import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { REVOKED_CLOSE_CODE, SUPERSEDED_CLOSE_CODE } from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace, type SocketLike } from "@durable-computer/runtime/node"
import { JobsUnsupported, type Sandbox, SandboxEnv } from "@durable-computer/sandbox"
import { registerSandboxConformance } from "@durable-computer/sandbox/testing"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { ExecutionEnv } from "@earendil-works/pi-durable/env"
import { afterAll, describe, expect, it } from "vitest"
import {
  computerSandbox,
  createComputerLinkActor,
  DaemonCore,
  type DaemonIO,
  LinkCore,
  linkStatus,
  RemoteError,
} from "../src/index.ts"
import { nodeDaemonIO } from "../src/node-io.ts"
import { nodeJobs } from "../src/node-jobs.ts"

// Typed as the interface the agent's tools are written against.
const environment = (sandbox: Sandbox): ExecutionEnv => new SandboxEnv(sandbox)

const fakeIO = (
  overrides: Partial<DaemonIO> = {},
): DaemonIO & { audits: Record<string, unknown>[] } => {
  const files = new Map<string, Uint8Array>()
  const audits: Record<string, unknown>[] = []
  return {
    audits,
    exec: async (command) => ({ stdout: `ran ${command}`, stderr: "", exitCode: 0 }),
    statSize: async (path) => files.get(path)?.length ?? null,
    readFile: async (path) => files.get(path)!,
    writeFile: async (path, bytes) => void files.set(path, bytes),
    stat: async (path) =>
      files.has(path) ? { kind: "file", size: files.get(path)!.length, mtimeMs: 1 } : null,
    list: async () => [],
    realpath: async (path) => path,
    mkdir: async () => {},
    remove: async () => {},
    rename: async () => {},
    audit: (entry) => void audits.push(entry),
    ...overrides,
  }
}

/** A link and a daemon joined by a wire that can be cut and restored. */
function wire(io: DaemonIO, options: { readOnly?: boolean } = {}) {
  let up = true
  const deliver = (to: () => { onFrame(raw: unknown): void }) => (frame: string) => {
    if (!up) return false
    queueMicrotask(() => to().onFrame(frame))
    return true
  }
  const link: LinkCore = new LinkCore(
    deliver(() => daemon),
    { execGraceMs: 50, fileOpTimeoutMs: 300 },
  )
  const daemon: DaemonCore = new DaemonCore(
    io,
    deliver(() => link),
    options,
  )
  return {
    link,
    daemon,
    cut: () => void (up = false),
    restore: () => {
      up = true
      daemon.onOpen()
    },
  }
}

describe("daemon protocol", () => {
  it("runs commands and records them", async () => {
    const io = fakeIO()
    const { link } = wire(io)
    expect(await link.exec("uname -a")).toEqual({ stdout: "ran uname -a", stderr: "", exitCode: 0 })
    expect(io.audits[0]).toMatchObject({ kind: "exec", command: "uname -a", exitCode: 0 })
  })

  it("moves files of any size in both directions, intact", async () => {
    const { link } = wire(fakeIO())
    const big = Uint8Array.from({ length: 700_000 }, (_, index) => (index * 7) % 256)
    await link.writeFile("/tmp/big.bin", big)
    const back = await link.readFile("/tmp/big.bin")
    expect(back.length).toBe(big.length)
    expect(back.every((byte, index) => byte === big[index])).toBe(true)
    await link.writeFile("/tmp/empty", new Uint8Array())
    expect((await link.readFile("/tmp/empty")).length).toBe(0)
    await expect(link.readFile("/tmp/missing")).rejects.toMatchObject({ code: "not_found" })
  })

  it("fails at once when the computer is offline", async () => {
    const { link, cut } = wire(fakeIO())
    cut()
    await expect(link.exec("ls")).rejects.toMatchObject({ code: "offline" })
    await expect(link.readFile("/x")).rejects.toBeInstanceOf(RemoteError)
    expect(link.pendingCount).toBe(0)
  })

  it("delivers a result late when the connection dropped while the command ran", async () => {
    const finish = Promise.withResolvers<void>()
    const io = fakeIO({
      exec: async () => {
        await finish.promise
        return { stdout: "built", stderr: "", exitCode: 0 }
      },
    })
    const { link, daemon, cut, restore } = wire(io)
    const result = link.exec("make", { timeoutMs: 5_000 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    cut()
    finish.resolve()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(daemon.outboxSize).toBe(1)
    restore()
    expect(await result).toMatchObject({ stdout: "built" })
    expect(daemon.outboxSize).toBe(0)
  })

  it("gives up on a result that never comes", async () => {
    const { link } = wire(fakeIO({ exec: () => new Promise(() => {}) }))
    await expect(link.exec("hang", { timeoutMs: 30 })).rejects.toMatchObject({ code: "timeout" })
  })

  it("refuses commands and writes when read-only, but still reads", async () => {
    const io = fakeIO()
    await io.writeFile("/notes.txt", new TextEncoder().encode("hello"))
    const { link } = wire(io, { readOnly: true })
    await expect(link.exec("rm -rf /")).rejects.toMatchObject({ code: "read_only" })
    await expect(link.writeFile("/x", new Uint8Array([1]))).rejects.toMatchObject({
      code: "read_only",
    })
    await expect(link.fs({ op: "remove", path: "/notes.txt" })).rejects.toMatchObject({
      code: "read_only",
    })
    expect(new TextDecoder().decode(await link.readFile("/notes.txt"))).toBe("hello")
    expect(await link.fs({ op: "stat", path: "/notes.txt" })).toMatchObject({
      kind: "file",
      size: 5,
    })
    expect(io.audits.filter((entry) => entry.kind === "refused").length).toBe(3)
  })
})

/** An in-memory WebSocket: the server end looks like a `ws` socket, the client end is the daemon's. */
function socketPair() {
  const server = {
    message: [] as ((data: unknown, binary: boolean) => void)[],
    close: [] as ((code: number, reason: unknown) => void)[],
  }
  const clientMessages: ((data: string) => void)[] = []
  const closed = Promise.withResolvers<number>()
  let state = 1
  const like: SocketLike = {
    get readyState() {
      return state
    },
    send: (data) => queueMicrotask(() => clientMessages.forEach((listener) => listener(data))),
    close: (code = 1000) => {
      if (state !== 1) return
      state = 3
      closed.resolve(code)
      server.close.forEach((listener) => listener(code, ""))
    },
    on: (event: string, listener: never) => {
      if (event === "message" || event === "close") server[event].push(listener)
      return like
    },
  }
  return {
    like,
    client: {
      send: (data: string) => {
        if (state !== 1) return false
        queueMicrotask(() => server.message.forEach((listener) => listener(data, false)))
        return true
      },
      onMessage: (listener: (data: string) => void) => void clientMessages.push(listener),
      closed: closed.promise,
    },
  }
}

const directory = mkdtempSync(join(tmpdir(), "dc-computers-"))
const namespace = new NodeActorNamespace({
  directory: join(directory, "links"),
  blobs: () => fileBlobs(join(directory, "blobs")),
  factory: (host) => createComputerLinkActor(host),
})
afterAll(() => namespace.close())

let counter = 0
/** Pair a "computer": a real daemon core on a temporary home directory, connected to its link. */
async function connectDaemon(name = `computer-${++counter}`, readOnly = false, old = false) {
  const home = mkdtempSync(join(tmpdir(), "dc-daemon-home-"))
  const pair = socketPair()
  const audits: Record<string, unknown>[] = []
  const daemon = new DaemonCore(
    nodeDaemonIO({ home, audit: (entry) => void audits.push(entry), shell: "sh" }),
    pair.client.send,
    { readOnly },
  )
  pair.client.onMessage((data) => daemon.onFrame(data))
  await namespace.connect(name, pair.like, new Request("http://link/connect"))
  pair.client.send(
    JSON.stringify({
      t: "hello",
      platform: "linux",
      hostname: "test-box",
      home,
      readOnly,
      version: "test",
      // A daemon from before there were jobs says nothing about them.
      ...(old ? {} : { jobs: true }),
    }),
  )
  daemon.onOpen()
  const sandbox = computerSandbox({ id: name, home, link: namespace.get(name) })
  return { name, home, sandbox, audits, closed: pair.client.closed }
}

// A paired computer has to behave exactly like the agent's own computer.
registerSandboxConformance({ describe, it, expect }, "paired computer", async () => {
  return (await connectDaemon()).sandbox
})

describe("computer link", () => {
  it("reports whether the computer is online and what it said about itself", async () => {
    const { name, home } = await connectDaemon()
    await new Promise((resolve) => setTimeout(resolve, 10))
    const status = await linkStatus(namespace.get(name))
    expect(status).toMatchObject({
      online: true,
      hello: { hostname: "test-box", home, readOnly: false },
    })
    expect(typeof status.lastSeenAt).toBe("number")
    expect(await linkStatus(namespace.get("never-connected"))).toEqual({
      online: false,
      lastSeenAt: null,
      hello: null,
    })
  })

  it("keeps a log on the machine of everything the agent did there", async () => {
    const { sandbox, audits } = await connectDaemon()
    const env = environment(sandbox)
    await env.exec("echo hi", undefined, BACKGROUND_CONTEXT)
    await env.writeFile("made.txt", "x", BACKGROUND_CONTEXT)
    expect(audits.map((entry) => entry.kind)).toEqual(expect.arrayContaining(["exec", "write"]))
    expect(audits.find((entry) => entry.kind === "exec")).toMatchObject({
      command: "echo hi",
      exitCode: 0,
    })
  })

  it("says so plainly when the computer is offline", async () => {
    const sandbox = computerSandbox({
      id: "x",
      home: "/home/x",
      link: namespace.get("offline-box"),
    })
    const result = await environment(sandbox).exec("ls", undefined, BACKGROUND_CONTEXT)
    expect(!result.ok && result.error.message).toBe("The computer is offline.")
  })

  it("lets a read-only computer be read but not changed", async () => {
    const writable = await connectDaemon("shared-home")
    await environment(writable.sandbox).writeFile("doc.txt", "contents", BACKGROUND_CONTEXT)
    const { sandbox } = await connectDaemon("read-only-box", true)
    const env = environment({ ...sandbox, home: writable.home })
    expect(await env.readTextFile(`${writable.home}/doc.txt`, BACKGROUND_CONTEXT)).toEqual({
      ok: true,
      value: "contents",
    })
    const listed = await env.listDir(writable.home, BACKGROUND_CONTEXT)
    expect(listed.ok && listed.value.map((entry) => entry.name)).toEqual(["doc.txt"])
    const write = await env.writeFile(`${writable.home}/new.txt`, "x", BACKGROUND_CONTEXT)
    expect(!write.ok && write.error.code).toBe("permission_denied")
    const exec = await env.exec("touch x", undefined, BACKGROUND_CONTEXT)
    expect(!exec.ok && exec.error.message).toContain("read-only")
  })

  it("replaces an older connection from the same computer", async () => {
    const first = await connectDaemon("twice")
    const second = await connectDaemon("twice")
    expect(await first.closed).toBe(SUPERSEDED_CLOSE_CODE)
    const result = await environment(second.sandbox).exec(
      "echo still here",
      undefined,
      BACKGROUND_CONTEXT,
    )
    expect(result.ok).toBe(true)
  })

  it("disconnects a removed computer and turns it away afterwards", async () => {
    const connected = await connectDaemon("to-revoke")
    await namespace.get("to-revoke").fetch(new Request("http://link/revoke", { method: "POST" }))
    expect(await connected.closed).toBe(REVOKED_CLOSE_CODE)
    const again = await connectDaemon("to-revoke")
    expect(await again.closed).toBe(REVOKED_CLOSE_CODE)
  })
})

describe("jobs on a paired computer", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  it("answers for a quick command, and leaves nothing behind", async () => {
    const { sandbox, home, audits } = await connectDaemon()
    const jobs = sandbox.jobs!("agent/1")
    let told = ""
    const done = await jobs.start(
      {
        id: "a",
        command: 'echo "$GREETING"; echo err >&2; pwd; exit 3',
        env: { GREETING: "hi" },
        lifeMs: 60_000,
      },
      {
        waitMs: 10_000,
        onOutput: (text) => (told += text),
        removeUnder: { bytes: 1000, lines: 100 },
      },
    )
    expect(done).toEqual({
      state: "exited",
      exitCode: 3,
      timedOut: false,
      output: `hi\nerr\n${home}\n`,
      next: `hi\nerr\n${home}\n`.length,
      kept: false,
    })
    expect(told).toBe(done.output)
    expect(existsSync(join(home, ".do-computer/jobs/agent_1/a"))).toBe(false)
    expect(audits).toContainEqual(expect.objectContaining({ kind: "job" }))
  })

  it("leaves a slow command running, to be followed from where it was and stopped", async () => {
    const { sandbox, home } = await connectDaemon()
    const jobs = sandbox.jobs!("agent-1")
    const first = await jobs.start(
      {
        id: "slow",
        command: "echo one; sleep 1; echo two; sleep 300 & echo $! > child; wait",
        lifeMs: 600_000,
      },
      { waitMs: 200 },
    )
    expect(first).toEqual({ state: "running", output: "one\n", next: 4, kept: true })
    expect(jobs.log("slow")).toBe(join(home, ".do-computer/jobs/agent-1/slow/output.log"))
    const rest = await jobs.follow("slow", { from: first.next, waitMs: 1_500 })
    expect(rest).toEqual({ state: "running", output: "two\n", next: 8, kept: true })
    expect(await jobs.check(["slow", "never"])).toEqual({
      slow: { state: "running", size: 8 },
      never: { state: "lost", size: 0 },
    })
    const child = Number(readFileSync(join(home, "child"), "utf8"))
    await jobs.stop("slow")
    const ended = await jobs.follow("slow", { from: 8, waitMs: 10_000 })
    expect(ended).toMatchObject({ state: "exited", timedOut: false })
    expect(ended.state === "exited" && ended.exitCode).not.toBe(0)
    await sleep(100)
    expect(() => process.kill(child, 0)).toThrow()
    await jobs.remove(["slow"])
    expect(existsSync(join(home, ".do-computer/jobs/agent-1/slow"))).toBe(false)
  })

  it("stops a job at its time limit and says that is what happened", async () => {
    const { sandbox } = await connectDaemon()
    const ended = await sandbox.jobs!("agent-1").start(
      { id: "t", command: "echo begun; sleep 30", lifeMs: 500 },
      { waitMs: 10_000 },
    )
    expect(ended).toMatchObject({
      state: "exited",
      exitCode: 124,
      timedOut: true,
      output: "begun\n",
    })
  })

  it("finds a job again after the daemon restarted, and can still stop it", async () => {
    const home = mkdtempSync(join(tmpdir(), "dc-daemon-home-"))
    const keeper = () => nodeJobs({ home, shell: "sh", resolve: (target) => target })("agent-1")
    const first = await keeper().start(
      { id: "j", command: "echo up; sleep 300", lifeMs: 600_000 },
      { waitMs: 200 },
    )
    expect(first).toMatchObject({ state: "running", output: "up\n" })
    // A daemon that knows nothing of the job but its folder.
    const after = keeper()
    expect((await after.check(["j"])).j).toEqual({ state: "running", size: 3 })
    await after.stop("j")
    expect(await after.follow("j", { from: 0, waitMs: 0 })).toMatchObject({
      state: "exited",
      exitCode: 143,
      output: "up\n",
    })
  })

  it("will not start one on a read-only computer", async () => {
    const { sandbox } = await connectDaemon(undefined, true)
    await expect(
      sandbox.jobs!("agent-1").start({ id: "a", command: "echo hi", lifeMs: 1_000 }, { waitMs: 0 }),
    ).rejects.toThrow(/read-only/)
  })

  it("says so when the daemon is from before there were jobs", async () => {
    const { sandbox } = await connectDaemon(undefined, false, true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    await expect(
      sandbox.jobs!("agent-1").start({ id: "a", command: "echo hi", lifeMs: 1_000 }, { waitMs: 0 }),
    ).rejects.toBeInstanceOf(JobsUnsupported)
  })
})

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { ActorStub } from "@do-computer/runtime"
import { expect, it } from "vitest"
import { nodeDaemonIO } from "../src/node-io.ts"
import { DaemonCore } from "../src/daemon-core.ts"
import { LinkCore } from "../src/link-core.ts"
import { computerSandbox } from "../src/sandbox.ts"

it("does not send pre-aborted execs or job waits", async () => {
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  const sandbox = computerSandbox({
    id: "test",
    home: "/tmp",
    link: {
      async fetch() {
        calls++
        throw new Error("must not send")
      },
    } as unknown as ActorStub,
  })
  await expect(sandbox.exec("true", { signal: controller.signal })).rejects.toMatchObject({
    name: "AbortError",
  })
  await expect(
    sandbox.jobs!("test").follow("job", { from: 0, waitMs: 60_000, signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" })
  expect(calls).toBe(0)
})

it.each(["exec", "follow"])(
  "releases an aborted %s wait even if the transport is stuck",
  async (kind) => {
    const controller = new AbortController()
    const requests: Request[] = []
    const answer = Promise.withResolvers<Response>()
    const sandbox = computerSandbox({
      id: "test",
      home: "/tmp",
      link: {
        fetch(request: Request) {
          requests.push(request)
          return request.url.endsWith("/cancel")
            ? Promise.resolve(Response.json({ ok: true }))
            : answer.promise
        },
      } as unknown as ActorStub,
    })
    const pending =
      kind === "exec"
        ? sandbox.exec("sleep 30", { signal: controller.signal })
        : sandbox.jobs!("test").follow("job", {
            from: 0,
            waitMs: 60_000,
            signal: controller.signal,
          })
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" })
    controller.abort()
    await rejected
    // Following a background job cancels only the wait, not the job itself.
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual(
      kind === "exec" ? ["/exec", "/cancel"] : ["/job"],
    )
    answer.resolve(
      Response.json(kind === "exec" ? { stdout: "", stderr: "", exitCode: 0 } : { value: {} }),
    )
  },
)

it("prevents an exec from starting when cancellation arrives before its HTTP request", async () => {
  const frames: string[] = []
  const link = new LinkCore((frame) => {
    frames.push(JSON.parse(frame).t)
    return true
  })
  link.cancel("request-id")
  await expect(link.exec("must not run", { requestId: "request-id" })).rejects.toMatchObject({
    code: "aborted",
  })
  expect(frames).toEqual(["cancel"])
  expect(link.pendingCount).toBe(0)
})

it("kills an in-flight daemon exec and releases its busy state on cancellation", async () => {
  const home = await mkdtemp(join(tmpdir(), "dc-cancel-"))
  const io = nodeDaemonIO({ home, audit() {} })
  const link: LinkCore = new LinkCore((frame) => {
    daemon.onFrame(frame)
    return true
  })
  const daemon: DaemonCore = new DaemonCore(io, (frame) => {
    link.onFrame(frame)
    return true
  })
  try {
    const pending = link.exec("sleep 30", { requestId: "cancel-me" })
    const rejected = expect(pending).rejects.toMatchObject({ code: "aborted" })
    expect(daemon.busy).toBe(true)
    link.cancel("cancel-me")
    await rejected
    await expect.poll(() => daemon.busy).toBe(false)
    expect(link.pendingCount).toBe(0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

it("settles a host timeout even when sending cancellation throws", async () => {
  const link = new LinkCore(
    (frame) => {
      if (JSON.parse(frame).t === "cancel") throw new Error("socket closed")
      return true
    },
    { execGraceMs: 5 },
  )
  await expect(link.exec("hang", { timeoutMs: 5 })).rejects.toMatchObject({ code: "timeout" })
  expect(link.pendingCount).toBe(0)
})

it("does not spawn an already-aborted daemon exec", async () => {
  const controller = new AbortController()
  controller.abort()
  const io = nodeDaemonIO({ home: "/tmp", shell: "/does/not/exist", audit() {} })
  expect(
    await io.exec("must not run", { env: {}, timeoutMs: 1000, signal: controller.signal }),
  ).toMatchObject({ exitCode: 130 })
})

it("sends cancellation when the host exec deadline expires", async () => {
  const frames: string[] = []
  const link = new LinkCore(
    (frame) => {
      frames.push(JSON.parse(frame).t)
      return true
    },
    { execGraceMs: 5 },
  )
  await expect(link.exec("hang", { timeoutMs: 5 })).rejects.toMatchObject({ code: "timeout" })
  expect(frames).toEqual(["exec", "cancel"])
})

it.skipIf(process.platform !== "linux")(
  "settles an exec whose escaped child keeps stdout open past its deadline",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "dc-escaped-"))
    const file = join(home, "pid")
    let pid = 0
    try {
      const io = nodeDaemonIO({ home, shell: "/bin/sh", audit() {} })
      const result = io.exec("setsid -f sh -c 'echo $$ > \"$PID_FILE\"; exec sleep 30' &", {
        env: { PID_FILE: file },
        timeoutMs: 200,
      })
      await expect
        .poll(async () => {
          pid = Number(await readFile(file, "utf8").catch(() => ""))
          return pid > 0
        })
        .toBe(true)
      const outcome = await Promise.race([result, delay(1500).then(() => "stuck" as const)])
      expect(outcome).toMatchObject({ exitCode: 124 })
    } finally {
      if (pid > 0)
        try {
          process.kill(-pid, "SIGKILL")
        } catch {}
      await rm(home, { recursive: true, force: true })
    }
  },
)

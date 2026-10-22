import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { afterEach, expect, it, vi } from "vitest"
import { LinkCore } from "../src/link-core.ts"
import { DaemonCore, type DaemonIO } from "../src/daemon-core.ts"
import { nodeJobs } from "../src/node-jobs.ts"
import { JOB_RUNNER } from "../src/job-runner.ts"

const homes: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})
const home = async () => {
  const dir = await mkdtemp(join(tmpdir(), "dc-lifecycle-"))
  homes.push(dir)
  return dir
}
const keeper = (dir: string) => nodeJobs({ home: dir, shell: "sh", resolve: (p) => p })("audit")

const operations = {
  exec: (link: LinkCore) => link.exec("unused"),
  read: (link: LinkCore) => link.readFile("/unused"),
  write: (link: LinkCore) => link.writeFile("/unused", new Uint8Array([1])),
  fs: (link: LinkCore) => link.fs({ op: "stat", path: "/unused" }),
  image: (link: LinkCore) => link.image({ path: "/unused", maxEdge: 1, maxPixels: 1, maxBytes: 1 }),
  job: (link: LinkCore) => link.job({ op: "check", scope: "audit", jobs: [] }),
  use: (link: LinkCore) => link.use({ t: "screen", op: "view" }),
}
const replies = {
  exec: { t: "exec_result", stdout: "", stderr: "", exitCode: 0 },
  read: { t: "file_chunk", seq: 0, data: "", last: true },
  write: { t: "ok" },
  fs: { t: "fs_result", value: true },
  image: { t: "image_result", value: null },
  job: { t: "job_result", value: {} },
  use: { t: "use_result", value: true },
}
for (const [kind, start] of Object.entries(operations)) {
  it(`keeps the ${kind} deadline armed across all mismatched response kinds`, async () => {
    let id = ""
    const link = new LinkCore((raw) => {
      id = JSON.parse(raw).id
      return true
    })
    const pending = start(link)
    for (const [other, reply] of Object.entries(replies)) {
      if (other === kind) continue
      link.onFrame(JSON.stringify({ ...reply, id }))
      expect(link.pendingCount).toBe(1)
    }
    const rejected = expect(pending).rejects.toThrow("test cleanup")
    link.onFrame(JSON.stringify({ t: "err", id, code: "io", message: "test cleanup" }))
    await rejected
    expect(link.pendingCount).toBe(0)
  })
}

it("rejects a malformed terminal file chunk instead of losing its deadline", async () => {
  let id = ""
  const link = new LinkCore((raw) => {
    id = JSON.parse(raw).id
    return true
  })
  const pending = link.readFile("/unused")
  const rejected = expect(pending).rejects.toThrow("invalid base64")
  link.onFrame(JSON.stringify({ t: "file_chunk", id, seq: 0, data: "%not-base64", last: true }))
  await rejected
  expect(link.pendingCount).toBe(0)
})

it("bounds tracked filesystem work, clears busy, and drops its late success", async () => {
  vi.useFakeTimers()
  const read = Promise.withResolvers<Uint8Array>()
  const frames: string[] = []
  const daemon = new DaemonCore(
    { statSize: async () => 1, readFile: () => read.promise, audit() {} } as unknown as DaemonIO,
    (raw) => {
      frames.push(raw)
      return true
    },
    { operationTimeoutMs: 10 },
  )
  daemon.onFrame(JSON.stringify({ t: "read", id: "stalled", path: "/unused" }))
  expect(daemon.busy).toBe(true)
  await vi.advanceTimersByTimeAsync(10)
  expect(daemon.busy).toBe(false)
  expect(frames.map((raw) => JSON.parse(raw))).toMatchObject([
    { t: "err", id: "stalled", code: "io" },
  ])
  read.resolve(new Uint8Array([1]))
  await vi.advanceTimersByTimeAsync(0)
  expect(frames).toHaveLength(1)
  expect(daemon.busy).toBe(false)
})

it("honors stop-before-start even across new keeper instances", async () => {
  const dir = await home()
  await keeper(dir).stop("late")
  const result = await keeper(dir).start(
    { id: "late", command: "touch should-not-exist", lifeMs: 1000 },
    { waitMs: 50 },
  )
  expect(result.state).not.toBe("running")
  await expect(readFile(join(dir, "should-not-exist"))).rejects.toThrow()
})

it("claims concurrent/replayed starts once and rejects a different command", async () => {
  const dir = await home(),
    jobs = keeper(dir)
  const job = { id: "once", command: "echo once >> marker; sleep 1", lifeMs: 3000 }
  try {
    await Promise.all([jobs.start(job, { waitMs: 100 }), jobs.start(job, { waitMs: 100 })])
    await keeper(dir).start(job, { waitMs: 100 })
    expect(await readFile(join(dir, "marker"), "utf8")).toBe("once\n")
    await expect(jobs.start({ ...job, command: "echo different" }, { waitMs: 0 })).rejects.toThrow(
      "already owns",
    )
  } finally {
    await jobs.stop("once")
    await jobs.follow("once", { from: 0, waitMs: 5000 })
  }
})

it("passes command Node options through without applying them to the supervisor", async () => {
  const dir = await home()
  const result = await keeper(dir).start(
    {
      id: "env",
      command: 'printf "%s" "$NODE_OPTIONS"',
      env: { NODE_OPTIONS: "--not-a-real-node-option" },
      lifeMs: 3000,
    },
    { waitMs: 3000 },
  )
  expect(result).toMatchObject({ state: "exited", exitCode: 0, output: "--not-a-real-node-option" })
})

it("keeps trusted runtime-only flags out of the command environment", async () => {
  const dir = await home()
  const jobs = nodeJobs({
    home: dir,
    shell: "sh",
    resolve: (p) => p,
    nodeEnv: { DC_HELPER_ONLY: "1" },
  })("audit")
  const result = await jobs.start(
    { id: "runtime", command: 'printf "%s" "${DC_HELPER_ONLY-absent}"', lifeMs: 3000 },
    { waitMs: 3000 },
  )
  expect(result).toMatchObject({ state: "exited", exitCode: 0, output: "absent" })
})

it("does not replay a command after its short output folder was removed", async () => {
  const dir = await home(),
    job = { id: "small", command: "echo once >> marker", lifeMs: 3000 }
  await keeper(dir).start(job, { waitMs: 3000, removeUnder: { bytes: 100, lines: 10 } })
  await keeper(dir).start(job, { waitMs: 0 })
  expect(await readFile(join(dir, "marker"), "utf8")).toBe("once\n")
})

const gone = async (pid: number) => {
  try {
    process.kill(pid, 0)
  } catch {
    return true
  }
  const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "")
  return stat !== "" && stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")
}

const cases = {
  // The command ends by itself: what it started in the background is meant to outlive it, as
  // `server &` or `nohup server &` does, and as the Linux sandbox's jobs leave it.
  exits: { command: "sleep 30 & echo $! > child-marker; echo started", survives: true },
  stopped: { command: "sleep 30 & echo $! > child-marker; wait", survives: false },
  "TERM-ignoring": {
    command: "trap '' TERM; echo $$ > child-marker; while :; do sleep 1; done",
    survives: false,
  },
}
for (const [name, { command, survives }] of Object.entries(cases)) {
  it.skipIf(process.platform === "win32")(
    survives
      ? "leaves a background child running after the command exits by itself"
      : `stops the whole group of a ${name} command, not just its supervisor`,
    async () => {
      const dir = await home(),
        jobs = keeper(dir),
        id = name.replace(/[^a-z]/gi, "")
      const folder = join(dir, ".do-computer", "jobs", "audit", id)
      let child = 0,
        supervisor = 0
      try {
        await jobs.start({ id, command, lifeMs: 20_000 }, { waitMs: 150 })
        await expect
          .poll(() => readFile(join(dir, "child-marker"), "utf8").catch(() => ""))
          .not.toBe("")
        child = Number(await readFile(join(dir, "child-marker"), "utf8"))
        supervisor = Number(await readFile(join(folder, "pid"), "utf8"))
        if (survives) {
          const ended = await jobs.follow(id, { from: 0, waitMs: 3000 })
          expect(ended).toMatchObject({ state: "exited", exitCode: 0, output: "started\n" })
          // Past the supervisor's four-second escalation, which must not have been armed.
          await delay(4500)
          expect(await gone(child)).toBe(false)
        } else {
          await jobs.stop(id)
          await expect.poll(() => gone(child), { timeout: 6500 }).toBe(true)
        }
      } finally {
        for (const pid of [child, supervisor])
          if (pid > 0) {
            try {
              process.kill(survives ? pid : -pid, "SIGKILL")
            } catch {}
          }
      }
    },
    15_000,
  )
}

it.skipIf(process.platform === "win32")(
  "enforces a detached process deadline after its launching daemon exits, without check()",
  async () => {
    const dir = await home(),
      stopped = join(dir, "stopped"),
      childFile = join(dir, "command-pid")
    const deadline = Date.now() + 1_000
    const args = [
      "-e",
      JOB_RUNNER,
      "--",
      dir,
      stopped,
      "sh",
      JSON.stringify(["-c", `echo $$ > '${childFile}'; exec sleep 30`]),
      String(deadline),
      "100000",
    ]
    const owner = `const fs=require('node:fs'),{spawn}=require('node:child_process');const log=fs.openSync(${JSON.stringify(join(dir, "output.log"))},'a');const p=spawn(process.execPath,${JSON.stringify(args)},{detached:true,stdio:['ignore',log,log]});p.unref();process.exit(0)`
    const result = spawnSync(process.execPath, ["-e", owner], { encoding: "utf8", timeout: 3000 })
    expect(result.status, result.stderr).toBe(0)
    let child = 0,
      supervisor = 0
    try {
      await expect
        .poll(async () => {
          child = Number(await readFile(childFile, "utf8").catch(() => "0"))
          supervisor = Number(await readFile(join(dir, "pid"), "utf8").catch(() => "0"))
          return child > 0
        })
        .toBe(true)
      await expect
        .poll(() => readFile(join(dir, "exit"), "utf8").catch(() => ""), { timeout: 7000 })
        .toMatch(/^124 1 /)
      expect(() => process.kill(child, 0)).toThrow()
    } finally {
      for (const pid of [child, supervisor])
        if (pid > 0) {
          try {
            process.kill(-pid, "SIGKILL")
          } catch {}
        }
      await delay(20)
    }
  },
)

it.skipIf(process.platform === "win32")(
  "stops a job at its wall-clock deadline even when the monotonic clock did not move, as across sleep",
  async () => {
    const dir = await home(),
      childFile = join(dir, "command-pid")
    // What waking from sleep looks like to the supervisor: an hour has passed on the wall clock,
    // and none on the monotonic one its timers run on.
    const wake =
      "const realNow = Date.now; let slept = 0; setTimeout(() => (slept = 3600000), 300).unref(); Date.now = () => realNow() + slept;\n"
    const args = [
      "-e",
      wake + JOB_RUNNER,
      "--",
      dir,
      join(dir, "stopped"),
      "sh",
      JSON.stringify(["-c", `echo $$ > '${childFile}'; exec sleep 30`]),
      String(Date.now() + 60 * 60_000 - 1),
      "100000",
    ]
    const { spawn } = await import("node:child_process")
    const supervisor = spawn(process.execPath, args, { detached: true, stdio: "ignore" })
    try {
      await expect
        .poll(() => readFile(join(dir, "exit"), "utf8").catch(() => ""), { timeout: 3000 })
        .toMatch(/^124 1 /)
    } finally {
      const child = Number(await readFile(childFile, "utf8").catch(() => "0"))
      for (const pid of [child, supervisor.pid ?? 0])
        if (pid > 0) {
          try {
            process.kill(-pid, "SIGKILL")
          } catch {}
        }
    }
  },
)

import { type ChildProcess, spawn } from "node:child_process"
import { closeSync, openSync, promises as fs } from "node:fs"
import { constants } from "node:os"
import * as path from "node:path"
import { EXEC_STDIO_CAP, JOB_LOG_CAP_BYTES } from "@durable-computer/protocol"
import type { JobFollowed, JobState, SandboxJobs } from "@durable-computer/sandbox"

export type NodeJobsOptions = {
  /** Where the folders of jobs are kept, under `.do-computer/jobs`. */
  readonly home: string
  /** The shell commands run in. Default `bash`. */
  readonly shell?: string
  /** Where a path that does not start at the root starts. */
  readonly resolve: (target: string) => string
  /** A job prints at most this much before it is stopped. */
  readonly logCapBytes?: number
}

/** A folder left behind is removed this long after its job ended. */
const KEEP_MS = 7 * 24 * 60 * 60_000
/** How long a job has to stop when asked before it is killed. */
const KILL_AFTER_MS = 5_000
/** How often a running job's log is measured against the cap. */
const MEASURE_EVERY_MS = 2_000

/**
 * Runs the command and writes how it ended, as `<exit code> <stopped at its limit>`. It writes
 * that itself so that it is on record even if the daemon is not there to see the command end.
 */
const WRAP =
  's=$(date +%s); "$3" -c "$1"; c=$?; echo "$c 0 $(( ($(date +%s) - s) * 1000 ))" > "$2/exit.tmp" && mv "$2/exit.tmp" "$2/exit"'

type Live = {
  child: ChildProcess
  /** Why the daemon stopped it, if it did: its time limit, or printing too much. */
  ended?: "limit" | "output"
  /** What is waiting to stop it at its time limit. */
  timers: ReturnType<typeof setTimeout>[]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // It is there and is somebody else's, which a job of ours never is.
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/** Ask a job's whole process group to stop, and kill it a few seconds later if it has not. */
function stopGroup(pid: number): ReturnType<typeof setTimeout> | undefined {
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    return undefined
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL")
    } catch {
      // Already gone.
    }
  }, KILL_AFTER_MS)
  timer.unref()
  return timer
}

/**
 * Jobs on a real machine, kept by the daemon through Node: the same folders and the same
 * meaning as `shellJobs`, without the Linux programs that one needs. A job is a process group
 * of its own, so it runs on when the daemon restarts; the daemon that comes back finds it by
 * its folder.
 */
export function nodeJobs(options: NodeJobsOptions): (scope: string) => SandboxJobs {
  const cap = options.logCapBytes ?? JOB_LOG_CAP_BYTES
  const live = new Map<string, Live>()

  const readExit = async (dir: string): Promise<JobState | undefined> => {
    const text = await fs.readFile(path.join(dir, "exit"), "utf8").catch(() => undefined)
    if (text === undefined) return undefined
    const [code, late, ran] = text.trim().split(" ")
    const exitCode = Number(code)
    const ranMs = Number(ran)
    return {
      state: "exited",
      exitCode: Number.isInteger(exitCode) ? exitCode : 1,
      timedOut: late === "1",
      ...(ran !== undefined && Number.isFinite(ranMs) && ranMs >= 0 ? { ranMs } : {}),
    }
  }
  const writeExit = async (dir: string, exitCode: number, late: boolean, ranMs?: number) => {
    if ((await readExit(dir)) !== undefined) return
    await fs.writeFile(
      path.join(dir, "exit.tmp"),
      `${exitCode} ${late ? 1 : 0}${ranMs === undefined ? "" : ` ${Math.round(ranMs)}`}\n`,
    )
    await fs.rename(path.join(dir, "exit.tmp"), path.join(dir, "exit"))
  }
  const number = async (file: string) =>
    Number(await fs.readFile(file, "utf8").catch(() => "")) || 0
  const sizeOf = async (dir: string) =>
    (await fs.stat(path.join(dir, "output.log")).catch(() => undefined))?.size

  const state = async (dir: string): Promise<JobState> => {
    const exited = await readExit(dir)
    if (exited !== undefined) return exited
    // One this daemon started is running until the daemon has written how it ended.
    if (live.has(dir)) return { state: "running" }
    const pid = await number(path.join(dir, "pid"))
    if (pid > 0 && alive(pid)) {
      // A daemon that restarted has no timer for it. Its limit is on record all the same.
      const deadline = await number(path.join(dir, "deadline"))
      if (deadline > 0 && Date.now() > deadline) {
        stopGroup(pid)
        await writeExit(dir, 124, true)
        return { state: "exited", exitCode: 124, timedOut: true }
      }
      return { state: "running" }
    }
    return (await readExit(dir)) ?? { state: "lost" }
  }

  const start = async (
    dir: string,
    job: { command: string; cwd?: string; env?: Readonly<Record<string, string>>; lifeMs: number },
  ) => {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "command"), `${job.command}\n`)
    const log = openSync(path.join(dir, "output.log"), "a")
    let child: ChildProcess
    try {
      // Its own process group, so that stopping it stops what it started, and so that it is
      // not stopped with the daemon.
      child = spawn("sh", ["-c", WRAP, "job", job.command, dir, options.shell ?? "bash"], {
        cwd: job.cwd === undefined ? options.home : options.resolve(job.cwd),
        env: { ...process.env, ...job.env },
        detached: true,
        stdio: ["ignore", log, log],
      })
    } finally {
      closeSync(log)
    }
    const startedAt = Date.now()
    const entry: Live = { child, timers: [] }
    live.set(dir, entry)
    // The kill that follows is left to happen after the command's shell has gone: something
    // it started may not have stopped when asked.
    const stop = (why: Live["ended"]) => {
      entry.ended ??= why
      if (child.pid !== undefined) stopGroup(child.pid)
    }
    const over = async (exitCode: number) => {
      for (const timer of entry.timers) clearTimeout(timer)
      clearInterval(measure)
      // The command writes how it ended. A stopped one did not live to.
      await writeExit(
        dir,
        entry.ended === "limit" ? 124 : exitCode,
        entry.ended === "limit",
        Date.now() - startedAt,
      ).catch(() => {})
      live.delete(dir)
    }
    const limit = setTimeout(() => stop("limit"), job.lifeMs)
    limit.unref()
    entry.timers.push(limit)
    const measure = setInterval(() => {
      void sizeOf(dir).then((size) => {
        if (size !== undefined && size > cap) stop("output")
      })
    }, MEASURE_EVERY_MS)
    measure.unref()
    child.on("error", (error) => {
      void fs
        .appendFile(path.join(dir, "output.log"), `Could not start the command: ${error.message}\n`)
        .catch(() => {})
        .then(() => over(127))
    })
    child.on("exit", (code, signal) => {
      void over(code ?? 128 + (signal === null ? 0 : (constants.signals[signal] ?? 0)))
    })
    // The daemon does not wait for it to end before it can exit itself.
    child.unref()
    if (child.pid !== undefined) {
      await fs.writeFile(path.join(dir, "pid"), String(child.pid))
      await fs.writeFile(path.join(dir, "deadline"), String(Date.now() + job.lifeMs))
    }
  }

  const follow = async (
    dir: string,
    from: number,
    waitMs: number,
    removeUnder: { bytes: number; lines: number } | undefined,
  ): Promise<JobFollowed> => {
    const until = Date.now() + Math.max(0, waitMs)
    let stands = await state(dir)
    for (
      let nap = 10;
      stands.state === "running" && Date.now() < until;
      nap = Math.min(nap * 2, 200)
    ) {
      await sleep(Math.min(nap, Math.max(0, until - Date.now())))
      stands = await state(dir)
    }
    const size = await sizeOf(dir)
    if (size === undefined) return { state: "lost", output: "", next: from, kept: true }
    // What is sent has to fit in one frame, so past that only the end of it is.
    let begin = Math.min(from, size)
    let note = ""
    if (size - begin > EXEC_STDIO_CAP) {
      note = `\n[${size - begin - EXEC_STDIO_CAP} bytes of output are not shown here]\n`
      begin = size - EXEC_STDIO_CAP
    }
    const bytes = Buffer.alloc(size - begin)
    if (bytes.length > 0) {
      const file = await fs.open(path.join(dir, "output.log"), "r")
      try {
        await file.read(bytes, 0, bytes.length, begin)
      } finally {
        await file.close()
      }
    }
    let kept = true
    if (stands.state === "exited" && removeUnder !== undefined && size <= removeUnder.bytes) {
      const whole = begin === 0 ? bytes : await fs.readFile(path.join(dir, "output.log"))
      let lines = 0
      for (const byte of whole) if (byte === 10) lines++
      if (lines <= removeUnder.lines) {
        await fs.rm(dir, { recursive: true, force: true })
        kept = false
      }
    }
    return { ...stands, output: note + bytes.toString("utf8"), next: size, kept }
  }

  return (scope) => {
    const base = path.join(
      options.home,
      ".do-computer",
      "jobs",
      scope.replace(/[^A-Za-z0-9_-]/g, "_"),
    )
    const dirOf = (id: string) => {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`"${id}" cannot name a job`)
      return path.join(base, id)
    }
    const sweep = async () => {
      for (const name of await fs.readdir(base).catch(() => [])) {
        const dir = path.join(base, name)
        const stats = await fs.stat(dir).catch(() => undefined)
        if (stats?.isDirectory() && Date.now() - stats.mtimeMs > KEEP_MS && !live.has(dir)) {
          await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
        }
      }
    }
    return {
      start: async (job, options) => {
        const dir = dirOf(job.id)
        await start(dir, job)
        return follow(dir, 0, options.waitMs, options.removeUnder)
      },
      follow: (id, options) => follow(dirOf(id), options.from, options.waitMs, options.removeUnder),
      stop: async (id) => {
        const dir = dirOf(id)
        if ((await readExit(dir)) !== undefined) return
        const pid = await number(path.join(dir, "pid"))
        if (pid <= 0) return
        stopGroup(pid)
        if (live.has(dir)) return
        // A job from before the daemon restarted: nobody is listening for its end.
        for (let waited = 0; alive(pid) && waited < KILL_AFTER_MS + 1_000; waited += 100) {
          await sleep(100)
        }
        await writeExit(dir, 143, false)
      },
      check: async (ids) => {
        const found: Record<string, JobState & { size: number }> = {}
        for (const id of ids) {
          const dir = dirOf(id)
          found[id] = { ...(await state(dir)), size: (await sizeOf(dir)) ?? 0 }
        }
        await sweep()
        return found
      },
      remove: async (ids) => {
        for (const id of ids) await fs.rm(dirOf(id), { recursive: true, force: true })
      },
      log: (id) => path.join(dirOf(id), "output.log"),
    }
  }
}

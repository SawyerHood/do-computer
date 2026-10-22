import { type ChildProcess, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { closeSync, openSync, promises as fs } from "node:fs"
import { constants } from "node:os"
import * as path from "node:path"
import { EXEC_STDIO_CAP, JOB_LOG_CAP_BYTES } from "@do-computer/protocol"
import type { JobFollowed, JobState, SandboxJobs } from "@do-computer/sandbox"
import { killTree } from "./kill.ts"
import { JOB_RUNNER } from "./job-runner.ts"
import { shownPath, toPosixView } from "./paths.ts"
import { findShell, posixShell, type Shell } from "./shell.ts"

export type NodeJobsOptions = {
  /** Where the folders of jobs are kept, under `.do-computer/jobs`. */
  readonly home: string
  /** The shell commands run in: the name of one like `sh`, or a `Shell`. Default `findShell()`. */
  readonly shell?: string | Shell
  /** Where a path that does not start at the root starts. */
  readonly resolve: (target: string) => string
  /** A job prints at most this much before it is stopped. */
  readonly logCapBytes?: number
  /** Trusted flags needed to rerun this runtime (for example Electron as Node), helper only. */
  readonly nodeEnv?: NodeJS.ProcessEnv
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

/**
 * The same on Windows, with two things done first. The script opens the log itself: Git's
 * bash prints nothing into a file it was handed already open for appending, which the first
 * run on a Windows machine showed. And it writes which process it is. What the daemon starts
 * there is Git's launcher for bash, which Windows ends when the daemon ends; the bash the
 * launcher starts runs on, and is the one to find again and to stop.
 */
const WINDOWS_WRAP = `exec >> "$2/output.log" 2>&1; cat /proc/$$/winpid > "$2/pid"; ${WRAP}`

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

/**
 * Ask a job's whole process group to stop, and kill it a few seconds later if it has not. On
 * Windows the asking is already by force, so nothing follows it.
 */
function stopGroup(pid: number, dir: string): ReturnType<typeof setTimeout> | undefined {
  if (process.platform === "win32") {
    killTree(pid, "SIGTERM")
    return undefined
  }
  // Capture before a completed job can purge its output folder. The supervisor and
  // command have different groups: killing only the supervisor would orphan the command.
  const metadata = Promise.all([
    fs.readFile(path.join(dir, "child.pid"), "utf8").then(Number, () => 0),
    fs.stat(path.join(dir, "supervised")).then(
      () => true,
      (error) => (error as NodeJS.ErrnoException).code !== "ENOENT",
    ),
  ])
  if (!killTree(pid, "SIGTERM")) return undefined
  const timer = setTimeout(() => {
    void metadata.then(([child, supervised]) => {
      if (child > 0) killTree(child, "SIGKILL")
      // A not-yet-allocated child is still the supervisor's responsibility. Never
      // destroy its independent deadline unless we can also stop its command group.
      if (!supervised || child > 0) killTree(pid, "SIGKILL")
    })
  }, KILL_AFTER_MS + 1_000)
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
  const shell =
    typeof options.shell === "string" ? posixShell(options.shell) : (options.shell ?? findShell())
  const windows = process.platform === "win32"
  /** The program a job is, and what it is given. */
  const program = (command: string, dir: string, deadline: number): [string, string[]] => {
    if (!windows) {
      return [
        process.execPath,
        [
          "-e",
          JOB_RUNNER,
          "--",
          dir,
          path.join(claimOf(dir), "stopped"),
          shell.file,
          JSON.stringify(shell.args(command)),
          String(deadline),
          String(cap),
        ],
      ]
    }
    // A shell that cannot run the script around a job, PowerShell on Windows, runs the command
    // alone. The daemon writes how it ended when it sees it end, and on Windows the command
    // ends with the daemon, so one from before the daemon restarted is reported as lost.
    if (!shell.posix) return [shell.file, shell.args(command)]
    // Windows has no `sh` but the one that comes with Git's bash, which is also the `bash` on
    // the PATH inside it, and which is told where the folder is in its own way of writing it.
    if (windows) {
      return [shell.file, ["-c", WINDOWS_WRAP, "job", command, toPosixView(dir), "bash"]]
    }
    return ["sh", ["-c", WRAP, "job", command, dir, shell.file]]
  }
  const live = new Map<string, Live>()
  const claimOf = (dir: string) => path.join(path.dirname(dir), ".claims", path.basename(dir))
  const locks = new Map<string, Promise<unknown>>()
  const serial = <T>(dir: string, work: () => Promise<T>): Promise<T> => {
    const next = (locks.get(dir) ?? Promise.resolve()).catch(() => {}).then(work)
    locks.set(dir, next)
    void next
      .finally(() => {
        if (locks.get(dir) === next) locks.delete(dir)
      })
      .catch(() => {})
    return next
  }

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
  const exists = (file: string) =>
    fs.stat(file).then(
      () => true,
      () => false,
    )
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
      // A daemon that restarted has no timer for it. Its limit is on record all the same. A
      // supervised job's supervisor stops it at its limit itself; this is only for one whose
      // supervisor has failed to.
      const deadline = await number(path.join(dir, "deadline"))
      const grace = (await exists(path.join(dir, "supervised"))) ? KILL_AFTER_MS * 2 : 0
      if (deadline > 0 && Date.now() > deadline + grace) {
        stopGroup(pid, dir)
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
    if (!Number.isFinite(job.lifeMs) || job.lifeMs <= 0 || job.lifeMs > 24 * 60 * 60_000) {
      throw new Error("Invalid job lifetime: expected at most 24 hours")
    }
    const claim = claimOf(dir)
    await fs.mkdir(claim, { recursive: true, mode: 0o700 })
    const identity = createHash("sha256")
      .update(
        JSON.stringify({
          command: job.command,
          cwd: job.cwd,
          env:
            job.env === undefined ? undefined : Object.fromEntries(Object.entries(job.env).sort()),
          lifeMs: job.lifeMs,
        }),
      )
      .digest("hex")
    try {
      await fs.writeFile(path.join(claim, "identity"), identity, { flag: "wx", mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      if ((await fs.readFile(path.join(claim, "identity"), "utf8")) !== identity) {
        throw new Error("A different command already owns this job id")
      }
      return // Includes ambiguous starts: never repeat an external side effect.
    }
    if (
      await fs.stat(path.join(claim, "stopped")).then(
        () => true,
        () => false,
      )
    )
      return
    // An older daemon may have started this id before identity records existed.
    const prior = await fs.readFile(path.join(dir, "command"), "utf8").catch(() => undefined)
    if (prior !== undefined) {
      if (prior !== `${job.command}\n`)
        throw new Error("A different command already owns this job id")
      return
    }
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "command"), `${job.command}\n`)
    const supervised = !windows
    if (supervised) await fs.writeFile(path.join(dir, "supervised"), "1", { mode: 0o600 })
    const log = openSync(path.join(dir, "output.log"), "a")
    const startedAt = Date.now()
    const deadline = startedAt + job.lifeMs
    let child: ChildProcess
    try {
      // Its own process group, so that stopping it stops what it started, and so that it is
      // not stopped with the daemon. Not on Windows, where a program started apart from the
      // daemon has no console, and neither bash nor PowerShell prints anything without one.
      const [file, args] = program(job.command, dir, deadline)
      child = spawn(file, args, {
        cwd: job.cwd === undefined ? options.home : options.resolve(job.cwd),
        env: windows
          ? { ...process.env, ...job.env }
          : {
              ...process.env,
              ...options.nodeEnv,
              // Command-specific Node flags must not run inside the trusted supervisor.
              NODE_OPTIONS: undefined,
              _DC_JOB_ENV: JSON.stringify({ ...process.env, ...job.env }),
            },
        detached: !windows,
        windowsHide: true,
        stdio: windows && shell.posix ? "ignore" : ["ignore", log, log],
      })
    } finally {
      closeSync(log)
    }
    const entry: Live = { child, timers: [] }
    live.set(dir, entry)
    // The kill that follows is left to happen after the command's shell has gone: something
    // it started may not have stopped when asked.
    const stop = (why: Live["ended"]) => {
      entry.ended ??= why
      if (child.pid !== undefined) stopGroup(child.pid, dir)
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
      if (live.get(dir) === entry) live.delete(dir)
    }
    // A supervised job's supervisor keeps its limit and its cap, and is the one to say it was
    // stopped at its limit: a timer here as well would race it and could record a stop instead.
    let measure: ReturnType<typeof setInterval> | undefined
    if (!supervised) {
      const limit = setTimeout(() => stop("limit"), job.lifeMs)
      limit.unref()
      entry.timers.push(limit)
      measure = setInterval(() => {
        void sizeOf(dir).then((size) => {
          if (size !== undefined && size > cap) stop("output")
        })
      }, MEASURE_EVERY_MS)
      measure.unref()
    }
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
      // Under Git's bash on Windows the script says which process it is, and says it better.
      if (!(windows && shell.posix)) {
        await fs.writeFile(path.join(dir, "pid"), String(child.pid))
      }
      await fs.writeFile(path.join(dir, "deadline"), String(deadline))
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
      for (const name of await fs.readdir(path.join(base, ".claims")).catch(() => [])) {
        const claim = path.join(base, ".claims", name)
        const dir = path.join(base, name)
        const stats = await fs.stat(claim).catch(() => undefined)
        if (
          stats &&
          Date.now() - stats.mtimeMs > KEEP_MS &&
          !live.has(dir) &&
          (await state(dir)).state !== "running"
        ) {
          await fs.rm(claim, { recursive: true, force: true })
        }
      }
      for (const name of await fs.readdir(base).catch(() => [])) {
        if (name === ".claims") continue
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
        await serial(dir, () => start(dir, job))
        return follow(dir, 0, options.waitMs, options.removeUnder)
      },
      follow: (id, options) => follow(dirOf(id), options.from, options.waitMs, options.removeUnder),
      stop: async (id) => {
        const dir = dirOf(id)
        // Durable even before start, and retained after output removal. A delayed start
        // must not undo an acknowledged stop. The independent supervisor checks it too.
        await fs.mkdir(claimOf(dir), { recursive: true, mode: 0o700 })
        await fs.writeFile(path.join(claimOf(dir), "stopped"), "", { mode: 0o600 })
        await serial(dir, async () => {
          if ((await readExit(dir)) !== undefined) return
          // One that has not yet said which process it is, is the one this daemon started.
          const pid = (await number(path.join(dir, "pid"))) || (live.get(dir)?.child.pid ?? 0)
          if (pid <= 0) return
          stopGroup(pid, dir)
          if (live.has(dir)) return
          // A job from before the daemon restarted: nobody is listening for its end.
          for (let waited = 0; alive(pid) && waited < KILL_AFTER_MS + 2_000; waited += 100) {
            await sleep(100)
          }
          await writeExit(dir, 143, false)
        })
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
        for (const id of ids) {
          const dir = dirOf(id)
          if ((await state(dir)).state === "running") throw new Error("Cannot remove a running job")
          await fs.rm(dir, { recursive: true, force: true })
        }
      },
      // As the server is shown the home, so that it is the path the server works out itself.
      log: (id) => shownPath(path.join(dirOf(id), "output.log")),
    }
  }
}

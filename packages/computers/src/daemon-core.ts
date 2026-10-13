import {
  base64ToBytes,
  chunkBytes,
  type DaemonErrorCode,
  DEFAULT_EXEC_TIMEOUT_MS,
  EXEC_STDIO_CAP,
  type BrowserFrame,
  type BrowserRan,
  DEFAULT_BROWSER_TIMEOUT_MS,
  type FsFrame,
  type HostFrame,
  type JobFrame,
  MAX_EXEC_TIMEOUT_MS,
  parseFrame,
  REMOTE_FILE_CAP,
  type LiveView,
  MAX_BROWSER_TIMEOUT_MS,
  type RemoteFileStat,
  type ScreenAction,
  type ScreenActed,
  type ScreenFrame,
  type UsingAgent,
  VIEW_WAIT_MS,
} from "@do-computer/protocol"
import type { SandboxJobs } from "@do-computer/sandbox"
import { UseRefused } from "./use.ts"

export { UseRefused } from "./use.ts"

/** The computer's screen, as agents use it. */
export interface ScreenIO {
  /** Do one thing for `agent` and resolve with how the screen looks afterwards. */
  act(agent: UsingAgent, action: ScreenAction, say: string | undefined): Promise<ScreenActed>
  /** How it looks now, waiting up to `waitMs` for a picture newer than number `after`. */
  view(after: number, waitMs: number): Promise<LiveView>
  /** Pause whoever is using it, or let them carry on. */
  hold(held: boolean): Promise<void>
}

/** A browser on the computer, as agents use it. */
export interface BrowserIO {
  /** Run a script for `agent`. Never rejects for a script that fails: that is in the answer. */
  run(
    agent: UsingAgent,
    script: string,
    options: { timeoutMs: number; say?: string; shown?: boolean },
  ): Promise<BrowserRan>
  view(after: number, waitMs: number): Promise<LiveView>
  hold(held: boolean): Promise<void>
  /** Close the browser kept for agents, and let go of the owner's own. */
  close(): Promise<void>
}

/** What the daemon does to its machine, injected: Node in the real daemon, fakes in tests. */
export interface DaemonIO {
  /** Run a shell command. Resolves with capped output; never rejects for a failing command. */
  exec(
    command: string,
    options: { cwd?: string; env: Record<string, string>; timeoutMs: number },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>
  /** File size, or null when there is no such file. */
  statSize(path: string): Promise<number | null>
  readFile(path: string): Promise<Uint8Array>
  /** Write, creating parent directories. */
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  /** The entry itself, not what a symlink points to; null when there is none. */
  stat(path: string): Promise<RemoteFileStat | null>
  list(path: string): Promise<(RemoteFileStat & { name: string })[]>
  realpath(path: string): Promise<string>
  mkdir(path: string, recursive: boolean): Promise<void>
  remove(path: string, options: { recursive: boolean; force: boolean }): Promise<void>
  rename(from: string, to: string): Promise<void>
  /**
   * Commands the daemon keeps going by itself, kept apart by `scope` for each agent that works
   * on the machine. Absent: the daemon cannot, and says so.
   */
  jobs?(scope: string): SandboxJobs
  /** The screen, where agents may use it. Absent: there is none for them, and the daemon says so. */
  screen?: ScreenIO
  /** A browser, where agents may use one. Absent: likewise. */
  browser?: BrowserIO
  /** Record one thing the agent did on this machine. */
  audit(entry: Record<string, unknown>): void
}

/** A failed file operation's errno, as an error code the host understands. */
function errorCode(error: unknown): DaemonErrorCode {
  switch ((error as { code?: string } | undefined)?.code) {
    case "ENOENT":
      return "not_found"
    case "ENOTDIR":
      return "not_directory"
    case "EISDIR":
      return "is_directory"
    case "EACCES":
    case "EPERM":
      return "permission_denied"
    case "ENOTEMPTY":
    case "EEXIST":
    case "EINVAL":
      return "invalid"
    default:
      return "io"
  }
}

const MUTATING_FS_OPS = new Set<FsFrame["op"]>(["mkdir", "remove", "rename"])

type PendingWrite = { path: string; size: number; chunks: Map<number, string>; startedAt: number }

const OUTBOX_CAP = 100
/** A chunked write that never finished is dropped after this long. */
const WRITE_ASSEMBLY_TTL_MS = 120_000

export type DaemonCoreOptions = {
  /** Refuse commands and writes; the agent may only read files. Decided by the machine's owner. */
  readonly readOnly?: boolean
  /** Called when the host says there may be a newer daemon to become. */
  readonly onUpdate?: () => void
  readonly now?: () => number
}

/**
 * The daemon side of the protocol, independent of any transport. It carries out host frames
 * against the injected IO and sends results back.
 *
 * A result that cannot be sent because the socket is down waits in a bounded outbox and is flushed
 * on reconnect. Closing the laptop lid mid-build means the build finishes, the result waits here,
 * and the host gets it on reconnect if it is still inside its deadline.
 */
export class DaemonCore {
  readonly #outbox: string[] = []
  readonly #writes = new Map<string, PendingWrite>()
  #working = 0
  readonly #io: DaemonIO
  readonly #send: (frame: string) => boolean
  readonly #readOnly: boolean
  readonly #onUpdate: (() => void) | undefined
  readonly #now: () => number

  /** @param send Deliver one frame to the socket; false means not connected. */
  constructor(io: DaemonIO, send: (frame: string) => boolean, options: DaemonCoreOptions = {}) {
    this.#io = io
    this.#send = send
    this.#readOnly = options.readOnly ?? false
    this.#onUpdate = options.onUpdate
    this.#now = options.now ?? Date.now
  }

  get outboxSize(): number {
    return this.#outbox.length
  }

  /** Whether something the host asked for is still being done, or a file is half arrived. */
  get busy(): boolean {
    return this.#working > 0 || this.#writes.size > 0
  }

  /** Count a piece of work as under way until it ends. */
  #track(work: Promise<void>): void {
    this.#working++
    void work.finally(() => this.#working--).catch(() => {})
  }

  /** The socket connected or reconnected: flush buffered results in order. */
  onOpen(): void {
    while (this.#outbox.length > 0) {
      if (!this.#send(this.#outbox[0]!)) return
      this.#outbox.shift()
    }
  }

  #sendOrBuffer(frame: string): void {
    if (this.#outbox.length > 0 || !this.#send(frame)) {
      this.#outbox.push(frame)
      // Bounded: drop the oldest. Whoever waited for a result that old has given up.
      while (this.#outbox.length > OUTBOX_CAP) this.#outbox.shift()
    }
  }

  #error(id: string, code: DaemonErrorCode, message: string): void {
    this.#sendOrBuffer(JSON.stringify({ t: "err", id, code, message }))
  }

  #refuse(id: string, what: string): void {
    this.#io.audit({ ts: this.#now(), kind: "refused", what })
    this.#error(id, "read_only", `This computer is paired read-only, so it will not ${what}.`)
  }

  /** Feed one raw socket message from the host. Work runs detached. */
  onFrame(raw: unknown): void {
    const frame = parseFrame<HostFrame>(raw)
    if (frame === null) return
    this.#collectStaleWrites()

    switch (frame.t) {
      case "exec":
        if (this.#readOnly) return this.#refuse(frame.id, "run commands")
        this.#track(
          this.#exec(frame.id, frame.command, frame.cwd, frame.env ?? {}, frame.timeoutMs),
        )
        return
      case "read":
        this.#track(this.#read(frame.id, frame.path, frame.maxBytes ?? REMOTE_FILE_CAP))
        return
      case "write_begin":
        if (this.#readOnly) return this.#refuse(frame.id, "write files")
        if (typeof frame.size !== "number" || frame.size > REMOTE_FILE_CAP) {
          this.#error(
            frame.id,
            "too_large",
            "The file is over the size limit for a paired computer.",
          )
          return
        }
        this.#writes.set(frame.id, {
          path: frame.path,
          size: frame.size,
          chunks: new Map(),
          startedAt: this.#now(),
        })
        return
      case "write_chunk":
        this.#writes.get(frame.id)?.chunks.set(frame.seq, frame.data)
        return
      case "write_end":
        // A refused write_begin already answered; its trailing frames find no pending write.
        if (this.#readOnly) return
        this.#track(this.#finishWrite(frame.id))
        return
      case "fs":
        if (this.#readOnly && MUTATING_FS_OPS.has(frame.op)) {
          return this.#refuse(frame.id, "change files")
        }
        this.#track(this.#fs(frame))
        return
      case "job":
        // Looking at a job and stopping one change nothing a read-only computer protects.
        if (this.#readOnly && frame.op === "start") return this.#refuse(frame.id, "run commands")
        this.#track(this.#job(frame))
        return
      case "screen":
        // Looking on, and pausing whoever is using it, change nothing here.
        if (this.#readOnly && frame.op === "act") return this.#refuse(frame.id, "use the screen")
        // Someone looking on is not work the daemon must finish before it restarts.
        if (frame.op === "act") this.#track(this.#screen(frame))
        else void this.#screen(frame)
        return
      case "browser":
        if (this.#readOnly && frame.op === "run") return this.#refuse(frame.id, "use a browser")
        if (frame.op === "run") this.#track(this.#browser(frame))
        else void this.#browser(frame)
        return
      case "update":
        this.#onUpdate?.()
        return
      case "revoked":
        // The transport reacts to the close code; nothing to do here.
        return
    }
  }

  async #exec(
    id: string,
    command: string,
    cwd: string | undefined,
    env: Record<string, string>,
    timeoutMs?: number,
  ): Promise<void> {
    const deadline = Math.min(timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS, MAX_EXEC_TIMEOUT_MS)
    const startedAt = this.#now()
    let result: { stdout: string; stderr: string; exitCode: number }
    try {
      result = await this.#io.exec(command, { cwd, env, timeoutMs: deadline })
    } catch (error) {
      result = {
        stdout: "",
        stderr: `The daemon could not run the command: ${(error as Error)?.message}`,
        exitCode: 1,
      }
    }
    this.#io.audit({
      ts: startedAt,
      kind: "exec",
      command,
      exitCode: result.exitCode,
      ms: this.#now() - startedAt,
    })
    this.#sendOrBuffer(
      JSON.stringify({
        t: "exec_result",
        id,
        stdout: result.stdout.slice(0, EXEC_STDIO_CAP),
        stderr: result.stderr.slice(0, EXEC_STDIO_CAP),
        exitCode: result.exitCode,
      }),
    )
  }

  async #job(frame: JobFrame): Promise<void> {
    const jobs = this.#io.jobs?.(frame.scope)
    if (jobs === undefined) {
      return this.#error(frame.id, "bad_request", "This computer cannot keep a command running.")
    }
    const follow = {
      waitMs: Math.min(Math.max(0, frame.waitMs ?? 0), MAX_EXEC_TIMEOUT_MS),
      ...(frame.removeUnder === undefined ? {} : { removeUnder: frame.removeUnder }),
    }
    try {
      let value: unknown = true
      switch (frame.op) {
        case "start": {
          if (frame.job === undefined || frame.command === undefined) {
            return this.#error(frame.id, "bad_request", "start needs a job and a command.")
          }
          this.#io.audit({ ts: this.#now(), kind: "job", command: frame.command })
          value = await jobs.start(
            {
              id: frame.job,
              command: frame.command,
              ...(frame.cwd === undefined ? {} : { cwd: frame.cwd }),
              ...(frame.env === undefined ? {} : { env: frame.env }),
              lifeMs: frame.lifeMs ?? DEFAULT_EXEC_TIMEOUT_MS,
            },
            follow,
          )
          break
        }
        case "follow":
          if (frame.job === undefined) {
            return this.#error(frame.id, "bad_request", "follow needs a job.")
          }
          value = await jobs.follow(frame.job, { ...follow, from: frame.from ?? 0 })
          break
        case "stop":
          if (frame.job === undefined) {
            return this.#error(frame.id, "bad_request", "stop needs a job.")
          }
          this.#io.audit({ ts: this.#now(), kind: "job_stop", job: frame.job })
          await jobs.stop(frame.job)
          break
        case "check":
          value = await jobs.check(frame.jobs ?? [])
          break
        case "remove":
          await jobs.remove(frame.jobs ?? [])
          break
      }
      this.#sendOrBuffer(JSON.stringify({ t: "job_result", id: frame.id, value }))
    } catch (error) {
      this.#error(frame.id, errorCode(error), (error as Error)?.message ?? String(error))
    }
  }

  /** Answer a `screen` or `browser` frame with what `work` resolves with, or why not. */
  async #use(id: string, work: () => Promise<unknown>): Promise<void> {
    try {
      const value = (await work()) ?? true
      this.#sendOrBuffer(JSON.stringify({ t: "use_result", id, value }))
    } catch (error) {
      const message = (error as Error)?.message ?? String(error)
      this.#error(id, error instanceof UseRefused ? "refused" : "io", message)
    }
  }

  async #screen(frame: ScreenFrame): Promise<void> {
    const screen = this.#io.screen
    if (screen === undefined) {
      return this.#error(
        frame.id,
        "refused",
        "This computer does not let Doods use its screen. Whoever it belongs to can switch that on in the Do Computer app there, under This Computer. It cannot be switched on from here.",
      )
    }
    const wait = Math.min(Math.max(0, frame.waitMs ?? 0), VIEW_WAIT_MS)
    switch (frame.op) {
      case "act": {
        const { agent, action } = frame
        if (agent === undefined || action === undefined) {
          return this.#error(frame.id, "bad_request", "act needs an agent and an action.")
        }
        this.#io.audit({ ts: this.#now(), kind: "screen", agent: agent.name, action })
        return this.#use(frame.id, () => screen.act(agent, action, frame.say))
      }
      case "view":
        return this.#use(frame.id, () => screen.view(frame.after ?? 0, wait))
      case "hold":
        return this.#use(frame.id, () => screen.hold(frame.held === true))
    }
  }

  async #browser(frame: BrowserFrame): Promise<void> {
    const browser = this.#io.browser
    if (browser === undefined) {
      return this.#error(
        frame.id,
        "refused",
        "This computer does not let Doods use a browser. Whoever it belongs to can switch that on where the computer was connected.",
      )
    }
    const wait = Math.min(Math.max(0, frame.waitMs ?? 0), VIEW_WAIT_MS)
    switch (frame.op) {
      case "run": {
        const { agent, script } = frame
        if (agent === undefined || script === undefined) {
          return this.#error(frame.id, "bad_request", "run needs an agent and a script.")
        }
        this.#io.audit({ ts: this.#now(), kind: "browser", agent: agent.name, script })
        const timeoutMs = Math.min(
          Math.max(1_000, frame.timeoutMs ?? DEFAULT_BROWSER_TIMEOUT_MS),
          MAX_BROWSER_TIMEOUT_MS,
        )
        return this.#use(frame.id, () =>
          browser.run(agent, script, {
            timeoutMs,
            ...(frame.say === undefined ? {} : { say: frame.say }),
            ...(frame.shown === undefined ? {} : { shown: frame.shown }),
          }),
        )
      }
      case "view":
        return this.#use(frame.id, () => browser.view(frame.after ?? 0, wait))
      case "hold":
        return this.#use(frame.id, () => browser.hold(frame.held === true))
      case "close":
        return this.#use(frame.id, () => browser.close())
    }
  }

  async #read(id: string, path: string, maxBytes: number): Promise<void> {
    const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024))
    const size = await this.#io.statSize(path).catch(() => null)
    if (size === null) return this.#error(id, "not_found", `No such file: ${path}`)
    const cap = Math.min(maxBytes, REMOTE_FILE_CAP)
    if (size > cap) {
      return this.#error(
        id,
        "too_large",
        `${path} is ${megabytes(size)} MB, over the ${megabytes(cap)} MB limit.`,
      )
    }
    let bytes: Uint8Array
    try {
      bytes = await this.#io.readFile(path)
    } catch (error) {
      return this.#error(id, "io", `Could not read ${path}: ${(error as Error)?.message}`)
    }
    this.#io.audit({ ts: this.#now(), kind: "read", path, bytes: bytes.length })
    const chunks = chunkBytes(bytes)
    chunks.forEach((data, seq) => {
      this.#sendOrBuffer(
        JSON.stringify({ t: "file_chunk", id, seq, data, last: seq === chunks.length - 1 }),
      )
    })
  }

  async #fs(frame: FsFrame): Promise<void> {
    try {
      let value: unknown = true
      switch (frame.op) {
        case "stat":
          value = await this.#io.stat(frame.path)
          break
        case "list":
          value = await this.#io.list(frame.path)
          break
        case "realpath":
          value = await this.#io.realpath(frame.path)
          break
        case "mkdir":
          await this.#io.mkdir(frame.path, frame.recursive ?? false)
          break
        case "remove":
          await this.#io.remove(frame.path, {
            recursive: frame.recursive ?? false,
            force: frame.force ?? false,
          })
          break
        case "rename":
          if (frame.to === undefined)
            return this.#error(frame.id, "bad_request", "rename needs a destination.")
          await this.#io.rename(frame.path, frame.to)
          break
      }
      if (MUTATING_FS_OPS.has(frame.op)) {
        this.#io.audit({ ts: this.#now(), kind: frame.op, path: frame.path, to: frame.to })
      }
      this.#sendOrBuffer(JSON.stringify({ t: "fs_result", id: frame.id, value }))
    } catch (error) {
      this.#error(frame.id, errorCode(error), (error as Error)?.message ?? String(error))
    }
  }

  async #finishWrite(id: string): Promise<void> {
    const pending = this.#writes.get(id)
    this.#writes.delete(id)
    if (pending === undefined) return this.#error(id, "bad_request", "The write was never started.")
    const parts: Uint8Array[] = []
    for (let seq = 0; seq < pending.chunks.size; seq++) {
      const data = pending.chunks.get(seq)
      if (data === undefined) return this.#error(id, "io", "The file transfer arrived incomplete.")
      parts.push(base64ToBytes(data))
    }
    const total = parts.reduce((sum, part) => sum + part.length, 0)
    if (total !== pending.size) {
      return this.#error(id, "io", `The file transfer was ${total} of ${pending.size} bytes.`)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const part of parts) {
      bytes.set(part, offset)
      offset += part.length
    }
    try {
      await this.#io.writeFile(pending.path, bytes)
    } catch (error) {
      return this.#error(id, "io", `Could not write ${pending.path}: ${(error as Error)?.message}`)
    }
    this.#io.audit({ ts: this.#now(), kind: "write", path: pending.path, bytes: total })
    this.#sendOrBuffer(JSON.stringify({ t: "ok", id }))
  }

  #collectStaleWrites(): void {
    const cutoff = this.#now() - WRITE_ASSEMBLY_TTL_MS
    for (const [id, pending] of this.#writes) {
      if (pending.startedAt < cutoff) this.#writes.delete(id)
    }
  }
}

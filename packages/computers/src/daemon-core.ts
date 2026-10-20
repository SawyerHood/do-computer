import {
  base64ToBytes,
  bytesToBase64,
  chunkBytes,
  type DaemonErrorCode,
  DEFAULT_EXEC_TIMEOUT_MS,
  EXEC_STDIO_CAP,
  type BrowserFrame,
  type BrowserFront,
  type BrowserPaid,
  type BrowserRan,
  type BrowserSignedIn,
  DEFAULT_BROWSER_TIMEOUT_MS,
  type FsFrame,
  type HostFrame,
  IMAGE_RESULT_BYTES,
  type ImageFrame,
  type ImageLimits,
  type JobFrame,
  MAX_EXEC_TIMEOUT_MS,
  USE_HELD_WAIT_MS,
  parseFrame,
  type PayField,
  type PayWith,
  REMOTE_FILE_CAP,
  type LiveView,
  MAX_BROWSER_TIMEOUT_MS,
  type RemoteFileStat,
  type ScreenAction,
  type ScreenActed,
  type ScreenFrame,
  type SignInWith,
  type UsingAgent,
  VIEW_WAIT_MS,
} from "@do-computer/protocol"
import type { SandboxJobs } from "@do-computer/sandbox"
import type { ShrunkImage } from "./node-image.ts"
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
  /**
   * The page in front in the browser agents are using now, as the browser itself says. Where
   * none is open it has no address, and none is started to find out.
   */
  front(): Promise<BrowserFront>
  /**
   * Sign in on the page in front with `login`, for `agent`: the daemon types it itself, so that
   * no script an agent wrote ever holds the password. Never rejects for a sign-in that did not
   * go through: that is in the answer, which has nothing of the password in it.
   */
  signIn(
    agent: UsingAgent,
    login: SignInWith,
    options: { timeoutMs: number; say?: string },
  ): Promise<BrowserSignedIn>
  /**
   * Pay on the page in front with `card`, for `agent`: the daemon fills `fields` in, types the
   * card and presses the button that says `button` in one go, so that no script an agent wrote
   * runs while the card is in the page. Never rejects for a payment that did not go through:
   * that is in the answer, which has nothing of the card's number or code in it.
   */
  pay(
    agent: UsingAgent,
    card: PayWith,
    options: { timeoutMs: number; say?: string; fields: PayField[]; button: string },
  ): Promise<BrowserPaid>
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
    options: { cwd?: string; env: Record<string, string>; timeoutMs: number; signal?: AbortSignal },
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
  /**
   * A picture made as small as it can be for a model to look at, or undefined where it is not
   * one this can prepare. Absent: the daemon prepares none, and says so.
   */
  prepareImage?(bytes: Uint8Array, limits: ImageLimits): ShrunkImage | undefined
  /** Record one thing the agent did on this machine. */
  audit(entry: Record<string, unknown>): void
}

/** The most boxes a payment may ask to have filled in beside the card. */
const MAX_PAY_FIELDS = 20

/** A card as a frame carried it, where it is whole. */
function readCard(value: unknown): PayWith | undefined {
  const card = value as Partial<PayWith> | null | undefined
  if (typeof card !== "object" || card === null) return undefined
  const { name, holder, number, expMonth, expYear, code, postalCode } = card
  if (
    typeof name !== "string" ||
    typeof holder !== "string" ||
    typeof number !== "string" ||
    typeof expMonth !== "number" ||
    typeof expYear !== "number" ||
    typeof code !== "string" ||
    typeof postalCode !== "string"
  ) {
    return undefined
  }
  return { name, holder, number, expMonth, expYear, code, postalCode }
}

/** What else to fill in as a frame carried it, where it is whole. None where the frame has none. */
function readPayFields(value: unknown): PayField[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_PAY_FIELDS) return undefined
  const fields: PayField[] = []
  for (const field of value as Partial<PayField>[]) {
    if (typeof field?.box !== "string" || typeof field.text !== "string") return undefined
    fields.push({ box: field.box, text: field.text })
  }
  return fields
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

/** A login as a frame carried it, where it is whole. */
function readLogin(value: unknown): SignInWith | undefined {
  const login = value as Partial<SignInWith> | null | undefined
  if (
    typeof login !== "object" ||
    login === null ||
    typeof login.name !== "string" ||
    typeof login.username !== "string" ||
    typeof login.password !== "string" ||
    !Array.isArray(login.sites) ||
    !login.sites.every((site) => typeof site === "string")
  ) {
    return undefined
  }
  return {
    name: login.name,
    username: login.username,
    password: login.password,
    sites: login.sites,
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
  /** Bound tracked IO even when a platform never settles it. Default two minutes. */
  readonly operationTimeoutMs?: number
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
  readonly #execs = new Map<string, AbortController>()
  #working = 0
  readonly #expired = new Map<string, number>()
  readonly #operationTimeoutMs: number
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
    this.#operationTimeoutMs = options.operationTimeoutMs ?? 120_000
  }

  get outboxSize(): number {
    return this.#outbox.length
  }

  /** Whether something the host asked for is still being done, or a file is half arrived. */
  get busy(): boolean {
    this.#collectStaleWrites()
    return this.#working > 0 || this.#writes.size > 0
  }

  /** Count a piece of work as under way until it ends. */
  #track(id: string, work: Promise<void>, timeoutMs = this.#operationTimeoutMs): void {
    this.#working++
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      this.#working--
    }
    const timer = setTimeout(
      () => {
        finish()
        // Platform IO may still complete; never send its late result as success.
        this.#expired.set(id, this.#now() + 30 * 60_000)
        while (this.#expired.size > 1024) this.#expired.delete(this.#expired.keys().next().value!)
        try {
          this.#sendOrBuffer(
            JSON.stringify({
              t: "err",
              id,
              code: "io",
              message: "The computer operation timed out; it may still be finishing.",
            }),
            true,
          )
        } catch {
          /* A closing transport must not strand busy accounting. */
        }
      },
      Math.max(1, timeoutMs),
    )
    ;(timer as { unref?: () => void }).unref?.()
    void work.finally(finish).catch(() => {})
  }

  /** The socket connected or reconnected: flush buffered results in order. */
  onOpen(): void {
    while (this.#outbox.length > 0) {
      if (!this.#send(this.#outbox[0]!)) return
      this.#outbox.shift()
    }
  }

  #sendOrBuffer(frame: string, allowExpired = false): void {
    if (!allowExpired && this.#expired.has((JSON.parse(frame) as { id?: string }).id ?? "")) return
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
    for (const [id, until] of this.#expired) if (until < this.#now()) this.#expired.delete(id)

    switch (frame.t) {
      case "cancel":
        this.#execs.get(frame.id)?.abort()
        return
      case "exec":
        if (this.#readOnly) return this.#refuse(frame.id, "run commands")
        this.#track(
          frame.id,
          this.#exec(frame.id, frame.command, frame.cwd, frame.env ?? {}, frame.timeoutMs),
          Math.max(1, Math.min(frame.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS, MAX_EXEC_TIMEOUT_MS)) +
            10_000,
        )
        return
      case "read":
        this.#track(frame.id, this.#read(frame.id, frame.path, frame.maxBytes ?? REMOTE_FILE_CAP))
        return
      case "image":
        this.#track(frame.id, this.#image(frame))
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
        this.#track(frame.id, this.#finishWrite(frame.id))
        return
      case "fs":
        if (this.#readOnly && MUTATING_FS_OPS.has(frame.op)) {
          return this.#refuse(frame.id, "change files")
        }
        this.#track(frame.id, this.#fs(frame))
        return
      case "job":
        // Looking at a job and stopping one change nothing a read-only computer protects.
        if (this.#readOnly && frame.op === "start") return this.#refuse(frame.id, "run commands")
        this.#track(
          frame.id,
          this.#job(frame),
          this.#operationTimeoutMs + Math.min(Math.max(0, frame.waitMs ?? 0), MAX_EXEC_TIMEOUT_MS),
        )
        return
      case "screen":
        // Looking on, and pausing whoever is using it, change nothing here.
        if (this.#readOnly && frame.op === "act") return this.#refuse(frame.id, "use the screen")
        // Someone looking on is not work the daemon must finish before it restarts.
        if (frame.op === "act")
          this.#track(frame.id, this.#screen(frame), USE_HELD_WAIT_MS + 60_000)
        else void this.#screen(frame)
        return
      case "browser":
        if (frame.op === "run" || frame.op === "sign_in" || frame.op === "pay") {
          if (this.#readOnly) return this.#refuse(frame.id, "use a browser")
          this.#track(frame.id, this.#browser(frame), USE_HELD_WAIT_MS + MAX_BROWSER_TIMEOUT_MS)
        } else void this.#browser(frame)
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
    const controller = new AbortController()
    this.#execs.set(id, controller)
    let result: { stdout: string; stderr: string; exitCode: number }
    try {
      result = await this.#io.exec(command, {
        cwd,
        env,
        timeoutMs: deadline,
        signal: controller.signal,
      })
    } catch (error) {
      result = {
        stdout: "",
        stderr: `The daemon could not run the command: ${(error as Error)?.message}`,
        exitCode: 1,
      }
    } finally {
      this.#execs.delete(id)
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
      case "front":
        return this.#use(frame.id, () => browser.front())
      case "sign_in": {
        const { agent } = frame
        const login = readLogin(frame.login)
        if (agent === undefined || login === undefined) {
          return this.#error(frame.id, "bad_request", "sign_in needs an agent and a login.")
        }
        // The name of the login and no more: the frame holds its password, and is never kept.
        this.#io.audit({
          ts: this.#now(),
          kind: "browser_sign_in",
          agent: agent.name,
          login: login.name,
        })
        const timeoutMs = Math.min(
          Math.max(1_000, frame.timeoutMs ?? DEFAULT_BROWSER_TIMEOUT_MS),
          MAX_BROWSER_TIMEOUT_MS,
        )
        return this.#use(frame.id, async (): Promise<BrowserSignedIn> => {
          try {
            return await browser.signIn(agent, login, {
              timeoutMs,
              ...(frame.say === undefined ? {} : { say: frame.say }),
            })
          } catch (error) {
            // Whoever paused the browser is told so. Anything else is not passed on: an error
            // is made of what went wrong, and what was being done was typing a password.
            if (error instanceof UseRefused) throw error
            return {
              outcome: "failed",
              message: `This computer could not sign in with the login "${login.name}".`,
              own: false,
            }
          }
        })
      }
      case "pay": {
        const { agent, button } = frame
        const card = readCard(frame.card)
        const fields = readPayFields(frame.fields)
        if (
          agent === undefined ||
          card === undefined ||
          fields === undefined ||
          typeof button !== "string" ||
          button.trim() === ""
        ) {
          return this.#error(
            frame.id,
            "bad_request",
            "pay needs an agent, a card, the button to press, and at most twenty boxes to fill in.",
          )
        }
        // The name of the card and its last four digits, as a receipt would have them, and no
        // more: the frame holds the whole card, and is never kept.
        this.#io.audit({
          ts: this.#now(),
          kind: "browser_pay",
          agent: agent.name,
          card: card.name,
          last4: card.number.replace(/\D/g, "").slice(-4),
        })
        const timeoutMs = Math.min(
          Math.max(1_000, frame.timeoutMs ?? DEFAULT_BROWSER_TIMEOUT_MS),
          MAX_BROWSER_TIMEOUT_MS,
        )
        return this.#use(frame.id, async (): Promise<BrowserPaid> => {
          try {
            return await browser.pay(agent, card, {
              timeoutMs,
              ...(frame.say === undefined ? {} : { say: frame.say }),
              fields,
              button,
            })
          } catch (error) {
            // As for signing in: why is not passed on, since what was being done was typing a card.
            if (error instanceof UseRefused) throw error
            return {
              outcome: "failed",
              message: `This computer could not pay with the card "${card.name}".`,
              own: false,
            }
          }
        })
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

  /**
   * A picture read for a model, prepared here so that the server is sent no more of it than the
   * model can see. Answers null for whatever is to be read as it is instead.
   */
  async #image(frame: ImageFrame): Promise<void> {
    const answer = (value: unknown) =>
      this.#sendOrBuffer(JSON.stringify({ t: "image_result", id: frame.id, value }))
    const prepare = this.#io.prepareImage
    if (prepare === undefined) return answer(null)
    const size = await this.#io.statSize(frame.path).catch(() => null)
    if (size === null) return this.#error(frame.id, "not_found", `No such file: ${frame.path}`)
    if (size > REMOTE_FILE_CAP) return answer(null)
    let bytes: Uint8Array
    try {
      bytes = await this.#io.readFile(frame.path)
    } catch (error) {
      return this.#error(
        frame.id,
        "io",
        `Could not read ${frame.path}: ${(error as Error)?.message}`,
      )
    }
    this.#io.audit({ ts: this.#now(), kind: "read", path: frame.path, bytes: bytes.length })
    let prepared: ReturnType<typeof prepare>
    try {
      prepared = prepare(bytes, {
        maxEdge: frame.maxEdge,
        maxPixels: frame.maxPixels,
        maxBytes: Math.min(frame.maxBytes, IMAGE_RESULT_BYTES),
      })
    } catch {
      prepared = undefined
    }
    if (prepared === undefined) return answer(null)
    const { bytes: made, ...rest } = prepared
    answer({ ...rest, data: bytesToBase64(made) })
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

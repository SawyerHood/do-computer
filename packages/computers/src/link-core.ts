import {
  base64ToBytes,
  chunkBytes,
  type BrowserFrame,
  type DaemonErrorCode,
  type DaemonFrame,
  DEFAULT_EXEC_TIMEOUT_MS,
  type FsFrame,
  type FsResultFrame,
  type ImageFrame,
  type ImageResultFrame,
  type JobFrame,
  MAX_EXEC_TIMEOUT_MS,
  parseFrame,
  MAX_BROWSER_TIMEOUT_MS,
  REMOTE_FILE_CAP,
  type ScreenFrame,
  USE_HELD_WAIT_MS,
  VIEW_WAIT_MS,
} from "@do-computer/protocol"

export type RemoteErrorCode = DaemonErrorCode | "offline" | "timeout" | "aborted"

/** A failed operation on a paired computer, in words fit to show the agent. */
export class RemoteError extends Error {
  constructor(
    readonly code: RemoteErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export type RemoteExecResult = { stdout: string; stderr: string; exitCode: number }

type Waiter = {
  kind: "exec" | "read" | "image" | "write" | "fs" | "job" | "use"
  resolve(value: unknown): void
  reject(error: RemoteError): void
  timer: ReturnType<typeof setTimeout>
  /** Read assembly: base64 chunks by sequence number. */
  chunks?: Map<number, string>
}

/** How long a file operation may wait for the daemon. */
const FILE_OP_TIMEOUT_MS = 120_000
/** Extra wait past the daemon's own kill deadline, for a result racing the timeout. */
const EXEC_GRACE_MS = 10_000

/** How long past a watcher's wait a picture of a screen or a page may still arrive. */
const USE_GRACE_MS = 20_000

export type LinkCoreOptions = {
  execGraceMs?: number
  fileOpTimeoutMs?: number
  useGraceMs?: number
}

/**
 * The host side of the daemon protocol, independent of any transport: it owns the requests that
 * are waiting for an answer and assembles file chunks.
 *
 * Waiters are not failed when the socket drops. The daemon buffers results while offline and
 * flushes them on reconnect, so a request still inside its deadline gets its result late but
 * correct. A frame nobody is waiting for is dropped.
 */
export class LinkCore {
  readonly #waiters = new Map<string, Waiter>()
  readonly #send: (frame: string) => boolean
  readonly #execGraceMs: number
  readonly #fileOpTimeoutMs: number
  readonly #useGraceMs: number
  #counter = 0
  readonly #cancelled = new Map<string, number>()

  /** @param send Deliver one frame to the live socket; false means there is none. */
  constructor(send: (frame: string) => boolean, options?: LinkCoreOptions) {
    this.#send = send
    this.#execGraceMs = options?.execGraceMs ?? EXEC_GRACE_MS
    this.#fileOpTimeoutMs = options?.fileOpTimeoutMs ?? FILE_OP_TIMEOUT_MS
    this.#useGraceMs = options?.useGraceMs ?? USE_GRACE_MS
  }

  get pendingCount(): number {
    return this.#waiters.size
  }

  #nextId(): string {
    return `r${++this.#counter}-${Date.now().toString(36)}`
  }

  #wait<T>(id: string, kind: Waiter["kind"], timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(id)
        if (kind === "exec") this.cancel(id)
        reject(new RemoteError("timeout", message))
      }, timeoutMs)
      this.#waiters.set(id, {
        kind,
        resolve: resolve as (value: unknown) => void,
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
        timer,
      })
    })
  }

  #settle(id: string): Waiter | undefined {
    const waiter = this.#waiters.get(id)
    if (waiter !== undefined) {
      this.#waiters.delete(id)
      clearTimeout(waiter.timer)
    }
    return waiter
  }

  /** Cancel an exec, including one whose HTTP request has not arrived yet. */
  cancel(id: string): void {
    const now = Date.now()
    for (const [key, until] of this.#cancelled) {
      if (until < now) this.#cancelled.delete(key)
    }
    this.#cancelled.set(id, now + MAX_EXEC_TIMEOUT_MS + this.#execGraceMs)
    this.#settle(id)?.reject(new RemoteError("aborted", "Command aborted."))
    // Best effort while disconnected; the daemon still enforces the execution deadline.
    try {
      this.#send(JSON.stringify({ t: "cancel", id }))
    } catch {
      // A transport closing between its state check and send must not break cancellation.
    }
  }

  exec(
    command: string,
    options?: {
      cwd?: string
      env?: Record<string, string>
      timeoutMs?: number
      requestId?: string
    },
  ): Promise<RemoteExecResult> {
    const timeoutMs = Math.min(options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS, MAX_EXEC_TIMEOUT_MS)
    const id = options?.requestId ?? this.#nextId()
    const cancelledUntil = this.#cancelled.get(id)
    if (cancelledUntil !== undefined) {
      if (cancelledUntil >= Date.now())
        return Promise.reject(new RemoteError("aborted", "Command aborted."))
      this.#cancelled.delete(id)
    }
    const frame = JSON.stringify({
      t: "exec",
      id,
      command,
      ...(options?.cwd ? { cwd: options.cwd } : {}),
      ...(options?.env ? { env: options.env } : {}),
      timeoutMs,
    })
    const waited = this.#wait<RemoteExecResult>(
      id,
      "exec",
      timeoutMs + this.#execGraceMs,
      `No result after ${Math.round(timeoutMs / 1000)}s. The command may still be running, or the connection was lost.`,
    )
    if (!this.#send(frame)) {
      this.#settle(id)
      waited.catch(() => {})
      return Promise.reject(new RemoteError("offline", "The computer is offline."))
    }
    return waited
  }

  async readFile(path: string, maxBytes: number = REMOTE_FILE_CAP): Promise<Uint8Array> {
    const id = this.#nextId()
    const waited = this.#wait<Uint8Array>(
      id,
      "read",
      this.#fileOpTimeoutMs,
      "No response from the computer. The connection may have been lost.",
    )
    if (!this.#send(JSON.stringify({ t: "read", id, path, maxBytes }))) {
      this.#settle(id)
      waited.catch(() => {})
      throw new RemoteError("offline", "The computer is offline.")
    }
    return waited
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    if (bytes.length > REMOTE_FILE_CAP) {
      throw new RemoteError(
        "too_large",
        `${Math.round(bytes.length / (1024 * 1024))} MB is over the ${Math.round(REMOTE_FILE_CAP / (1024 * 1024))} MB limit for files on a paired computer.`,
      )
    }
    const id = this.#nextId()
    const waited = this.#wait<void>(
      id,
      "write",
      this.#fileOpTimeoutMs,
      "No response from the computer. The connection may have been lost.",
    )
    const frames = [
      JSON.stringify({ t: "write_begin", id, path, size: bytes.length }),
      ...chunkBytes(bytes).map((data, seq) => JSON.stringify({ t: "write_chunk", id, seq, data })),
      JSON.stringify({ t: "write_end", id }),
    ]
    for (const frame of frames) {
      if (!this.#send(frame)) {
        this.#settle(id)
        waited.catch(() => {})
        throw new RemoteError("offline", "The computer is offline.")
      }
    }
    return waited
  }

  /** A file-system operation the daemon carries out without a shell. */
  async fs(request: Omit<FsFrame, "t" | "id">): Promise<FsResultFrame["value"]> {
    const id = this.#nextId()
    const waited = this.#wait<FsResultFrame["value"]>(
      id,
      "fs",
      this.#fileOpTimeoutMs,
      "No response from the computer. The connection may have been lost.",
    )
    if (!this.#send(JSON.stringify({ t: "fs", id, ...request }))) {
      this.#settle(id)
      waited.catch(() => {})
      throw new RemoteError("offline", "The computer is offline.")
    }
    return waited
  }

  /**
   * A picture read for a model, made smaller on the machine; null where the daemon says to read
   * it as it is. Only a daemon that said `images` in its hello understands this.
   */
  async image(request: Omit<ImageFrame, "t" | "id">): Promise<ImageResultFrame["value"]> {
    const id = this.#nextId()
    const waited = this.#wait<ImageResultFrame["value"]>(
      id,
      "image",
      this.#fileOpTimeoutMs,
      "No response from the computer. The connection may have been lost.",
    )
    if (!this.#send(JSON.stringify({ t: "image", id, ...request }))) {
      this.#settle(id)
      waited.catch(() => {})
      throw new RemoteError("offline", "The computer is offline.")
    }
    return waited
  }

  /**
   * Something to do with a job the daemon keeps going. One that follows a job waits as long as
   * it was told to, so the answer is given that long and a little more.
   */
  async job(request: Omit<JobFrame, "t" | "id">): Promise<unknown> {
    const id = this.#nextId()
    const waitMs = Math.min(Math.max(0, request.waitMs ?? 0), MAX_EXEC_TIMEOUT_MS)
    const waited = this.#wait<unknown>(
      id,
      "job",
      waitMs + this.#fileOpTimeoutMs,
      "No response from the computer. The connection may have been lost.",
    )
    if (!this.#send(JSON.stringify({ t: "job", id, ...request, waitMs }))) {
      this.#settle(id)
      waited.catch(() => {})
      throw new RemoteError("offline", "The computer is offline.")
    }
    return waited
  }

  /**
   * Something to do with the computer's screen or a browser on it. Doing something there waits
   * for as long as the agent may be kept paused, and for a script as long as it may run.
   * Looking on waits only as long as a picture is waited for.
   */
  async use(request: Omit<ScreenFrame, "id"> | Omit<BrowserFrame, "id">): Promise<unknown> {
    const id = this.#nextId()
    const doing =
      request.op === "act" ||
      request.op === "run" ||
      request.op === "sign_in" ||
      request.op === "pay"
    const waitMs = doing
      ? USE_HELD_WAIT_MS + (request.t === "browser" ? MAX_BROWSER_TIMEOUT_MS : 60_000)
      : Math.min(Math.max(0, request.waitMs ?? 0), VIEW_WAIT_MS) + this.#useGraceMs
    const waited = this.#wait<unknown>(
      id,
      "use",
      waitMs,
      "No response from the computer. The connection may have been lost.",
    )
    if (!this.#send(JSON.stringify({ ...request, id }))) {
      this.#settle(id)
      waited.catch(() => {})
      throw new RemoteError("offline", "The computer is offline.")
    }
    return waited
  }

  /** Feed one raw socket message from the daemon. */
  onFrame(raw: unknown): void {
    const frame = parseFrame<DaemonFrame>(raw)
    if (frame === null || !("id" in frame)) return

    if (frame.t === "err") {
      this.#settle(frame.id)?.reject(new RemoteError(frame.code, frame.message))
      return
    }
    if (frame.t === "exec_result") {
      const waiter = this.#settle(frame.id)
      if (waiter?.kind === "exec") {
        waiter.resolve({ stdout: frame.stdout, stderr: frame.stderr, exitCode: frame.exitCode })
      }
      return
    }
    if (frame.t === "file_chunk") {
      // Assembled on the live waiter; it is not settled until the last chunk.
      const waiter = this.#waiters.get(frame.id)
      if (waiter === undefined || waiter.kind !== "read") return
      waiter.chunks ??= new Map()
      waiter.chunks.set(frame.seq, frame.data)
      if (!frame.last) return
      this.#settle(frame.id)
      const parts: Uint8Array[] = []
      for (let seq = 0; seq < waiter.chunks.size; seq++) {
        const data = waiter.chunks.get(seq)
        if (data === undefined) {
          waiter.reject(new RemoteError("io", "The file transfer arrived incomplete."))
          return
        }
        parts.push(base64ToBytes(data))
      }
      const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
      let offset = 0
      for (const part of parts) {
        bytes.set(part, offset)
        offset += part.length
      }
      waiter.resolve(bytes)
      return
    }
    if (frame.t === "fs_result") {
      const waiter = this.#settle(frame.id)
      if (waiter?.kind === "fs") waiter.resolve(frame.value)
      return
    }
    if (frame.t === "image_result") {
      const waiter = this.#settle(frame.id)
      if (waiter?.kind === "image") waiter.resolve(frame.value)
      return
    }
    if (frame.t === "job_result") {
      const waiter = this.#settle(frame.id)
      if (waiter?.kind === "job") waiter.resolve(frame.value)
      return
    }
    if (frame.t === "use_result") {
      const waiter = this.#settle(frame.id)
      if (waiter?.kind === "use") waiter.resolve(frame.value)
      return
    }
    if (frame.t === "ok") {
      const waiter = this.#settle(frame.id)
      if (waiter?.kind === "write") waiter.resolve(undefined)
    }
  }
}

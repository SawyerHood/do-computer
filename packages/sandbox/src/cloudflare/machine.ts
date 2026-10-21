import { boundedArgv, execDeadline, hitDeadline } from "../remote.ts"
import { failure } from "../shell-fs.ts"
import { within, START_TIMEOUT_MS, SETUP_TIMEOUT_MS, EXEC_GRACE_MS } from "./deadline.ts"

/** The managed image every account can start without building anything. */
export const DEFAULT_IMAGE = "cloudflare/debian-trixie"
export const DEFAULT_INSTANCE = "standard-1"
export const DEFAULT_HOME = "/workspace"

/** How often the alarm looks at a running machine. */
const CHECK_INTERVAL_MS = 60_000
/** A machine nobody has used for this long is saved and stopped. */
const IDLE_LIMIT_MS = 10 * 60_000
/** A machine in use is saved this often, to bound what an unexpected stop loses. */
const CHECKPOINT_INTERVAL_MS = 15 * 60_000
/**
 * How long the platform keeps the machine after its object goes quiet. Longer than the check
 * interval, so the machine outlives the gap between checks; if the checks stop, this stops it.
 */
const INACTIVITY_TIMEOUT_MS = 5 * 60_000
/**
 * A snapshot expires 30 days after it was made or last restored. A stopped machine is restored and
 * saved again before that, so an agent left alone for months still has its computer.
 */
const REFRESH_AFTER_MS = 20 * 24 * 60 * 60_000
/** The largest file moved in or out in one piece; it passes through the object's memory. */
const MAX_FILE_BYTES = 64 * 1024 * 1024
const SIGTERM = 15
const SIGKILL = 9

/** The parts of `ExecProcess` the machine uses. */
export interface ContainerProcessLike {
  readonly stdout: ReadableStream<Uint8Array> | null | undefined
  readonly exitCode: Promise<number>
  output(): Promise<{ stdout: ArrayBuffer; stderr: ArrayBuffer; exitCode: number }>
  kill(signal?: number): void
}

/** The parts of a Durable Object's `ctx.container` the machine uses. */
export interface ContainerLike {
  readonly running: boolean
  /** Images named in the Wrangler configuration, by name. */
  readonly images?: Record<string, string>
  start(options: {
    image?: string
    containerSnapshot?: { id: string }
    entrypoint?: string[]
    enableInternet: boolean
    instance?: string
  }): void
  exec(
    cmd: string[],
    options?: {
      cwd?: string
      env?: Record<string, string>
      stdin?: ReadableStream<Uint8Array>
      stdout?: "pipe" | "ignore"
      stderr?: "pipe" | "ignore" | "combined"
    },
  ): Promise<ContainerProcessLike>
  snapshotContainer(options: { name?: string }): Promise<{ id: string; size: number }>
  destroy(reason?: unknown): Promise<void>
  setInactivityTimeout(durationMs: number): Promise<void>
}

/** The parts of Durable Object storage the machine uses. */
export interface MachineStore {
  get<T>(key: string): Promise<T | undefined>
  put(entries: Record<string, unknown>): Promise<void>
  delete(keys: string[]): Promise<void>
  getAlarm(): Promise<number | null>
  setAlarm(at: number): Promise<void>
}

export type MachineConfig = {
  /** `cloudflare/debian-trixie`, or the name of an image in the Wrangler configuration. */
  readonly image: string
  readonly instance: string
  readonly internet: boolean
  /** The directory commands start in. Created when the machine first starts. */
  readonly home: string
}

export type ExecRequest = {
  /** Chosen by the caller, so it can ask for this command to be stopped. */
  id: string
  command: string
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
}

/** One line of an exec response: output as it arrives, then how the command ended. */
export type ExecLine = { output: string } | { exitCode: number; timedOut: boolean }

type Stored = {
  snapshotId?: string
  /** When the files were last saved, or restored from a save. */
  savedAt?: number
  lastActivity?: number
  /** A resumed DO must finish preparation interrupted by an earlier instance. */
  needsSetup?: boolean
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  })

const decode = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer)

/**
 * One agent's computer on Cloudflare Containers: a Linux machine that belongs to a Durable Object.
 *
 * The machine runs only while it is used. An alarm saves a snapshot of its disk when it has been
 * idle and stops it; the next command starts a new machine from that snapshot. So everything on
 * disk persists, installed packages included, and running processes do not.
 *
 * This class is the object's behavior without the Workers runtime, so it can be tested on Node.
 */
export class ContainerMachine {
  readonly #container: () => ContainerLike | undefined
  readonly #store: MachineStore
  readonly #config: MachineConfig
  readonly #now: () => number
  /** Commands and transfers in progress. Held in memory: a request keeps the object loaded. */
  #busy = 0
  readonly #running = new Map<string, () => void>()
  readonly #cancelled = new Map<string, number>()
  #needsSetup = false
  #starting: Promise<ContainerLike> | undefined
  #whoami: Promise<{ HOME: string; USER: string }> | undefined

  constructor(
    container: () => ContainerLike | undefined,
    store: MachineStore,
    config: MachineConfig,
    now: () => number = Date.now,
  ) {
    this.#container = container
    this.#store = store
    this.#config = config
    this.#now = now
  }

  #require(): ContainerLike {
    const container = this.#container()
    if (container === undefined) {
      throw new Error(
        "This deployment has no container configured. Add the `containers` entry for the " +
          "sandbox class to wrangler.jsonc, or choose another DC_SANDBOX.",
      )
    }
    return container
  }

  /**
   * Call when the object starts and finds its machine running: the inactivity timeout belongs to
   * the object instance, so a restarted object has to set it again.
   */
  async resumed(): Promise<void> {
    const container = this.#container()
    if (container?.running)
      await within(container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS), SETUP_TIMEOUT_MS)
  }

  /** The running machine, started from the last snapshot if it had stopped. */
  #ensureRunning(): Promise<ContainerLike> {
    // One start at a time: `start()` throws on a machine that is already starting.
    if (this.#starting === undefined) {
      const controller = new AbortController()
      this.#starting = within(this.#start(controller.signal), START_TIMEOUT_MS, () =>
        controller.abort(),
      ).finally(() => {
        this.#starting = undefined
      })
    }
    return this.#starting
  }

  async #start(signal: AbortSignal): Promise<ContainerLike> {
    const container = this.#require()
    if (!container.running) {
      const snapshotId = await this.#store.get<string>("snapshotId")
      signal.throwIfAborted()
      await this.#store.put({ needsSetup: true })
      signal.throwIfAborted()
      // A snapshot that cannot be restored fails here, and keeps failing. That is deliberate:
      // falling back to the image would hand the agent an empty disk as if it were its own.
      container.start({
        ...(snapshotId === undefined
          ? { image: container.images?.[this.#config.image] ?? this.#config.image }
          : { containerSnapshot: { id: snapshotId } }),
        // The managed image's own command exits at once, which would stop the machine.
        entrypoint: ["sleep", "infinity"],
        enableInternet: this.#config.internet,
        instance: this.#config.instance,
      })
      this.#needsSetup = true
      await this.#store.put({ savedAt: this.#now() })
    }
    signal.throwIfAborted()
    this.#needsSetup ||= (await this.#store.get<boolean>("needsSetup")) === true
    signal.throwIfAborted()
    if (this.#needsSetup) {
      // `exec` waits for a machine that is still starting, and rejects if it failed to start.
      const { exitCode, stdout } = await this.#run(
        container,
        ["mkdir", "-p", "--", this.#config.home],
        { stderr: "combined" },
        SETUP_TIMEOUT_MS,
      )
      signal.throwIfAborted()
      if (exitCode !== 0) throw new Error(`The machine could not be prepared: ${decode(stdout)}`)
      await this.#store.put({ needsSetup: false })
      signal.throwIfAborted()
      this.#needsSetup = false
    }
    signal.throwIfAborted()
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS)
    signal.throwIfAborted()
    if ((await this.#store.getAlarm()) === null) {
      signal.throwIfAborted()
      await this.#store.setAlarm(this.#now() + CHECK_INTERVAL_MS)
    }
    return container
  }

  /** Bound both provider allocation and output, and clean up an allocation that arrives late. */
  #run(
    container: ContainerLike,
    argv: string[],
    options: Parameters<ContainerLike["exec"]>[1],
    timeoutMs: number,
  ) {
    let process: ContainerProcessLike | undefined
    let expired = false
    let exited = false
    const kill = () => {
      if (process && !exited) {
        try {
          process.kill(SIGKILL)
        } catch {}
      }
    }
    const work = (async () => {
      process = await container.exec(argv, options)
      void process.exitCode.then(
        () => {
          exited = true
        },
        () => {
          exited = true
        },
      )
      if (expired) {
        kill()
        throw new Error("Process arrived after its deadline")
      }
      return process.output()
    })()
    return within(work, timeoutMs, () => {
      expired = true
      kill()
    })
  }

  /** Who commands run as and where that user lives, asked of the image once per object. */
  #login(container: ContainerLike): Promise<{ HOME: string; USER: string }> {
    this.#whoami ??= (async () => {
      const { stdout } = await this.#run(
        container,
        ["sh", "-c", 'id -un; getent passwd "$(id -u)" | cut -d: -f6'],
        { stderr: "ignore" },
        SETUP_TIMEOUT_MS,
      )
      const [user = "", directory = ""] = decode(stdout).split("\n")
      return { USER: user || "root", HOME: directory || "/root" }
    })().catch(() => ({ USER: "root", HOME: "/root" }))
    return this.#whoami
  }

  /** Run `work` on the running machine, counted as activity so the alarm leaves it alone. */
  async #active<T>(work: (container: ContainerLike) => Promise<T>): Promise<T> {
    this.#busy++
    try {
      const container = await this.#ensureRunning()
      await within(this.#store.put({ lastActivity: this.#now() }), SETUP_TIMEOUT_MS)
      return await within(work(container), 120_000)
    } finally {
      this.#busy--
      await within(this.#store.put({ lastActivity: this.#now() }), SETUP_TIMEOUT_MS).catch(() => {})
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const route = `${request.method} ${url.pathname}`
    try {
      switch (route) {
        case "POST /exec":
          return await this.#exec((await request.json()) as ExecRequest)
        case "POST /abort": {
          const { id } = (await request.json()) as { id: string }
          this.#pruneCancelled()
          this.#cancelled.set(
            id,
            this.#now() + START_TIMEOUT_MS + SETUP_TIMEOUT_MS + 600_000 + EXEC_GRACE_MS,
          )
          while (this.#cancelled.size > 1024)
            this.#cancelled.delete(this.#cancelled.keys().next().value!)
          this.#running.get(id)?.()
          return json({ ok: true })
        }
        case "GET /file":
          return await this.#read(url.searchParams.get("path") ?? "")
        case "PUT /file":
          return await this.#write(url.searchParams.get("path") ?? "", request.body)
        case "GET /status":
          return json(await this.status())
        case "POST /save":
          return json(await this.save())
        case "POST /reset":
          await this.reset()
          return json({ ok: true })
        default:
          return json({ error: "Not found" }, 404)
      }
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  }

  #pruneCancelled(): void {
    for (const [id, until] of this.#cancelled) if (until < this.#now()) this.#cancelled.delete(id)
  }

  /** Runs a command and streams what it prints, one JSON line at a time, ending with its exit. */
  async #exec(input: ExecRequest): Promise<Response> {
    const timeoutMs = execDeadline(input.timeoutMs)
    this.#pruneCancelled()
    if (this.#cancelled.has(input.id)) throw new Error("Command aborted")
    if (this.#running.has(input.id)) throw new Error("Command id is already running")
    let timer: ReturnType<typeof setTimeout> | undefined
    let refusal = new Error("Command aborted")
    let process: ContainerProcessLike | undefined
    let exited = false
    let cancelled = false
    let busy = false
    const cancellation = new AbortController()
    const wait = <T>(work: Promise<T>): Promise<T> =>
      new Promise((resolve, reject) => {
        const abort = () => reject(refusal)
        if (cancelled) abort()
        else cancellation.signal.addEventListener("abort", abort, { once: true })
        // Remove the listener after each read, rather than retaining one per output chunk.
        work.then(
          (value) => {
            cancellation.signal.removeEventListener("abort", abort)
            resolve(value)
          },
          (error) => {
            cancellation.signal.removeEventListener("abort", abort)
            reject(error)
          },
        )
      })
    const kill = (signal = SIGTERM) => {
      if (process !== undefined && !exited) {
        try {
          process.kill(signal)
        } catch {
          // It may have exited between checking and signalling it.
        }
      }
    }
    // Register before the first await. Cancelling one caller leaves the bounded boot running
    // for other callers, but stops waiting immediately and never launches this command.
    this.#running.set(input.id, () => {
      if (cancelled) return
      cancelled = true
      kill()
      const escalation = setTimeout(() => kill(SIGKILL), 5_000)
      ;(escalation as { unref?: () => void }).unref?.()
      cancellation.abort()
    })
    const arm = (ms: number) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        refusal = new Error("Command timed out waiting for the computer")
        this.#running.get(input.id)?.()
      }, ms)
    }
    arm(START_TIMEOUT_MS + SETUP_TIMEOUT_MS + EXEC_GRACE_MS)
    let startedAt: number
    this.#busy++
    busy = true
    try {
      const container = await wait(this.#ensureRunning())
      await wait(this.#store.put({ lastActivity: this.#now() }))
      const login = await wait(this.#login(container))
      if (cancelled) throw new Error("Command aborted")
      startedAt = this.#now()
      arm(timeoutMs + EXEC_GRACE_MS)
      await wait(
        container
          .exec(boundedArgv(input.command, timeoutMs), {
            cwd: input.cwd ?? this.#config.home,
            env: { ...login, LANG: "C.UTF-8", TERM: "dumb", ...input.env },
            stderr: "combined",
          })
          .then((created) => {
            process = created
            void created.exitCode.then(
              () => (exited = true),
              () => (exited = true),
            )
            // An exec RPC may return after its caller has already aborted.
            if (cancelled) kill(SIGKILL)
          }),
      )
    } catch (error) {
      clearTimeout(timer)
      this.#running.delete(input.id)
      if (busy) this.#busy--
      throw error
    }
    const running = process!

    const encoder = new TextEncoder()
    const line = (value: ExecLine) => encoder.encode(`${JSON.stringify(value)}\n`)
    const finish = async () => {
      clearTimeout(timer)
      this.#running.delete(input.id)
      this.#busy--
      await within(this.#store.put({ lastActivity: this.#now() }), SETUP_TIMEOUT_MS).catch(() => {})
    }
    const now = this.#now
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const decoder = new TextDecoder()
          if (running.stdout) {
            const reader = running.stdout.getReader()
            try {
              for (;;) {
                const { done, value } = await wait(reader.read())
                if (done) break
                const output = decoder.decode(value, { stream: true })
                if (output !== "") controller.enqueue(line({ output }))
              }
            } finally {
              // Do not await a broken provider's cancellation while unwinding an abort.
              if (cancelled) void reader.cancel().catch(() => {})
              reader.releaseLock()
            }
          }
          const rest = decoder.decode()
          if (rest !== "") controller.enqueue(line({ output: rest }))
          const exitCode = await wait(running.exitCode)
          controller.enqueue(
            line({ exitCode, timedOut: hitDeadline(exitCode, now() - startedAt, timeoutMs) }),
          )
          controller.close()
        } catch (error) {
          controller.error(error)
        } finally {
          await finish()
        }
      },
      // The caller went away: nobody is waiting for this command any more.
      cancel: () => this.#running.get(input.id)?.(),
    })
    return new Response(body, { headers: { "content-type": "application/x-ndjson" } })
  }

  /** A file command's outcome as an error response the client turns back into a typed failure. */
  #fileError(exitCode: number, output: string, path: string): Response {
    const error = failure({ exitCode, output }, path)
    return json({ error: error.message, code: error.code }, 422)
  }

  async #read(path: string): Promise<Response> {
    return this.#active(async (container) => {
      const { exitCode, stdout, stderr } = await this.#run(
        container,
        [
          "sh",
          "-c",
          `if [ -d "$1" ]; then echo 'Is a directory' >&2; exit 1; fi
s=$(stat -c %s -- "$1") || exit 1
if [ "$s" -gt ${MAX_FILE_BYTES} ]; then echo 'File too large to read in one piece' >&2; exit 1; fi
exec cat -- "$1"`,
          "sh",
          path,
        ],
        undefined,
        120_000,
      )
      if (exitCode !== 0) return this.#fileError(exitCode, decode(stderr), path)
      return new Response(stdout, { headers: { "content-type": "application/octet-stream" } })
    })
  }

  async #write(path: string, data: ReadableStream<Uint8Array> | null): Promise<Response> {
    return this.#active(async (container) => {
      // bash, whose message for a missing directory is the one `failure` knows.
      const { exitCode, stdout } = await this.#run(
        container,
        ["bash", "-c", 'cat > "$1"', "bash", path],
        {
          // An empty file is a closed stdin, which is what leaving it out gives.
          ...(data === null ? {} : { stdin: data }),
          stderr: "combined",
        },
        120_000,
      )
      if (exitCode !== 0) return this.#fileError(exitCode, decode(stdout), path)
      return json({ ok: true })
    })
  }

  async status(): Promise<{ running: boolean; snapshotId: string | null; savedAt: number | null }> {
    return {
      running: this.#container()?.running ?? false,
      snapshotId: (await this.#store.get<string>("snapshotId")) ?? null,
      savedAt: (await this.#store.get<number>("savedAt")) ?? null,
    }
  }

  /** Save the running machine's disk. Each save is a new snapshot; old ones expire by themselves. */
  async save(): Promise<{ snapshotId: string; size: number }> {
    const startedAt = this.#now()
    const snapshot = await this.#require().snapshotContainer({ name: "auto" })
    await this.#store.put({ snapshotId: snapshot.id, savedAt: startedAt } satisfies Stored)
    return { snapshotId: snapshot.id, size: snapshot.size }
  }

  /** Throw the machine and its saved disk away. The next command starts from the image. */
  async reset(): Promise<void> {
    const container = this.#container()
    if (container?.running) await container.destroy("reset")
    await this.#store.delete(["snapshotId", "savedAt", "lastActivity", "needsSetup"])
  }

  /**
   * The periodic check. While the machine runs: save and stop it when idle, save a checkpoint when
   * it has been in use for a while. While it is stopped: keep its snapshot from expiring.
   */
  async alarm(): Promise<void> {
    const container = this.#container()
    if (container === undefined) return
    const now = this.#now()
    const savedAt = (await this.#store.get<number>("savedAt")) ?? 0

    if (!container.running) {
      if ((await this.#store.get<string>("snapshotId")) === undefined) return
      if (now - savedAt < REFRESH_AFTER_MS) {
        await this.#store.setAlarm(savedAt + REFRESH_AFTER_MS)
        return
      }
      // Restore, save again, stop. If this fails the alarm is retried by the runtime.
      await this.#ensureRunning()
      await this.save()
      if (this.#busy === 0) {
        await container.destroy("refreshed")
        await this.#store.setAlarm(this.#now() + REFRESH_AFTER_MS)
      } else {
        await this.#store.setAlarm(this.#now() + CHECK_INTERVAL_MS)
      }
      return
    }

    const lastActivity = (await this.#store.get<number>("lastActivity")) ?? 0
    const idle =
      this.#busy === 0 && this.#starting === undefined && now - lastActivity > IDLE_LIMIT_MS
    const checkpoint =
      this.#busy === 0 &&
      this.#starting === undefined &&
      lastActivity > savedAt &&
      now - savedAt > CHECKPOINT_INTERVAL_MS
    if (idle || checkpoint) await this.save()

    // A save takes a few seconds and commands keep running during it. One that arrived meanwhile
    // has written files this snapshot may not hold, so the machine stays up for the next check.
    const usedDuringSave =
      this.#busy > 0 ||
      this.#starting !== undefined ||
      ((await this.#store.get<number>("lastActivity")) ?? 0) !== lastActivity
    if (idle && !usedDuringSave) {
      await container.destroy("idle")
      await this.#store.setAlarm(this.#now() + REFRESH_AFTER_MS)
      return
    }
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS)
    await this.#store.setAlarm(this.#now() + CHECK_INTERVAL_MS)
  }
}

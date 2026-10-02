import { boundedArgv, execDeadline, hitDeadline } from "../remote.ts"
import { failure } from "../shell-fs.ts"

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
    if (container?.running) await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS)
  }

  /** The running machine, started from the last snapshot if it had stopped. */
  #ensureRunning(): Promise<ContainerLike> {
    // One start at a time: `start()` throws on a machine that is already starting.
    this.#starting ??= this.#start().finally(() => {
      this.#starting = undefined
    })
    return this.#starting
  }

  async #start(): Promise<ContainerLike> {
    const container = this.#require()
    if (!container.running) {
      const snapshotId = await this.#store.get<string>("snapshotId")
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
      await this.#store.put({ savedAt: this.#now() })
      // `exec` waits for a machine that is still starting, and rejects if it failed to start.
      const made = await container.exec(["mkdir", "-p", "--", this.#config.home], {
        stderr: "combined",
      })
      const { exitCode, stdout } = await made.output()
      if (exitCode !== 0) throw new Error(`The machine could not be prepared: ${decode(stdout)}`)
    }
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS)
    if ((await this.#store.getAlarm()) === null) {
      await this.#store.setAlarm(this.#now() + CHECK_INTERVAL_MS)
    }
    return container
  }

  /** Who commands run as and where that user lives, asked of the image once per object. */
  #login(container: ContainerLike): Promise<{ HOME: string; USER: string }> {
    this.#whoami ??= (async () => {
      const process = await container.exec(
        ["sh", "-c", 'id -un; getent passwd "$(id -u)" | cut -d: -f6'],
        { stderr: "ignore" },
      )
      const { stdout } = await process.output()
      const [user = "", directory = ""] = decode(stdout).split("\n")
      return { USER: user || "root", HOME: directory || "/root" }
    })().catch(() => ({ USER: "root", HOME: "/root" }))
    return this.#whoami
  }

  /** Run `work` on the running machine, counted as activity so the alarm leaves it alone. */
  async #active<T>(work: (container: ContainerLike) => Promise<T>): Promise<T> {
    const container = await this.#ensureRunning()
    this.#busy++
    await this.#store.put({ lastActivity: this.#now() })
    try {
      return await work(container)
    } finally {
      this.#busy--
      await this.#store.put({ lastActivity: this.#now() })
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

  /** Runs a command and streams what it prints, one JSON line at a time, ending with its exit. */
  async #exec(input: ExecRequest): Promise<Response> {
    const timeoutMs = execDeadline(input.timeoutMs)
    // Started before the response, so a machine that cannot start is an error and not a stream.
    const container = await this.#ensureRunning()
    this.#busy++
    await this.#store.put({ lastActivity: this.#now() })
    const startedAt = this.#now()

    let process: ContainerProcessLike
    try {
      process = await container.exec(boundedArgv(input.command, timeoutMs), {
        cwd: input.cwd ?? this.#config.home,
        // A command gets only this environment and the machine's PATH, so the basics a shell
        // would have had from a login are put back.
        env: { ...(await this.#login(container)), LANG: "C.UTF-8", TERM: "dumb", ...input.env },
        stderr: "combined",
      })
    } catch (error) {
      this.#busy--
      throw error
    }

    // Signalling a process that has exited is an error in the runtime, so remember when it has.
    let exited = false
    void process.exitCode.then(
      () => (exited = true),
      () => (exited = true),
    )
    this.#running.set(input.id, () => {
      if (!exited) process.kill(SIGTERM)
    })

    const encoder = new TextEncoder()
    const line = (value: ExecLine) => encoder.encode(`${JSON.stringify(value)}\n`)
    const finish = async () => {
      this.#running.delete(input.id)
      this.#busy--
      await this.#store.put({ lastActivity: this.#now() })
    }
    const now = this.#now
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const decoder = new TextDecoder()
          if (process.stdout) {
            const reader = process.stdout.getReader()
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              const output = decoder.decode(value, { stream: true })
              if (output !== "") controller.enqueue(line({ output }))
            }
          }
          const rest = decoder.decode()
          if (rest !== "") controller.enqueue(line({ output: rest }))
          const exitCode = await process.exitCode
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
      const process = await container.exec([
        "sh",
        "-c",
        `if [ -d "$1" ]; then echo 'Is a directory' >&2; exit 1; fi
s=$(stat -c %s -- "$1") || exit 1
if [ "$s" -gt ${MAX_FILE_BYTES} ]; then echo 'File too large to read in one piece' >&2; exit 1; fi
exec cat -- "$1"`,
        "sh",
        path,
      ])
      const { exitCode, stdout, stderr } = await process.output()
      if (exitCode !== 0) return this.#fileError(exitCode, decode(stderr), path)
      return new Response(stdout, { headers: { "content-type": "application/octet-stream" } })
    })
  }

  async #write(path: string, data: ReadableStream<Uint8Array> | null): Promise<Response> {
    return this.#active(async (container) => {
      // bash, whose message for a missing directory is the one `failure` knows.
      const process = await container.exec(["bash", "-c", 'cat > "$1"', "bash", path], {
        // An empty file is a closed stdin, which is what leaving it out gives.
        ...(data === null ? {} : { stdin: data }),
        stderr: "combined",
      })
      const { exitCode, stdout } = await process.output()
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
    await this.#store.delete(["snapshotId", "savedAt", "lastActivity"])
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
    const idle = this.#busy === 0 && now - lastActivity > IDLE_LIMIT_MS
    const checkpoint =
      this.#busy === 0 && lastActivity > savedAt && now - savedAt > CHECKPOINT_INTERVAL_MS
    if (idle || checkpoint) await this.save()

    // A save takes a few seconds and commands keep running during it. One that arrived meanwhile
    // has written files this snapshot may not hold, so the machine stays up for the next check.
    const usedDuringSave =
      this.#busy > 0 || ((await this.#store.get<number>("lastActivity")) ?? 0) !== lastActivity
    if (idle && !usedDuringSave) {
      await container.destroy("idle")
      await this.#store.setAlarm(this.#now() + REFRESH_AFTER_MS)
      return
    }
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS)
    await this.#store.setAlarm(this.#now() + CHECK_INTERVAL_MS)
  }
}

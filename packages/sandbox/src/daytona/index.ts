import type { ExecOptions, ExecOutcome, Sandbox } from "../index.ts"
import { lazySandbox } from "../lazy.ts"
import {
  boundedShell,
  checkedTransfer,
  execDeadline,
  hitDeadline,
  remoteMachine,
} from "../remote.ts"
import { shellFs } from "../shell-fs.ts"
import { type DaytonaClientLike, type DaytonaMachineLike, getOrCreateSandbox } from "./lifecycle.ts"

export {
  type DaytonaClientLike,
  type DaytonaMachineLike,
  ensureStarted,
  getOrCreateSandbox,
  isConflict,
  isNotFound,
  SandboxUnavailableError,
} from "./lifecycle.ts"

/** Home directory of the default user in Daytona's default image. */
export const DAYTONA_HOME = "/home/daytona"
/** Minutes without use after which Daytona stops the machine. Its disk is kept. */
const AUTO_STOP_MINUTES = 15
/** Seconds the provider's own deadline trails ours by, so ours is the one that reports. */
const PROVIDER_GRACE_SECONDS = 15

/** The parts of a Daytona sandbox this provider uses. The SDK's `Sandbox` satisfies it. */
export interface DaytonaSandboxLike extends DaytonaMachineLike {
  refreshData?(): Promise<void>
  process: {
    executeCommand(
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ): Promise<{ result?: string; exitCode?: number }>
  }
  fs: {
    downloadFile(path: string): Promise<Uint8Array>
    uploadFile(file: Buffer, path: string): Promise<void>
  }
}

export type DaytonaSandboxOptions = {
  readonly id: string
  readonly apiKey: string
  readonly apiUrl?: string
  /** The Daytona region to create the machine in. */
  readonly target?: string
  /** Start from this snapshot instead of Daytona's default. */
  readonly snapshot?: string
  /** Or build from this image, such as `debian:13`. Ignored when `snapshot` is set. */
  readonly image?: string
  readonly home?: string
  /** For tests: the client to use instead of the SDK's. */
  readonly client?: () => Promise<DaytonaClientLike<DaytonaSandboxLike>>
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
}

/** A name Daytona accepts, the same for the same agent every time. */
export const daytonaName = (id: string) => `dc-${id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`

/**
 * An agent's computer on Daytona: a Linux machine found by a name derived from the agent's id, and
 * created the first time. Daytona stops it after a quarter of an hour without use and keeps its
 * whole disk, so the next command starts the same machine, installed packages included.
 */
export function daytonaSandbox(options: DaytonaSandboxOptions): Sandbox {
  const name = daytonaName(options.id)
  const home = options.home ?? DAYTONA_HOME
  const now = options.now ?? Date.now

  const client =
    options.client ??
    (async () => {
      // Loaded on first use: most requests never touch the computer.
      const { Daytona } = await import("@daytona/sdk")
      const daytona = new Daytona({
        apiKey: options.apiKey,
        apiUrl: options.apiUrl,
        target: options.target,
      })
      // Narrowed by hand only where the SDK overloads a method; the rest is checked by the types.
      const narrowed: DaytonaClientLike<DaytonaSandboxLike> = {
        get: (name) => daytona.get(name),
        create: (params) => daytona.create(params),
        start: (sandbox) => daytona.start(sandbox as Parameters<typeof daytona.start>[0]),
      }
      return narrowed
    })
  let connecting: ReturnType<typeof client> | undefined
  const connect = () => (connecting ??= client())

  const machine = remoteMachine<DaytonaSandboxLike>({
    attach: async () =>
      getOrCreateSandbox(await connect(), name, {
        sleep: options.sleep,
        create: {
          autoStopInterval: AUTO_STOP_MINUTES,
          // Never deleted for being unused; archived instead, which a start brings back.
          autoDeleteInterval: -1,
          labels: { "durable-computer": options.id },
          ...(options.snapshot !== undefined
            ? { snapshot: options.snapshot }
            : options.image !== undefined
              ? { image: options.image }
              : {}),
        },
      }),
    alive: async (sandbox) => {
      await sandbox.refreshData?.()
      return sandbox.state === "started"
    },
    // Well inside the auto-stop interval, so a machine about to be trusted has been seen lately.
    staleAfterMs: (AUTO_STOP_MINUTES * 60_000) / 3,
    now,
  })

  const exec = async (command: string, execOptions: ExecOptions = {}): Promise<ExecOutcome> => {
    execOptions.signal?.throwIfAborted()
    const timeoutMs = execDeadline(execOptions.timeoutMs)
    const startedAt = now()
    const response = await machine.use((sandbox) =>
      sandbox.process.executeCommand(
        // stderr joins stdout here: Daytona returns only one of them otherwise.
        boundedShell(`exec 2>&1\n${command}`, timeoutMs),
        execOptions.cwd ?? home,
        execOptions.env === undefined ? undefined : { ...execOptions.env },
        Math.ceil(timeoutMs / 1000) + PROVIDER_GRACE_SECONDS,
      ),
    )
    // Daytona has no way to stop a command, so an abort is noticed only once it ends.
    execOptions.signal?.throwIfAborted()
    const output = response.result ?? ""
    if (output !== "") execOptions.onOutput?.(output)
    const exitCode = response.exitCode ?? 0
    return { exitCode, output, timedOut: hitDeadline(exitCode, now() - startedAt, timeoutMs) }
  }

  const real: Sandbox = {
    id: `daytona:${options.id}`,
    home,
    capabilities: { realBinaries: true, network: true },
    exec,
    // Daytona's disk is the machine's own; there is nothing to copy anywhere.
    flush: async () => {},
    fs: shellFs(
      exec,
      checkedTransfer(exec, {
        readFile: (path) =>
          machine.use(async (sandbox) => new Uint8Array(await sandbox.fs.downloadFile(path))),
        writeFile: (path, data) =>
          machine.use((sandbox) => sandbox.fs.uploadFile(Buffer.from(data), path)),
      }),
    ),
  }
  // `remoteMachine` already attaches on first use; `lazySandbox` adds nothing but its shape.
  return lazySandbox({
    id: real.id,
    home,
    capabilities: real.capabilities,
    acquire: async () => real,
  })
}

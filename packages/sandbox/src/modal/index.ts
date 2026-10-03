import type { ExecOptions, ExecOutcome, Sandbox } from "../index.ts"
import { lazySandbox } from "../lazy.ts"
import {
  boundedArgv,
  checkedTransfer,
  execDeadline,
  hitDeadline,
  remoteMachine,
} from "../remote.ts"
import { quote, shellFs } from "../shell-fs.ts"

export const MODAL_HOME = "/workspace"
export const DEFAULT_MODAL_APP = "durable-computer"
/** A Debian image with Node, Python, git and build tools: a reasonable machine to start from. */
export const DEFAULT_MODAL_IMAGE = "node:24-trixie"
/** A machine nobody uses for this long is stopped. */
const IDLE_TIMEOUT_MS = 15 * 60_000
/** Modal's longest lifetime for one sandbox. After it, the next command starts a new one. */
const MAX_LIFETIME_MS = 24 * 60 * 60_000
/** Milliseconds the provider's own deadline trails ours by, so ours is the one that reports. */
const PROVIDER_GRACE_MS = 15_000

/** The parts of a Modal process this provider uses. */
export interface ModalProcessLike<R> {
  stdout: ReadableStream<R>
  wait(): Promise<number>
}

/** The parts of a Modal sandbox this provider uses. The SDK's `Sandbox` satisfies it. */
export interface ModalSandboxLike {
  exec(
    command: string[],
    params?: {
      mode?: "text"
      workdir?: string
      env?: Record<string, string>
      timeoutMs?: number
      stderr?: "pipe" | "ignore"
    },
  ): Promise<ModalProcessLike<string>>
  filesystem: {
    readBytes(path: string): Promise<Uint8Array>
    writeBytes(data: Uint8Array, path: string): Promise<void>
  }
  /** `null` while the sandbox runs, its exit code once it has ended. */
  poll(): Promise<number | null>
  terminate(): Promise<void>
}

/** The parts of the Modal client this provider uses, already narrowed to one app and image. */
export interface ModalSessionLike {
  /** The running sandbox with this name. Rejects with `NotFoundError` when there is none. */
  find(name: string): Promise<ModalSandboxLike>
  /** A new sandbox with this name. Rejects with `AlreadyExistsError` if one is running. */
  create(name: string): Promise<ModalSandboxLike>
  /** Delete the workspace volume with this name. Succeeds when there is none. */
  deleteVolume(name: string): Promise<void>
}

export type ModalSandboxOptions = {
  readonly id: string
  readonly tokenId: string
  readonly tokenSecret: string
  /** The Modal app the machines belong to. Created if it does not exist. */
  readonly app?: string
  /** A registry image to start machines from. */
  readonly image?: string
  /** The Modal environment, if the workspace uses more than one. */
  readonly environment?: string
  /** Where the workspace volume is mounted. */
  readonly home?: string
  /** Whether the machine can reach the network. Default true. Applies when it is created. */
  readonly network?: boolean
  /** For tests: the session to use instead of the SDK's. */
  readonly session?: () => Promise<ModalSessionLike>
  readonly now?: () => number
}

const named = (error: unknown, name: string) =>
  typeof error === "object" && error !== null && (error as { name?: unknown }).name === name

/** A name Modal accepts for a sandbox and a volume, the same for the same agent every time. */
export const modalName = (id: string) => `dc-${id.replace(/[^A-Za-z0-9_.-]/g, "-")}`.slice(0, 64)

async function sdkSession(options: ModalSandboxOptions): Promise<ModalSessionLike> {
  // Loaded on first use: most requests never touch the computer, and the SDK is Node-only.
  const { ModalClient } = await import("modal")
  const client = new ModalClient({
    tokenId: options.tokenId,
    tokenSecret: options.tokenSecret,
    environment: options.environment,
  })
  const appName = options.app ?? DEFAULT_MODAL_APP
  const home = options.home ?? MODAL_HOME
  const app = await client.apps.fromName(appName, { createIfMissing: true })
  const image = client.images.fromRegistry(options.image ?? DEFAULT_MODAL_IMAGE)
  return {
    find: (name) => client.sandboxes.fromName(appName, name),
    create: async (name) => {
      // The workspace is a volume of its own, so it outlives every machine it is mounted in.
      const volume = await client.volumes.fromName(name, { createIfMissing: true })
      return client.sandboxes.create(app, image, {
        name,
        volumes: { [home]: volume },
        workdir: home,
        timeoutMs: MAX_LIFETIME_MS,
        idleTimeoutMs: IDLE_TIMEOUT_MS,
        ...(options.network === false ? { blockNetwork: true } : {}),
      })
    },
    deleteVolume: (name) => client.volumes.delete(name, { allowMissing: true }),
  }
}

/**
 * An agent's computer on Modal: a sandbox found by a name derived from the agent's id, with a
 * volume of the same name mounted as its workspace.
 *
 * Modal stops a sandbox when it is idle and after a day at most, and a stopped sandbox is gone.
 * So the workspace persists and the rest of the machine does not: a package installed outside the
 * workspace is there until the machine is replaced.
 */
export function modalSandbox(options: ModalSandboxOptions): Sandbox {
  const name = modalName(options.id)
  const home = options.home ?? MODAL_HOME
  const now = options.now ?? Date.now
  const open = options.session ?? (() => sdkSession(options))
  let opening: Promise<ModalSessionLike> | undefined
  const session = () => {
    opening ??= open()
    opening.catch(() => (opening = undefined))
    return opening
  }

  const machine = remoteMachine<ModalSandboxLike>({
    attach: async () => {
      const modal = await session()
      try {
        return await modal.find(name)
      } catch (error) {
        if (!named(error, "NotFoundError")) throw error
      }
      try {
        return await modal.create(name)
      } catch (error) {
        // Another request started it between the look and the create.
        if (!named(error, "AlreadyExistsError")) throw error
        return modal.find(name)
      }
    },
    alive: async (sandbox) => (await sandbox.poll()) === null,
    staleAfterMs: IDLE_TIMEOUT_MS / 3,
    now,
  })

  const exec = async (command: string, execOptions: ExecOptions = {}): Promise<ExecOutcome> => {
    execOptions.signal?.throwIfAborted()
    const timeoutMs = execDeadline(execOptions.timeoutMs)
    const startedAt = now()
    return machine.use(async (sandbox) => {
      const process = await sandbox.exec(
        // One stream, in the order things were printed.
        boundedArgv(`exec 2>&1\n${command}`, timeoutMs),
        {
          mode: "text",
          workdir: execOptions.cwd ?? home,
          env: execOptions.env === undefined ? undefined : { ...execOptions.env },
          timeoutMs: timeoutMs + PROVIDER_GRACE_MS,
          stderr: "ignore",
        },
      )
      let output = ""
      const reader = process.stdout.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        output += value
        execOptions.onOutput?.(value)
      }
      const exitCode = await process.wait()
      // Modal has no way to stop one command, so an abort is noticed only once it ends.
      execOptions.signal?.throwIfAborted()
      return { exitCode, output, timedOut: hitDeadline(exitCode, now() - startedAt, timeoutMs) }
    })
  }

  const real: Sandbox = {
    id: `modal:${options.id}`,
    home,
    capabilities: { realBinaries: true, network: options.network !== false },
    exec,
    // A volume is written back in the background and when the machine stops. `sync` on the mount
    // asks for it now.
    flush: async () => {
      if (machine.attached) await exec(`sync ${quote(home)}`).catch(() => {})
    },
    fs: shellFs(
      exec,
      checkedTransfer(exec, {
        readFile: (path) => machine.use((sandbox) => sandbox.filesystem.readBytes(path)),
        writeFile: (path, data) =>
          machine.use((sandbox) => sandbox.filesystem.writeBytes(data, path)),
      }),
    ),
  }
  return lazySandbox({
    id: real.id,
    home: real.home,
    capabilities: real.capabilities,
    acquire: async () => real,
    destroy: async () => {
      const modal = await session()
      try {
        // The machine first: a volume cannot go while something has it mounted.
        await (await modal.find(name)).terminate()
      } catch (error) {
        if (!named(error, "NotFoundError")) throw error
      }
      await modal.deleteVolume(name)
    },
  })
}

import {
  type DirectoryEntry,
  type ExecOptions,
  type ExecOutcome,
  type FileStat,
  type Sandbox,
  SandboxError,
  type SandboxErrorCode,
  type SandboxFs,
} from "../index.ts"
import { lazySandbox } from "../lazy.ts"

export { movedFromDatabase } from "./legacy.ts"

export const DEFAULT_HOME = "/workspace"

export type ShellExecRequest = {
  /** Names the command, so that it can be stopped. */
  readonly id: string
  readonly command: string
  readonly cwd?: string
  readonly env?: Record<string, string>
  readonly timeoutMs?: number
}

/** What a file operation came to. A failure is a value: an error loses its code on the way. */
export type ShellAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: SandboxErrorCode; readonly message: string }

/** What the shell's object answers to. Paths are absolute. */
export interface WorkerShellRpc {
  exec(request: ShellExecRequest): Promise<ExecOutcome>
  abort(id: string): Promise<void>
  stat(path: string): Promise<ShellAnswer<FileStat | null>>
  list(path: string): Promise<ShellAnswer<DirectoryEntry[]>>
  readFile(path: string): Promise<ShellAnswer<ReadableStream<Uint8Array>>>
  writeFile(path: string, data: ReadableStream<Uint8Array>): Promise<ShellAnswer<null>>
  mkdir(path: string, recursive: boolean): Promise<ShellAnswer<null>>
  remove(path: string, recursive: boolean, force: boolean): Promise<ShellAnswer<null>>
  rename(from: string, to: string): Promise<ShellAnswer<null>>
  symlink(target: string, path: string): Promise<ShellAnswer<null>>
  chmod(path: string, mode: number): Promise<ShellAnswer<null>>
  realpath(path: string): Promise<ShellAnswer<string>>
  reset(): Promise<void>
}

export type WorkerShellSandboxOptions = {
  /** What the files are kept under. Equal ids are the same shell. */
  readonly id: string
  /** The shell's object. */
  readonly shell: WorkerShellRpc
  readonly home?: string
  /** Whether the shell was given the internet, to describe it truthfully. Default true. */
  readonly network?: boolean
  /**
   * Run once before the shell is first used, with the shell itself: for files that were kept
   * somewhere else and are to be moved in.
   */
  readonly prepare?: (shell: WorkerShellRpc) => Promise<void>
}

async function unwrap<T>(path: string, answer: Promise<ShellAnswer<T>>): Promise<T> {
  const answered = await answer
  if (answered.ok) return answered.value
  throw new SandboxError(answered.code, answered.message, path)
}

const bytes = (data: Uint8Array): ReadableStream<Uint8Array> =>
  new Response(data.slice().buffer).body ??
  new ReadableStream({
    start: (controller) => controller.close(),
  })

function remoteFs(shell: WorkerShellRpc): SandboxFs {
  return {
    stat: async (path) => (await unwrap(path, shell.stat(path))) ?? undefined,
    list: (path) => unwrap(path, shell.list(path)),
    readFile: async (path) =>
      new Uint8Array(await new Response(await unwrap(path, shell.readFile(path))).arrayBuffer()),
    writeFile: async (path, data) => void (await unwrap(path, shell.writeFile(path, bytes(data)))),
    mkdir: async (path, options) => void (await unwrap(path, shell.mkdir(path, options.recursive))),
    remove: async (path, options) =>
      void (await unwrap(path, shell.remove(path, options.recursive, options.force))),
    rename: async (from, to) => void (await unwrap(from, shell.rename(from, to))),
    realpath: (path) => unwrap(path, shell.realpath(path)),
  }
}

/**
 * The built-in shell where the server runs on Cloudflare, seen from the agent: a shell
 * interpreter with no machine behind it. Every call goes to the shell's object, which keeps the
 * files and runs commands in a Worker of their own. It has the common text tools but no real
 * binaries, so no git, package managers or browser.
 */
export function workerShellSandbox(options: WorkerShellSandboxOptions): Sandbox {
  const { shell } = options
  const home = options.home ?? DEFAULT_HOME

  const exec = async (command: string, execOptions: ExecOptions = {}): Promise<ExecOutcome> => {
    execOptions.signal?.throwIfAborted()
    const id = crypto.randomUUID()
    // The object stops the command; this side only has to ask.
    const abort = () => void shell.abort(id).catch(() => {})
    execOptions.signal?.addEventListener("abort", abort, { once: true })
    try {
      const outcome = await shell.exec({
        id,
        command,
        cwd: execOptions.cwd,
        env: execOptions.env === undefined ? undefined : { ...execOptions.env },
        timeoutMs: execOptions.timeoutMs,
      })
      execOptions.signal?.throwIfAborted()
      if (outcome.output !== "") execOptions.onOutput?.(outcome.output)
      return outcome
    } finally {
      execOptions.signal?.removeEventListener("abort", abort)
    }
  }

  return lazySandbox({
    id: `just-bash:${options.id}`,
    home,
    capabilities: { realBinaries: false, network: options.network !== false },
    // Deleting does not need what was kept elsewhere moved in first.
    destroy: () => shell.reset(),
    acquire: async () => {
      await options.prepare?.(shell)
      return {
        id: `just-bash:${options.id}`,
        home,
        capabilities: { realBinaries: false, network: options.network !== false },
        exec,
        fs: remoteFs(shell),
        // The object stores each change as it is made.
        flush: async () => {},
      }
    },
  })
}

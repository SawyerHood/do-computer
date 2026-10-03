export { SandboxEnv } from "./env.ts"
export { createJustBashSandbox, type JustBashOptions, justBashSandbox } from "./just-bash/index.ts"
export { lazySandbox, type LazySandboxOptions } from "./lazy.ts"
export { shellFs } from "./shell-fs.ts"

export type FileKind = "file" | "directory" | "symlink"

export type FileStat = {
  readonly kind: FileKind
  readonly size: number
  readonly mtimeMs: number
}

export type DirectoryEntry = FileStat & { readonly name: string }

export type SandboxErrorCode =
  "not_found" | "not_directory" | "is_directory" | "permission_denied" | "invalid" | "unknown"

/** A file operation that failed for a reason the caller can act on. */
export class SandboxError extends Error {
  constructor(
    readonly code: SandboxErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message)
  }
}

/**
 * File operations of a sandbox. Paths are absolute. Operations reject with `SandboxError`; anything
 * else is treated as an unknown failure.
 */
export interface SandboxFs {
  /** The entry at `path` without following a final symlink, or undefined when there is none. */
  stat(path: string): Promise<FileStat | undefined>
  list(path: string): Promise<DirectoryEntry[]>
  readFile(path: string): Promise<Uint8Array>
  /** Create or replace a file. The parent directory must exist. */
  writeFile(path: string, data: Uint8Array): Promise<void>
  mkdir(path: string, options: { recursive: boolean }): Promise<void>
  remove(path: string, options: { recursive: boolean; force: boolean }): Promise<void>
  rename(from: string, to: string): Promise<void>
  /** The path with every symlink resolved. */
  realpath(path: string): Promise<string>
}

export type ExecOptions = {
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  /** Receives combined stdout and stderr as it arrives; providers that cannot stream call it once. */
  readonly onOutput?: (text: string) => void
}

export type ExecOutcome = {
  readonly exitCode: number
  /** Combined stdout and stderr. */
  readonly output: string
  readonly timedOut?: boolean
}

/**
 * An agent's computer, reduced to what every provider can do: run a shell command and work with
 * files. A paired computer has the same shape.
 */
export interface Sandbox {
  /** Equal ids see the same files at the same paths. */
  readonly id: string
  /** The durable workspace directory, and the default working directory. */
  readonly home: string
  /** What this sandbox can do, so the agent is not told about tools that cannot work. */
  readonly capabilities: { readonly realBinaries: boolean; readonly network: boolean }
  readonly fs: SandboxFs
  exec(command: string, options?: ExecOptions): Promise<ExecOutcome>
  /** Make everything written so far durable. A no-op where writes already are. */
  flush(): Promise<void>
  /**
   * Delete the machine and everything on it, for good. Absent where the sandbox keeps nothing
   * outside the agent's own storage. Succeeds when there was nothing to delete.
   */
  destroy?(): Promise<void>
}

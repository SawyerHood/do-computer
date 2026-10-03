import type { Context } from "@earendil-works/chord"
import {
  type ExecutionEnv,
  ExecutionError,
  err,
  FileError,
  type FileErrorCode,
  type FileInfo,
  ok,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type TextLineReader,
  toError,
} from "@earendil-works/pi-durable/env"
import { type FileStat, type Sandbox, SandboxError } from "./index.ts"

const decoder = new TextDecoder()
const encoder = new TextEncoder()

/** Join and normalize a POSIX path; `..` cannot climb above the root. */
export function resolvePosix(base: string, path: string): string {
  const parts = (path.startsWith("/") ? path : `${base}/${path}`).split("/")
  const resolved: string[] = []
  for (const part of parts) {
    if (part === "" || part === ".") continue
    if (part === "..") resolved.pop()
    else resolved.push(part)
  }
  return `/${resolved.join("/")}`
}

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1) || "/"

function fileError(error: unknown, path: string): FileError {
  if (error instanceof SandboxError) {
    const code: FileErrorCode = error.code
    return new FileError(code, error.message, error.path ?? path)
  }
  const cause = toError(error)
  return new FileError("unknown", cause.message, path, cause)
}

function info(path: string, stat: FileStat): FileInfo {
  return { name: basename(path), path, kind: stat.kind, size: stat.size, mtimeMs: stat.mtimeMs }
}

function splitLines(text: string): { text: string; terminated: boolean }[] {
  const lines: { text: string; terminated: boolean }[] = []
  let start = 0
  for (;;) {
    const end = text.indexOf("\n", start)
    if (end === -1) {
      if (start < text.length) lines.push({ text: text.slice(start), terminated: false })
      return lines
    }
    lines.push({ text: text.slice(start, end), terminated: true })
    start = end + 1
  }
}

/**
 * pi-durable's execution environment over a `Sandbox`. This is what the agent's file and shell
 * tools run against, whichever provider the sandbox comes from.
 */
export class SandboxEnv implements ExecutionEnv {
  readonly id: string
  cwd: string
  readonly #sandbox: Sandbox
  #temporary = 0

  constructor(sandbox: Sandbox, cwd?: string) {
    this.#sandbox = sandbox
    this.id = sandbox.id
    this.cwd = cwd === undefined ? sandbox.home : resolvePosix(sandbox.home, cwd)
  }

  #resolve(path: string): string {
    if (path === "~") return this.#sandbox.home
    if (path.startsWith("~/")) return resolvePosix(this.#sandbox.home, path.slice(2))
    return resolvePosix(this.cwd, path)
  }

  async #file<T>(
    path: string,
    run: (absolute: string) => Promise<T>,
  ): Promise<Result<T, FileError>> {
    const absolute = this.#resolve(path)
    try {
      return ok(await run(absolute))
    } catch (error) {
      return err(fileError(error, absolute))
    }
  }

  async #ensureParent(absolute: string): Promise<void> {
    const directory = absolute.slice(0, absolute.lastIndexOf("/")) || "/"
    if ((await this.#sandbox.fs.stat(directory)) === undefined) {
      await this.#sandbox.fs.mkdir(directory, { recursive: true })
    }
  }

  async absolutePath(path: string): Promise<Result<string, FileError>> {
    return ok(this.#resolve(path))
  }

  async joinPath(parts: string[]): Promise<Result<string, FileError>> {
    return ok(parts.reduce((base, part) => resolvePosix(base, part), this.cwd))
  }

  readTextFile(path: string): Promise<Result<string, FileError>> {
    return this.#file(path, async (absolute) =>
      decoder.decode(await this.#sandbox.fs.readFile(absolute)),
    )
  }

  async openTextLineReader(path: string): Promise<Result<TextLineReader, FileError>> {
    const text = await this.readTextFile(path)
    if (!text.ok) return text
    const lines = splitLines(text.value)
    let next = 0
    return ok({
      readLine: async () => ok(lines[next++]),
      close: async () => {},
    })
  }

  async readTextLines(
    path: string,
    options: { maxLines?: number } | undefined,
  ): Promise<Result<string[], FileError>> {
    const text = await this.readTextFile(path)
    if (!text.ok) return text
    const lines = splitLines(text.value).map((line) => line.text)
    return ok(options?.maxLines === undefined ? lines : lines.slice(0, options.maxLines))
  }

  readBinaryFile(path: string): Promise<Result<Uint8Array, FileError>> {
    return this.#file(path, (absolute) => this.#sandbox.fs.readFile(absolute))
  }

  /** Missing parent directories are created, as the write tool promises. */
  writeFile(path: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
    return this.#file(path, async (absolute) => {
      const data = typeof content === "string" ? encoder.encode(content) : content
      await this.#ensureParent(absolute)
      await this.#sandbox.fs.writeFile(absolute, data)
      await this.#sandbox.flush()
    })
  }

  appendFile(path: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
    return this.#file(path, async (absolute) => {
      const addition = typeof content === "string" ? encoder.encode(content) : content
      const existing = (await this.#sandbox.fs.stat(absolute))
        ? await this.#sandbox.fs.readFile(absolute)
        : new Uint8Array()
      const joined = new Uint8Array(existing.length + addition.length)
      joined.set(existing)
      joined.set(addition, existing.length)
      await this.#ensureParent(absolute)
      await this.#sandbox.fs.writeFile(absolute, joined)
      await this.#sandbox.flush()
    })
  }

  truncateFile(path: string, size: number): Promise<Result<void, FileError>> {
    return this.#file(path, async (absolute) => {
      const existing = await this.#sandbox.fs.readFile(absolute)
      const resized = new Uint8Array(size)
      resized.set(existing.subarray(0, size))
      await this.#sandbox.fs.writeFile(absolute, resized)
      await this.#sandbox.flush()
    })
  }

  flushFile(path: string): Promise<Result<void, FileError>> {
    return this.#file(path, () => this.#sandbox.flush())
  }

  async renameFile(source: string, destination: string): Promise<Result<void, FileError>> {
    return this.#file(source, async (absolute) => {
      await this.#sandbox.fs.rename(absolute, this.#resolve(destination))
      await this.#sandbox.flush()
    })
  }

  fileInfo(path: string): Promise<Result<FileInfo, FileError>> {
    return this.#file(path, async (absolute) => {
      const stat = await this.#sandbox.fs.stat(absolute)
      if (stat === undefined) throw new SandboxError("not_found", `No such file: ${absolute}`)
      return info(absolute, stat)
    })
  }

  listDir(path: string): Promise<Result<FileInfo[], FileError>> {
    return this.#file(path, async (absolute) =>
      (await this.#sandbox.fs.list(absolute))
        .map((entry) => info(resolvePosix(absolute, entry.name), entry))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    )
  }

  canonicalPath(path: string): Promise<Result<string, FileError>> {
    return this.#file(path, (absolute) => this.#sandbox.fs.realpath(absolute))
  }

  exists(path: string): Promise<Result<boolean, FileError>> {
    return this.#file(
      path,
      async (absolute) => (await this.#sandbox.fs.stat(absolute)) !== undefined,
    )
  }

  createDir(
    path: string,
    options: { recursive?: boolean } | undefined,
  ): Promise<Result<void, FileError>> {
    return this.#file(path, async (absolute) => {
      await this.#sandbox.fs.mkdir(absolute, { recursive: options?.recursive ?? false })
      await this.#sandbox.flush()
    })
  }

  remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
  ): Promise<Result<void, FileError>> {
    return this.#file(path, async (absolute) => {
      await this.#sandbox.fs.remove(absolute, {
        recursive: options?.recursive ?? false,
        force: options?.force ?? false,
      })
      await this.#sandbox.flush()
    })
  }

  #temporaryName(prefix: string, suffix: string): string {
    const unique = `${Date.now().toString(36)}${(this.#temporary++).toString(36)}${Math.random().toString(36).slice(2, 8)}`
    return `/tmp/${prefix}${unique}${suffix}`
  }

  createTempDir(prefix: string | undefined): Promise<Result<string, FileError>> {
    const path = this.#temporaryName(prefix ?? "tmp-", "")
    return this.#file(path, async (absolute) => {
      await this.#sandbox.fs.mkdir(absolute, { recursive: true })
      return absolute
    })
  }

  createTempFile(
    options: { prefix?: string; suffix?: string } | undefined,
  ): Promise<Result<string, FileError>> {
    const path = this.#temporaryName(options?.prefix ?? "tmp-", options?.suffix ?? "")
    return this.#file(path, async (absolute) => {
      await this.#sandbox.fs.mkdir("/tmp", { recursive: true })
      await this.#sandbox.fs.writeFile(absolute, new Uint8Array())
      return absolute
    })
  }

  async exec(
    command: string,
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    const timeout = options?.timeout
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
      return err(
        new ExecutionError("timeout", "Invalid timeout: must be a finite number of seconds"),
      )
    }
    let callbackError: Error | undefined
    let bytes = 0
    let lines = 0
    try {
      const outcome = await this.#sandbox.exec(command, {
        cwd: options?.cwd === undefined ? this.cwd : this.#resolve(options.cwd),
        env: options?.env,
        timeoutMs: timeout === undefined ? undefined : timeout * 1000,
        signal: context.abortSignal,
        onOutput: (text) => {
          bytes += text.length
          lines += text.split("\n").length - 1
          if (callbackError !== undefined || options?.onOutput === undefined) return
          try {
            options.onOutput(text, context)
          } catch (error) {
            callbackError = toError(error)
          }
        },
      })
      await this.#sandbox.flush()
      if (callbackError !== undefined) {
        return err(new ExecutionError("callback_error", callbackError.message, callbackError))
      }
      // Output past the thresholds is kept whole in a file, as the bash tool only retains a window.
      let spillPath: string | undefined
      const spill = options?.spill
      if (spill !== undefined && (bytes > spill.afterBytes || lines > spill.afterLines)) {
        const created = await this.createTempFile({ prefix: "output-", suffix: ".log" })
        if (created.ok) {
          const written = await this.writeFile(created.value, outcome.output)
          if (written.ok) spillPath = created.value
        }
      }
      if (context.abortSignal?.aborted) {
        const error = new ExecutionError("aborted", "Command was aborted")
        error.spillPath = spillPath
        return err(error)
      }
      if (outcome.timedOut) {
        const error = new ExecutionError("timeout", `Command timed out after ${timeout} seconds`)
        error.spillPath = spillPath
        return err(error)
      }
      return ok({ exitCode: outcome.exitCode, spillPath })
    } catch (error) {
      if (context.abortSignal?.aborted)
        return err(new ExecutionError("aborted", "Command was aborted"))
      const cause = toError(error)
      return err(new ExecutionError("unknown", cause.message, cause))
    }
  }

  async cleanup(): Promise<void> {
    await this.#sandbox.flush()
  }
}

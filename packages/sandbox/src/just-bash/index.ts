import { BodyTooLarge, readLimited } from "@durable-computer/protocol"
import { BlockedAddressError, type Fetch, type SqliteDatabase } from "@durable-computer/runtime"
import {
  Bash,
  type BashOptions,
  type IFileSystem,
  NetworkAccessDeniedError,
} from "just-bash/browser"
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
import { DurableFs } from "./durable-fs.ts"

export type JustBashOptions = {
  /** Identifies the file namespace, for example the agent's id. */
  readonly id: string
  /** Where the files are stored. The sandbox creates and owns the `dc_fs` tables in it. */
  readonly database: SqliteDatabase
  /** Workspace directory. Default `/workspace`. */
  readonly home?: string
  /** Ceiling on all file content held in memory. Default 64 MB. */
  readonly maxTotalBytes?: number
  /** Environment variables every command sees. */
  readonly env?: Readonly<Record<string, string>>
  /**
   * Gives the shell `curl`, making its requests through this. The shell runs inside the server,
   * so its requests leave from the server's own network: pass a fetch that refuses private
   * addresses. Absent, there is no network.
   */
  readonly fetch?: Fetch
}

const TIMEOUT_EXIT_CODE = 124
/** The longest one request may take, and the most it may bring back. */
const REQUEST_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024

type ShellFetch = NonNullable<BashOptions["fetch"]>

/** The shell's network hook over a plain `fetch`, with a deadline and a size limit. */
function shellFetch(fetcher: Fetch): ShellFetch {
  return async (url, request = {}) => {
    const deadline = Math.min(request.timeoutMs ?? REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS)
    const signals = [AbortSignal.timeout(deadline)]
    if (request.signal) signals.push(request.signal)
    try {
      const response = await fetcher(url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: request.followRedirects === false ? "manual" : "follow",
        signal: AbortSignal.any(signals),
      })
      const headers: Record<string, string> = {}
      response.headers.forEach((value, name) => {
        headers[name] = value
      })
      return {
        status: response.status,
        statusText: response.statusText,
        headers,
        body: await readLimited(response.body, MAX_RESPONSE_BYTES),
        url: response.url || url,
      }
    } catch (error) {
      // In the words the shell's own curl uses for an address it may not reach.
      if (error instanceof BlockedAddressError)
        throw new NetworkAccessDeniedError(url, error.message)
      if (error instanceof BodyTooLarge) {
        throw new Error(`The response is larger than ${MAX_RESPONSE_BYTES / (1024 * 1024)} MB.`)
      }
      throw error
    }
  }
}

/** just-bash reports failures as errno-prefixed messages; map the prefix to a code. */
function translate(error: unknown, path: string): SandboxError {
  const message = error instanceof Error ? error.message : String(error)
  const codes: Record<string, SandboxErrorCode> = {
    ENOENT: "not_found",
    ENOTDIR: "not_directory",
    EISDIR: "is_directory",
    EACCES: "permission_denied",
    EPERM: "permission_denied",
    EEXIST: "invalid",
    ENOTEMPTY: "invalid",
    EINVAL: "invalid",
  }
  const errno = /^([A-Z]+):/.exec(message)?.[1]
  return new SandboxError((errno && codes[errno]) || "unknown", message, path)
}

function nativeFs(fs: IFileSystem): SandboxFs {
  const guard = async <T>(path: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (error) {
      throw translate(error, path)
    }
  }
  const describe = (stat: Awaited<ReturnType<IFileSystem["lstat"]>>): FileStat => ({
    kind: stat.isSymbolicLink ? "symlink" : stat.isDirectory ? "directory" : "file",
    size: stat.size,
    mtimeMs: stat.mtime.getTime(),
  })
  return {
    stat: async (path) => {
      try {
        return describe(await fs.lstat(path))
      } catch (error) {
        const translated = translate(error, path)
        if (translated.code === "not_found" || translated.code === "not_directory") return undefined
        throw translated
      }
    },
    list: (path) =>
      guard(path, async () => {
        const entries: DirectoryEntry[] = []
        for (const name of await fs.readdir(path)) {
          entries.push({
            name,
            ...describe(await fs.lstat(path === "/" ? `/${name}` : `${path}/${name}`)),
          })
        }
        return entries
      }),
    readFile: (path) => guard(path, () => fs.readFileBuffer(path)),
    writeFile: (path, data) =>
      guard(path, async () => {
        const directory = path.slice(0, path.lastIndexOf("/")) || "/"
        const stat = await fs.stat(directory)
        if (!stat.isDirectory) throw new Error(`ENOTDIR: not a directory, '${directory}'`)
        await fs.writeFile(path, data)
      }),
    mkdir: (path, options) => guard(path, () => fs.mkdir(path, options)),
    remove: (path, options) => guard(path, () => fs.rm(path, options)),
    rename: (from, to) => guard(from, () => fs.mv(from, to)),
    realpath: (path) => guard(path, () => fs.realpath(path)),
  }
}

/**
 * A sandbox with no machine behind it: a shell interpreter and filesystem running inside the
 * server process, with files kept in the agent's own database. It has the common text tools but
 * no real binaries, so no git, package managers or browser.
 */
export async function createJustBashSandbox(options: JustBashOptions): Promise<Sandbox> {
  const home = options.home ?? "/workspace"
  const durable = await DurableFs.open(options.database, options.maxTotalBytes ?? 64 * 1024 * 1024)
  await durable.fs.mkdir(home, { recursive: true })
  await durable.fs.mkdir("/tmp", { recursive: true })
  await durable.flush()
  const bash = new Bash({
    fs: durable.fs,
    cwd: home,
    env: { HOME: home, USER: "agent", ...options.env },
    ...(options.fetch === undefined ? {} : { fetch: shellFetch(options.fetch) }),
  })

  return {
    id: `just-bash:${options.id}`,
    home,
    capabilities: { realBinaries: false, network: options.fetch !== undefined },
    fs: nativeFs(durable.fs),
    flush: () => durable.flush(),
    async exec(command: string, execOptions: ExecOptions = {}): Promise<ExecOutcome> {
      const signals = [
        execOptions.signal,
        execOptions.timeoutMs && AbortSignal.timeout(execOptions.timeoutMs),
      ]
      const timeout = signals[1] as AbortSignal | undefined
      const signal = AbortSignal.any(signals.filter((value) => value instanceof AbortSignal))
      const result = await bash.exec(command, {
        cwd: execOptions.cwd ?? home,
        env: execOptions.env === undefined ? undefined : { ...execOptions.env },
        signal,
      })
      await durable.flush()
      const output = result.stdout + result.stderr
      if (output !== "") execOptions.onOutput?.(output)
      const timedOut = timeout?.aborted === true && execOptions.signal?.aborted !== true
      return { exitCode: timedOut ? TIMEOUT_EXIT_CODE : result.exitCode, output, timedOut }
    },
  }
}

/** The just-bash sandbox, opened on first use: its files are only read from the database then. */
export function justBashSandbox(options: JustBashOptions): Sandbox {
  return lazySandbox({
    id: `just-bash:${options.id}`,
    home: options.home ?? "/workspace",
    capabilities: { realBinaries: false, network: options.fetch !== undefined },
    acquire: () => createJustBashSandbox(options),
  })
}

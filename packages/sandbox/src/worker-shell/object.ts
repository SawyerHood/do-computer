import { Workspace, type WorkspaceEgressPolicy } from "@cloudflare/computer"
import {
  WorkerShellBackend,
  type WorkerShellLoader,
} from "@cloudflare/computer/backends/worker-shell"
import curl from "@cloudflare/computer/shell/curl"
import file from "@cloudflare/computer/shell/file"
import htmlToMarkdown from "@cloudflare/computer/shell/html-to-markdown"
import jq from "@cloudflare/computer/shell/jq"
import xan from "@cloudflare/computer/shell/xan"
import { BlockedAddressError, type Fetch } from "@durable-computer/runtime"
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers"
import type { DirectoryEntry, ExecOutcome, FileStat, SandboxErrorCode } from "../index.ts"
import {
  DEFAULT_HOME,
  type ShellAnswer,
  type ShellExecRequest,
  type WorkerShellRpc,
} from "./index.ts"

export { WorkspaceServiceProxy } from "@cloudflare/computer"

export type WorkerShellOptions<Env> = {
  /** The name, in the Worker's environment, of the binding to this very class. */
  readonly binding: string
  /** The Worker Loader binding the shell's own Worker is started through. */
  readonly loader: (env: Env) => WorkerLoader | undefined
  /**
   * What the shell may reach on the network. It runs in a Worker of its own with no network but
   * this. Absent, or answering undefined, it has none, and no `curl`.
   */
  readonly egress?: (ctx: DurableObjectState, env: Env) => WorkspaceEgressPolicy | undefined
  /** Workspace directory. Default `/workspace`. */
  readonly home?: string
}

/** Symbolic links followed before a path is taken to go round in a circle. */
const MAX_LINKS = 40
const TIMEOUT_EXIT_CODE = 124
const ABORT_EXIT_CODE = 130
/**
 * The longest any command runs. The shell's Worker cannot be told to stop a command, so one
 * that its caller gave up on runs until its time is out, and this is the most that can be.
 */
const MAX_RUN_MS = 10 * 60_000

/** The store reports failures as errno-prefixed messages or codes; map them to ours. */
function failure(error: unknown): { ok: false; code: SandboxErrorCode; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  const codes: Record<string, SandboxErrorCode> = {
    ENOENT: "not_found",
    ENOTDIR: "not_directory",
    EISDIR: "is_directory",
    EACCES: "permission_denied",
    EPERM: "permission_denied",
    EROFS: "permission_denied",
    EEXIST: "invalid",
    ENOTEMPTY: "invalid",
    EINVAL: "invalid",
    ELOOP: "invalid",
  }
  const errno = (error as { code?: unknown } | null)?.code ?? /^([A-Z]+)\b/.exec(message)?.[1]
  return { ok: false, code: (typeof errno === "string" && codes[errno]) || "unknown", message }
}

/**
 * Class of the Worker entrypoint that every request of a shell with a network leaves through,
 * for `egress`'s `http-gateway`. The shell runs outside the server but its requests are made
 * here, so pass a fetch that refuses private addresses. Redirects go back to the shell, which
 * follows them through here again.
 */
export function createShellGatewayClass<Env>(fetcher: (env: Env) => Fetch) {
  return class ShellGateway extends WorkerEntrypoint<Env> {
    override async fetch(request: Request): Promise<Response> {
      try {
        return await fetcher(this.env)(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          redirect: "manual",
        })
      } catch (error) {
        if (!(error instanceof BlockedAddressError)) throw error
        return new Response(`${error.message}\n`, { status: 403 })
      }
    }
  }
}

const parent = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/"

/**
 * Durable Object class for a shell with no machine behind it. The files are in the object's own
 * storage, and commands run in a shell interpreter in a Worker started for the purpose, which
 * reaches the files and nothing else of the server. It has the common text tools but no real
 * binaries. Address it by what the files are kept under and talk to it with
 * `workerShellSandbox()`.
 *
 * The class needs a `worker_loaders` binding in the Wrangler configuration, and the Worker's main
 * module must export `WorkspaceServiceProxy` from here: it is how the shell's Worker finds its
 * way back to this object.
 */
export function createWorkerShellClass<Env>(options: WorkerShellOptions<Env>) {
  const home = options.home ?? DEFAULT_HOME

  return class WorkerShell extends DurableObject<Env> implements WorkerShellRpc {
    #workspace: Workspace | undefined
    #opened: Promise<Workspace> | undefined
    /** The commands under way, by the id their caller gave them. */
    readonly #running = new Map<string, () => void>()

    #open(): Promise<Workspace> {
      this.#opened ??= (async () => {
        const loader = options.loader(this.env)
        if (loader === undefined) {
          throw new Error(
            "This deployment has no Worker Loader binding for the built-in shell. Add " +
              "`worker_loaders` to wrangler.jsonc.",
          )
        }
        const egress = options.egress?.(this.ctx, this.env)
        const workspace = new Workspace({
          storage: this.ctx.storage,
          // What a command prints is cut down by whoever asked for it, and kept by them.
          output: false,
          backends: [
            new WorkerShellBackend({
              loader: loader as unknown as WorkerShellLoader,
              workspace: { binding: options.binding, id: this.ctx.id.toString() },
              ctx: this.ctx,
              // The groups that run in a Worker. yq, sqlite3, python3 and js-exec do not.
              commands: [curl, jq, xan, file, htmlToMarkdown],
              egress: egress ?? { mode: "none" },
            }),
          ],
        })
        await workspace.ready()
        await workspace.fs.mkdir(home, { recursive: true })
        await workspace.fs.mkdir("/tmp", { recursive: true })
        this.#workspace = workspace
        return workspace
      })()
      this.#opened.catch(() => {
        this.#opened = undefined
      })
      return this.#opened
    }

    async #answer<T>(run: (workspace: Workspace) => Promise<T>): Promise<ShellAnswer<T>> {
      try {
        return { ok: true, value: await run(await this.#open()) }
      } catch (error) {
        return failure(error)
      }
    }

    /** For the shell's own Worker, which reaches the files through it. Not for callers. */
    async __getWorkspaceStub(): Promise<unknown> {
      return (await this.#open()).stub()
    }

    async exec(request: ShellExecRequest): Promise<ExecOutcome> {
      const workspace = await this.#open()
      const limit = Math.min(request.timeoutMs ?? MAX_RUN_MS, MAX_RUN_MS)
      const started = Date.now()
      const stopped = Promise.withResolvers<undefined>()
      this.#running.set(request.id, () => stopped.resolve(undefined))
      // The shell answers once the command is over, with all it printed.
      const finished = (async () => {
        const run = await workspace.runtime.exec(request.command, {
          id: request.id,
          cwd: request.cwd ?? home,
          env: { HOME: home, USER: "agent", ...request.env },
          encoding: "utf8",
          timeoutMs: limit,
        })
        try {
          return await run.result()
        } finally {
          run[Symbol.dispose]()
        }
      })()
      try {
        const result = await Promise.race([finished, stopped.promise])
        if (result === undefined) {
          finished.catch(() => {})
          return { exitCode: ABORT_EXIT_CODE, output: "", timedOut: false }
        }
        // A command may exit with the code of a timeout itself; one that was stopped ran that long.
        const timedOut = result.exitCode === TIMEOUT_EXIT_CODE && Date.now() - started >= limit
        return {
          exitCode: result.exitCode,
          output: timedOut ? "" : result.stdout + result.stderr,
          timedOut,
        }
      } finally {
        this.#running.delete(request.id)
      }
    }

    /** Stop waiting for a command. Its caller is answered at once. */
    async abort(id: string): Promise<void> {
      this.#running.get(id)?.()
    }

    stat(path: string): Promise<ShellAnswer<FileStat | null>> {
      return this.#answer(async ({ fs }) => {
        try {
          const stat = await fs.lstat(path)
          return {
            kind: stat.isSymbolicLink ? "symlink" : stat.isDirectory ? "directory" : "file",
            size: stat.size,
            mtimeMs: stat.mtime,
          }
        } catch (error) {
          const { code } = failure(error)
          if (code === "not_found" || code === "not_directory") return null
          throw error
        }
      })
    }

    list(path: string): Promise<ShellAnswer<DirectoryEntry[]>> {
      return this.#answer(async ({ fs }) => {
        const entries = await fs.readdir(path)
        return entries.map((entry) => ({
          name: entry.name,
          kind: entry.isSymbolicLink ? "symlink" : entry.isDirectory ? "directory" : "file",
          size: entry.size,
          mtimeMs: entry.mtime,
        }))
      })
    }

    readFile(path: string): Promise<ShellAnswer<ReadableStream<Uint8Array>>> {
      return this.#answer(({ fs }) => fs.readFile(path))
    }

    writeFile(path: string, data: ReadableStream<Uint8Array>): Promise<ShellAnswer<null>> {
      return this.#answer(async ({ fs }) => {
        const directory = await fs.stat(parent(path))
        if (!directory.isDirectory) throw new Error(`ENOTDIR: not a directory, '${parent(path)}'`)
        await fs.writeFile(path, data)
        return null
      })
    }

    mkdir(path: string, recursive: boolean): Promise<ShellAnswer<null>> {
      return this.#answer(async ({ fs }) => {
        await fs.mkdir(path, recursive ? { recursive } : {})
        return null
      })
    }

    remove(path: string, recursive: boolean, force: boolean): Promise<ShellAnswer<null>> {
      return this.#answer(async ({ fs }) => {
        await fs.rm(path, { ...(recursive ? { recursive } : {}), ...(force ? { force } : {}) })
        return null
      })
    }

    rename(from: string, to: string): Promise<ShellAnswer<null>> {
      return this.#answer(async ({ fs }) => {
        await fs.rename(from, to)
        return null
      })
    }

    symlink(target: string, path: string): Promise<ShellAnswer<null>> {
      return this.#answer(async ({ fs }) => {
        await fs.symlink(target, path)
        return null
      })
    }

    chmod(path: string, mode: number): Promise<ShellAnswer<null>> {
      return this.#answer(async ({ fs }) => {
        await fs.chmod(path, mode)
        return null
      })
    }

    /** The store keeps paths as written, so links are followed here, one part at a time. */
    realpath(path: string): Promise<ShellAnswer<string>> {
      return this.#answer(async ({ fs }) => {
        let pending = path.split("/").filter((part) => part !== "")
        let resolved = ""
        for (let links = 0; pending.length > 0;) {
          const part = pending.shift()!
          if (part === ".") continue
          if (part === "..") {
            resolved = resolved.slice(0, resolved.lastIndexOf("/"))
            continue
          }
          const next = `${resolved}/${part}`
          const stat = await fs.lstat(next)
          if (!stat.isSymbolicLink) {
            resolved = next
            continue
          }
          if (++links > MAX_LINKS) throw new Error(`ELOOP: too many symbolic links, '${path}'`)
          const target = await fs.readlink(next)
          if (target.startsWith("/")) resolved = ""
          pending = [...target.split("/").filter((piece) => piece !== ""), ...pending]
        }
        return resolved || "/"
      })
    }

    /** Delete every file. The object is as it was before it was first used. */
    async reset(): Promise<void> {
      const workspace = this.#workspace ?? (await this.#opened?.catch(() => undefined))
      this.#opened = undefined
      this.#workspace = undefined
      await workspace?.close().catch(() => {})
      await this.ctx.storage.deleteAll()
    }
  }
}

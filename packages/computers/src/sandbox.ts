import type { PreparedImage } from "@do-computer/protocol"
import type { ActorStub } from "@do-computer/runtime"
import {
  type DirectoryEntry,
  type ExecOptions,
  type ExecOutcome,
  type FileStat,
  type JobFollowed,
  type JobFollowOptions,
  type JobState,
  JobsUnsupported,
  type Sandbox,
  SandboxError,
  type SandboxErrorCode,
  type SandboxFs,
} from "@do-computer/sandbox"
import type { LinkStatus } from "./link-actor.ts"

/** Error codes of a paired computer, as the codes file tools understand. */
const CODES: Record<string, SandboxErrorCode> = {
  not_found: "not_found",
  not_directory: "not_directory",
  is_directory: "is_directory",
  permission_denied: "permission_denied",
  read_only: "permission_denied",
  invalid: "invalid",
}

/** A failure reaching or using a paired computer that is not about one file. */
export class ComputerUnavailable extends Error {}

export type ComputerSandboxOptions = {
  readonly id: string
  /** The daemon's home directory, which relative paths resolve against. */
  readonly home: string
  /** The computer's link actor. */
  readonly link: ActorStub
}

/**
 * A paired computer as a sandbox: the same shape as the agent's own computer, so the same file and
 * shell tools work on it. Every call goes to the computer's link actor and on to its daemon.
 */
export function computerSandbox(options: ComputerSandboxOptions): Sandbox {
  const call = async (path: string, init: RequestInit, file?: string): Promise<Response> => {
    const response = await options.link.fetch(new Request(`http://computer${path}`, init))
    if (response.ok) return response
    const failure = (await response.json().catch(() => ({}))) as { error?: string; code?: string }
    const message = failure.error ?? `The computer answered with an error (${response.status}).`
    if (failure.code === "unsupported") throw new JobsUnsupported(message)
    const code = failure.code === undefined ? undefined : CODES[failure.code]
    if (code !== undefined && file !== undefined) throw new SandboxError(code, message, file)
    throw new ComputerUnavailable(message)
  }
  const post = (path: string, body: unknown, file?: string) =>
    call(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      file,
    )
  const operate = async <T>(request: Record<string, unknown>): Promise<T> =>
    ((await (await post("/fs", request, String(request.path))).json()) as { value: T }).value

  const fs: SandboxFs = {
    stat: async (path) => (await operate<FileStat | null>({ op: "stat", path })) ?? undefined,
    list: (path) => operate<DirectoryEntry[]>({ op: "list", path }),
    readFile: async (path) =>
      new Uint8Array(await (await post("/read", { path }, path)).arrayBuffer()),
    writeFile: async (path, data) => {
      await call(
        `/write?path=${encodeURIComponent(path)}`,
        { method: "POST", body: data.slice().buffer },
        path,
      )
    },
    mkdir: async (path, { recursive }) => void (await operate({ op: "mkdir", path, recursive })),
    remove: async (path, { recursive, force }) =>
      void (await operate({ op: "remove", path, recursive, force })),
    rename: async (from, to) => void (await operate({ op: "rename", path: from, to })),
    realpath: (path) => operate<string>({ op: "realpath", path }),
    readImage: async (path, limits) => {
      try {
        const { value } = (await (await post("/image", { path, ...limits }, path)).json()) as {
          value: PreparedImage | null
        }
        return value ?? undefined
      } catch (error) {
        // A daemon from before it could: the picture is read as it is.
        if (error instanceof JobsUnsupported) return undefined
        throw error
      }
    },
  }

  return {
    id: `computer:${options.id}`,
    home: options.home,
    capabilities: { realBinaries: true, network: true },
    fs,
    flush: async () => {},
    async use(what, request) {
      const response = await options.link.fetch(
        new Request(`http://computer/${what}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        }),
      )
      if (response.ok) return ((await response.json()) as { value: unknown }).value
      const failure = (await response.json().catch(() => ({}))) as { error?: string }
      throw new ComputerUnavailable(
        failure.error ?? `The computer answered with an error (${response.status}).`,
      )
    },
    // The daemon keeps jobs itself, and nothing of what one prints arrives before the answer.
    jobs(scope) {
      const ask = async <T>(request: Record<string, unknown>): Promise<T> =>
        ((await (await post("/job", { scope, ...request })).json()) as { value: T }).value
      const following = (follow: JobFollowOptions) => ({
        waitMs: follow.waitMs,
        ...(follow.removeUnder === undefined ? {} : { removeUnder: follow.removeUnder }),
      })
      const told = (follow: JobFollowOptions) => (followed: JobFollowed) => {
        if (followed.output !== "") follow.onOutput?.(followed.output)
        return followed
      }
      return {
        start: (job, follow) =>
          ask<JobFollowed>({
            op: "start",
            job: job.id,
            command: job.command,
            cwd: job.cwd,
            env: job.env,
            lifeMs: job.lifeMs,
            ...following(follow),
          }).then(told(follow)),
        follow: (id, follow) =>
          ask<JobFollowed>({ op: "follow", job: id, from: follow.from, ...following(follow) }).then(
            told(follow),
          ),
        stop: async (id) => void (await ask({ op: "stop", job: id })),
        check: (ids) =>
          ids.length === 0
            ? Promise.resolve({})
            : ask<Record<string, JobState & { size: number }>>({ op: "check", jobs: [...ids] }),
        remove: async (ids) =>
          void (ids.length > 0 && (await ask({ op: "remove", jobs: [...ids] }))),
        log: (id) =>
          `${options.home}/.do-computer/jobs/${scope.replace(/[^A-Za-z0-9_-]/g, "_")}/${id}/output.log`,
      }
    },
    async exec(command: string, execOptions: ExecOptions = {}): Promise<ExecOutcome> {
      const response = await post("/exec", {
        command,
        cwd: execOptions.cwd,
        env: execOptions.env,
        timeoutMs: execOptions.timeoutMs,
      })
      const result = (await response.json()) as { stdout: string; stderr: string; exitCode: number }
      const output = result.stdout + result.stderr
      if (output !== "") execOptions.onOutput?.(output)
      // The daemon kills a command at its deadline and reports the conventional exit code.
      return { exitCode: result.exitCode, output, timedOut: result.exitCode === 124 }
    },
  }
}

export async function linkStatus(link: ActorStub): Promise<LinkStatus> {
  const response = await link.fetch(new Request("http://computer/status"))
  return (await response.json()) as LinkStatus
}

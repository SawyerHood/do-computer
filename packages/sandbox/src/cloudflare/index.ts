import {
  type ExecOptions,
  type ExecOutcome,
  type Sandbox,
  SandboxError,
  type SandboxErrorCode,
} from "../index.ts"
import { shellFs } from "../shell-fs.ts"
import { DEFAULT_HOME, type ExecLine, type ExecRequest } from "./machine.ts"

export {
  type ContainerLike,
  ContainerMachine,
  type ContainerProcessLike,
  DEFAULT_HOME,
  DEFAULT_IMAGE,
  DEFAULT_INSTANCE,
  type MachineConfig,
  type MachineStore,
} from "./machine.ts"

export type ContainerSandboxClientOptions = {
  readonly id: string
  /** Send a request to this agent's sandbox object. */
  readonly fetch: (request: Request) => Promise<Response>
  readonly home?: string
}

/** The machine could not be reached or started; not a failure of one command or file. */
export class ContainerUnavailable extends Error {}

async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<ExecLine> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (let end = buffer.indexOf("\n"); end !== -1; end = buffer.indexOf("\n")) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        if (line !== "") yield JSON.parse(line) as ExecLine
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/**
 * An agent's computer on Cloudflare Containers, seen from the agent. Every call goes to the
 * sandbox object, which starts the machine when it is needed and saves it when it is idle, so
 * this side holds no state and costs nothing until something runs.
 */
export function containerSandbox(options: ContainerSandboxClientOptions): Sandbox {
  const home = options.home ?? DEFAULT_HOME
  const call = async (path: string, init: RequestInit, file?: string): Promise<Response> => {
    const response = await options.fetch(new Request(`http://sandbox${path}`, init))
    if (response.ok) return response
    const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string }
    const message = body.error ?? `The computer answered with an error (${response.status}).`
    if (file !== undefined && body.code !== undefined) {
      throw new SandboxError(body.code as SandboxErrorCode, message, file)
    }
    throw new ContainerUnavailable(message)
  }
  const post = (path: string, value: unknown) =>
    call(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    })

  const exec = async (command: string, execOptions: ExecOptions = {}): Promise<ExecOutcome> => {
    execOptions.signal?.throwIfAborted()
    const id = crypto.randomUUID()
    // The object stops the command; this side only has to ask.
    const abort = () => void post("/abort", { id }).catch(() => {})
    execOptions.signal?.addEventListener("abort", abort, { once: true })
    try {
      const response = await post("/exec", {
        id,
        command,
        cwd: execOptions.cwd,
        env: execOptions.env === undefined ? undefined : { ...execOptions.env },
        timeoutMs: execOptions.timeoutMs,
      } satisfies ExecRequest)
      let output = ""
      for await (const line of lines(response.body!)) {
        if ("output" in line) {
          output += line.output
          execOptions.onOutput?.(line.output)
        } else {
          execOptions.signal?.throwIfAborted()
          return { exitCode: line.exitCode, output, timedOut: line.timedOut }
        }
      }
      execOptions.signal?.throwIfAborted()
      throw new ContainerUnavailable("The computer stopped before the command finished.")
    } finally {
      execOptions.signal?.removeEventListener("abort", abort)
    }
  }

  return {
    id: `cloudflare:${options.id}`,
    home,
    capabilities: { realBinaries: true, network: true },
    exec,
    // The object saves the disk when the machine goes idle, and at intervals while it is in use.
    flush: async () => {},
    fs: shellFs(exec, {
      readFile: async (path) =>
        new Uint8Array(
          await (
            await call(`/file?path=${encodeURIComponent(path)}`, { method: "GET" }, path)
          ).arrayBuffer(),
        ),
      writeFile: async (path, data) => {
        await call(
          `/file?path=${encodeURIComponent(path)}`,
          { method: "PUT", body: data.slice().buffer },
          path,
        )
      },
    }),
  }
}

import { guardedFetch } from "@durable-computer/runtime"
import type { WorkerShellRpc } from "../../src/worker-shell/index.ts"
import { createShellGatewayClass, createWorkerShellClass } from "../../src/worker-shell/object.ts"

export { WorkspaceServiceProxy } from "../../src/worker-shell/object.ts"

type Shells = DurableObjectNamespace<Rpc.DurableObjectBranded & WorkerShellRpc>

export type Env = { SHELL: Shells; QUIET: Shells; LOADER: WorkerLoader }

/** A small web, standing in for the network. */
async function web(input: string | URL, init?: RequestInit): Promise<Response> {
  const { pathname, hostname } = new URL(input)
  if (hostname !== "example.test") return new Response("no such host", { status: 502 })
  if (pathname === "/hello") return new Response("hello from the web\n")
  if (pathname === "/echo") {
    return new Response(`got ${init?.method}: ${await new Response(init?.body).text()}`)
  }
  if (pathname === "/moved") {
    return new Response(null, { status: 302, headers: { location: "https://example.test/hello" } })
  }
  if (pathname === "/inside") {
    return new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest" },
    })
  }
  return new Response("not found", { status: 404 })
}

// As the app passes it: public hosts only, over http or https.
export const Gateway = createShellGatewayClass<Env>(() =>
  guardedFetch(web, false, { allowHttp: true }),
)

export const ShellObject = createWorkerShellClass<Env>({
  binding: "SHELL",
  loader: (env) => env.LOADER,
  egress: (ctx) => ({
    mode: "http-gateway",
    gateway: (ctx as unknown as { exports: { Gateway(options: object): Fetcher } }).exports.Gateway(
      {},
    ),
    revision: "test",
  }),
})

/** A shell with no network. */
export const QuietShellObject = createWorkerShellClass<Env>({
  binding: "QUIET",
  loader: (env) => env.LOADER,
})

export default { fetch: () => new Response("sandbox test worker") }

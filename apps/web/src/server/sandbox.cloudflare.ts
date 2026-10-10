import { guardedFetch } from "@durable-computer/runtime"
import { containerSandbox } from "@durable-computer/sandbox/cloudflare"
import { createContainerSandboxClass } from "@durable-computer/sandbox/cloudflare/object"
import { movedFromDatabase, workerShellSandbox } from "@durable-computer/sandbox/worker-shell"
import {
  createShellGatewayClass,
  createWorkerShellClass,
} from "@durable-computer/sandbox/worker-shell/object"
import type { Env } from "./platform.cloudflare.ts"
import { readConfig } from "./platform.ts"
import type { RuntimeProviders } from "./sandbox.ts"

/** One Durable Object per machine. Its container exists only while it is in use. */
export const SandboxObject = createContainerSandboxClass<Env>({
  config: (env) => {
    const config = readConfig(env)
    const { image, instance } = config.cloudflare
    return {
      internet: config.sandboxNetwork,
      ...(image === undefined ? {} : { image }),
      ...(instance === undefined ? {} : { instance }),
    }
  },
})

/**
 * What the built-in shell's requests leave through. They are made from the server's own
 * network, so they may reach the public internet, over http or https, and nothing private.
 */
export const ShellGateway = createShellGatewayClass<Env>((env) =>
  guardedFetch((input, init) => fetch(input, init), readConfig(env).allowPrivateHosts, {
    allowHttp: true,
  }),
)

/**
 * One Durable Object per built-in shell, which keeps its files. Commands run in a Worker
 * started for the purpose, so nothing an agent runs there shares memory with the server.
 */
export const ShellObject = createWorkerShellClass<Env>({
  binding: "SHELL",
  loader: (env) => env.LOADER,
  egress: (ctx, env) =>
    readConfig(env).sandboxNetwork
      ? {
          mode: "http-gateway",
          gateway: (
            ctx as unknown as { exports: { ShellGateway(options: object): Fetcher } }
          ).exports.ShellGateway({}),
          // The rule is the same for every shell and every deploy.
          revision: "1",
        }
      : undefined,
})

export const cloudflareProviders = (env: Env): RuntimeProviders => ({
  // The key is the agent the shell is for. The shell this replaced ran inside the server and
  // kept its files in that agent's database: they are moved over the first time it is used.
  shell: (config) => (key, host) =>
    workerShellSandbox({
      id: key,
      network: config.sandboxNetwork,
      shell: env.SHELL.get(env.SHELL.idFromName(key)),
      ...(host === undefined ? {} : { prepare: movedFromDatabase(host.sql) }),
    }),
  cloudflare: (config) => (key) =>
    containerSandbox({
      id: key,
      network: config.sandboxNetwork,
      fetch: (request) => env.SANDBOX.get(env.SANDBOX.idFromName(key)).fetch(request),
    }),
})

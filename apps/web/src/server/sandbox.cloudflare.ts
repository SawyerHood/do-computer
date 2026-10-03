import { containerSandbox } from "@durable-computer/sandbox/cloudflare"
import { createContainerSandboxClass } from "@durable-computer/sandbox/cloudflare/object"
import type { Env } from "./platform.cloudflare.ts"
import { readConfig } from "./platform.ts"
import type { RuntimeProviders } from "./sandbox.ts"

/** One Durable Object per agent's computer. Its container exists only while it is in use. */
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

export const cloudflareProviders = (env: Env): RuntimeProviders => ({
  cloudflare: (config) => (host) =>
    containerSandbox({
      id: host.name,
      network: config.sandboxNetwork,
      fetch: (request) => env.SANDBOX.get(env.SANDBOX.idFromName(host.name)).fetch(request),
    }),
})

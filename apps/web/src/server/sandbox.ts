import type { ActorHost } from "@durable-computer/runtime"
import { justBashSandbox, type Sandbox } from "@durable-computer/sandbox"
import { daytonaSandbox } from "@durable-computer/sandbox/daytona"
import { type Config, ConfigError } from "./platform.ts"

export type SandboxFactory = (host: ActorHost) => Sandbox

/** Providers only one runtime has: Modal's SDK needs Node, and a container needs Cloudflare. */
export type RuntimeProviders = {
  readonly modal?: (config: Config) => SandboxFactory
  readonly cloudflare?: (config: Config) => SandboxFactory
}

/**
 * The computer each agent gets, chosen by the deployment's `DC_SANDBOX` setting. Returns undefined
 * for `none`: agents then have no file or shell tools. Every factory is cheap and starts nothing;
 * a remote machine is created the first time an agent runs something on it.
 */
export function sandboxFactory(
  config: Config,
  runtime: "Node" | "Cloudflare",
  providers: RuntimeProviders,
): SandboxFactory | undefined {
  switch (config.sandbox) {
    case "none":
      return undefined
    case "just-bash":
      // Files live in the agent's own database, so this needs no other service on either runtime.
      return (host) => justBashSandbox({ id: host.name, database: host.sql })
    case "daytona": {
      const { apiKey, apiUrl, target, snapshot, image } = config.daytona
      if (apiKey === undefined) {
        throw new ConfigError("DC_SANDBOX is daytona, which needs DAYTONA_API_KEY.")
      }
      return (host) => daytonaSandbox({ id: host.name, apiKey, apiUrl, target, snapshot, image })
    }
    case "modal":
    case "cloudflare": {
      const provider = providers[config.sandbox]
      if (provider === undefined) {
        throw new ConfigError(
          config.sandbox === "modal"
            ? `DC_SANDBOX is modal, which only works when the app runs on Node. This is ${runtime}.`
            : `DC_SANDBOX is cloudflare, which only works when the app runs on Cloudflare. This is ${runtime}.`,
        )
      }
      return provider(config)
    }
  }
}

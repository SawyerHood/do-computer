import type { ActorHost } from "@durable-computer/runtime"
import { justBashSandbox, type Sandbox } from "@durable-computer/sandbox"
import type { Config } from "./platform.ts"

/**
 * The computer each agent gets, chosen by the deployment's `DC_SANDBOX` setting. Returns undefined
 * for `none`: agents then have no file or shell tools.
 */
export function sandboxFactory(config: Config): ((host: ActorHost) => Sandbox) | undefined {
  switch (config.sandbox) {
    case "none":
      return undefined
    case "just-bash":
      // Files live in the agent's own database, so this needs no other service on either runtime.
      return (host) => justBashSandbox({ id: host.name, database: host.sql })
  }
}

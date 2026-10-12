import { env } from "cloudflare:workers"
import { d1Database, durableObjectNamespace } from "@do-computer/runtime/cloudflare"
import type { WorkerShellRpc } from "@do-computer/sandbox/worker-shell"
import { type Platform, readConfig } from "./platform.ts"
import { cloudflareProviders } from "./sandbox.cloudflare.ts"
import { computerChoices } from "./sandbox.ts"

export type Env = {
  DB: D1Database
  AGENT: DurableObjectNamespace
  COMPUTER: DurableObjectNamespace
  PRESENCE: DurableObjectNamespace
  LIBRARY: DurableObjectNamespace
  MODEL_ACCESS: DurableObjectNamespace
  SANDBOX: DurableObjectNamespace
  SHELL: DurableObjectNamespace<Rpc.DurableObjectBranded & WorkerShellRpc>
  /** Starts the Worker a built-in shell runs its commands in. */
  LOADER: WorkerLoader
  BLOBS: R2Bucket
  /** Counts the calls anyone can make without an account. Absent where none is configured. */
  PUBLIC_LIMIT?: RateLimit
} & Record<string, string | undefined>

let platform: Platform | undefined

export function getPlatform(): Platform {
  const bindings = env as unknown as Env
  return (platform ??= {
    target: "cloudflare",
    config: readConfig(bindings),
    db: d1Database(bindings.DB),
    authDatabase: bindings.DB,
    agents: durableObjectNamespace(bindings.AGENT),
    computers: durableObjectNamespace(bindings.COMPUTER),
    presence: durableObjectNamespace(bindings.PRESENCE),
    libraries: durableObjectNamespace(bindings.LIBRARY),
    modelAccess: durableObjectNamespace(bindings.MODEL_ACCESS),
    machines: computerChoices(readConfig(bindings), "cloudflare", cloudflareProviders(bindings)),
  })
}

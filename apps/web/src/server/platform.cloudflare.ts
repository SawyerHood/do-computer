import { env } from "cloudflare:workers"
import { d1Database, durableObjectNamespace } from "@durable-computer/runtime/cloudflare"
import { type Platform, readConfig } from "./platform.ts"

export type Env = {
  DB: D1Database
  AGENT: DurableObjectNamespace
  COMPUTER: DurableObjectNamespace
  SANDBOX: DurableObjectNamespace
  BLOBS: R2Bucket
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
  })
}

import { createAgentActor, createAgentModels } from "@durable-computer/agent"
import { createDurableActorClass, r2Blobs } from "@durable-computer/runtime/cloudflare"
import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import type { Env } from "./server/platform.cloudflare.ts"
import { readConfig } from "./server/platform.ts"

/** One Durable Object per agent. */
export const AgentObject = createDurableActorClass<Env>({
  create: (host, env) => {
    const models = createAgentModels(readConfig(env))
    return createAgentActor(host, {
      models: models.models,
      defaultModel: models.defaultModel,
      modelOptions: models.options,
      onReport: (error) => console.error(`[agent ${host.name}]`, error),
    })
  },
  blobs: (env, name) => r2Blobs(env.BLOBS, `agents/${encodeURIComponent(name)}/`),
})

export default createServerEntry({
  fetch: (request) => handler.fetch(request),
})

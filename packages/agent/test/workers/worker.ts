import { createDurableActorClass, r2Blobs } from "@durable-computer/runtime/cloudflare"
import { createAgentActor, createAgentModels } from "../../src/index.ts"

export type Env = { AGENT: DurableObjectNamespace; BLOBS: R2Bucket }

// No key: the built-in echo model, which needs no network.
const models = createAgentModels({})

export const AgentObject = createDurableActorClass<Env>({
  create: (host) =>
    createAgentActor(host, {
      models: models.models,
      defaultModel: models.defaultModel,
      modelOptions: models.options,
      keepAliveMs: 200,
    }),
  blobs: (env, name) => r2Blobs(env.BLOBS, `${encodeURIComponent(name)}/`),
})

export default { fetch: () => new Response("agent test worker") } satisfies ExportedHandler<Env>

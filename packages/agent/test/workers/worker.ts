import { createDurableActorClass, r2Blobs } from "@durable-computer/runtime/cloudflare"
import { justBashSandbox } from "@durable-computer/sandbox"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { createAgentActor, createAgentModels } from "../../src/index.ts"

export type Env = {
  AGENT: DurableObjectNamespace
  SCRIPTED: DurableObjectNamespace
  BLOBS: R2Bucket
}

// No key: the built-in echo model, which needs no network.
const echo = createAgentModels({})

export const AgentObject = createDurableActorClass<Env>({
  create: (host) =>
    createAgentActor(host, {
      models: echo.models,
      defaultModel: echo.defaultModel,
      modelOptions: echo.options,
      keepAliveMs: 200,
    }),
  blobs: (env, name) => r2Blobs(env.BLOBS, `${encodeURIComponent(name)}/`),
})

/** A model the tests script, to drive tool calls inside the Workers runtime. */
export const scripted = fauxProvider({
  provider: "test",
  models: [{ id: "model" }],
  tokensPerSecond: 5_000,
})
const scriptedModels = createModels()
scriptedModels.setProvider(scripted.provider)

export const ScriptedAgentObject = createDurableActorClass<Env>({
  create: (host) =>
    createAgentActor(host, {
      models: scriptedModels,
      defaultModel: "test/model",
      modelOptions: [
        { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
      ],
      keepAliveMs: 200,
      sandbox: (host) => justBashSandbox({ id: host.name, database: host.sql }),
    }),
  blobs: (env, name) => r2Blobs(env.BLOBS, `${encodeURIComponent(name)}/`),
})

export default { fetch: () => new Response("agent test worker") } satisfies ExportedHandler<Env>

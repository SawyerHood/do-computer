import {
  createDurableActorClass,
  durableObjectNamespace,
  r2Blobs,
} from "@do-computer/runtime/cloudflare"
import { justBashSandbox } from "@do-computer/sandbox"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import {
  type AgentDirectory,
  createAgentActor,
  createAgentModels,
  createModelAccessActor,
} from "../../src/index.ts"
import { fakeMcp } from "../fake-mcp.ts"

export type Env = {
  AGENT: DurableObjectNamespace
  SCRIPTED: DurableObjectNamespace
  MODEL_ACCESS: DurableObjectNamespace
  BLOBS: R2Bucket
}

// No key: the built-in echo model, which needs no network.
const echo = createAgentModels({})

/** The agents that share a workspace, for the test of messages between them. */
export const PEERS = ["peer-ada", "peer-bo"]

/** What a host does for its agents: one object reaches another through its own namespace. */
function directory(env: Env): AgentDirectory {
  const beside = (one: string, other: string) =>
    one !== other && PEERS.includes(one) && PEERS.includes(other)
  const hand = (to: string, path: string, body: unknown) =>
    durableObjectNamespace(env.AGENT)
      .get(to)
      .fetch(
        new Request(`http://agent${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      )
  return {
    list: async (agentId) =>
      PEERS.filter((id) => beside(agentId, id)).map((id) => ({ id, name: id, tagline: null })),
    send: async (agentId, to, message) =>
      beside(agentId, to)
        ? ((await (await hand(to, `/peers/${agentId}/message`, message)).json()) as {
            threadId: string
          })
        : undefined,
    reply: async (agentId, to, reply) =>
      beside(agentId, to) && (await hand(to, `/peers/${agentId}/reply`, reply)).ok,
  }
}

export const AgentObject = createDurableActorClass<Env>({
  create: (host, env) =>
    createAgentActor(host, {
      models: echo.models,
      defaultModel: echo.defaultModel,
      modelOptions: echo.options,
      keepAliveMs: 200,
      contextRetentionMs: 0,
      documentRetentionMs: 0,
      agentDirectory: directory(env),
    }),
  blobs: (env, name) => r2Blobs(env.BLOBS, `${encodeURIComponent(name)}/`),
})

/** A model the tests script, to drive tool calls inside the Workers runtime. */
export const scripted = fauxProvider({
  provider: "test",
  models: [{ id: "model" }],
  tokensPerSecond: 5_000,
})
/** A remote MCP service that signs users in, standing in for the network. */
export const mcp = fakeMcp({ oauth: true })
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
      contextRetentionMs: 0,
      documentRetentionMs: 0,
      sandbox: (host) => justBashSandbox({ id: host.name, database: host.sql }),
      connectorFetch: mcp.fetch,
    }),
  blobs: (env, name) => r2Blobs(env.BLOBS, `${encodeURIComponent(name)}/`),
})

/** A workspace's sign-ins to model providers, with the providers pi really has. */
export const ModelAccessObject = createDurableActorClass<Env>({
  create: (host) => createModelAccessActor(host, { vaultKey: "a key for the tests" }),
  blobs: (env, name) => r2Blobs(env.BLOBS, `models/${encodeURIComponent(name)}/`),
})

export default { fetch: () => new Response("agent test worker") } satisfies ExportedHandler<Env>

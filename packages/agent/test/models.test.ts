import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ModelOption } from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import type { Credential, CredentialStore } from "@earendil-works/pi-ai"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActor, createAgentModels, type DeploymentAccess } from "../src/index.ts"
import { inOfferedOrder, isSuggested, modelOption } from "../src/model-providers.ts"

const HAIKU = "openrouter/anthropic/claude-haiku-5.5"
const LUNA = "openrouter/openai/gpt-6-luna"
const SPARK = "openrouter/meta/muse-spark-1.3-contributor"
const OPUS = "openrouter/anthropic/claude-opus-5.5"

/** What a workspace is signed in to, as its agents read it. */
function signIns(kept: Record<string, Credential> = {}): CredentialStore & {
  kept: Record<string, Credential>
} {
  const read = async (providerId: string) => kept[providerId]
  return {
    kept,
    read,
    list: async () =>
      Object.entries(kept).map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      })),
    modify: (providerId) => read(providerId),
    delete: async () => {},
  }
}

/** What the deployment itself is signed in to, as the actor that keeps it would answer. */
function serverSignIns(kept: Record<string, Credential>): DeploymentAccess {
  const { models } = createAgentModels({})
  const signedIn = Object.entries(kept).map(([id, credential]) => {
    const provider = models.getProvider(id)!
    return { id, credential, provider }
  })
  const answers: Record<string, () => unknown> = {
    "/providers": () => ({
      providers: signedIn.map(({ id, credential }) => ({ id, signedIn: { type: credential.type } })),
    }),
    "/models": () => ({
      models: signedIn.flatMap(({ credential, provider }) =>
        inOfferedOrder(provider.getModels()).map((model) => ({
          ...modelOption(model, provider, isSuggested(model)),
          signIn: {
            subscription: credential.type === "oauth" && provider.auth.oauth?.isSubscription === true,
            by: "Sawyer",
          },
        })),
      ),
    }),
  }
  return async () => ({
    fetch: async (request: Request) => {
      const { pathname } = new URL(request.url)
      const kind = pathname.startsWith("/credentials/")
        ? { credential: kept[decodeURIComponent(pathname.slice("/credentials/".length))] ?? null }
        : answers[pathname]?.()
      return Response.json(kind ?? { error: "Not found" }, { status: kind ? 200 : 404 })
    },
  })
}

const ids = (options: readonly ModelOption[]) => options.map((option) => option.id)

describe("a deployment that names the models it offers", () => {
  const config = {
    openrouterApiKey: "sk-or-server",
    // By their OpenRouter ids, or in full: both name the same model.
    allowedModels: ["meta/muse-spark-1.3-contributor", HAIKU, "openai/gpt-6-luna"],
  }

  it("offers those and no others, in the order it names them", () => {
    const { options, defaultModel } = createAgentModels(config)
    expect(ids(options)).toEqual([SPARK, HAIKU, LUNA])
    // None is set apart from the rest: the deployment chose them all.
    expect(options.some((option) => option.recommended)).toBe(false)
    // The first, unless the deployment says which.
    expect(defaultModel).toBe(SPARK)
    expect(createAgentModels({ ...config, defaultModel: "openai/gpt-6-luna" }).defaultModel).toBe(
      LUNA,
    )
    expect(createAgentModels({ ...config, defaultModel: HAIKU }).defaultModel).toBe(HAIKU)
    // One it does not offer is no default.
    expect(
      createAgentModels({ ...config, defaultModel: "anthropic/claude-opus-5.5" }).defaultModel,
    ).toBe(SPARK)
  })

  it("pays for those models and for no other, whatever an agent is set to", async () => {
    const { models } = createAgentModels(config, { workspace: signIns() })
    const model = (id: string) => models.getModel("openrouter", id.slice("openrouter/".length))!
    expect((await models.getAuth(model(HAIKU)))?.auth.apiKey).toBe("sk-or-server")
    expect(await models.getAuth(model(OPUS))).toBeUndefined()
    // Without names, every model is the deployment's to run.
    const open = createAgentModels({ openrouterApiKey: "sk-or-server" }, { workspace: signIns() })
    expect((await open.models.getAuth(model(OPUS)))?.auth.apiKey).toBe("sk-or-server")
  })

  it("leaves a workspace that signed in with its own account every model of it", async () => {
    const workspace = signIns({ openrouter: { type: "api_key", key: "sk-or-theirs" } })
    const { models } = createAgentModels(config, { workspace })
    const model = (id: string) => models.getModel("openrouter", id.slice("openrouter/".length))!
    expect((await models.getAuth(model(OPUS)))?.auth.apiKey).toBe("sk-or-theirs")
    // Its own account is what a model the deployment offers is called with as well.
    expect((await models.getAuth(model(HAIKU)))?.auth.apiKey).toBe("sk-or-theirs")
  })

  it("has no echo to offer while it has a real model, and only that when it has none", () => {
    expect(ids(createAgentModels({ allowedModels: [HAIKU] }).options)).toEqual(["echo/echo-1"])
    // A key, and names that are none of its models: nothing real to offer.
    const { options, defaultModel } = createAgentModels({
      openrouterApiKey: "sk-or-server",
      allowedModels: ["anthropic/claude-haiku-5-5"],
    })
    expect(ids(options)).toEqual(["echo/echo-1"])
    expect(defaultModel).toBe("echo/echo-1")
  })
})

describe("a deployment that names its models and is signed in besides", () => {
  const config = { openrouterApiKey: "sk-or-server", allowedModels: [HAIKU, "openai/gpt-6-luna"] }
  const SONNET = "anthropic/claude-sonnet-5-5"
  const claude = (id: string) => id.startsWith("anthropic/")
  const subscription: Credential = {
    type: "oauth",
    access: "claude-subscription",
    refresh: "refresh",
    expires: Date.now() + 3_600_000,
  }

  it("offers every model of a subscription, after the ones it names", async () => {
    const deployment = serverSignIns({ anthropic: subscription })
    const { models, offered } = createAgentModels(config, { workspace: signIns(), deployment })
    const { options, defaultModel } = await offered()
    expect(ids(options).slice(0, 3)).toEqual([HAIKU, LUNA, SONNET])
    expect(ids(options).filter(claude)).toHaveLength(models.getModels("anthropic").length)
    // New agents still start on the first it names, not on what a subscription suggests.
    expect(options.find((option) => option.id === SONNET)?.recommended).toBe(true)
    expect(defaultModel).toBe(HAIKU)
    // Unless the deployment says to start them on one of the subscription's.
    const started = createAgentModels(
      { ...config, defaultModel: SONNET },
      { workspace: signIns(), deployment },
    )
    expect((await started.offered()).defaultModel).toBe(SONNET)

    // It is what such a model is called with, and never the deployment's key.
    const auth = await models.getAuth(models.getModel("anthropic", "claude-sonnet-5-5")!)
    expect(JSON.stringify(auth)).toContain("claude-subscription")
    const opus = models.getModel("openrouter", OPUS.slice("openrouter/".length))!
    expect(await models.getAuth(opus)).toBeUndefined()
  })

  it("keeps a key it was signed in with to the models it names", async () => {
    const deployment = serverSignIns({ anthropic: { type: "api_key", key: "sk-ant-server" } })
    const { models, offered } = createAgentModels(config, { workspace: signIns(), deployment })
    expect(ids((await offered()).options)).toEqual([HAIKU, LUNA])
    const sonnet = models.getModel("anthropic", "claude-sonnet-5-5")!
    expect(await models.getAuth(sonnet)).toBeUndefined()

    // One of that provider's that it does name is offered, and paid for with that key.
    const naming = createAgentModels(
      { ...config, allowedModels: [...config.allowedModels, SONNET] },
      { workspace: signIns(), deployment },
    )
    expect(ids((await naming.offered()).options)).toEqual([HAIKU, LUNA, SONNET])
    expect((await naming.models.getAuth(sonnet))?.auth.apiKey).toBe("sk-ant-server")
  })
})

describe("an agent on a model its deployment has stopped offering", () => {
  const namespaces: NodeActorNamespace[] = []
  afterEach(async () => {
    for (const namespace of namespaces.splice(0)) await namespace.close().catch(() => {})
  })

  it("goes on with the model new agents start on", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dc-agent-models-"))
    const workspace = signIns({ openrouter: { type: "api_key", key: "sk-or-theirs" } })
    /** The server, as it is each time it starts. */
    const start = () => {
      const namespace = new NodeActorNamespace({
        directory: join(directory, "actors"),
        blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
        factory: (host) => {
          const models = createAgentModels(
            { openrouterApiKey: "sk-or-server", allowedModels: [HAIKU, LUNA] },
            { workspace },
          )
          const openrouter = models.models.getProvider("openrouter")!
          return createAgentActor(host, {
            models: models.models,
            defaultModel: models.defaultModel,
            modelOptions: models.options,
            // Every model of what the workspace is signed in to, as its own actor would say.
            workspaceModels: async () =>
              workspace.kept.openrouter === undefined
                ? []
                : openrouter.getModels().map((model) => modelOption(model, openrouter, false)),
          })
        },
      })
      namespace.start()
      namespaces.push(namespace)
      return namespace
    }
    const call = async (namespace: NodeActorNamespace, path: string, payload?: unknown) => {
      const response = await namespace.get("agent-1").fetch(
        new Request(`http://actor${path}`, {
          method: payload === undefined ? "GET" : "POST",
          body: payload === undefined ? undefined : JSON.stringify(payload),
        }),
      )
      expect(response.ok).toBe(true)
      return (await response.json()) as { agent: { model: string } }
    }

    const first = start()
    await call(first, "/init", { ownerId: "user-1", model: OPUS })
    expect((await call(first, "/")).agent.model).toBe(OPUS)
    await first.close()

    // Its workspace's own account is what lets it run on a model the deployment does not offer.
    const second = start()
    expect((await call(second, "/")).agent.model).toBe(OPUS)
    await second.close()

    // The workspace signs out. The deployment does not pay for that model, so the agent moves.
    delete workspace.kept.openrouter
    const third = start()
    expect((await call(third, "/")).agent.model).toBe(HAIKU)
  })
})

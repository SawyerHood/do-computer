import type { Api, Model } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { describe, expect, it } from "vitest"
import { isExtraModel, parseExtraModels } from "../src/extra-models.ts"
import { createAgentModels, modelProviders } from "../src/index.ts"

/** A model no provider's list has, as a deployment's settings would name it. */
const ADDED = "claude-new-1"

const anthropic = (extra: readonly string[]) =>
  modelProviders(extra).find((provider) => provider.id === "anthropic")!

const found = (extra: readonly string[], id = ADDED) =>
  anthropic(extra)
    .getModels()
    .find((model) => model.id === id)

describe("the models a deployment's settings add", () => {
  it("are read as a provider, a model, and what is written after it", () => {
    expect(
      parseExtraModels([
        `anthropic/${ADDED}`,
        ` anthropic/${ADDED}[1m] `,
        `anthropic/${ADDED}[1m]=claude-opus-5-5`,
        `anthropic/${ADDED}=claude-opus-5-5`,
        "openrouter/acme/new-2",
        // Neither is a provider and a model.
        "claude-new-1",
        "anthropic/",
      ]),
    ).toEqual([
      { provider: "anthropic", id: ADDED, longContext: false, like: undefined },
      { provider: "anthropic", id: ADDED, longContext: true, like: undefined },
      { provider: "anthropic", id: ADDED, longContext: true, like: "claude-opus-5-5" },
      { provider: "anthropic", id: ADDED, longContext: false, like: "claude-opus-5-5" },
      { provider: "openrouter", id: "acme/new-2", longContext: false, like: undefined },
    ])
  })

  it("join their provider's list, treated as the model suggested first for it", () => {
    const before = anthropic([]).getModels()
    expect(before.some((model) => model.id === ADDED)).toBe(false)

    const model = found([`anthropic/${ADDED}`])!
    const sonnet = before.find((other) => other.id === "claude-sonnet-5-5")!
    expect(model).toEqual({ ...sonnet, id: ADDED, name: ADDED })
    expect(isExtraModel(model)).toBe(true)
    expect(isExtraModel(sonnet)).toBe(false)
    // The provider's own are all still there, and no other provider gained anything.
    expect(anthropic([`anthropic/${ADDED}`]).getModels()).toHaveLength(before.length + 1)
    const others = (extra: string[]) =>
      modelProviders(extra)
        .filter((provider) => provider.id !== "anthropic")
        .map((provider) => provider.getModels().length)
    expect(others([`anthropic/${ADDED}`])).toEqual(others([]))
  })

  it("are treated as the model they name, without the models that may answer for it", () => {
    const fable = anthropic([])
      .getModels()
      .find((other) => other.id === "claude-fable-5")! as Model<"anthropic-messages">
    expect(fable.compat?.allowedFallbackModels).not.toBeUndefined()

    const model = found([`anthropic/${ADDED}=claude-fable-5`])! as Model<"anthropic-messages">
    expect(model.cost).toEqual(fable.cost)
    expect(model.thinkingLevelMap).toEqual(fable.thinkingLevelMap)
    const { allowedFallbackModels: _, ...compat } = fable.compat!
    expect(model.compat).toEqual(compat)
  })

  it("hold a million tokens when asked to, whatever the model they are treated as holds", () => {
    const haiku = anthropic([])
      .getModels()
      .find((other) => other.id === "claude-haiku-4-5")!
    expect(haiku.contextWindow).toBe(200_000)
    expect(found([`anthropic/${ADDED}=claude-haiku-4-5`])!.contextWindow).toBe(200_000)
    expect(found([`anthropic/${ADDED}[1m]=claude-haiku-4-5`])!.contextWindow).toBe(1_000_000)
  })

  it("are passed over where they cannot be placed", () => {
    // No such provider, no such model to be treated as, and a model the provider has.
    expect(modelProviders([`nobody/${ADDED}`]).flatMap((p) => p.getModels())).toHaveLength(
      modelProviders().flatMap((p) => p.getModels()).length,
    )
    expect(found([`anthropic/${ADDED}=claude-nothing`])).toBeUndefined()
    const sonnet = found(["anthropic/claude-sonnet-5-5[1m]=claude-haiku-4-5"], "claude-sonnet-5-5")!
    expect(isExtraModel(sonnet)).toBe(false)
    expect(sonnet.name).toBe("Claude Sonnet 5.5")
  })
})

/** What a call to one of Anthropic's models sends, read from the request it would make. */
async function sent(extra: string, key: string) {
  const models = createModels({
    authContext: { env: async () => undefined, fileExists: async () => false },
  })
  for (const provider of modelProviders([extra])) models.setProvider(provider)
  const model = models.getModel("anthropic", ADDED)!
  const requests: { url: string; headers: Headers; body: { model: string } }[] = []
  const message = await models.complete(
    model as Model<Api>,
    { messages: [{ role: "user", content: "Hello", timestamp: 0 }] },
    {
      apiKey: key,
      maxRetries: 0,
      // Stands in for Anthropic, and turns the request down once it has been read.
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)) as { model: string },
        })
        return Response.json(
          { type: "error", error: { type: "invalid_request_error", message: "Turned down." } },
          { status: 400 },
        )
      },
    },
  )
  expect(message.stopReason).toBe("error")
  expect(requests).toHaveLength(1)
  return requests[0]!
}

describe("a call to a model that was added", () => {
  it("asks for the model by the name it was given", async () => {
    const request = await sent(`anthropic/${ADDED}`, "sk-ant-api-test")
    expect(request.url).toContain("https://api.anthropic.com/v1/messages")
    expect(request.body.model).toBe(ADDED)
    expect(request.headers.get("anthropic-beta") ?? "").not.toContain("context-1m")
  })

  it("asks for the long context beside whatever else the request asks for", async () => {
    const request = await sent(`anthropic/${ADDED}[1m]`, "sk-ant-api-test")
    expect(request.body.model).toBe(ADDED)
    const features = request.headers.get("anthropic-beta")!.split(",")
    expect(features).toContain("context-1m-2025-08-07")
    // What a call to the model it is treated as names is all still named.
    const plain = await sent(`anthropic/${ADDED}`, "sk-ant-api-test")
    const usual = (plain.headers.get("anthropic-beta") ?? "").split(",").filter(Boolean)
    expect(features).toEqual([...usual, "context-1m-2025-08-07"])
  })

  it("asks for it on a subscription too, where a request says it is Claude Code's", async () => {
    const request = await sent(`anthropic/${ADDED}[1m]`, "sk-ant-oat01-test")
    const features = request.headers.get("anthropic-beta")!.split(",")
    expect(features).toEqual(
      expect.arrayContaining(["claude-code-20250219", "oauth-2025-04-20", "context-1m-2025-08-07"]),
    )
    expect(request.headers.get("authorization")).toBe("Bearer sk-ant-oat01-test")
  })
})

describe("a deployment with models added", () => {
  it("can call one, and offers none of them on its own key", () => {
    const config = { openrouterApiKey: "sk-or-server", extraModels: ["openrouter/acme/new-2"] }
    const { models, options } = createAgentModels(config)
    expect(models.getModel("openrouter", "acme/new-2")).not.toBeUndefined()
    expect(options.some((option) => option.id === "openrouter/acme/new-2")).toBe(false)
    expect(options).toEqual(createAgentModels({ openrouterApiKey: "sk-or-server" }).options)
    // Naming it among the models the deployment offers does not make it one.
    const named = createAgentModels({
      ...config,
      allowedModels: ["anthropic/claude-haiku-5.5", "acme/new-2"],
    })
    expect(named.options.map((option) => option.id)).toEqual([
      "openrouter/anthropic/claude-haiku-5.5",
    ])
  })
})

import type { ModelOption } from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import { sources } from "./welcome-models.ts"

const model = (id: string, more: Partial<ModelOption> = {}): ModelOption => ({
  id,
  name: id,
  reasoning: false,
  inputCost: 0,
  outputCost: 0,
  ...more,
})
const theirs = (id: string, provider: string, subscription: boolean, more = {}) =>
  model(id, { provider, signIn: { subscription, by: "Sawyer" }, ...more })
const ids = (source: { models: ModelOption[] } | undefined) => source?.models.map((one) => one.id)

describe("sources", () => {
  const offered = [model("meta/spark"), model("anthropic/haiku"), model("openai/luna")]

  it("has what the deployment includes as one choice, on the model the agent was made with", () => {
    const [included, ...rest] = sources(offered, "anthropic/haiku")
    expect(rest).toEqual([])
    expect(included).toMatchObject({ key: "own", label: "Included", first: "anthropic/haiku" })
    expect(included!.tag).toBeUndefined()
    // The others it offers are what it can be changed to.
    expect(ids(included)).toEqual(["meta/spark", "anthropic/haiku", "openai/luna"])
  })

  it("starts on a suggested one, and then the first, where that model is not the deployment's", () => {
    expect(sources(offered, "gone/model")[0]!.first).toBe("meta/spark")
    const suggested = [offered[0]!, model("anthropic/haiku", { recommended: true }), offered[2]!]
    expect(sources(suggested, "gone/model")[0]!.first).toBe("anthropic/haiku")
    expect(sources([], "gone/model")).toEqual([])
  })

  it("keeps what is included to a few of hundreds, the one it starts on among them", () => {
    const hundreds = Array.from({ length: 300 }, (_, at) =>
      model(`or/m${at}`, { recommended: at < 8 }),
    )
    const [included] = sources(hundreds, "or/m250")
    expect(ids(included)).toEqual(["or/m250", "or/m0", "or/m1", "or/m2", "or/m3", "or/m4"])
    expect(included!.first).toBe("or/m250")
  })

  it("has each provider the person signed in to after it, on the first of its models", () => {
    const found = sources(
      [
        ...offered,
        theirs("anthropic/sonnet", "Anthropic", false),
        theirs("anthropic/opus", "Anthropic", false),
        theirs("openai/gpt", "OpenAI", true),
      ],
      "meta/spark",
    )
    expect(found.map((source) => source.label)).toEqual([
      "Included",
      "Your Anthropic key",
      "Your OpenAI subscription",
    ])
    expect(found[1]).toMatchObject({
      provider: "Anthropic",
      tag: "On your key",
      first: "anthropic/sonnet",
    })
    expect(ids(found[1])).toEqual(["anthropic/sonnet", "anthropic/opus"])
    expect(found[2]).toMatchObject({ provider: "OpenAI", tag: "On your subscription" })
  })

  it("keeps a long list of theirs to the suggested few", () => {
    const many = Array.from({ length: 12 }, (_, at) =>
      theirs(`openai/m${at}`, "OpenAI", true, { recommended: at === 3 || at === 7 }),
    )
    const [, own] = sources([...offered, ...many], "meta/spark")
    expect(ids(own)).toEqual(["openai/m3", "openai/m7"])
    expect(own!.first).toBe("openai/m3")
  })
})

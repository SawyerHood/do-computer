import { describe, expect, it } from "vitest"
import { filterModels, nearestThinking } from "../src/index.ts"

const models = [
  { id: "openrouter/anthropic/claude-sonnet-5.5", name: "Anthropic: Claude Sonnet 5.5" },
  { id: "openrouter/anthropic/claude-haiku-4.5", name: "Anthropic: Claude Haiku 4.5" },
  { id: "openrouter/openai/gpt-5.1", name: "OpenAI: GPT-5.1" },
  { id: "openrouter/google/gemini-3.8-flash", name: "Google: Gemini 3.8 Flash" },
]
const names = (query: string) => filterModels(models, query).map((model) => model.name)

describe("filterModels", () => {
  it("returns everything, in order, for an empty search", () => {
    expect(names("")).toEqual(models.map((model) => model.name))
    expect(names("   ")).toEqual(models.map((model) => model.name))
  })

  it("matches the name or the id, whatever the case", () => {
    expect(names("HAIKU")).toEqual(["Anthropic: Claude Haiku 4.5"])
    expect(names("gpt-5")).toEqual(["OpenAI: GPT-5.1"])
    expect(names("google/")).toEqual(["Google: Gemini 3.8 Flash"])
  })

  it("needs every word, in any order", () => {
    expect(names("claude 5.5")).toEqual(["Anthropic: Claude Sonnet 5.5"])
    expect(names("5.5 sonnet anthropic")).toEqual(["Anthropic: Claude Sonnet 5.5"])
    expect(names("claude gemini")).toEqual([])
  })
})

describe("nearestThinking", () => {
  it("keeps a level the model offers", () => {
    expect(nearestThinking(["off", "low", "medium", "high"], "medium")).toBe("medium")
  })

  it("goes up to the next level the model offers, and down only when there is none above", () => {
    expect(nearestThinking(["off", "low", "high", "max"], "medium")).toBe("high")
    expect(nearestThinking(["low", "medium", "high"], "off")).toBe("low")
    expect(nearestThinking(["off", "low", "medium"], "max")).toBe("medium")
  })

  it("has nothing for a model that does not reason", () => {
    expect(nearestThinking([], "medium")).toBeUndefined()
  })
})

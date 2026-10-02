import { describe, expect, it } from "vitest"
import { filterModels } from "../src/index.ts"

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

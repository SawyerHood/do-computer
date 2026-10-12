import type { ModelLoginMethod, ModelProvider } from "@durable-computer/protocol"
import { describe, expect, it } from "vitest"
import {
  asked,
  DEPLOYMENT,
  offer,
  pasted,
  type Scope,
  short,
  signedInWords,
  signInWords,
} from "../src/models/words.ts"

const oauth: ModelLoginMethod = { type: "oauth", label: "Anthropic (Claude Pro/Max)", subscription: true }
const key: ModelLoginMethod = { type: "api_key", label: "Anthropic API key", subscription: false }
const anthropic: ModelProvider = {
  id: "anthropic",
  name: "Anthropic",
  methods: [oauth, key],
  featured: true,
  signedIn: null,
}
const team: Scope = { id: "w1", name: "Tidewater", kind: "team", role: "member" }

describe("the words of model sign-ins", () => {
  it("names a way of signing in as a button would", () => {
    expect(short(oauth)).toBe("Claude Pro or Max")
    expect(short({ ...oauth, label: "GitHub Copilot (subscription)" })).toBe("GitHub Copilot")
    expect(short({ ...oauth, label: "OpenRouter OAuth" })).toBe("OpenRouter")
  })

  it("says what a provider offers", () => {
    expect(offer(anthropic, false)).toBe("A subscription or a key.")
    expect(offer({ ...anthropic, methods: [key] }, false)).toBe("A key.")
    expect(offer(anthropic, true)).toBe("Already here. Sign in to use your own account.")
  })

  it("says how a workspace is signed in", () => {
    const at = new Date().getTime()
    const signedIn = { type: "oauth" as const, by: "Sawyer", byId: "me", at, models: 1 }
    expect(signedInWords({ ...anthropic, signedIn }, "me")).toBe(
      "Claude Pro or Max subscription · by you, today · 1 model",
    )
    expect(signedInWords({ ...anthropic, signedIn: { ...signedIn, type: "api_key", models: 3 } }, "x")).toBe(
      "A key · by Sawyer, today · 3 models",
    )
  })

  it("names what is pasted back from a provider's page", () => {
    const prompt = { id: "p", type: "manual_code" as const, message: "Paste the code" }
    expect(pasted(prompt)).toBe("The code it shows")
    expect(pasted({ ...prompt, placeholder: "http://localhost:1455/auth/callback?code=…" })).toBe(
      "The address you end up at",
    )
    expect(pasted({ ...prompt, type: "secret" })).toBeUndefined()
  })

  it("calls a field Key where it would only repeat the title", () => {
    const prompt = { id: "p", type: "secret" as const, message: "Enter Anthropic API key:" }
    expect(asked(prompt, "Anthropic API key")).toBe("Key")
    expect(asked({ ...prompt, message: "Enter account id:" }, "Anthropic API key")).toBe("Account id")
  })

  it("words a sign-in for whose agents it is", () => {
    expect(signInWords(team, anthropic, oauth)).toMatchObject({
      key: false,
      title: "Sign in with Claude Pro or Max",
      description: "Use a Claude Pro or Max subscription for Tidewater's agents.",
    })
    expect(signInWords(team, anthropic, oauth).shared).toContain("Everyone in Tidewater")
    expect(signInWords(team, anthropic, oauth).shared).toContain("Anthropic decides")
    const server = signInWords(DEPLOYMENT, anthropic, key)
    expect(server.title).toBe("Anthropic API key")
    expect(server.shared).toBe(
      "Everyone on this server can then set agents to these models, and what the agents use counts against your account there.",
    )
  })
})

import { env } from "cloudflare:test"
import type { ModelLogin, ModelProvidersState } from "@durable-computer/protocol"
import { durableObjectNamespace } from "@durable-computer/runtime/cloudflare"
import { describe, expect, it } from "vitest"
import { CALLER_HEADER, encodeCaller } from "../../src/index.ts"
import type { Env } from "./worker.ts"

const namespace = durableObjectNamespace((env as unknown as Env).MODEL_ACCESS)

async function call<T>(workspace: string, path: string, method = "GET", payload?: unknown) {
  const response = await namespace.get(workspace).fetch(
    new Request(`http://models${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        [CALLER_HEADER]: encodeCaller({ id: "user-1", name: "Ada" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  )
  return { status: response.status, body: (await response.json()) as T }
}

const start = async (workspace: string, providerId: string, type: "oauth" | "api_key") =>
  (await call<{ login: ModelLogin }>(workspace, "/logins", "POST", { providerId, type })).body.login

const answer = async (workspace: string, login: ModelLogin, value: string) =>
  call<{ login: ModelLogin }>(workspace, `/logins/${login.id}/answer`, "POST", {
    promptId: login.prompt?.id,
    value,
  })

/**
 * pi's own sign-ins, as far as they go without an account: the page each sends the person to,
 * and the question it then asks. That they start at all here is the point. They were written
 * for a terminal on the person's machine, and run in a Durable Object.
 */
describe("signing in to pi's providers in a Durable Object", () => {
  it("offers Claude and ChatGPT subscriptions, and keys for the rest", async () => {
    const { providers } = (await call<ModelProvidersState>("ws-list", "/providers")).body
    const byId = new Map(providers.map((provider) => [provider.id, provider]))
    expect(providers.slice(0, 3).map((provider) => provider.id)).toEqual([
      "anthropic",
      "openai",
      "openai-codex",
    ])
    expect(byId.get("anthropic")!.methods).toEqual([
      { type: "oauth", label: "Anthropic (Claude Pro/Max)", subscription: true },
      { type: "api_key", label: "Anthropic API key", subscription: false },
    ])
    expect(byId.get("openai")!.methods.map((method) => method.type)).toEqual(["oauth", "api_key"])
    expect(byId.get("openai-codex")!.methods).toEqual([
      { type: "oauth", label: "OpenAI (ChatGPT Plus/Pro)", subscription: true },
    ])
    expect(byId.get("github-copilot")!.methods[0]).toMatchObject({ type: "oauth" })
    // The ones that sign in with the server's own files are not offered to a workspace.
    expect(byId.has("amazon-bedrock")).toBe(false)
    expect(byId.has("google-vertex")).toBe(false)
    expect(providers.length).toBeGreaterThan(30)
    expect(providers.every((provider) => provider.methods.length > 0)).toBe(true)
  })

  it("starts a Claude subscription sign-in: a page at Claude, then the code it shows", async () => {
    const login = await start("ws-claude", "anthropic", "oauth")
    expect(login.status).toBe("waiting")
    const url = new URL(login.authUrl!.url)
    expect(url.origin + url.pathname).toBe("https://claude.ai/oauth/authorize")
    // The way that ends on a page showing a code, not on an address of the server's own.
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://platform.claude.com/oauth/code/callback",
    )
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(login.prompt).toMatchObject({ type: "manual_code" })

    // A code Anthropic never gave is refused by Anthropic, and the sign-in says so.
    const { body } = await answer("ws-claude", login, "not-a-code#not-a-state")
    expect(body.login.status).toBe("failed")
    expect(body.login.error).not.toBeNull()
    const { providers } = (await call<ModelProvidersState>("ws-claude", "/providers")).body
    expect(providers.find((provider) => provider.id === "anthropic")!.signedIn).toBeNull()
  })

  it("starts a ChatGPT subscription sign-in for Codex, by a page or by a code", async () => {
    const login = await start("ws-codex", "openai-codex", "oauth")
    expect(login.prompt).toMatchObject({ type: "select" })
    expect(login.prompt!.options!.map((option) => option.id)).toEqual(["browser", "device_code"])
    const { body } = await answer("ws-codex", login, "browser")
    expect(body.login.status).toBe("waiting")
    const url = new URL(body.login.authUrl!.url)
    expect(url.hostname).toBe("auth.openai.com")
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback")
    expect(body.login.prompt).toMatchObject({ type: "manual_code" })
    const cancelled = await call<{ login: ModelLogin }>(
      "ws-codex",
      `/logins/${body.login.id}`,
      "DELETE",
    )
    expect(cancelled.body.login.status).toBe("cancelled")
  })

  it("starts a sign-in with ChatGPT for OpenAI's own models", async () => {
    const login = await start("ws-openai", "openai", "oauth")
    expect(login.error).toBeNull()
    expect(login.status).toBe("waiting")
    expect(new URL(login.authUrl!.url).hostname).toBe("auth.openai.com")
    expect(login.prompt).toMatchObject({ type: "manual_code" })
    await call("ws-openai", `/logins/${login.id}`, "DELETE")
  })

  it("keeps a key, and offers that provider's models", async () => {
    const login = await start("ws-key", "anthropic", "api_key")
    expect(login.prompt).toMatchObject({ type: "secret" })
    expect((await answer("ws-key", login, "sk-ant-test")).body.login.status).toBe("done")
    const { models } = (
      await call<{ models: { id: string; recommended?: boolean }[] }>("ws-key", "/models")
    ).body
    expect(models[0]).toMatchObject({ id: "anthropic/claude-sonnet-5-5", recommended: true })
    expect(models.length).toBeGreaterThan(5)
    const { credential } = (await call<{ credential: unknown }>("ws-key", "/credentials/anthropic"))
      .body
    expect(credential).toEqual({ type: "api_key", key: "sk-ant-test" })
  })
})

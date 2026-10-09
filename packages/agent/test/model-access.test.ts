import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ModelLogin, ModelOption, ModelProvidersState } from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@durable-computer/runtime/node"
import {
  type Api,
  createAssistantMessageEventStream,
  envApiKeyAuth,
  type Model,
  type OAuthAuth,
} from "@earendil-works/pi-ai"
import { createModels, createProvider, type Provider } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import {
  CALLER_HEADER,
  createModelAccessActor,
  encodeCaller,
  workspaceCredentials,
  workspaceModelOptions,
} from "../src/index.ts"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** What the stand-in provider's sign-in does, for a test to steer and to read. */
type Flow = {
  /** How long a token it hands out lasts. */
  lifetimeMs: number
  refreshes: number
  failRefresh: boolean
  /** Finishes a sign-in that is waiting for a code to be entered at the provider. */
  approve: ((code: string) => void) | undefined
}

const model = (provider: string, id: string, name: string): Model<Api> => ({
  id,
  name,
  api: "openai-completions",
  provider,
  baseUrl: "https://fake.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
})

/** A provider that answers with the key it was called with, and signs in the ways pi's do. */
function fake(flow: Flow, id = "fake"): Provider {
  const oauth: OAuthAuth = {
    name: "Fake (subscription)",
    isSubscription: true,
    async login(interaction) {
      const how = await interaction.prompt({
        type: "select",
        message: "Select a login method:",
        options: [
          { id: "browser", label: "Browser login" },
          { id: "copy_code", label: "Copy code login" },
          { id: "device", label: "Device code login" },
        ],
      })
      const token = (code: string) => ({
        type: "oauth" as const,
        access: `access-${code}`,
        refresh: "refresh-0",
        expires: Date.now() + flow.lifetimeMs,
      })
      if (how === "device") {
        interaction.notify({
          type: "device_code",
          userCode: "ABCD-1234",
          verificationUri: "https://fake.test/device",
          expiresInSeconds: 600,
        })
        return token(
          await new Promise<string>((resolve, reject) => {
            flow.approve = resolve
            interaction.signal.addEventListener("abort", () => reject(new Error("Login cancelled")))
          }),
        )
      }
      interaction.notify({
        type: "auth_url",
        url: `https://fake.test/authorize?how=${how}`,
        instructions: "Sign in, then paste the code.",
      })
      const code = await interaction.prompt({
        type: "manual_code",
        message: "Paste the code:",
        placeholder: "code#state",
      })
      if (code === "bad") {
        throw new Error("Token exchange failed. status=400; stack=Error: at exchange (flow.js:1)")
      }
      interaction.notify({ type: "progress", message: "Exchanging the code..." })
      return token(code)
    },
    async refresh() {
      flow.refreshes++
      await sleep(20)
      if (flow.failRefresh) throw new Error("invalid_grant")
      return {
        type: "oauth",
        access: `access-renewed-${flow.refreshes}`,
        refresh: `refresh-${flow.refreshes}`,
        expires: Date.now() + 3_600_000,
      }
    },
    toAuth: async (credential) => ({ apiKey: credential.access }),
  }
  const answer = (asked: Model<Api>, key: string | undefined) => {
    const stream = createAssistantMessageEventStream()
    const message = {
      ...fauxAssistantMessage(`called with ${key ?? "nothing"}`),
      api: asked.api,
      provider: asked.provider,
      model: asked.id,
    }
    stream.push({ type: "done", reason: "stop", message })
    stream.end(message)
    return stream
  }
  return createProvider({
    id,
    name: "Fake",
    auth: { apiKey: envApiKeyAuth("Fake API key", ["FAKE_API_KEY"]), oauth },
    models: [model(id, "big", "Fake Big"), model(id, "small", "Fake Small")],
    api: {
      stream: (asked, _context, options) => answer(asked, options?.apiKey),
      streamSimple: (asked, _context, options) => answer(asked, options?.apiKey),
    },
  })
}

type World = {
  workspaces: NodeActorNamespace
  flow: Flow
  providers: () => Provider[]
  directory: string
}
const worlds: World[] = []

function open(
  ids: string[] = ["fake"],
  directory = mkdtempSync(join(tmpdir(), "dc-model-access-")),
): World {
  const flow: Flow = { lifetimeMs: 3_600_000, refreshes: 0, failRefresh: false, approve: undefined }
  const providers = () => ids.map((id) => fake(flow, id))
  const workspaces = new NodeActorNamespace({
    directory: join(directory, "models"),
    blobs: () => fileBlobs(join(directory, "blobs")),
    factory: (host) => createModelAccessActor(host, { providers }),
    onError: (error) => {
      throw error
    },
  })
  const world = { workspaces, flow, providers, directory }
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.workspaces.close().catch(() => {})
})

const ADA = { id: "user-ada", name: "Ada" }

async function call<T>(
  world: World,
  path: string,
  method = "GET",
  body?: unknown,
  workspace = "w1",
): Promise<{ status: number; body: T }> {
  const response = await world.workspaces.get(workspace).fetch(
    new Request(`http://models${path}`, {
      method,
      headers: { "content-type": "application/json", [CALLER_HEADER]: encodeCaller(ADA) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: response.status, body: (await response.json()) as T }
}

const start = async (world: World, type: "oauth" | "api_key", providerId = "fake") =>
  (await call<{ login: ModelLogin }>(world, "/logins", "POST", { providerId, type })).body.login

const answer = async (world: World, login: ModelLogin, value: string) =>
  (
    await call<{ login: ModelLogin }>(world, `/logins/${login.id}/answer`, "POST", {
      promptId: login.prompt?.id,
      value,
    })
  ).body.login

const providers = async (world: World) =>
  (await call<ModelProvidersState>(world, "/providers")).body.providers

const credential = (world: World, providerId = "fake") =>
  call<{ credential: { type: string; key?: string; access?: string } | null; code?: string }>(
    world,
    `/credentials/${providerId}`,
  )

/** Sign in with the subscription, by pasting a code, and resolve once it is done. */
async function signIn(world: World, code = "code-1") {
  const chosen = await answer(world, await start(world, "oauth"), "browser")
  const done = await answer(world, chosen, code)
  expect(done.status).toBe("done")
}

describe("a workspace's model providers", () => {
  it("lists the providers and how each can be signed in to", async () => {
    const world = open()
    expect(await providers(world)).toEqual([
      {
        id: "fake",
        name: "Fake",
        methods: [
          { type: "oauth", label: "Fake (subscription)", subscription: true },
          { type: "api_key", label: "Fake API key", subscription: false },
        ],
        featured: false,
        signedIn: null,
      },
    ])
    expect((await call<{ models: ModelOption[] }>(world, "/models")).body.models).toEqual([])
  })

  it("signs in with a key, and says who did without saying the key", async () => {
    const world = open()
    const login = await start(world, "api_key")
    expect(login).toMatchObject({
      providerId: "fake",
      type: "api_key",
      status: "waiting",
      prompt: { type: "secret", message: "Enter Fake API key" },
    })
    const done = await answer(world, login, "  sk-secret  ")
    expect(done).toMatchObject({ status: "done", prompt: null, error: null })

    const listed = await providers(world)
    expect(listed[0]!.signedIn).toMatchObject({
      type: "api_key",
      by: "Ada",
      byId: "user-ada",
      models: 2,
    })
    expect(JSON.stringify(listed)).not.toContain("sk-secret")
    expect((await credential(world)).body.credential).toEqual({ type: "api_key", key: "sk-secret" })

    const { models } = (await call<{ models: ModelOption[] }>(world, "/models")).body
    expect(models.map((option) => option.id)).toEqual(["fake/big", "fake/small"])
    expect(models[0]).toMatchObject({
      name: "Fake Big",
      provider: "Fake",
      inputCost: 1,
      signIn: { subscription: false, by: "Ada" },
    })
  })

  it("leads a sign-in through a page to open and a code to paste", async () => {
    const world = open()
    const login = await start(world, "oauth")
    expect(login.prompt).toMatchObject({ type: "select" })
    expect(login.prompt!.options!.map((option) => option.id)).toEqual([
      "browser",
      "copy_code",
      "device",
    ])
    // Only one of the options can be chosen, and only the question that stands answered.
    expect(
      (
        await call(world, `/logins/${login.id}/answer`, "POST", {
          promptId: login.prompt!.id,
          value: "x",
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await call(world, `/logins/${login.id}/answer`, "POST", {
          promptId: "nope",
          value: "browser",
        })
      ).status,
    ).toBe(409)

    const asked = await answer(world, login, "browser")
    expect(asked).toMatchObject({
      status: "waiting",
      authUrl: { url: "https://fake.test/authorize?how=browser" },
      prompt: { type: "manual_code", placeholder: "code#state" },
    })
    const done = await answer(world, asked, "code-1")
    expect(done).toMatchObject({ status: "done", authUrl: null, prompt: null })
    expect((await credential(world)).body.credential).toMatchObject({
      type: "oauth",
      access: "access-code-1",
    })
    expect((await providers(world))[0]!.signedIn).toMatchObject({ type: "oauth", by: "Ada" })
    // A model of a subscription says so, for the app to show in place of its price.
    const { models } = (await call<{ models: ModelOption[] }>(world, "/models")).body
    expect(models[0]!.signIn).toEqual({ subscription: true, by: "Ada" })
  })

  it("waits for a code entered at the provider, and tells whoever is waiting", async () => {
    const world = open()
    const shown = await answer(world, await start(world, "oauth"), "device")
    expect(shown).toMatchObject({
      status: "waiting",
      prompt: null,
      deviceCode: { userCode: "ABCD-1234", verificationUri: "https://fake.test/device" },
    })
    expect(shown.deviceCode!.expiresAt).toBeGreaterThan(Date.now())

    // Asked to wait for what comes next, it answers as soon as there is something.
    const began = Date.now()
    const waiting = call<{ login: ModelLogin }>(
      world,
      `/logins/${shown.id}?rev=${shown.rev}&wait=10000`,
    )
    await sleep(50)
    world.flow.approve!("device-1")
    const { login } = (await waiting).body
    expect(login.status).toBe("done")
    expect(Date.now() - began).toBeLessThan(5_000)
    expect((await credential(world)).body.credential).toMatchObject({ access: "access-device-1" })
  })

  it("makes a provider's choice for the person where only one way can work", async () => {
    const world = open(["anthropic"])
    const login = await start(world, "oauth", "anthropic")
    // Not asked how: straight to the page and the code.
    expect(login).toMatchObject({
      authUrl: { url: "https://fake.test/authorize?how=copy_code" },
      prompt: { type: "manual_code" },
    })
  })

  it("says why a sign-in failed, without the provider's trace", async () => {
    const world = open()
    const asked = await answer(world, await start(world, "oauth"), "browser")
    const failed = await answer(world, asked, "bad")
    expect(failed).toMatchObject({
      status: "failed",
      error: "Token exchange failed. status=400",
      prompt: null,
    })
    expect((await providers(world))[0]!.signedIn).toBeNull()
  })

  it("can be cancelled, and starting again leaves the earlier sign-in behind", async () => {
    const world = open()
    const first = await answer(world, await start(world, "oauth"), "device")
    const second = await start(world, "oauth")
    expect(
      (await call<{ login: ModelLogin }>(world, `/logins/${first.id}`)).body.login.status,
    ).toBe("cancelled")
    const cancelled = await call<{ login: ModelLogin }>(world, `/logins/${second.id}`, "DELETE")
    expect(cancelled.body.login).toMatchObject({ status: "cancelled", prompt: null })
    expect(
      (await call(world, `/logins/${second.id}/answer`, "POST", { promptId: "x", value: "y" }))
        .status,
    ).toBe(409)
    expect((await providers(world))[0]!.signedIn).toBeNull()
    expect((await call(world, "/logins/unknown")).status).toBe(404)
  })

  it("refuses a provider or a way of signing in that it does not have", async () => {
    const world = open()
    expect(
      (await call(world, "/logins", "POST", { providerId: "nope", type: "oauth" })).status,
    ).toBe(404)
    expect(
      (await call(world, "/logins", "POST", { providerId: "constructor", type: "oauth" })).status,
    ).toBe(404)
    // An agent asks about every provider it calls. One this cannot sign in to has nothing kept.
    expect((await credential(world, "echo")).body).toEqual({ credential: null })
    expect((await credential(world, "constructor")).body).toEqual({ credential: null })
  })

  it("keeps a sign-in across a restart, and each workspace's apart", async () => {
    const world = open()
    await signIn(world)
    await world.workspaces.close()
    // The same files, opened again, hold what was kept.
    const again = open(["fake"], world.directory)
    expect((await credential(again)).body.credential).toMatchObject({ access: "access-code-1" })
    expect((await providers(again))[0]!.signedIn).toMatchObject({ by: "Ada" })
    const other = await call<ModelProvidersState>(again, "/providers", "GET", undefined, "w2")
    expect(other.body.providers[0]!.signedIn).toBeNull()
  })

  it("is its starter's alone, and what someone signed in with goes when they leave", async () => {
    const world = open()
    const login = await start(world, "api_key")
    const asBo = (path: string, method: string, body?: unknown) =>
      world.workspaces.get("w1").fetch(
        new Request(`http://models${path}`, {
          method,
          headers: {
            "content-type": "application/json",
            [CALLER_HEADER]: encodeCaller({ id: "user-bo", name: "Bo" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      )
    expect((await asBo(`/logins/${login.id}`, "GET")).status).toBe(404)
    expect(
      (await asBo(`/logins/${login.id}/answer`, "POST", { promptId: login.prompt!.id, value: "k" }))
        .status,
    ).toBe(404)
    expect((await asBo(`/logins/${login.id}`, "DELETE")).status).toBe(404)
    expect((await answer(world, login, "sk-ada")).status).toBe("done")

    // Bo leaving takes nothing of Ada's. Ada leaving takes her sign-in.
    expect(await (await asBo("/members/user-bo", "DELETE")).json()).toEqual({ removed: [] })
    expect((await providers(world))[0]!.signedIn).not.toBeNull()
    expect(await (await asBo("/members/user-ada", "DELETE")).json()).toEqual({ removed: ["fake"] })
    expect((await providers(world))[0]!.signedIn).toBeNull()
  })

  it("signs out", async () => {
    const world = open()
    await signIn(world)
    const { body } = await call<ModelProvidersState>(world, "/providers/fake", "DELETE")
    expect(body.providers[0]!.signedIn).toBeNull()
    expect((await credential(world)).body.credential).toBeNull()
    expect((await call<{ models: ModelOption[] }>(world, "/models")).body.models).toEqual([])
  })
})

describe("a token that is running out", () => {
  it("is exchanged once, however many agents ask at the same moment", async () => {
    const world = open()
    world.flow.lifetimeMs = 60_000
    await signIn(world)
    const answers = await Promise.all([credential(world), credential(world), credential(world)])
    expect(world.flow.refreshes).toBe(1)
    for (const { body } of answers) {
      expect(body.credential).toMatchObject({ access: "access-renewed-1", refresh: "refresh-1" })
    }
    // And is not exchanged again while the new one lasts.
    await credential(world)
    expect(world.flow.refreshes).toBe(1)
    // Who signed in is still known after the exchange.
    expect((await providers(world))[0]!.signedIn).toMatchObject({ by: "Ada", type: "oauth" })
  })

  it("is still used when the exchange fails early, and says so once it has run out", async () => {
    const world = open()
    world.flow.lifetimeMs = 60_000
    world.flow.failRefresh = true
    await signIn(world)
    expect((await credential(world)).body.credential).toMatchObject({ access: "access-code-1" })

    const expired = open()
    expired.flow.lifetimeMs = -1_000
    expired.flow.failRefresh = true
    await signIn(expired)
    const refused = await call<{ error: string; code: string }>(expired, "/credentials/fake")
    expect(refused.status).toBe(409)
    expect(refused.body.code).toBe("sign_in_expired")
    expect(refused.body.error).toContain("sign in to Fake again")
  })
})

describe("an agent's models", () => {
  const prompt = { messages: [{ role: "user" as const, content: "hello", timestamp: 0 }] }

  it("call a provider with what the agent's workspace is signed in with", async () => {
    const world = open()
    const access = async () => world.workspaces.get("w1")
    const models = createModels({
      credentials: workspaceCredentials(access),
      authContext: { env: async () => undefined, fileExists: async () => false },
    })
    for (const provider of world.providers()) models.setProvider(provider)
    const big = models.getModel("fake", "big")!

    // Nobody has signed in: there is nothing to call it with.
    const before = await models.completeSimple(big, prompt)
    expect(before.stopReason).toBe("error")
    expect(await workspaceModelOptions(access)).toEqual([])

    await signIn(world, "code-9")
    const after = await models.completeSimple(big, prompt)
    expect(after.content).toEqual([{ type: "text", text: "called with access-code-9" }])
    expect((await workspaceModelOptions(access)).map((option) => option.id)).toEqual([
      "fake/big",
      "fake/small",
    ])
    expect(await models.getAvailable("fake")).toHaveLength(2)

    // A provider nobody signs in to, such as the deployment's own, is still called: what the
    // workspace keeps for it is nothing, and what the deployment has is used.
    const own = createProvider({
      id: "house",
      name: "House",
      auth: { apiKey: envApiKeyAuth("House key", ["HOUSE_KEY"]) },
      models: [{ ...world.providers()[0]!.getModels()[0]!, provider: "house" }],
      api: world.providers()[0]!,
    })
    const mixed = createModels({
      credentials: workspaceCredentials(access),
      authContext: {
        env: async (name) => (name === "HOUSE_KEY" ? "deployment-key" : undefined),
        fileExists: async () => false,
      },
    })
    mixed.setProvider(own)
    const house = await mixed.completeSimple(mixed.getModel("house", "big")!, prompt)
    expect(house.content).toEqual([{ type: "text", text: "called with deployment-key" }])

    // An agent in a workspace with no such actor is signed in to nothing.
    const alone = createModels({ credentials: workspaceCredentials(async () => undefined) })
    for (const provider of world.providers()) alone.setProvider(provider)
    expect((await alone.completeSimple(alone.getModel("fake", "big")!, prompt)).stopReason).toBe(
      "error",
    )
  })

  it("are handed a token the workspace exchanged, and never exchange one themselves", async () => {
    const world = open()
    // Short enough that pi itself would want it exchanged.
    world.flow.lifetimeMs = 60_000
    await signIn(world)
    const models = createModels({
      credentials: workspaceCredentials(async () => world.workspaces.get("w1")),
    })
    for (const provider of world.providers()) models.setProvider(provider)
    const big = models.getModel("fake", "big")!
    const replies = await Promise.all([
      models.completeSimple(big, prompt),
      models.completeSimple(big, prompt),
    ])
    for (const reply of replies) {
      expect(reply.content).toEqual([{ type: "text", text: "called with access-renewed-1" }])
    }
    expect(world.flow.refreshes).toBe(1)
  })

  it("say that the sign-in ran out when it did", async () => {
    const world = open()
    world.flow.lifetimeMs = -1_000
    world.flow.failRefresh = true
    await signIn(world)
    const models = createModels({
      credentials: workspaceCredentials(async () => world.workspaces.get("w1")),
    })
    for (const provider of world.providers()) models.setProvider(provider)
    const reply = await models.completeSimple(models.getModel("fake", "big")!, prompt)
    expect(reply.stopReason).toBe("error")
    expect(reply.errorMessage).toContain("sign in to Fake again")
  })
})

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  AddConnectorRequest,
  ApprovalsState,
  ChatState,
  ChatSummary,
  ConnectorResult,
  ConnectorSummary,
  ToolPart,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { APPS_URL, CONNECTOR_REDIRECT_HEADER, createAgentActor } from "../src/index.ts"

const REDIRECT = "https://app.example/api/connectors/callback"
const SERVER = "https://apps.test/mcp"
const ISSUER = "https://apps.test"
const TOKEN = "access-token-1"
const CODE = "good-code"
const TOOLS = [
  "COMPOSIO_SEARCH_TOOLS",
  "COMPOSIO_GET_TOOL_SCHEMAS",
  "COMPOSIO_MANAGE_CONNECTIONS",
  "COMPOSIO_MULTI_EXECUTE_TOOL",
  "COMPOSIO_REMOTE_WORKBENCH",
].map((name) => ({ name, description: `What ${name} does`, inputSchema: { type: "object" } }))

/**
 * Composio's MCP server and the sign-in in front of it, as a `fetch` stand-in: an app registers
 * itself, a person signs in, and the server then offers Composio's handful of tools.
 */
function fakeApps() {
  const calls: string[] = []
  const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json", ...headers },
    })
  const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const method = init?.method ?? "GET"
    if (url.origin !== ISSUER) return json({ error: "unknown host" }, 404)
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return json({ resource: SERVER, authorization_servers: [ISSUER] })
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        registration_endpoint: `${ISSUER}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      })
    }
    if (url.pathname === "/register" && method === "POST") {
      return json({ ...JSON.parse(String(init?.body)), client_id: "client-1" }, 201)
    }
    if (url.pathname === "/token" && method === "POST") {
      return new URLSearchParams(String(init?.body)).get("code") === CODE
        ? json({ access_token: TOKEN, token_type: "Bearer", expires_in: 3600 })
        : json({ error: "invalid_grant" }, 400)
    }
    if (url.pathname !== "/mcp") return json({ error: "not_found" }, 404)
    if (new Headers(init?.headers).get("authorization") !== `Bearer ${TOKEN}`) {
      return json({ error: "unauthorized" }, 401, {
        "www-authenticate": `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp"`,
      })
    }
    if (method === "DELETE") return new Response(null, { status: 200 })
    const message = JSON.parse(String(init?.body))
    const result = (value: unknown) => json({ jsonrpc: "2.0", id: message.id, result: value })
    switch (message.method) {
      case "initialize":
        return result({
          protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-apps", version: "1.0.0" },
        })
      case "notifications/initialized":
        return new Response(null, { status: 202 })
      case "tools/list":
        return result({ tools: TOOLS })
      case "tools/call":
        calls.push(message.params.name)
        return result({ content: [{ type: "text", text: `ran ${message.params.name}` }] })
    }
    return json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "No" } })
  }
  return { fetch, calls }
}

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  apps: ReturnType<typeof fakeApps>
}
const worlds: World[] = []

/** `appsUrl` null leaves the deployment saying nothing of where Apps is. */
function open(appsUrl: string | null = SERVER): World {
  const directory = mkdtempSync(join(tmpdir(), "dc-apps-"))
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const apps = fakeApps()
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
        connectorFetch: apps.fetch,
        appUrl: "https://app.example",
        ...(appsUrl === null ? {} : { appsUrl }),
      }),
  })
  const world = { namespace, faux, apps }
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

async function call<T>(
  world: World,
  path: string,
  method = "GET",
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await world.namespace.get("agent-1").fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: {
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
    }),
  )
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`)
  return result
}

const fromApp = { [CONNECTOR_REDIRECT_HEADER]: REDIRECT }
const add = (world: World, input: AddConnectorRequest) =>
  call<ConnectorResult & { state?: string }>(world, "/connectors", "POST", input, fromApp)
const connectors = async (world: World) =>
  (await call<{ connectors: ConnectorSummary[] }>(world, "/connectors")).connectors
/** Come back from the sign-in, as the gateway does with the code the service sent. */
const signIn = (world: World, id: string) =>
  call<ConnectorResult>(world, `/connectors/${id}/authorize`, "POST", { code: CODE })

async function settled(world: World, chatId: string): Promise<ChatState> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const state = await call<ChatState>(world, `/chats/${chatId}`)
    if (!state.busy && state.queued.length === 0 && state.messages.at(-1)?.role === "assistant")
      return state
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("The chat did not settle")
}

async function say(world: World, chatId: string, text: string): Promise<ChatState> {
  await call(world, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
  return settled(world, chatId)
}

async function setup(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  return call<ChatSummary>(world, "/chats", "POST", {})
}

const useTool = (name: string, args: Record<string, string | string[]> = {}) => [
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
  fauxAssistantMessage("Done."),
]
const lastTool = (state: ChatState) =>
  state.messages.flatMap((m) => m.parts).findLast((part): part is ToolPart => part.type === "tool")!

describe("the Apps connector", () => {
  it("is Composio's server unless a deployment says otherwise, and needs no key", async () => {
    expect(APPS_URL).toBe("https://connect.composio.dev/mcp")
    const world = open(null)
    await setup(world)
    // The stand-in is not at Composio's address, so nothing answers: it is added all the same.
    const { connector } = await add(world, { apps: true })
    expect(connector).toMatchObject({ name: "Apps", kind: "apps", url: APPS_URL, status: "error" })
  })

  it("is added with nothing typed, and has whoever added it sign in", async () => {
    const world = open()
    await setup(world)
    const added = await add(world, { apps: true })
    expect(added.connector).toMatchObject({
      name: "Apps",
      kind: "apps",
      url: SERVER,
      status: "needs_auth",
      tools: [],
    })
    expect(added.authorizationUrl).toMatch(/^https:\/\/apps\.test\/authorize\?/)
    expect(added.state).toBeTruthy()
    // It asks before it acts from the moment it is there, signed in to or not.
    const id = added.connector.id
    expect((await call<ApprovalsState>(world, "/approvals")).rules[`connector:${id}`]).toBe("ask")

    // Asked for again, it is the same one tried again and not a second.
    expect((await add(world, { apps: true })).connector.id).toBe(id)
    expect((await connectors(world)).length).toBe(1)

    const { connector } = await signIn(world, id)
    expect(connector.status).toBe("connected")
    expect(connector.tools.map((tool) => tool.name)).toEqual(TOOLS.map((tool) => tool.name))
  })

  it("is Apps by its address, when it is added by hand", async () => {
    const world = open()
    await setup(world)
    const { connector } = await add(world, { name: "My Composio", url: SERVER })
    expect(connector).toMatchObject({ name: "My Composio", kind: "apps", status: "needs_auth" })
    expect(
      (await call<ApprovalsState>(world, "/approvals")).rules[`connector:${connector.id}`],
    ).toBe("ask")
    // Any other connector is used without asking, as before: no rule is kept for it.
    const other = await add(world, { name: "Other", url: "https://apps.test/elsewhere" })
    expect(other.connector.kind).toBeUndefined()
    expect(
      (await call<ApprovalsState>(world, "/approvals")).rules[`connector:${other.connector.id}`],
    ).toBeUndefined()
  })

  it("looks things up without asking, and asks before doing something in an account", async () => {
    const world = open()
    const chat = await setup(world)
    await signIn(world, (await add(world, { apps: true })).connector.id)

    world.faux.setResponses(useTool("apps__COMPOSIO_SEARCH_TOOLS", { queries: [] }))
    const searched = await say(world, chat.id, "what can you do with my mail?")
    expect(lastTool(searched)).toMatchObject({
      status: "done",
      output: "ran COMPOSIO_SEARCH_TOOLS",
    })

    // The tool that runs things, and one this app has not been told about, are both asked for.
    for (const tool of ["COMPOSIO_MULTI_EXECUTE_TOOL", "COMPOSIO_REMOTE_WORKBENCH"]) {
      world.faux.setResponses(useTool(`apps__${tool}`))
      const held = await say(world, chat.id, "go on")
      expect(lastTool(held).status).toBe("error")
      expect(lastTool(held).output).toContain("needs the user's approval first (Use Apps)")
    }
    expect(world.apps.calls).toEqual(["COMPOSIO_SEARCH_TOOLS"])
  })

  it("can be added by the agent, which is told once the person has signed in", async () => {
    const world = open()
    const chat = await setup(world)
    await call(world, "/approvals/rules", "PATCH", { "tool:connectors_change": "allow" })
    world.faux.setResponses(useTool("connectors", { action: "add_apps" }))
    const asked = await say(world, chat.id, "check my mail")
    expect(lastTool(asked).status).toBe("done")
    expect(lastTool(asked).output).toContain('Added the connector "Apps"')
    expect(lastTool(asked).output).toContain("Composio")

    const [apps] = await connectors(world)
    expect(apps).toMatchObject({ kind: "apps", status: "needs_auth", askedIn: chat.id })
    world.faux.setResponses([fauxAssistantMessage("Now I can look.")])
    await signIn(world, apps!.id)
    const told = await settled(world, chat.id)
    expect(told.messages.at(-1)?.parts.at(-1)).toMatchObject({ text: "Now I can look." })
  })
})

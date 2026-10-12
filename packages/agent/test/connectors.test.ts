import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  ChatState,
  ChatSummary,
  AddConnectorRequest,
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
import { CONNECTOR_REDIRECT_HEADER, connectorToolName, createAgentActor } from "../src/index.ts"
import { fakeMcp, type FakeMcpOptions, GOOD_CODE } from "./fake-mcp.ts"

const REDIRECT = "https://app.example/api/connectors/callback"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  mcp: ReturnType<typeof fakeMcp>
}
const worlds: World[] = []

function open(directory: string, mcp: ReturnType<typeof fakeMcp>): World {
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  const models = createModels()
  models.setProvider(faux.provider)
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
        connectorFetch: mcp.fetch,
      }),
  })
  const world = { namespace, faux, mcp }
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

async function say(world: World, chatId: string, text: string): Promise<ChatState> {
  const before = (await call<ChatState>(world, `/chats/${chatId}`)).messages.length
  await call(world, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
  const deadline = Date.now() + 8_000
  for (;;) {
    const state = await call<ChatState>(world, `/chats/${chatId}`)
    if (!state.busy && state.messages.length > before + 1) return state
    if (Date.now() > deadline) throw new Error("run did not finish")
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

const lastTool = (state: ChatState) =>
  state.messages.flatMap((m) => m.parts).findLast((part): part is ToolPart => part.type === "tool")!
const useTool = (name: string, args: Record<string, number | string>) => [
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
  fauxAssistantMessage("done"),
]

async function setup(
  options: FakeMcpOptions = {},
  directory = mkdtempSync(join(tmpdir(), "dc-connectors-")),
) {
  const world = open(directory, fakeMcp(options))
  await call(world, "/init", "POST", { ownerId: "user-1" })
  const chat = await call<ChatSummary>(world, "/chats", "POST", {})
  return { world, chat, directory }
}

describe("connector tool names", () => {
  it("say which connector a tool is from, within what providers accept", () => {
    expect(connectorToolName("My Calendar!", "events.list")).toBe("my_calendar__events_list")
    expect(connectorToolName("x".repeat(80), "y".repeat(80)).length).toBe(64)
    expect(connectorToolName("???", "t")).toBe("service__t")
  })
})

describe("connectors", () => {
  it("connect to an MCP server and give the agent its tools", async () => {
    const { world, chat } = await setup()
    const { connector } = await add(world, { name: "Calculator", url: world.mcp.url })
    expect(connector).toMatchObject({
      name: "Calculator",
      status: "connected",
      enabled: true,
      error: null,
    })
    expect(connector.tools.map((tool) => tool.name)).toEqual(["add", "whoami", "always.fails"])

    let prompt = ""
    world.faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context)
        return fauxAssistantMessage([fauxToolCall("calculator__add", { a: 2, b: 40 })], {
          stopReason: "toolUse",
        })
      },
      fauxAssistantMessage("42."),
    ])
    const tool = lastTool(await say(world, chat.id, "what is 2 + 40?"))
    expect(prompt).toContain("[Calculator] Add two numbers")
    expect(tool).toMatchObject({ name: "calculator__add", status: "done", output: "42" })
    expect(world.mcp.calls).toEqual([{ tool: "add", args: { a: 2, b: 40 }, authorization: null }])
  })

  it("pass a tool's own failure to the agent as a failure", async () => {
    const { world, chat } = await setup()
    await add(world, { name: "Calculator", url: world.mcp.url })
    world.faux.setResponses(useTool("calculator__always_fails", {}))
    expect(lastTool(await say(world, chat.id, "try it"))).toMatchObject({
      status: "error",
      output: "It broke.",
    })
  })

  it("send a fixed token with every request, and keep it out of the agent's sight", async () => {
    const { world, chat } = await setup({ token: "s3cret-token" })
    const refused = await add(world, { name: "Private", url: world.mcp.url })
    expect(refused.connector.status).toBe("error")
    // Ids travel in URLs, where "12345678" or "1e234567" would come back as a number.
    expect(refused.connector.id).toMatch(/^c[0-9a-f]{8}$/)
    await call(world, `/connectors/${refused.connector.id}`, "DELETE")

    const { connector } = await add(world, {
      name: "Private",
      url: world.mcp.url,
      token: "s3cret-token",
    })
    expect(connector.status).toBe("connected")
    let prompt = ""
    world.faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context)
        return fauxAssistantMessage([fauxToolCall("private__whoami", {})], {
          stopReason: "toolUse",
        })
      },
      fauxAssistantMessage("done"),
    ])
    await say(world, chat.id, "who am I?")
    expect(world.mcp.calls.at(-1)?.authorization).toBe("Bearer s3cret-token")
    // Neither the prompt nor anything the app lists carries the token.
    expect(prompt).not.toContain("s3cret-token")
    expect(JSON.stringify(await call(world, "/connectors"))).not.toContain("s3cret-token")
    expect(JSON.stringify(await call(world, "/"))).not.toContain("s3cret-token")
  })

  it("send the user to sign in when the service asks for it, then connect with what comes back", async () => {
    const { world, chat } = await setup({ oauth: true })
    const pending = await add(world, { name: "Notes", url: world.mcp.url })
    expect(pending.connector.status).toBe("needs_auth")
    const authorization = new URL(pending.authorizationUrl!)
    expect(authorization.origin + authorization.pathname).toBe("https://auth.test/authorize")
    expect(authorization.searchParams.get("redirect_uri")).toBe(REDIRECT)
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256")
    // The state the service will echo back is what lets the gateway find this connector again.
    expect(pending.state).toBe(authorization.searchParams.get("state"))
    expect(pending.connector.tools).toEqual([])

    await expect(
      call(world, `/connectors/${pending.connector.id}/authorize`, "POST", { code: "wrong-code" }),
    ).rejects.toThrow("400: The sign-in could not be completed")

    const done = await call<ConnectorResult>(
      world,
      `/connectors/${pending.connector.id}/authorize`,
      "POST",
      {
        code: GOOD_CODE,
      },
    )
    expect(done.connector).toMatchObject({ status: "connected" })
    expect(done.connector.tools.length).toBe(3)

    world.faux.setResponses(useTool("notes__whoami", {}))
    expect(lastTool(await say(world, chat.id, "who am I there?")).output).toBe(
      "caller with Bearer access-token-1",
    )
  })

  it("sign in as an app registered by hand, where the service lets none register itself", async () => {
    const client = { id: "app-1", secret: "app-secret" }
    // Without the app's id there is nobody to sign in as.
    const { world: alone } = await setup({ oauth: true, client })
    expect((await add(alone, { name: "Notes", url: alone.mcp.url })).connector.status).toBe("error")

    const { world, chat } = await setup({ oauth: true, client })
    const pending = await add(world, {
      name: "Notes",
      url: world.mcp.url,
      clientId: client.id,
      clientSecret: client.secret,
    })
    expect(pending.connector.status).toBe("needs_auth")
    expect(new URL(pending.authorizationUrl!).searchParams.get("client_id")).toBe("app-1")
    expect(world.mcp.requests).not.toContain("POST https://auth.test/register")
    const done = await call<ConnectorResult>(
      world,
      `/connectors/${pending.connector.id}/authorize`,
      "POST",
      { code: GOOD_CODE },
    )
    expect(done.connector).toMatchObject({ status: "connected" })
    // Neither the id nor the secret is in what a client is told of the connector.
    expect(JSON.stringify(done)).not.toContain("app-secret")
    world.faux.setResponses(useTool("notes__whoami", {}))
    expect(lastTool(await say(world, chat.id, "who am I there?")).output).toBe(
      "caller with Bearer access-token-1",
    )
  })

  it("keep working after a restart without connecting again until a tool is used", async () => {
    const { world, directory } = await setup({ oauth: true })
    const pending = await add(world, { name: "Notes", url: world.mcp.url })
    await call(world, `/connectors/${pending.connector.id}/authorize`, "POST", { code: GOOD_CODE })
    await world.namespace.close()

    const mcp = fakeMcp({ oauth: true })
    const reopened = open(directory, mcp)
    const chat = await call<ChatSummary>(reopened, "/chats", "POST", {})
    let prompt = ""
    reopened.faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context)
        return fauxAssistantMessage("hello")
      },
    ])
    await say(reopened, chat.id, "hi")
    // The tools are offered from what was remembered; the service has not been contacted.
    expect(prompt).toContain("[Notes] Add two numbers")
    expect(mcp.requests).toEqual([])

    reopened.faux.setResponses(useTool("notes__add", { a: 1, b: 2 }))
    expect(lastTool(await say(reopened, chat.id, "add")).output).toBe("3")
    expect(mcp.calls.at(-1)?.authorization).toBe("Bearer access-token-1")
  })

  it("explain an unreachable service to the agent instead of failing the run", async () => {
    const { world, chat } = await setup()
    await add(world, { name: "Calculator", url: world.mcp.url })
    world.mcp.setDown(true)
    world.faux.setResponses(useTool("calculator__add", { a: 1, b: 1 }))
    const tool = lastTool(await say(world, chat.id, "add"))
    expect(tool.status).toBe("error")
    expect(tool.output).toContain("Calculator could not be reached")
    world.mcp.setDown(false)
    world.faux.setResponses(useTool("calculator__add", { a: 1, b: 1 }))
    expect(lastTool(await say(world, chat.id, "again")).output).toBe("2")
  })

  it("take a disabled or removed connector's tools away from the agent", async () => {
    const { world, chat } = await setup()
    const { connector } = await add(world, { name: "Calculator", url: world.mcp.url })
    await call(world, `/connectors/${connector.id}`, "PATCH", { enabled: false })
    let prompt = ""
    world.faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context)
        return fauxAssistantMessage("ok")
      },
    ])
    await say(world, chat.id, "hi")
    expect(prompt).not.toContain("calculator__add")

    await call(world, `/connectors/${connector.id}`, "PATCH", { enabled: true })
    await call(world, `/connectors/${connector.id}`, "DELETE")
    expect(await connectors(world)).toEqual([])
    await expect(call(world, `/connectors/${connector.id}`, "DELETE")).rejects.toThrow("400")
  })

  it("refuse what could not be a connector, and adding one from anywhere but the app", async () => {
    const { world } = await setup()
    await expect(add(world, { name: "Plain", url: "http://mcp.test/mcp" })).rejects.toThrow(
      "https://",
    )
    await expect(add(world, { name: "", url: world.mcp.url })).rejects.toThrow("name")
    await expect(add(world, { name: "Bad", url: "not a url" })).rejects.toThrow("not a URL")
    await add(world, { name: "Calculator", url: world.mcp.url })
    await expect(add(world, { name: "calculator", url: world.mcp.url })).rejects.toThrow(
      "already a connector",
    )
    await expect(
      call(world, "/connectors", "POST", { name: "Sneaky", url: world.mcp.url }),
    ).rejects.toThrow("only be connected from the app")
  })
})

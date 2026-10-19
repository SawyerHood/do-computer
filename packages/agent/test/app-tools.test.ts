import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  AgentActivity,
  ApprovalsState,
  ChatState,
  ChatSummary,
  ConnectorSummary,
  HistoryHit,
  ScheduleSummary,
  SecretRequest,
  ToolPart,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import type { Sandbox } from "@do-computer/sandbox"
import { createLocalProcessSandbox } from "@do-computer/sandbox/testing"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import {
  type AgentComputer,
  type AgentDirectory,
  APP_ORIGIN_HEADER,
  type ComputerChoices,
  type ComputerDirectory,
  createAgentActor,
  type PeerMessage,
} from "../src/index.ts"
import { fakeMcp, type FakeMcpOptions, GOOD_CODE } from "./fake-mcp.ts"

type Machine = AgentComputer & { id: string; mine?: boolean }

/** What stands in for the app: the machines of the workspace, and the agents in it. */
type Host = {
  machines: Machine[]
  /** What `add` was asked for, in order. */
  added: { kind?: string; name?: string; by?: string }[]
  removed: string[]
  created: { name: string; tagline?: string; personality?: string; by?: string }[]
  sent: { to: string; message: PeerMessage }[]
}

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  mcp: ReturnType<typeof fakeMcp>
  host: Host
  /** The machine behind a kind and key, as a provider would have it. */
  machine: (kind: string, key: string) => Sandbox
  /** Everything `onActivity` was told, in the order it was told. */
  activity: ({ agentId: string } & AgentActivity)[]
}
const worlds: World[] = []
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

type Setup = {
  mcp?: FakeMcpOptions
  /** Whether the app's address is set for the agent. Default: it is. */
  appUrl?: boolean
  /** Whether a host says which machines there are, and lets the agent add them. */
  hosted?: boolean
}

function open(setup: Setup = {}): World {
  const directory = mkdtempSync(join(tmpdir(), "dc-app-tools-"))
  const faux = fauxProvider({
    provider: "test",
    models: [{ id: "model" }, { id: "big" }],
    tokensPerSecond: 50_000,
  })
  const models = createModels()
  models.setProvider(faux.provider)
  const mcp = fakeMcp(setup.mcp)
  const real = new Map<string, Sandbox>()
  const machine = (kind: string, key: string) => {
    const name = `${kind}:${key}`
    if (!real.has(name)) real.set(name, createLocalProcessSandbox())
    return real.get(name)!
  }
  const host: Host = { machines: [], added: [], removed: [], created: [], sent: [] }
  const computers: ComputerChoices = {
    kinds: [
      { id: "real", label: "Real", description: "A full Linux machine." },
      { id: "none", label: "None", description: "No computer." },
    ],
    default: "real",
    create: (kind, key) => (kind === "real" ? machine(kind, key) : undefined),
  }
  const computerDirectory: ComputerDirectory = {
    allowed: async (_agentId, id) => host.machines.some((one) => one.id === id),
    list: async () =>
      host.machines.map((one) => ({
        id: one.id,
        name: one.name,
        owner: "Ada",
        team: false,
        platform: "linux",
        kind: one.kind!,
        readOnly: false,
        online: true,
        connected: true,
        asked: false,
        ...(one.mine === true ? { mine: true } : {}),
      })),
    request: async () => undefined,
    machines: async () => host.machines.map(({ mine: _mine, ...one }) => one),
    kinds: async () => [{ id: "real", label: "Real", description: "A full Linux machine." }],
    add: async (_agentId, input) => {
      host.added.push(input)
      if (host.machines.length >= 2) return { error: "The workspace already has 2 machines." }
      const id = `m${host.machines.length + 1}`
      const name = input.name ?? "computer"
      host.machines.push({
        id,
        name,
        kind: input.kind ?? "real",
        machineKey: id,
        platform: "linux",
        hostname: "",
        home: machine("real", id).home,
        readOnly: false,
        pairedAt: 1,
        mine: true,
      })
      return { id, name, kind: input.kind ?? "real" }
    },
    remove: async (_agentId, computerId) => {
      host.removed.push(computerId)
      host.machines = host.machines.filter((one) => one.id !== computerId)
      return { ok: true }
    },
  }
  const agentDirectory: AgentDirectory = {
    list: async () =>
      host.created.map((made, index) => ({
        id: `new-${index + 1}`,
        ...made,
        tagline: made.tagline ?? null,
      })),
    send: async (_agentId, to, message) => {
      host.sent.push({ to, message })
      return { threadId: "77" }
    },
    reply: async () => true,
    create: async (_agentId, input) => {
      if (host.created.length >= 2) return { error: "The workspace already has 20 agents." }
      host.created.push(input)
      return { id: `new-${host.created.length}`, name: input.name }
    },
  }
  const activity: World["activity"] = []
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (actorHost) =>
      createAgentActor(actorHost, {
        onActivity: (change) => activity.push(change),
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 1, outputCost: 2 },
          {
            id: "test/big",
            name: "Big",
            reasoning: true,
            thinking: ["low", "high"],
            inputCost: 10,
            outputCost: 20,
            recommended: true,
          },
        ],
        keepAliveMs: 100,
        ...(setup.hosted === true
          ? { computers, computerDirectory }
          : { sandbox: () => machine("own", actorHost.name) }),
        agentDirectory,
        connectorFetch: mcp.fetch,
        ...(setup.appUrl === false ? {} : { appUrl: "https://app.test" }),
      }),
  })
  namespace.start()
  const world = { namespace, faux, mcp, host, machine, activity }
  worlds.push(world)
  return world
}

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
  return call<ChatSummary>(world, "/chats", "POST", { title: "Chores" })
}

type ToolArguments = Parameters<typeof fauxToolCall>[1]
const useTool = (name: string, args: ToolArguments, then = "Done.") => [
  // A connector's tool, named `<connector>__<tool>`, is not offered until it has been looked for.
  ...(name.includes("__")
    ? [
        fauxAssistantMessage([fauxToolCall("tool_search", { query: name })], {
          stopReason: "toolUse",
        }),
      ]
    : []),
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
  fauxAssistantMessage(then),
]
const tools = (state: ChatState) =>
  state.messages.flatMap((m) => m.parts).filter((p): p is ToolPart => p.type === "tool")
const last = (state: ChatState) => tools(state).at(-1)!
const notices = (state: ChatState) =>
  state.messages.flatMap((m) => m.parts).filter((p) => p.type === "notice")

/** Use a tool that asks first, and say yes to it once. Resolves with the chat afterwards. */
async function allowed(
  world: World,
  chatId: string,
  name: string,
  args: ToolArguments,
): Promise<ChatState> {
  world.faux.setResponses(useTool(name, args, "May I?"))
  const asked = await say(world, chatId, "go")
  expect(last(asked).output).toContain("needs the user's approval first")
  const { pending } = await call<ApprovalsState>(world, "/approvals")
  world.faux.setResponses(useTool(name, args))
  await call(world, `/approvals/${pending.at(-1)!.id}`, "POST", { decision: "once" })
  return settled(world, chatId)
}

/** Everything the agent could have read: every chat as a client sees it, and what search finds. */
async function everythingSaid(world: World, needle: string): Promise<string> {
  const { chats } = await call<{ chats: ChatSummary[] }>(world, "/")
  const states = await Promise.all(chats.map((chat) => call<ChatState>(world, `/chats/${chat.id}`)))
  const { hits } = await call<{ hits: HistoryHit[] }>(
    world,
    `/search?q=${encodeURIComponent(needle)}`,
  )
  return JSON.stringify([states, hits])
}

describe("abilities that ask first", () => {
  it("are asked about until someone says otherwise, and can be allowed for good", async () => {
    const world = open({ hosted: true })
    const chat = await setup(world)
    const initial = await call<ApprovalsState>(world, "/approvals")
    expect(initial.rules).toEqual({
      "tool:machines": "ask",
      "tool:connectors_change": "ask",
      "tool:share_public": "ask",
      "tool:settings_change": "ask",
      "tool:agents_create": "ask",
    })
    // Removing a machine is asked about every time, so there is no rule to set for it.
    expect(initial.subjects.map((subject) => subject.id)).not.toContain("tool:machines_remove")
    await expect(
      call(world, "/approvals/rules", "PATCH", { "tool:machines_remove": "allow" }),
    ).rejects.toThrow(/asked about every time/)

    world.faux.setResponses(useTool("computers", { action: "add", name: "builder" }, "May I?"))
    const asked = await say(world, chat.id, "we need a build box")
    expect(last(asked).status).toBe("error")
    expect(world.host.added).toEqual([])
    const { pending } = await call<ApprovalsState>(world, "/approvals")
    expect(pending).toMatchObject([{ title: "Add a machine to the workspace", detail: "builder" }])
    expect(pending[0]!.onceOnly).toBeUndefined()

    world.faux.setResponses(useTool("computers", { action: "add", name: "builder" }))
    await call(world, `/approvals/${pending[0]!.id}`, "POST", { decision: "always" })
    const after = await settled(world, chat.id)
    expect(last(after)).toMatchObject({ status: "done" })
    expect(last(after).output).toContain('Added the machine "builder"')
    // Allowed from here on, which is said outright since the default would ask again.
    const rules = (await call<ApprovalsState>(world, "/approvals")).rules
    expect(rules["tool:machines"]).toBeUndefined()
    expect(rules["tool:connectors_change"]).toBe("ask")

    world.faux.setResponses(useTool("computers", { action: "add", name: "second" }))
    expect(last(await say(world, chat.id, "another")).status).toBe("done")
    expect(world.host.added.map((one) => one.name)).toEqual(["builder", "second"])

    // And put back to asking.
    await call(world, "/approvals/rules", "PATCH", { "tool:machines": "ask" })
    expect((await call<ApprovalsState>(world, "/approvals")).rules["tool:machines"]).toBe("ask")
  })

  it("leave looking alone", async () => {
    const world = open({ hosted: true })
    const chat = await setup(world)
    for (const [name, args] of [
      ["computers", { action: "list" }],
      ["connectors", { action: "list" }],
      ["settings", { action: "get" }],
      ["agents", { action: "list" }],
    ] as const) {
      world.faux.setResponses(useTool(name, args))
      expect(last(await say(world, chat.id, "look")).status, name).toBe("done")
    }
    expect((await call<ApprovalsState>(world, "/approvals")).pending).toEqual([])
  })
})

describe("the computers tool", () => {
  it("adds a machine the agent can then work on, in the name of whoever it is working for", async () => {
    const world = open({ hosted: true })
    const chat = await setup(world)
    world.faux.setResponses(useTool("computers", { action: "list" }))
    expect(last(await say(world, chat.id, "what is there?")).output).toContain(
      'Kinds of machine you can add with "add": real (Real: A full Linux machine.)',
    )

    await call(
      world,
      `/chats/${chat.id}/messages`,
      "POST",
      { text: "hello", requestId: "r1" },
      { "x-dc-caller": encodeURIComponent(JSON.stringify({ id: "user-7", name: "Grace" })) },
    )
    world.faux.setResponses([fauxAssistantMessage("Hello.")])
    await settled(world, chat.id)
    const state = await allowed(world, chat.id, "computers", { action: "add", name: "builder" })
    expect(last(state).details).toMatchObject({ computerId: "m1", name: "builder", kind: "real" })
    // The machine is added for the person who is speaking, not for whoever made the agent.
    expect(world.host.added).toEqual([{ name: "builder", by: "user-7" }])

    world.faux.setResponses(useTool("bash", { command: "echo on-it", computer: "builder" }))
    expect(last(await say(world, chat.id, "use it"))).toMatchObject({
      status: "done",
      output: "on-it\n",
    })
  })

  it("says why a machine could not be added", async () => {
    const world = open({ hosted: true })
    const chat = await setup(world)
    await call(world, "/approvals/rules", "PATCH", { "tool:machines": "allow" })
    world.faux.setResponses(useTool("computers", { action: "add", kind: "huge" }))
    expect(last(await say(world, chat.id, "go")).output).toContain(
      'There is no kind of machine "huge". The kinds that can be added: real (Real).',
    )
    for (const name of ["one", "two"]) {
      world.faux.setResponses(useTool("computers", { action: "add", name }))
      await say(world, chat.id, "go")
    }
    world.faux.setResponses(useTool("computers", { action: "add", name: "three" }))
    const full = last(await say(world, chat.id, "go"))
    expect(full.status).toBe("error")
    expect(full.output).toBe("The workspace already has 2 machines.")
  })

  it("removes only a machine it added, and asks every time", async () => {
    const world = open({ hosted: true })
    const chat = await setup(world)
    await call(world, "/approvals/rules", "PATCH", { "tool:machines": "allow" })
    world.host.machines.push({
      id: "theirs",
      name: "shared",
      kind: "real",
      machineKey: "theirs",
      platform: "linux",
      hostname: "",
      home: world.machine("real", "theirs").home,
      readOnly: false,
      pairedAt: 1,
    })
    world.faux.setResponses(useTool("computers", { action: "add", name: "scratch" }))
    await say(world, chat.id, "add one")

    world.faux.setResponses(useTool("computers", { action: "remove", name: "scratch" }, "May I?"))
    const asked = await say(world, chat.id, "remove it")
    expect(last(asked).output).toContain("needs the user's approval first")
    const { pending } = await call<ApprovalsState>(world, "/approvals")
    expect(pending).toMatchObject([
      { title: "Delete the machine scratch, with everything on it", onceOnly: true },
    ])
    // "Always" is not an answer here: it lets this one through and nothing more.
    world.faux.setResponses(useTool("computers", { action: "remove", name: "scratch" }))
    await call(world, `/approvals/${pending[0]!.id}`, "POST", { decision: "always" })
    expect(last(await settled(world, chat.id)).output).toContain('Deleted the machine "scratch"')
    expect(world.host.removed).toEqual(["m2"])

    const state = await allowed(world, chat.id, "computers", { action: "remove", name: "shared" })
    expect(last(state).status).toBe("error")
    expect(last(state).output).toContain("You can only remove a machine you added")
    expect(world.host.removed).toEqual(["m2"])
  })

  it("tells a person how to connect a computer of their own", async () => {
    const world = open({ hosted: true })
    const chat = await setup(world)
    world.faux.setResponses(useTool("computers", { action: "connect_own" }))
    expect(last(await say(world, chat.id, "how do I add my laptop?")).output).toContain(
      "curl -fsSL https://app.test/install.sh | sh",
    )
  })
})

describe("the connectors tool", () => {
  it("adds a connector whose tools are then the agent's", async () => {
    const world = open()
    const chat = await setup(world)
    const state = await allowed(world, chat.id, "connectors", {
      action: "add",
      name: "Sums",
      url: "https://mcp.test/mcp",
    })
    expect(last(state).output).toContain(
      'Added the connector "Sums". It is connected and offers 3 tools',
    )
    expect(last(state).details).toMatchObject({ name: "Sums", status: "connected" })

    world.faux.setResponses(useTool("sums__add", { a: 2, b: 3 }))
    expect(last(await say(world, chat.id, "add them"))).toMatchObject({ status: "done" })
    expect(world.mcp.calls.at(-1)).toMatchObject({ tool: "add", args: { a: 2, b: 3 } })

    world.faux.setResponses(useTool("connectors", { action: "list" }))
    expect(last(await say(world, chat.id, "list")).output).toMatch(
      /- Sums \(id c\w+, https:\/\/mcp\.test\/mcp\): connected, 3 tools\. Tools: sums__add/,
    )
  })

  it("has the person sign in where the service asks, and tells the agent when they have", async () => {
    const world = open({ mcp: { oauth: true } })
    const chat = await setup(world)
    const state = await allowed(world, chat.id, "connectors", {
      action: "add",
      name: "Sums",
      url: "https://mcp.test/mcp",
    })
    expect(last(state).output).toContain("needs the person to sign in")
    const [waiting] = (await call<{ connectors: ConnectorSummary[] }>(world, "/connectors"))
      .connectors
    expect(waiting).toMatchObject({ name: "Sums", status: "needs_auth", askedIn: chat.id })

    // The person presses Sign in, which the app does for them, and comes back with a code.
    await call(world, `/connectors/${waiting!.id}/connect`, "POST", undefined, {
      "x-dc-connector-redirect": "https://app.test/api/connectors/callback",
    })
    world.faux.setResponses([fauxAssistantMessage("Sums is connected.")])
    const result = await call<{ chatId?: string; turn?: unknown }>(
      world,
      `/connectors/${waiting!.id}/authorize`,
      "POST",
      { code: GOOD_CODE },
    )
    expect(result.chatId).toBe(chat.id)
    expect(result.turn).toBeUndefined()
    const after = await settled(world, chat.id)
    expect(notices(after).at(-1)).toMatchObject({ kind: "connector", text: "Sums", approved: true })
    const [connected] = (await call<{ connectors: ConnectorSummary[] }>(world, "/connectors"))
      .connectors
    expect(connected).toMatchObject({ status: "connected" })
    expect(connected!.askedIn).toBeUndefined()
  })

  it("tells the agent when the person chooses not to sign in", async () => {
    const world = open({ mcp: { oauth: true } })
    const chat = await setup(world)
    await allowed(world, chat.id, "connectors", {
      action: "add",
      name: "Sums",
      url: "https://mcp.test/mcp",
    })
    const [waiting] = (await call<{ connectors: ConnectorSummary[] }>(world, "/connectors"))
      .connectors
    world.faux.setResponses([fauxAssistantMessage("Then I will do without.")])
    await call(world, `/connectors/${waiting!.id}/dismiss`, "POST")
    const after = await settled(world, chat.id)
    expect(notices(after).at(-1)).toMatchObject({ kind: "connector", approved: false })
    const [left] = (await call<{ connectors: ConnectorSummary[] }>(world, "/connectors")).connectors
    expect(left).toMatchObject({ status: "needs_auth" })
    expect(left!.askedIn).toBeUndefined()
  })

  it("asks for an access token in a form, and never sees it", async () => {
    const token = "tok-9f8e7d6c5b4a"
    const world = open({ mcp: { token } })
    const chat = await setup(world)
    const state = await allowed(world, chat.id, "connectors", {
      action: "add",
      name: "Sums",
      url: "https://mcp.test/mcp",
      needs_token: true,
    })
    expect(last(state).output).toContain("Asked the person for the access token")
    expect(
      (await call<{ connectors: ConnectorSummary[] }>(world, "/connectors")).connectors,
    ).toEqual([])
    const { requests } = await call<{ requests: SecretRequest[] }>(world, "/secrets")
    expect(requests).toMatchObject([
      {
        chatId: chat.id,
        fields: [{ name: "ACCESS_TOKEN" }],
        destination: { kind: "connector", name: "Sums", url: "https://mcp.test/mcp" },
      },
    ])

    world.faux.setResponses([fauxAssistantMessage("Sums is ready.")])
    await call(world, `/secrets/${requests[0]!.id}`, "POST", { values: { ACCESS_TOKEN: token } })
    const after = await settled(world, chat.id)
    expect(notices(after).at(-1)).toMatchObject({
      kind: "secret",
      text: "the connector Sums",
      detail: "its access token",
      approved: true,
    })
    const { connectors } = await call<{ connectors: ConnectorSummary[] }>(world, "/connectors")
    expect(connectors).toMatchObject([{ name: "Sums", status: "connected" }])
    expect(JSON.stringify(connectors)).not.toContain(token)
    expect(await everythingSaid(world, token)).not.toContain(token)

    world.faux.setResponses(useTool("sums__whoami", {}))
    await say(world, chat.id, "who am I?")
    expect(world.mcp.calls.at(-1)).toMatchObject({ authorization: `Bearer ${token}` })
  })

  it("turns a connector off and on, and removes it", async () => {
    const world = open()
    const chat = await setup(world)
    await call(world, "/approvals/rules", "PATCH", { "tool:connectors_change": "allow" })
    world.faux.setResponses(
      useTool("connectors", { action: "add", name: "Sums", url: "https://mcp.test/mcp" }),
    )
    await say(world, chat.id, "add")
    world.faux.setResponses(useTool("connectors", { action: "disable", name: "sums" }))
    expect(last(await say(world, chat.id, "off")).output).toContain('Turned off "Sums"')
    world.faux.setResponses(useTool("sums__add", { a: 1, b: 1 }))
    expect(last(await say(world, chat.id, "try")).status).toBe("error")
    world.faux.setResponses(useTool("connectors", { action: "enable", name: "Sums" }))
    expect(last(await say(world, chat.id, "on")).output).toContain("connected, 3 tools")
    world.faux.setResponses(useTool("connectors", { action: "remove", name: "Sums" }))
    expect(last(await say(world, chat.id, "remove")).output).toContain("Removed the connector")
    expect(
      (await call<{ connectors: ConnectorSummary[] }>(world, "/connectors")).connectors,
    ).toEqual([])
  })

  it("cannot add one where the app's address is not known, until its gateway says", async () => {
    const world = open({ appUrl: false })
    const chat = await setup(world)
    await call(world, "/approvals/rules", "PATCH", { "tool:connectors_change": "allow" })
    const add = { action: "add", name: "Sums", url: "https://mcp.test/mcp" }
    world.faux.setResponses(useTool("connectors", add))
    expect(last(await say(world, chat.id, "add")).output).toContain(
      "the address of the app is not known",
    )
    await call(world, "/", "GET", undefined, { [APP_ORIGIN_HEADER]: "https://elsewhere.test" })
    world.faux.setResponses(useTool("connectors", add))
    expect(last(await say(world, chat.id, "add")).output).toContain("It is connected")
  })
})

describe("the request_secret tool", () => {
  const ask: ToolArguments = {
    secrets: [
      { name: "OPENAI_API_KEY", description: "From platform.openai.com" },
      { name: "RESEND_API_KEY" },
    ],
    purpose: "To send the weekly email",
  }

  it("has the person type secrets into a form, saves them to a file, and never sees them", async () => {
    const world = open()
    const chat = await setup(world)
    const home = world.machine("own", "agent-1").home
    writeFileSync(join(home, ".env"), "# keys\nPORT=3000\nRESEND_API_KEY=old # rotate me\n")

    world.faux.setResponses(useTool("request_secret", ask, "I have asked for the keys."))
    const asked = await say(world, chat.id, "set up the email")
    expect(last(asked).status).toBe("done")
    expect(last(asked).output).toContain(`saved to ${home}/.env`)
    const { requests } = await call<{ requests: SecretRequest[] }>(world, "/secrets")
    expect(requests).toMatchObject([
      {
        chatId: chat.id,
        purpose: "To send the weekly email",
        fields: [
          { name: "OPENAI_API_KEY", description: "From platform.openai.com" },
          { name: "RESEND_API_KEY", description: null },
        ],
        destination: { kind: "dotenv", computer: "computer", path: `${home}/.env` },
      },
    ])

    // Asking again for the same things is the same question.
    world.faux.setResponses(useTool("request_secret", ask))
    expect(last(await say(world, chat.id, "ask again")).output).toContain("already asked")
    expect((await call<{ requests: SecretRequest[] }>(world, "/secrets")).requests.length).toBe(1)

    const values = { OPENAI_API_KEY: "sk-live-4242 it's secret", RESEND_API_KEY: "re_9999" }
    await expect(
      call(world, `/secrets/${requests[0]!.id}`, "POST", { values: { OPENAI_API_KEY: "x" } }),
    ).rejects.toThrow(/Give a value for RESEND_API_KEY/)
    await expect(
      call(world, `/secrets/${requests[0]!.id}`, "POST", {
        values: { ...values, RESEND_API_KEY: "two\nlines" },
      }),
    ).rejects.toThrow(/one line/)

    world.faux.setResponses([fauxAssistantMessage("The keys are in place.")])
    await call(world, `/secrets/${requests[0]!.id}`, "POST", { values })
    const after = await settled(world, chat.id)
    expect(notices(after).at(-1)).toMatchObject({
      kind: "secret",
      text: `${home}/.env`,
      approved: true,
      detail: "OPENAI_API_KEY, RESEND_API_KEY",
    })
    expect(readFileSync(join(home, ".env"), "utf8")).toBe(
      `# keys\nPORT=3000\nRESEND_API_KEY='re_9999' # rotate me\nOPENAI_API_KEY="sk-live-4242 it's secret"\n`,
    )
    expect(statSync(join(home, ".env")).mode & 0o777).toBe(0o600)
    expect((await call<{ requests: SecretRequest[] }>(world, "/secrets")).requests).toEqual([])
    await expect(call(world, `/secrets/${requests[0]!.id}`, "POST", { values })).rejects.toThrow(
      /already been answered/,
    )
    // Nothing that was typed is anywhere the agent reads.
    const everything = await everythingSaid(world, "re_9999")
    expect(everything).not.toContain("sk-live-4242")
    expect(everything).not.toContain("re_9999")
  })

  it("tells the agent when the person says no", async () => {
    const world = open()
    const chat = await setup(world)
    world.faux.setResponses(useTool("request_secret", ask))
    await say(world, chat.id, "set up")
    const { requests } = await call<{ requests: SecretRequest[] }>(world, "/secrets")
    // The agent said that it is waiting on someone, with what it asked for.
    const asking = world.activity.findLast((told) => told.asking)
    expect(asking).toMatchObject({ latest: { kind: "asked", chatId: chat.id } })
    world.faux.setResponses([fauxAssistantMessage("Then I will leave the email for now.")])
    const declined = world.activity.length
    await call(world, `/secrets/${requests[0]!.id}/decline`, "POST")
    const after = await settled(world, chat.id)
    expect(notices(after).at(-1)).toMatchObject({ kind: "secret", approved: false })
    expect((await call<{ requests: SecretRequest[] }>(world, "/secrets")).requests).toEqual([])
    // And that it no longer is, from the moment the person said no.
    const since = world.activity.slice(declined)
    expect(since.length).toBeGreaterThan(0)
    expect(since.every((told) => !told.asking)).toBe(true)
  })

  it("refuses names that are not variables, and a file in the library", async () => {
    const world = open()
    const chat = await setup(world)
    world.faux.setResponses(useTool("request_secret", { secrets: [{ name: "my key" }] }))
    expect(last(await say(world, chat.id, "go")).output).toContain("cannot be a secret's name")
    world.faux.setResponses(
      useTool("request_secret", { secrets: [{ name: "KEY" }], path: "~/library/keys.env" }),
    )
    expect(last(await say(world, chat.id, "go")).output).toContain("is in the library")
    expect((await call<{ requests: SecretRequest[] }>(world, "/secrets")).requests).toEqual([])
  })
})

describe("the schedule tool", () => {
  it("runs a task now, and changes the timezone it is read in", async () => {
    const world = open()
    const chat = await setup(world)
    world.faux.setResponses(
      useTool("schedule", {
        action: "create",
        schedule: "0 9 * * *",
        prompt: "Say hi",
        title: "Hi",
      }),
    )
    await say(world, chat.id, "every morning")
    const [made] = (await call<{ schedules: ScheduleSummary[] }>(world, "/schedules")).schedules
    world.faux.setResponses(
      useTool("schedule", { action: "update", id: made!.id, timezone: "Asia/Tokyo" }),
    )
    await say(world, chat.id, "in Tokyo")
    const [moved] = (await call<{ schedules: ScheduleSummary[] }>(world, "/schedules")).schedules
    expect(moved!.timezone).toBe("Asia/Tokyo")
    expect(moved!.nextRunAt).not.toBe(made!.nextRunAt)
    world.faux.setResponses(
      useTool("schedule", { action: "update", id: made!.id, timezone: "Mars/Olympus" }),
    )
    expect(last(await say(world, chat.id, "on Mars")).output).toContain("is not an IANA timezone")

    world.faux.setResponses([
      fauxAssistantMessage([fauxToolCall("schedule", { action: "run", id: made!.id })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Hi there."),
      fauxAssistantMessage("Started it."),
      fauxAssistantMessage("Noted."),
    ])
    const ran = await say(world, chat.id, "try it now")
    expect(last(ran).output).toContain("Started a run of schedule")
    for (let attempt = 0; attempt < 800; attempt++) {
      const [now] = (await call<{ schedules: ScheduleSummary[] }>(world, "/schedules")).schedules
      if (now!.runCount === 1 && now!.lastRun !== null) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(
      `The schedule did not run: ${JSON.stringify((await call<{ schedules: ScheduleSummary[] }>(world, "/schedules")).schedules)}`,
    )
  })
})

describe("the settings tool", () => {
  it("shows the agent its settings and cost, and changes them when allowed", async () => {
    const world = open()
    const chat = await setup(world)
    world.faux.setResponses(useTool("settings", { action: "get" }))
    const shown = last(await say(world, chat.id, "what are you running on?")).output!
    expect(shown).toContain("Model: test/model (Test; $1 in and $2 out per million tokens)")
    expect(shown).toContain("Thinking: medium")
    expect(shown).toContain("Cost so far:")
    expect(shown).toContain(
      "- test/big (Big; $10 in and $20 out per million tokens; thinking: low, high)",
    )

    const state = await allowed(world, chat.id, "settings", {
      action: "set",
      model: "test/big",
      thinking: "high",
      timezone: "Europe/Paris",
    })
    expect(last(state).output).toContain(
      "Saved. Model: test/big. Thinking: high. Timezone: Europe/Paris.",
    )
    const agent = await call<{
      agent: { model: string; thinking: string }
      timezone: string
    }>(world, "/")
    expect(agent).toMatchObject({
      agent: { model: "test/big", thinking: "high" },
      timezone: "Europe/Paris",
    })

    await call(world, "/approvals/rules", "PATCH", { "tool:settings_change": "allow" })
    world.faux.setResponses(useTool("settings", { action: "set", model: "test/huge" }))
    const wrong = last(await say(world, chat.id, "bigger"))
    expect(wrong.status).toBe("error")
    expect(wrong.output).toContain('Unknown model "test/huge"')
  })
})

describe("the agents tool", () => {
  it("makes a new agent with a name and character, and gives it its first task", async () => {
    const world = open()
    const chat = await setup(world)
    const state = await allowed(world, chat.id, "agents", {
      action: "create",
      name: "Scout",
      tagline: "Keeps an eye on the news",
      personality: "You are brief.",
      message: "Find today's headlines.",
    })
    expect(last(state).output).toContain('Made the agent "Scout" (id new-1)')
    expect(last(state).output).toContain("Your message was sent to it")
    expect(world.host.created).toEqual([
      {
        name: "Scout",
        tagline: "Keeps an eye on the news",
        personality: "You are brief.",
        by: "user-1",
      },
    ])
    expect(world.host.sent).toMatchObject([
      { to: "new-1", message: { chatId: chat.id, text: "Find today's headlines." } },
    ])

    await call(world, "/approvals/rules", "PATCH", { "tool:agents_create": "allow" })
    world.faux.setResponses(useTool("agents", { action: "create", name: "scout" }))
    expect(last(await say(world, chat.id, "again")).output).toContain("already an agent called")
  })
})

describe("what the agent is told about the app", () => {
  it("can only change the app from a conversation with a person", async () => {
    const world = open({ hosted: true })
    const chat = await setup(world)
    // Two conversations answer at once here, so each reply is chosen by what it is a reply to.
    const step = (context: { messages: unknown[] }) => {
      const seen = JSON.stringify(context.messages)
      if (!seen.includes("delegate it")) {
        return seen.includes("cannot do this")
          ? fauxAssistantMessage("I could not.")
          : fauxAssistantMessage([fauxToolCall("computers", { action: "add", name: "sneaky" })], {
              stopReason: "toolUse",
            })
      }
      return seen.includes("Started sub-agent")
        ? fauxAssistantMessage("Started.")
        : fauxAssistantMessage(
            [fauxToolCall("subagent", { action: "start", task: "Add a machine", title: "Adder" })],
            { stopReason: "toolUse" },
          )
    }
    world.faux.setResponses(Array.from({ length: 8 }, () => step))
    await say(world, chat.id, "delegate it")
    for (let attempt = 0; attempt < 300; attempt++) {
      const { chats } = await call<{ chats: ChatSummary[] }>(world, "/")
      const sub = chats.find((one) => one.kind === "subagent")
      if (sub?.status === "done") {
        const state = await call<ChatState>(world, `/chats/${sub.id}`)
        expect(last(state).status).toBe("error")
        expect(last(state).output).toContain("A sub-agent cannot do this")
        expect(world.host.added).toEqual([])
        expect((await call<ApprovalsState>(world, "/approvals")).pending).toEqual([])
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error("The sub-agent did not finish")
  })
})

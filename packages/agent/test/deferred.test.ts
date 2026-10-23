import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChatState, ChatSummary, ToolPart } from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { getCurrentTools, Type, type Context as ModelContext } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { defineExtension, defineTool, type JsonObject } from "@earendil-works/pi-durable"
import { afterEach, describe, expect, it } from "vitest"
import { calledIn, LOAD_TOOLS, summaryOf, withLoaded } from "../src/deferred.ts"
import { createAgentActor, createAgentModels, ECHO_MODEL } from "../src/index.ts"
import { quietOnReminder, sent } from "./quiet.ts"

describe("naming a deferred tool", () => {
  it("is its description to the first sentence, kept to one short line", () => {
    expect(summaryOf('Load and manage skills. "view" loads one.')).toBe("Load and manage skills")
    expect(summaryOf("Pin a page: `pin` one")).toBe("Pin a page")
    const long = summaryOf(`Do ${"many things ".repeat(20)}now.`)
    expect(long.length).toBeLessThanOrEqual(110)
    expect(long.endsWith("…")).toBe(true)
  })

  it("finds what a transcript called, and loads it beside what was loaded", () => {
    const messages = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          { type: "toolCall", name: "schedule" },
          { type: "toolCall", name: "bash" },
        ],
      },
      { role: "assistant", content: [{ type: "toolCall", name: "visual" }] },
    ]
    expect(calledIn(messages, new Set(["visual", "schedule", "pin"]))).toEqual([
      "schedule",
      "visual",
    ])
    expect(withLoaded(undefined, ["visual"])).toEqual({ add: ["visual"] })
    expect(withLoaded({ add: ["pin"], remove: ["x"] }, ["visual", "pin"])).toEqual({
      add: ["pin", "visual"],
      remove: ["x"],
    })
  })
})

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof quietOnReminder<ReturnType<typeof fauxProvider>>>
  errors: unknown[]
}

const worlds: World[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

const temporary = () => mkdtempSync(join(tmpdir(), "dc-deferred-"))

/** Whether the test's own tool is deferred, as of the next time the agent is opened. */
let greetDeferred = false

const greeter = defineExtension({
  name: "test.greet",
  get tools() {
    return [
      defineTool({
        name: "greet",
        description: "Greet someone.",
        parameters: Type.Object({ name: Type.String() }),
        ...(greetDeferred ? { deferred: true as const } : {}),
        execute: async (args) => ({ output: [{ type: "text", text: `Hello, ${args.name}` }] }),
      }),
    ]
  },
})

function open(directory: string, model: "test" | "echo" = "test"): World {
  const faux = quietOnReminder(
    fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 }),
  )
  // The deployment's own models, with only the echo model in them, and the scripted one beside.
  const scripted = createModels()
  scripted.setProvider(faux.provider)
  const models = model === "echo" ? createAgentModels({}).models : scripted
  const errors: unknown[] = []
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: model === "echo" ? ECHO_MODEL : "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
          { id: ECHO_MODEL, name: "Echo", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        extensions: [greeter],
        keepAliveMs: 60_000,
        onReport: (error) => errors.push(error),
      }),
    onError: (error) => errors.push(error),
  })
  namespace.start()
  const world = { namespace, faux, errors }
  worlds.push(world)
  return world
}

async function call<T>(world: World, path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await world.namespace.get("agent-1").fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
    }),
  )
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`)
  return result
}

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 10_000,
): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error(`Timed out; last value: ${JSON.stringify(value)}`)
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}

async function setup(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  return call<ChatSummary>(world, "/chats/main", "POST", {})
}

const chatState = (world: World, chatId: string) => call<ChatState>(world, `/chats/${chatId}`)
const tools = (state: ChatState) =>
  state.messages.flatMap((message) =>
    message.parts.filter((part): part is ToolPart => part.type === "tool"),
  )

/** Say `text` in a chat and wait until it is at rest with `answered` said. */
async function say(world: World, chatId: string, text: string, answered: string) {
  await call(world, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
  return until(
    () => chatState(world, chatId),
    (state) => !state.busy && JSON.stringify(state.messages).includes(answered),
  )
}

type Sent = { role: string }
/** The tools a request offers, in order, as its system messages leave them. */
const offered = (context: ModelContext) =>
  getCurrentTools(context.messages).map((tool) => tool.name)
/** What a request says of its prompt: its system messages, the first and what changed since. */
const promptOf = (context: ModelContext) =>
  JSON.stringify(context.messages.filter((message) => (message as Sent).role === "system"))
const use = (name: string, args: JsonObject) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" })

describe("deferred tools in a chat", () => {
  it("are named in the prompt, loaded on asking, and kept for the chat", async () => {
    greetDeferred = false
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses([
      use(LOAD_TOOLS, { names: ["schedule", "nothing"] }),
      sent("Loaded."),
      use(LOAD_TOOLS, { names: ["schedule"] }),
      sent("Again."),
    ])
    await say(world, chat.id, "load it", "Loaded.")
    const [first, second] = world.faux.requests as [ModelContext, ModelContext]
    expect(offered(first)).toContain(LOAD_TOOLS)
    expect(offered(first)).not.toContain("schedule")
    expect(offered(first)).not.toContain("visual")
    expect(promptOf(first)).toContain("- schedule: ")
    expect(promptOf(first)).toContain("- visual: ")
    // Offered from the next request on, after the tools the cache already holds.
    expect(offered(second).slice(0, offered(first).length)).toEqual(offered(first))
    expect(offered(second)).toContain("schedule")
    expect(offered(second)).not.toContain("visual")
    const [loaded] = tools(await chatState(world, chat.id))
    expect(loaded).toMatchObject({ name: LOAD_TOOLS, status: "done" })
    expect(loaded!.output).toContain("Loaded schedule")
    expect(loaded!.output).toContain("Not tools that can be loaded here: nothing")

    // Still there in the next run, and the prompt still names it.
    const again = await say(world, chat.id, "and again", "Again.")
    const later = world.faux.requests.at(-1)!
    expect(offered(later)).toContain("schedule")
    expect(promptOf(later)).toContain("- schedule: ")
    expect(tools(again).at(-1)!.output).toContain("Already available: schedule")
    expect(world.errors).toEqual([])
  })

  it("bring the rules for pages with them, which a chat without them is not told", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses([use(LOAD_TOOLS, { names: ["visual"] }), sent("Ready.")])
    await say(world, chat.id, "draw", "Ready.")
    const [first, second] = world.faux.requests as [ModelContext, ModelContext]
    expect(promptOf(first)).not.toContain("design tokens")
    expect(promptOf(second)).toContain("design tokens")
  })

  it("are loaded by the echo model before it calls one", async () => {
    const world = open(temporary(), "echo")
    const chat = await setup(world)
    const state = await say(world, chat.id, '/tool settings {"action":"get"}', "The tool returned")
    expect(tools(state).map((part) => [part.name, part.status])).toEqual([
      [LOAD_TOOLS, "done"],
      ["settings", "done"],
    ])
  })

  it("stay offered in a main chat that called one before it was deferred", async () => {
    greetDeferred = false
    const directory = temporary()
    const before = open(directory)
    const chat = await setup(before)
    before.faux.setResponses([use("greet", { name: "Ada" }), sent("Greeted.")])
    await say(before, chat.id, "greet Ada", "Greeted.")
    expect(offered(before.faux.requests[0]!)).toContain("greet")
    await before.namespace.close()
    worlds.splice(worlds.indexOf(before), 1)

    // A deploy later the tool is deferred, and the agent is opened again with it so.
    greetDeferred = true
    try {
      const after = open(directory)
      after.faux.setResponses([sent("Still here."), sent("Fresh.")])
      await say(after, chat.id, "anyone?", "Still here.")
      expect(offered(after.faux.requests.at(-1)!)).toContain("greet")
      // Named in the prompt all the same, as a deferred tool is.
      expect(promptOf(after.faux.requests.at(-1)!)).toContain("- greet: Greet someone")
      expect(after.errors).toEqual([])
    } finally {
      greetDeferred = false
    }
  })

  it("are not offered in a main chat that never called them", async () => {
    greetDeferred = true
    try {
      const world = open(temporary())
      const chat = await setup(world)
      world.faux.setResponses([sent("Hi.")])
      await say(world, chat.id, "hi", "Hi.")
      expect(offered(world.faux.requests[0]!)).not.toContain("greet")
      expect(promptOf(world.faux.requests[0]!)).toContain("- greet: Greet someone")
    } finally {
      greetDeferred = false
    }
  })
})

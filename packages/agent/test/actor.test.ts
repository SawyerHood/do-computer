import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AgentEvent,
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  EMPTY_CHAT,
  readSse,
  reduceChat,
} from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@durable-computer/runtime/node"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActor } from "../src/index.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
}

const worlds: World[] = []

function open(directory: string, tokensPerSecond = 2_000): World {
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond })
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: unknown[] = []
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
        onReport: (error) => reports.push(error),
      }),
    onError: (error) => reports.push(error),
  })
  namespace.start()
  const world = { namespace, faux, reports }
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

const temporary = () => mkdtempSync(join(tmpdir(), "dc-agent-"))

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

async function setup(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  return call<ChatSummary>(world, "/chats", "POST", {})
}

/** Follow a chat's event stream, reducing as a client would, until `done` holds. */
async function follow(
  world: World,
  chatId: string,
  done: (state: ChatState, events: ChatEvent[]) => boolean,
): Promise<{ state: ChatState; events: ChatEvent[] }> {
  const response = await world.namespace
    .get("agent-1")
    .fetch(new Request(`http://actor/chats/${chatId}/events`))
  let state = EMPTY_CHAT
  const events: ChatEvent[] = []
  for await (const event of readSse<ChatEvent>(response.body!)) {
    events.push(event)
    state = reduceChat(state, event)
    if (done(state, events)) break
  }
  return { state, events }
}

const send = (
  world: World,
  chatId: string,
  text: string,
  requestId: string = crypto.randomUUID(),
) => call<{ submissionId: string }>(world, `/chats/${chatId}/messages`, "POST", { text, requestId })

const answered = (count: number) => (state: ChatState) =>
  !state.busy &&
  state.messages.filter((m) => m.role === "assistant" && m.status === "done").length >= count

describe("agent actor", () => {
  it("refuses everything but init until it has an owner", async () => {
    const world = open(temporary())
    await expect(call(world, "/")).rejects.toThrow("409")
    await call(world, "/init", "POST", { ownerId: "user-1" })
    await expect(call(world, "/init", "POST", { ownerId: "someone-else" })).rejects.toThrow("409")
    const state = await call<{ agent: { id: string; model: string; name: null } }>(world, "/")
    expect(state.agent).toMatchObject({ id: "agent-1", model: "test/model", name: null })
  })

  it("answers a message and streams it to a client", async () => {
    const world = open(temporary(), 60)
    const chat = await setup(world)
    const answer = "Hello there, it is very nice to meet you today. ".repeat(3).trim()
    world.faux.setResponses([fauxAssistantMessage(answer)])
    const following = follow(world, chat.id, answered(1))
    await send(world, chat.id, "hi, who are you?\nsecond line")
    const { state, events } = await following

    expect(state.messages.map((m) => [m.role, m.status])).toEqual([
      ["user", "done"],
      ["assistant", "done"],
    ])
    expect(state.messages[1]!.parts).toEqual([{ type: "text", text: answer }])
    expect(state.messages[1]!.model).toBe("test/model")
    // The answer arrived as increments, not as one finished message.
    expect(events.filter((event) => event.type === "delta").length).toBeGreaterThan(0)
    expect(events.filter((event) => event.type === "snapshot").length).toBe(1)

    const { chats } = await call<{ chats: ChatSummary[] }>(world, "/")
    expect(chats[0]!.title).toBe("hi, who are you?")
    expect(world.reports).toEqual([])
  })

  it("does not submit the same request twice", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses([fauxAssistantMessage("once"), fauxAssistantMessage("twice")])
    const first = await send(world, chat.id, "hello", "request-1")
    const second = await send(world, chat.id, "hello", "request-1")
    expect(second.submissionId).toBe(first.submissionId)
    const { state } = await follow(world, chat.id, answered(1))
    expect(state.messages.filter((m) => m.role === "user").length).toBe(1)
  })

  it("lets the agent name itself, and tells listeners its identity changed", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses([
      fauxAssistantMessage(
        [
          fauxText("Juniper it is."),
          fauxToolCall("set_identity", {
            name: "Juniper",
            tagline: "Calm and curious",
            personality: "You are warm and brief.",
            avatar: { character: "sprout", color: "moss", accessory: "glasses" },
          }),
          fauxToolCall("memory", { action: "add", target: "user", content: "Name is Sawyer" }),
        ],
        { stopReason: "toolUse" },
      ),
      (context) => {
        // The saved identity must be in the prompt of the next request.
        const system = JSON.stringify(context)
        return fauxAssistantMessage(
          system.includes("Your name is Juniper.") && system.includes("Name is Sawyer")
            ? "Saved and visible."
            : "Saved but NOT visible in my prompt.",
        )
      },
    ])

    const agentEvents = await world.namespace
      .get("agent-1")
      .fetch(new Request("http://actor/events"))
    const seen: AgentEvent[] = []
    const listening = (async () => {
      for await (const event of readSse<AgentEvent>(agentEvents.body!)) {
        seen.push(event)
        if (event.type === "changed" && event.what === "identity") break
      }
    })()

    await send(world, chat.id, "call yourself Juniper")
    const { state } = await follow(world, chat.id, answered(2))
    await listening

    const tools = state.messages.flatMap((m) => m.parts).filter((part) => part.type === "tool")
    expect(tools.map((tool) => [tool.name, tool.status])).toEqual([
      ["set_identity", "done"],
      ["memory", "done"],
    ])
    expect(state.messages.at(-1)!.parts).toEqual([{ type: "text", text: "Saved and visible." }])
    const full = await call<{ agent: Record<string, unknown>; soul: string; user: string }>(
      world,
      "/",
    )
    expect(full.agent).toMatchObject({
      name: "Juniper",
      tagline: "Calm and curious",
      avatar: { character: "sprout", color: "moss", accessory: "glasses" },
    })
    expect(full.soul).toBe("You are warm and brief.")
    expect(full.user).toBe("Name is Sawyer")
    expect(seen[0]).toEqual({ type: "ready" })
  })

  it("rejects a memory write over the limit, so the agent has to consolidate", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("memory", { action: "add", target: "user", content: "x".repeat(1400) })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Too long."),
    ])
    await send(world, chat.id, "remember this")
    const { state } = await follow(world, chat.id, answered(2))
    const tool = state.messages.flatMap((m) => m.parts).find((part) => part.type === "tool")
    expect(tool).toMatchObject({ status: "error" })
    expect((await call<{ user: string }>(world, "/")).user).toBe("")
  })

  it("queues a message sent mid-run and answers it in the same chat", async () => {
    const world = open(temporary(), 150)
    const chat = await setup(world)
    world.faux.setResponses([
      fauxAssistantMessage("A long first answer that takes a little while to stream out fully."),
      fauxAssistantMessage("Second answer."),
    ])
    await send(world, chat.id, "first")
    await follow(world, chat.id, (state) => state.messages.some((m) => m.status === "streaming"))
    await send(world, chat.id, "second")
    const { state } = await follow(world, chat.id, answered(2))
    expect(state.messages.filter((m) => m.role === "user").map((m) => m.parts[0])).toEqual([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ])
    expect(state.queued).toEqual([])
  })

  it("stops a run when asked", async () => {
    const world = open(temporary(), 50)
    const chat = await setup(world)
    world.faux.setResponses([fauxAssistantMessage("word ".repeat(400))])
    await send(world, chat.id, "write a lot")
    await follow(world, chat.id, (state) => state.messages.some((m) => m.status === "streaming"))
    await call(world, `/chats/${chat.id}/abort`, "POST")
    const state = await call<ChatState>(world, `/chats/${chat.id}`)
    expect(state.busy).toBe(false)
    expect(state.messages.at(-1)).toMatchObject({ role: "assistant", status: "aborted" })
  })

  it("finishes an interrupted run after a restart, woken by its alarm", async () => {
    const directory = temporary()
    const before = open(directory, 60)
    const chat = await setup(before)
    before.faux.setResponses([fauxAssistantMessage("word ".repeat(200))])
    await send(before, chat.id, "keep going")
    await follow(before, chat.id, (state) => state.messages.some((m) => m.status === "streaming"))
    await before.namespace.close()

    // A new process: nothing addresses the agent, only its recorded alarm wakes it.
    const after = open(directory)
    after.faux.setResponses([fauxAssistantMessage("Finished after the restart.")])
    const deadline = Date.now() + 10_000
    let state: ChatState
    do {
      await new Promise((resolve) => setTimeout(resolve, 100))
      state = await call<ChatState>(after, `/chats/${chat.id}`)
    } while (state.busy && Date.now() < deadline)

    expect(state.busy).toBe(false)
    expect(state.messages.at(-1)).toMatchObject({
      role: "assistant",
      status: "done",
      parts: [{ type: "text", text: "Finished after the restart." }],
    })
  })

  it("keeps chats separate and only serves ones it listed", async () => {
    const world = open(temporary())
    const first = await setup(world)
    const second = await call<ChatSummary>(world, "/chats", "POST", { title: "Second" })
    world.faux.setResponses([fauxAssistantMessage("for the first")])
    await send(world, first.id, "hello first")
    await follow(world, first.id, answered(1))
    expect((await call<ChatState>(world, `/chats/${second.id}`)).messages).toEqual([])
    await expect(call(world, "/chats/99999")).rejects.toThrow("404")
    await call(world, `/chats/${second.id}`, "PATCH", { archived: true, title: "Renamed" })
    const { chats } = await call<{ chats: ChatSummary[] }>(world, "/")
    expect(chats.find((c) => c.id === second.id)).toMatchObject({
      archived: true,
      title: "Renamed",
    })
  })
})

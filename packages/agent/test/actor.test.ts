import { existsSync, mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AgentEvent,
  type AgentUsage,
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
import { createLocalProcessSandbox } from "@durable-computer/sandbox/testing"
import type { Sandbox } from "@durable-computer/sandbox"
import { type AgentNotification, createAgentActor } from "../src/index.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
}

const worlds: World[] = []

function open(directory: string, tokensPerSecond = 2_000, sandbox?: () => Sandbox): World {
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
        sandbox,
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

  it("asks the model to think before it answers", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    const asked: unknown[] = []
    const think = (_context: unknown, options: { reasoning?: unknown } | undefined) => {
      asked.push(options?.reasoning)
      return fauxAssistantMessage("Done.")
    }
    world.faux.setResponses([think, think, think])
    await Promise.all([follow(world, chat.id, answered(1)), send(world, chat.id, "hi")])

    // Its owner's choice reaches a chat that already exists, from its next reply.
    const state = await call<{ agent: { thinking: string } }>(world, "/", "PATCH", {
      thinking: "high",
    })
    expect(state.agent.thinking).toBe("high")
    await Promise.all([follow(world, chat.id, answered(2)), send(world, chat.id, "again")])

    await call(world, "/", "PATCH", { thinking: "off" })
    await Promise.all([follow(world, chat.id, answered(3)), send(world, chat.id, "once more")])

    expect(asked).toEqual(["medium", "high", undefined])
    await expect(call(world, "/", "PATCH", { thinking: "lots" })).rejects.toThrow("400")
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
            color: "moss",
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
      avatar: { color: "moss" },
    })
    expect(full.soul).toBe("You are warm and brief.")
    expect(full.user).toBe("Name is Sawyer")
    expect(seen[0]).toEqual({ type: "ready" })
  })

  it("is an egg until its owner has watched it hatch, and only hatches once", async () => {
    const world = open(temporary())
    await setup(world)
    type State = { agent: { hatched: boolean; avatar: unknown } }
    expect((await call<State>(world, "/")).agent.hatched).toBe(false)
    expect((await call<State>(world, "/", "PATCH", { hatched: true })).agent.hatched).toBe(true)
    // Nothing a client sends puts it back.
    expect((await call<State>(world, "/", "PATCH", { hatched: false })).agent.hatched).toBe(true)
  })

  it("counts an agent that already has a name as hatched", async () => {
    const world = open(temporary())
    await setup(world)
    const named = await call<{ agent: { hatched: boolean } }>(world, "/", "PATCH", {
      name: "Wren",
    })
    expect(named.agent.hatched).toBe(true)
  })

  it("keeps the look it grew when only its color changes", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    type State = { agent: { avatar: unknown } }
    // The owner rolls a new look: a seed, with a color.
    const rolled = await call<State>(world, "/", "PATCH", {
      avatar: { color: "plum", seed: "k3-roll" },
    })
    expect(rolled.agent.avatar).toEqual({ color: "plum", seed: "k3-roll" })
    await expect(call(world, "/", "PATCH", { avatar: { color: "neon" } })).rejects.toThrow(
      'Unknown color "neon"',
    )

    // The agent picks a color for itself. The seed is not its to change.
    world.faux.setResponses([
      fauxAssistantMessage([fauxToolCall("set_identity", { color: "honey" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Honey it is."),
    ])
    await send(world, chat.id, "be yellow")
    await follow(world, chat.id, answered(2))
    expect((await call<State>(world, "/")).agent.avatar).toEqual({
      color: "honey",
      seed: "k3-roll",
    })

    world.faux.setResponses([
      fauxAssistantMessage([fauxToolCall("set_identity", { color: "neon" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("That is not one I can be."),
    ])
    await send(world, chat.id, "be neon")
    const { state } = await follow(world, chat.id, answered(4))
    const refused = state.messages.flatMap((m) => m.parts).findLast((part) => part.type === "tool")
    expect(refused).toMatchObject({ status: "error" })
    expect(JSON.stringify(refused)).toContain("Colors: clay, moss")
  })

  it("rejects a memory write over the limit, so the agent has to consolidate", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("memory", { action: "add", target: "user", content: "x".repeat(4100) })],
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

  it("has one main chat, which a new agent is given and which cannot be put away", async () => {
    const world = open(temporary())
    await call(world, "/init", "POST", { ownerId: "user-1" })
    const main = await call<ChatSummary>(world, "/chats/main", "POST")
    expect(main).toMatchObject({ kind: "chat", main: true, archived: false })
    // Asked for again it is the same chat, and a chat started beside it is not it.
    expect((await call<ChatSummary>(world, "/chats/main", "POST")).id).toBe(main.id)
    const side = await call<ChatSummary>(world, "/chats", "POST", { title: "Aside" })
    expect(side.main).toBeUndefined()
    const { chats } = await call<{ chats: ChatSummary[] }>(world, "/")
    expect(chats.filter((chat) => chat.main).map((chat) => chat.id)).toEqual([main.id])

    await expect(call(world, `/chats/${main.id}`, "PATCH", { archived: true })).rejects.toThrow(
      "409",
    )
    expect(
      (await call<ChatSummary>(world, `/chats/${main.id}`, "PATCH", { title: "Renamed" })).main,
    ).toBe(true)
  })

  it("makes the chat last talked in the main one, for an agent from before there was one", async () => {
    const world = open(temporary())
    const first = await setup(world)
    const second = await call<ChatSummary>(world, "/chats", "POST", {})
    const put = await call<ChatSummary>(world, "/chats", "POST", {})
    await call(world, `/chats/${put.id}`, "PATCH", { archived: true })
    world.faux.setResponses([fauxAssistantMessage("hello")])
    await send(world, first.id, "the one in use")
    await follow(world, first.id, answered(1))

    expect((await call<ChatSummary>(world, "/chats/main", "POST")).id).toBe(first.id)
    // It stays the main chat whichever is talked in after.
    world.faux.setResponses([fauxAssistantMessage("hello")])
    await send(world, second.id, "an aside")
    await follow(world, second.id, answered(1))
    expect((await call<ChatSummary>(world, "/chats/main", "POST")).id).toBe(first.id)
  })

  it("tells whoever is watching the agent which of its documents changed", async () => {
    const world = open(temporary())
    await setup(world)
    const stream = await world.namespace.get("agent-1").fetch(new Request("http://actor/events"))
    const events = readSse<AgentEvent>(stream.body!)[Symbol.asyncIterator]()
    const next = async () => (await events.next()).value as AgentEvent
    // Said first, once all of them are watched: what a client has from before is asked for again.
    expect(await next()).toEqual({ type: "ready" })
    // Each of these was empty until now, and is told of all the same.
    await call(world, "/approvals/rules", "PATCH", { "tool:bash": "ask" })
    expect(await next()).toEqual({ type: "changed", what: "approvals" })
    await call(world, "/creature/open", "POST")
    expect(await next()).toEqual({ type: "changed", what: "creature" })
    await call(world, "/chats", "POST", {})
    expect(await next()).toEqual({ type: "changed", what: "chats" })
    await events.return?.(undefined)
  })
})

describe("deleting an agent", () => {
  it("removes its computer and everything it stored, leaving the name empty", async () => {
    const directory = temporary()
    let destroyed = 0
    const world = open(directory, 2_000, () => ({
      ...createLocalProcessSandbox(),
      destroy: async () => void destroyed++,
    }))
    const chat = await setup(world)
    world.faux.setResponses([fauxAssistantMessage("noted")])
    await send(world, chat.id, "remember this")
    await follow(world, chat.id, answered(1))
    await world.namespace
      .get("agent-1")
      .fetch(new Request("http://actor/library?name=a.txt", { method: "POST", body: "a file" }))
    expect(existsSync(join(directory, "actors", "agent-1.sqlite"))).toBe(true)
    expect(
      readdirSync(join(directory, "blobs", "agent-1"), { recursive: true }).length,
    ).toBeGreaterThan(0)

    expect(await call(world, "/destroy", "POST")).toEqual({ ok: true })
    expect(destroyed).toBe(1)
    expect(existsSync(join(directory, "actors", "agent-1.sqlite"))).toBe(false)
    const left = existsSync(join(directory, "blobs", "agent-1"))
      ? readdirSync(join(directory, "blobs", "agent-1"), {
          recursive: true,
          withFileTypes: true,
        }).filter((entry) => entry.isFile())
      : []
    expect(left).toEqual([])

    // The name is an agent nobody owns again: it answers nothing until it is given an owner.
    await expect(call(world, "/")).rejects.toThrow()
    await expect(call(world, `/chats/${chat.id}`)).rejects.toThrow()
    expect(world.reports).toEqual([])
  })

  it("keeps the agent whole when its computer cannot be deleted", async () => {
    const world = open(temporary(), 2_000, () => ({
      ...createLocalProcessSandbox(),
      destroy: async () => {
        throw new Error("the provider is unreachable")
      },
    }))
    const chat = await setup(world)
    await expect(call(world, "/destroy", "POST")).rejects.toThrow(
      /502: The agent's computer could not be deleted, so nothing was: the provider is unreachable/,
    )
    // Still there, and still working.
    world.faux.setResponses([fauxAssistantMessage("still here")])
    await send(world, chat.id, "are you there?")
    const { state } = await follow(world, chat.id, answered(1))
    expect(state.messages.at(-1)?.parts[0]).toMatchObject({ text: "still here" })
  })
})

describe("usage", () => {
  it("adds up what every chat spent, by model", async () => {
    const world = open(temporary())
    const first = await setup(world)
    const empty = await call<AgentUsage>(world, "/usage")
    expect(empty).toEqual({
      total: { inputTokens: 0, outputTokens: 0, cost: 0 },
      models: [],
      scheduled: { inputTokens: 0, outputTokens: 0, cost: 0 },
      chats: 1,
    })

    world.faux.setResponses([
      fauxAssistantMessage("one"),
      fauxAssistantMessage("two, a longer answer"),
    ])
    await send(world, first.id, "hello")
    await follow(world, first.id, answered(1))
    const second = await call<ChatSummary>(world, "/chats", "POST", {})
    await send(world, second.id, "hello again")
    await follow(world, second.id, answered(1))
    const one = await call<ChatState>(world, `/chats/${first.id}`)
    const two = await call<ChatState>(world, `/chats/${second.id}`)

    const usage = await call<AgentUsage>(world, "/usage")
    expect(usage.chats).toBe(2)
    expect(usage.models.map((entry) => entry.model)).toEqual(["test/model"])
    // The agent's total is the sum of what each chat reported for itself.
    expect(usage.total.inputTokens).toBe(one.usage.inputTokens + two.usage.inputTokens)
    expect(usage.total.outputTokens).toBe(one.usage.outputTokens + two.usage.outputTokens)
    expect(usage.total.outputTokens).toBeGreaterThan(0)
    expect(usage.models[0]).toMatchObject(usage.total)
    expect(usage.scheduled.outputTokens).toBe(0)
  })
})

describe("unseen replies", () => {
  it("are reported only when nobody is following the chat", async () => {
    const directory = temporary()
    const faux = fauxProvider({
      provider: "test",
      models: [{ id: "model" }],
      tokensPerSecond: 2_000,
    })
    const models = createModels()
    models.setProvider(faux.provider)
    const unseen: AgentNotification[] = []
    const namespace = new NodeActorNamespace({
      directory: join(directory, "actors"),
      blobs: () => fileBlobs(join(directory, "blobs")),
      factory: (host) =>
        createAgentActor(host, {
          models,
          defaultModel: "test/model",
          modelOptions: [
            { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
          ],
          keepAliveMs: 100,
          onNotify: (notification) => unseen.push(notification),
        }),
    })
    const world: World = { namespace, faux, reports: [] }
    worlds.push(world)
    const chat = await setup(world)

    // Someone is watching: no notification.
    faux.setResponses([fauxAssistantMessage("While you watch.")])
    const following = follow(world, chat.id, answered(1))
    await send(world, chat.id, "hello")
    await following
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(unseen).toEqual([])

    // Nobody is: the answer is reported once it is complete.
    faux.setResponses([fauxAssistantMessage("While you were away.")])
    await send(world, chat.id, "and now?")
    const deadline = Date.now() + 5_000
    while (unseen.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(unseen).toEqual([
      {
        agentId: "agent-1",
        agentName: null,
        kind: "reply",
        text: "While you were away.",
        chatId: chat.id,
      },
    ])
  })
})

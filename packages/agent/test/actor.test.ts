import { existsSync, mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AgentActivity,
  type AgentEvent,
  type AgentSummary,
  type AgentUsage,
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  EMPTY_CHAT,
  readSse,
  reduceChat,
} from "@do-computer/protocol"
import type { ActorDatabase } from "@do-computer/runtime"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { createLocalProcessSandbox } from "@do-computer/sandbox/testing"
import type { Sandbox } from "@do-computer/sandbox"
import {
  type AgentNotification,
  CALLER_HEADER,
  createAgentActor,
  encodeCaller,
} from "../src/index.ts"
import { preview } from "../src/preview.ts"
import { quietOnReminder, sent } from "./quiet.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
  /** Everything `onActivity` was told, in the order it was told. */
  activity: Told[]
}
type Told = { agentId: string } & AgentActivity

const worlds: World[] = []

function open(
  directory: string,
  tokensPerSecond = 2_000,
  sandbox?: () => Sandbox,
  /** The agent's database as the agent is to have it, in place of the host's. */
  database: (sql: ActorDatabase) => ActorDatabase = (sql) => sql,
): World {
  const faux = quietOnReminder(
    fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond }),
  )
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: unknown[] = []
  const activity: Told[] = []
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(Object.assign(host, { sql: database(host.sql) }), {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
        sandbox,
        onReport: (error) => reports.push(error),
        onActivity: (change) => activity.push(change),
      }),
    onError: (error) => reports.push(error),
  })
  namespace.start()
  const world = { namespace, faux, reports, activity }
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
  return call<ChatSummary>(world, "/chats/main", "POST", {})
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
    // In the main chat what the agent says to the person is what it sends.
    world.faux.setResponses([sent(answer)])
    const following = follow(world, chat.id, answered(1))
    await send(world, chat.id, "hi, who are you?\nsecond line")
    const { state, events } = await following

    expect(state.messages.map((m) => [m.role, m.status])).toEqual([
      ["user", "done"],
      ["assistant", "done"],
    ])
    expect(state.messages[1]!.parts).toEqual([{ type: "text", text: answer }])
    expect(state.messages[1]!.model).toBe("test/model")
    // The client was kept up to date as it went: it was told the person's message and that the
    // agent was at work, and caught up with the send by a fresh snapshot where the row of the
    // agent's working, live while the call was written, gave way to it.
    expect(events.map((event) => event.type).slice(0, 3)).toEqual(["snapshot", "message", "busy"])
    expect(events.at(-1)).toEqual({ type: "busy", busy: false })

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
        return sent(
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

  it("still gets to know its owner when they named it as it hatched", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    // The first run names it, and says who named it, before it has said a word.
    await call(world, "/", "PATCH", { name: "Pip", user: "Their name is Sawyer." })
    const prompts: string[] = []
    const keep = (said: string) => (context: unknown) => {
      prompts.push(JSON.stringify(context))
      return fauxAssistantMessage(said)
    }
    world.faux.setResponses([keep("Hello, Sawyer."), keep("Hello again.")])

    await send(world, chat.id, "hello")
    await follow(world, chat.id, answered(1))
    expect(prompts[0]).toContain("They have already named you Pip")
    expect(prompts[0]).toContain("You do not have a personality yet")
    expect(prompts[0]).toContain("Their name is Sawyer.")

    // With a personality it is someone, and is told who.
    await call(world, "/", "PATCH", { soul: "You are warm and brief." })
    await send(world, chat.id, "hello again")
    await follow(world, chat.id, answered(2))
    expect(prompts[1]).toContain("Your name is Pip.")
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
      sent("Honey it is."),
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
      sent("That is not one I can be."),
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
      sent("Too long."),
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

  it("opens again after its store failed under it, and finishes the run", async () => {
    // A store that refuses everything while it is `down`, as a full disk does.
    let down = false
    const flaky = (sql: ActorDatabase): ActorDatabase => {
      const unless = <T>(run: () => Promise<T>) =>
        down ? Promise.reject(new Error("disk I/O error")) : run()
      return {
        exec: (text) => unless(() => sql.exec(text)),
        run: (text, ...params) => unless(() => sql.run(text, ...params)),
        get: (text, ...params) => unless(() => sql.get(text, ...params)),
        all: (text, ...params) => unless(() => sql.all(text, ...params)),
        transaction: (callback) => unless(() => sql.transaction(callback)),
        close: () => sql.close(),
      }
    }
    const world = open(temporary(), 60, undefined, flaky)
    const chat = await setup(world)
    world.faux.setResponses([
      fauxAssistantMessage("word ".repeat(200)),
      fauxAssistantMessage("Finished after the failure."),
    ])
    await send(world, chat.id, "keep going")
    await follow(world, chat.id, (state) => state.messages.some((m) => m.status === "streaming"))

    // The run is writing as it goes, so the next thing it writes is refused.
    down = true
    const deadline = Date.now() + 10_000
    while (world.reports.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(String(world.reports[0])).toContain("disk I/O error")
    down = false

    // Nothing addresses the agent: it wakes itself, and the run is picked up where it was.
    let state: ChatState | undefined
    do {
      await new Promise((resolve) => setTimeout(resolve, 100))
      state = await call<ChatState>(world, `/chats/${chat.id}`).catch(() => undefined)
    } while ((state === undefined || state.busy) && Date.now() < deadline)

    expect(state?.busy).toBe(false)
    expect(state?.messages.at(-1)).toMatchObject({
      role: "assistant",
      status: "done",
      parts: [{ type: "text", text: "Finished after the failure." }],
    })
  })

  it("is talked to in its main chat alone, and serves only the chats it listed", async () => {
    const world = open(temporary())
    await call(world, "/init", "POST", { ownerId: "user-1" })
    const main = await call<ChatSummary>(world, "/chats/main", "POST")
    expect(main).toMatchObject({ kind: "chat", main: true, archived: false })
    // Asked for again it is the same chat. No other chat with people is made.
    expect((await call<ChatSummary>(world, "/chats/main", "POST")).id).toBe(main.id)
    await expect(call(world, "/chats", "POST", {})).rejects.toThrow("410")
    const { chats } = await call<{ chats: ChatSummary[] }>(world, "/")
    expect(chats.map((chat) => chat.id)).toEqual([main.id])
    await expect(call(world, "/chats/99999")).rejects.toThrow("404")

    // It is always there: it is not one that can be put away, and it can be renamed.
    await expect(call(world, `/chats/${main.id}`, "PATCH", { archived: true })).rejects.toThrow(
      "409",
    )
    expect(
      (await call<ChatSummary>(world, `/chats/${main.id}`, "PATCH", { title: "Renamed" })).main,
    ).toBe(true)
  })

  it("is set up as a bus as it opens, with nothing to be told where nothing was said", async () => {
    const world = open(temporary())
    const main = await setup(world)
    const state = await call<ChatState>(world, `/chats/${main.id}`)
    // A chat new on the bus has no note that it changed: its first message says how it works.
    expect(state.messages).toEqual([])
    world.faux.setResponses([sent("Hello.")])
    await send(world, main.id, "hello")
    const { state: after } = await follow(world, main.id, answered(1))
    expect(after.messages.map((message) => message.parts[0])).toEqual([
      { type: "text", text: "hello" },
      { type: "text", text: "Hello." },
    ])
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
    await call(
      world,
      `/chats/${(await call<ChatSummary>(world, "/chats/main", "POST")).id}`,
      "PATCH",
      {
        title: "Renamed",
      },
    )
    expect(await next()).toEqual({ type: "changed", what: "chats" })
    await events.return?.(undefined)
  })
})

describe("the agent's latest line", () => {
  const agent = async (world: World) => (await call<{ agent: AgentSummary }>(world, "/")).agent
  const activityOf = ({ agentId: _, ...activity }: Told): AgentActivity => activity
  /** Wait until the hook was last told something `done` holds of, once it was told `from` things. */
  async function told(world: World, done: (change: Told) => boolean, from = 0) {
    const deadline = Date.now() + 5_000
    for (;;) {
      const last = world.activity.at(-1)
      if (world.activity.length > from && last !== undefined && done(last)) return last
      if (Date.now() > deadline) {
        throw new Error(`Timed out; it was told: ${JSON.stringify(world.activity)}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  async function until(world: World, done: (agent: AgentSummary) => boolean) {
    const deadline = Date.now() + 5_000
    for (;;) {
      const found = await agent(world)
      if (done(found)) return found
      if (Date.now() > deadline) throw new Error(`Timed out; it was: ${JSON.stringify(found)}`)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  it("is what a person wrote while it works, and then what it answered", async () => {
    const world = open(temporary(), 150)
    const chat = await setup(world)
    // Nothing has been said yet, and it is neither at work nor asking for anything.
    const idle = await agent(world)
    expect(idle).toMatchObject({ working: false, asking: false })
    expect(idle).not.toHaveProperty("latest")

    world.faux.setResponses([
      sent("Here is **the plan**:\n\n```sh\nmake all\n```\n\nThen we ship."),
    ])
    const before = Date.now()
    await world.namespace.get("agent-1").fetch(
      new Request(`http://actor/chats/${chat.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: "## Plan\n\nwhat is  the `plan`?", requestId: "r1" }),
        headers: {
          "content-type": "application/json",
          [CALLER_HEADER]: encodeCaller({ id: "user-1", name: "Jon" }),
        },
      }),
    )
    const during = await agent(world)
    expect(during.working).toBe(true)
    expect(during.latest).toEqual({
      kind: "said",
      at: expect.any(Number),
      text: "Plan what is the plan?",
      by: "user-1",
      chatId: chat.id,
    })
    expect(during.latest!.at).toBeGreaterThanOrEqual(before)

    const after = await until(world, (found) => found.latest?.kind === "reply" && !found.working)
    expect(after.latest).toEqual({
      kind: "reply",
      at: expect.any(Number),
      text: "Here is the plan: Then we ship.",
      chatId: chat.id,
    })
    expect(after.latest!.at).toBeGreaterThanOrEqual(during.latest!.at)
    expect(world.reports).toEqual([])
  })

  it("tells the hook what a person wrote as it sets to work, then its answer, then that it rests", async () => {
    const world = open(temporary(), 150)
    const chat = await setup(world)
    // Nothing has happened that the hook would be told of.
    expect(world.activity).toEqual([])

    world.faux.setResponses([sent("Here is the plan.")])
    await send(world, chat.id, "what is the plan?")
    await told(world, (change) => change.latest?.kind === "reply" && !change.working)
    expect(world.activity[0]).toEqual({
      agentId: "agent-1",
      latest: { kind: "said", at: expect.any(Number), text: "what is the plan?", chatId: chat.id },
      working: true,
      asking: false,
    })
    expect(world.activity.at(-1)).toEqual({
      agentId: "agent-1",
      latest: { kind: "reply", at: expect.any(Number), text: "Here is the plan.", chatId: chat.id },
      working: false,
      asking: false,
    })
    // In the order it happened: nothing of what was written is told once the answer has been.
    const kinds = world.activity.map((change) => change.latest?.kind)
    expect(kinds.lastIndexOf("said")).toBeLessThan(kinds.indexOf("reply"))
    // What the hook was told last is what the agent says of itself.
    expect(await agent(world)).toMatchObject(activityOf(world.activity.at(-1)!))
    expect(world.reports).toEqual([])
  })

  it("tells the hook that work is over when a run is stopped, or ends with no answer", async () => {
    const world = open(temporary(), 50)
    const chat = await setup(world)
    world.faux.setResponses([fauxAssistantMessage("word ".repeat(400))])
    await send(world, chat.id, "write a lot")
    await follow(world, chat.id, (state) => state.messages.some((m) => m.status === "streaming"))
    expect(world.activity.at(-1)).toMatchObject({ working: true, latest: { kind: "said" } })

    // A run that is stopped has no answer to tell of. Its end is told of all the same.
    await call(world, `/chats/${chat.id}/abort`, "POST")
    await told(world, (change) => !change.working)
    expect(world.activity.at(-1)).toMatchObject({
      working: false,
      latest: { kind: "said", text: "write a lot" },
    })

    // One that ends with nothing said leaves the line as it was, and its end is told of too.
    world.faux.setResponses([fauxAssistantMessage("")])
    const before = world.activity.length
    await send(world, chat.id, "say nothing")
    await told(world, (change) => !change.working, before + 1)
    expect(world.activity.slice(before).map((change) => change.working)).toEqual([true, false])
    expect(world.activity.at(-1)).toMatchObject({ latest: { kind: "said", text: "say nothing" } })
    expect(world.reports).toEqual([])
  })

  it("tells the hook how it stands when its alarm wakes it after a restart", async () => {
    const directory = temporary()
    const before = open(directory, 60)
    const chat = await setup(before)
    before.faux.setResponses([fauxAssistantMessage("word ".repeat(200))])
    await send(before, chat.id, "keep going")
    await follow(before, chat.id, (state) => state.messages.some((m) => m.status === "streaming"))
    await before.namespace.close()

    // A new process, which has told nobody anything. Nothing addresses the agent: its alarm
    // wakes it, and it says that it is at work, and then that it is not.
    const after = open(directory, 60)
    after.faux.setResponses([fauxAssistantMessage("Finished after the restart.")])
    await told(after, (change) => !change.working)
    expect(after.activity.map((change) => change.working)).toEqual([true, false])
    // An answer that is finished after a restart is not kept as its line.
    expect(after.activity.at(-1)).toMatchObject({ latest: { kind: "said", text: "keep going" } })
    expect(after.reports).toEqual([])
  })

  it("tells the hook nothing twice in a row", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses([sent("Done.")])
    await send(world, chat.id, "do it")
    await told(world, (change) => change.latest?.kind === "reply" && !change.working)
    const settled = world.activity.length

    // Reading the agent, and changing what the hook is not told of, tells it nothing.
    await agent(world)
    await call(world, "/", "PATCH", { name: "Ada" })
    await call<ChatSummary>(world, "/chats/main", "POST", {})
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(world.activity).toHaveLength(settled)
    for (const [index, change] of world.activity.entries()) {
      if (index > 0) expect(change).not.toEqual(world.activity[index - 1])
    }
    expect(world.reports).toEqual([])
  })

  it("is one line of plain text, cut short", () => {
    expect(
      preview("# Done\n\n- **Two** files, _both_ in `src/`\n- see [the notes](https://x.test)"),
    ).toBe("Done Two files, both in src/ see the notes")
    expect(preview("Before\n```ts\nconst a = 1\n```\nafter, in my_file.ts")).toBe(
      "Before after, in my_file.ts",
    )
    // Something that is nothing but code is shown as the code.
    expect(preview("```sh\nmake all\n```")).toBe("make all")
    const long = preview("word ".repeat(100))
    expect(long).toHaveLength(140)
    expect(long.endsWith("word…")).toBe(true)
    expect(preview("  \n ")).toBe("")
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
      /502: The Dood's computer could not be deleted, so nothing was: the provider is unreachable/,
    )
    // Still there, and still working.
    world.faux.setResponses([sent("still here")])
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
      fauxAssistantMessage([fauxToolCall("subagent", { action: "start", task: "Say two." })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("two, a longer answer"),
    ])
    await send(world, first.id, "hello")
    await follow(world, first.id, answered(1))
    // A sub-agent is a chat of its own, which spends too.
    await send(world, first.id, "hand it over")
    let second: ChatSummary | undefined
    const deadline = Date.now() + 5_000
    while (second?.status !== "done" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      second = (await call<{ chats: ChatSummary[] }>(world, "/")).chats.find(
        (chat) => chat.kind === "subagent",
      )
    }
    await follow(world, first.id, (state) => !state.busy && state.queued.length === 0)
    const one = await call<ChatState>(world, `/chats/${first.id}`)
    const two = await call<ChatState>(world, `/chats/${second!.id}`)

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
    const faux = quietOnReminder(
      fauxProvider({
        provider: "test",
        models: [{ id: "model" }],
        tokensPerSecond: 2_000,
      }),
    )
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
    const world: World = { namespace, faux, reports: [], activity: [] }
    worlds.push(world)
    const chat = await setup(world)

    // Someone is watching: no notification.
    faux.setResponses([sent("While you watch.")])
    const following = follow(world, chat.id, answered(1))
    await send(world, chat.id, "hello")
    await following
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(unseen).toEqual([])

    // Nobody is: the answer is reported once it is complete.
    faux.setResponses([sent("While you were away.")])
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

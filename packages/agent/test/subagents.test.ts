import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  AgentActivity,
  AgentSummary,
  ApprovalsState,
  ChatState,
  ChatSummary,
  NoticePart,
  ToolPart,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { type AgentNotification, createAgentActor } from "../src/index.ts"
import { quietOnReminder, sent } from "./quiet.ts"
import { entriesOf, inStore } from "./seed.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: AgentNotification[]
  errors: unknown[]
  /** Everything `onActivity` was told, in the order it was told. */
  activity: Told[]
}
type Told = { agentId: string } & AgentActivity
const worlds: World[] = []

function open(directory: string): World {
  const faux = quietOnReminder(
    fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 }),
  )
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: AgentNotification[] = []
  const errors: unknown[] = []
  const activity: Told[] = []
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
        // Long, so that a report arrives because the sub-agent came to rest and not on a wake-up.
        keepAliveMs: 60_000,
        onNotify: (notification) => reports.push(notification),
        onReport: (error) => errors.push(error),
        onActivity: (change) => activity.push(change),
      }),
    onError: (error) => errors.push(error),
  })
  namespace.start()
  const world = { namespace, faux, reports, errors, activity }
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

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
  ms = 8_000,
): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error(`Timed out; last value: ${JSON.stringify(value)}`)
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}

const chatState = (world: World, chatId: string) => call<ChatState>(world, `/chats/${chatId}`)
const chats = async (world: World) => (await call<{ chats: ChatSummary[] }>(world, "/")).chats
const subagents = async (world: World) =>
  (await chats(world)).filter((chat) => chat.kind === "subagent")

async function setup(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  return call<ChatSummary>(world, "/chats/main", "POST", {})
}

const send = (world: World, chatId: string, text: string) =>
  call(world, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })

const temporary = () => mkdtempSync(join(tmpdir(), "dc-subagents-"))
const notices = (state: ChatState) =>
  state.messages.flatMap((message) =>
    message.parts.filter(
      (part): part is NoticePart => part.type === "notice" && part.kind === "subagent",
    ),
  )
const said = (state: ChatState) =>
  state.messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
    )
const tools = (state: ChatState) =>
  state.messages.flatMap((message) =>
    message.parts.filter((part): part is ToolPart => part.type === "tool"),
  )

type Turn = {
  /** Everything the model was shown, as text. */
  seen: string
  /** The newest thing it was shown. */
  last: string
  /** Whether this is a sub-agent's conversation. */
  sub: boolean
}

/**
 * The agent and its sub-agents ask the model in an order that is not fixed, so each answer is
 * chosen from what the model was shown, not from a queue.
 */
function script(
  world: World,
  answer: (turn: Turn) => AssistantMessage | Promise<AssistantMessage>,
) {
  const seen: Turn[] = []
  world.faux.setResponses(
    Array.from({ length: 40 }, () => (context: { messages: unknown[] }) => {
      const turn: Turn = {
        seen: JSON.stringify(context.messages),
        // What it was last told, past what changed of its prompt since.
        last: JSON.stringify(
          (context.messages as { role?: string }[]).findLast(
            (message) => message.role !== "system",
          ),
        ),
        sub: JSON.stringify(context.messages).includes("You are working as a sub-agent"),
      }
      seen.push(turn)
      return answer(turn)
    }),
  )
  return seen
}

const use = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" })
const afterTool = (turn: Turn) => turn.last.includes('"toolResult"')
/** A sub-agent's word, as the main chat is told it: an event. */
const NUDGED = "subagent-report"

describe("sub-agents", () => {
  it("works in a chat of its own, reports back, and gives the agent a turn", async () => {
    const directory = temporary()
    const world = open(directory)
    const chat = await setup(world)
    const turns = script(world, (turn) => {
      if (turn.sub) {
        return fauxAssistantMessage(
          turn.last.includes("Also check Sunday") ? "Sunday is cheaper." : "Three flights found.",
        )
      }
      // In the main chat it speaks to the person with what it sends.
      if (afterTool(turn)) return sent("Started.")
      if (turn.last.includes(NUDGED)) {
        return sent(turn.seen.includes("Sunday is cheaper.") ? "Go on Sunday." : "Flights are in.")
      }
      if (turn.last.includes("ask it more")) {
        const id = /Started sub-agent (\d+)/.exec(turn.seen)![1]!
        return use("subagent", { action: "message", id, task: "Also check Sunday." })
      }
      return use("subagent", {
        action: "start",
        title: "Flights",
        task: "Find flights to Lisbon.",
      })
    })

    await send(world, chat.id, "plan a trip")
    const reported = await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).includes("Flights are in."),
    )
    const [sub] = await subagents(world)
    expect(sub).toMatchObject({
      title: "Flights",
      kind: "subagent",
      parentId: chat.id,
      status: "done",
    })
    // The agent was not kept waiting: it answered before the report came, and again after it.
    expect(said(reported)).toEqual(["Started.", "Flights are in."])
    expect(tools(reported)[0]).toMatchObject({
      name: "subagent",
      status: "done",
      details: { chatId: sub!.id, title: "Flights" },
    })
    expect(notices(reported)).toEqual([
      {
        type: "notice",
        kind: "subagent",
        text: "Flights",
        chatId: sub!.id,
        outcome: "reported",
        detail: "Three flights found.",
      },
    ])
    // Its chat holds the task as it was given, without what it was told about being a sub-agent.
    const own = await chatState(world, sub!.id)
    expect(own.messages.map((message) => [message.role, message.parts])).toEqual([
      ["user", [{ type: "text", text: "Find flights to Lisbon." }]],
      ["assistant", [{ type: "text", text: "Three flights found." }]],
    ])
    // The model saw the report where it was started, and knew what it was doing as a sub-agent.
    const relayed = turns.find((turn) => !turn.sub && turn.last.includes(NUDGED))!
    expect(relayed.last).toContain('<event kind=\\"subagent-report\\"')
    expect(relayed.seen).toContain("Three flights found.")
    // What it said about the report is announced like any answer nobody was there to read.
    expect(world.reports.map((notification) => notification.text)).toContain("Flights are in.")
    expect(world.reports.map((notification) => notification.text)).not.toContain(
      "Three flights found.",
    )

    // A finished sub-agent can be given more, and reports again.
    await send(world, chat.id, "ask it more")
    const again = await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).includes("Go on Sunday."),
    )
    expect(notices(again).map((notice) => notice.detail)).toEqual([
      "Three flights found.",
      "Sunday is cheaper.",
    ])
    expect((await subagents(world)).map((one) => one.status)).toEqual(["done"])
    expect((await chatState(world, sub!.id)).messages.at(-2)!.parts).toEqual([
      { type: "text", text: "Also check Sunday." },
    ])
    expect(world.errors).toEqual([])

    // Through two sub-agents' coming and going, what the main chat is shown of what goes on
    // around it changed in place, by small patches: never every section taken away and sent
    // again, which a section that came and went would have needed.
    await world.namespace.close()
    const prompts = await inStore(directory, "agent-1", async (harness) =>
      (await entriesOf(harness, chat.id)).flatMap((entry) =>
        entry.kind === "pi.system"
          ? (entry.model ?? []).map(
              (message) =>
                ((message as { sections?: Record<string, string | null> }).sections ??
                  {}) as Record<string, string | null>,
            )
          : [],
      ),
    )
    const recent = prompts.flatMap((sections) =>
      sections.recent === undefined ? [] : [sections.recent],
    )
    // Shown first with nothing around, then the sub-agent at work, then nothing again, twice.
    expect(recent.length).toBeGreaterThanOrEqual(3)
    expect(recent).not.toContain(null)
    expect(recent.at(-1)).toContain("Nothing is at work around this conversation.")
    expect(recent.some((text) => text?.includes('Your sub-agent "Flights"'))).toBe(true)
    // After the first, no entry takes away more than one section.
    for (const sections of prompts.slice(1)) {
      expect(Object.values(sections).filter((value) => value === null).length).toBeLessThanOrEqual(
        1,
      )
    }
  })

  it("is read and not written in by the user, who can stop it", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    let release = (_message: AssistantMessage) => {}
    const held = new Promise<AssistantMessage>((resolve) => (release = resolve))
    const turns = script(world, (turn) => {
      if (turn.sub) return held
      if (afterTool(turn)) return sent("Started.")
      return use("subagent", { action: "start", task: "Shortlist hotels near Alfama." })
    })

    await send(world, chat.id, "find a hotel")
    await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).includes("Started."),
    )
    const [sub] = await until(
      () => subagents(world),
      (all) => all.length === 1,
    )
    // With no title given, it is called by how its task begins.
    expect(sub).toMatchObject({ title: "Shortlist hotels near Alfama.", status: "working" })
    // The agent has answered, and is at work for as long as its sub-agent is.
    const { agent } = await until(
      () => call<{ agent: AgentSummary }>(world, "/"),
      (state) => state.agent.latest?.kind === "reply",
    )
    expect(agent).toMatchObject({ working: true, latest: { text: "Started." } })
    await expect(send(world, sub!.id, "hello")).rejects.toThrow("409")
    await expect(call(world, `/chats/${sub!.id}/reset`, "POST")).rejects.toThrow("409")

    // The model is still answering when it is stopped; what it then says is not a report.
    const stopping = call(world, `/chats/${sub!.id}/abort`, "POST")
    await new Promise((resolve) => setTimeout(resolve, 100))
    release(fauxAssistantMessage("Too late."))
    await stopping
    expect((await subagents(world))[0]).toMatchObject({ status: "stopped" })
    // The agent is told, where it will see it, and is not given a turn over it.
    const parent = await chatState(world, chat.id)
    expect(notices(parent)).toEqual([
      {
        type: "notice",
        kind: "subagent",
        text: "Shortlist hotels near Alfama.",
        chatId: sub!.id,
        outcome: "stopped",
      },
    ])
    expect(parent.busy).toBe(false)
    expect(turns.filter((turn) => !turn.sub)).toHaveLength(2)
    // Stopping one that is not at work is refused.
    await expect(call(world, `/chats/${sub!.id}/abort`, "POST")).rejects.toThrow("400")
    expect(world.errors).toEqual([])
  })

  it("cannot be started by a sub-agent, and cannot change schedules", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    script(world, (turn) => {
      if (turn.sub) {
        if (!afterTool(turn)) return use("subagent", { action: "start", task: "Go deeper." })
        if (!turn.seen.includes("cannot change schedules")) {
          return use("schedule", { action: "create", schedule: "1h", prompt: "Later." })
        }
        return fauxAssistantMessage("Did it alone.")
      }
      if (afterTool(turn)) return sent("Started.")
      if (turn.last.includes(NUDGED)) return sent("Done.")
      return use("subagent", { action: "start", title: "Dig", task: "Dig in." })
    })
    await send(world, chat.id, "dig")
    await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).includes("Done."),
    )
    const all = await subagents(world)
    expect(all).toHaveLength(1)
    expect(tools(await chatState(world, all[0]!.id))).toMatchObject([
      {
        name: "subagent",
        status: "error",
        output: expect.stringContaining("Only your main conversation"),
      },
      { name: "schedule", status: "error", output: "A sub-agent cannot change schedules." },
    ])
    expect(world.errors).toEqual([])
  })

  it("waits for the user's OK before it reports, and carries on once it has it", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    await call(world, "/approvals/rules", "PATCH", { "tool:memory": "ask" })
    script(world, (turn) => {
      if (turn.sub) {
        if (turn.seen.includes("Saved. your notes")) return fauxAssistantMessage("Saved the note.")
        const asked = turn.seen.includes("approval first") && !turn.seen.includes("Approved")
        if (asked) return fauxAssistantMessage("May I save a note?")
        return use("memory", { action: "add", target: "memory", content: "likes Lisbon" })
      }
      // A change to its memory is shown to the model after whatever else is newest, so here the
      // newest thing it was shown does not say which turn this is.
      if (turn.seen.includes(NUDGED)) return sent("It is saved.")
      if (turn.seen.includes("Started sub-agent")) return sent("Started.")
      return use("subagent", { action: "start", title: "Note", task: "Save a note." })
    })
    await send(world, chat.id, "remember this")
    // With nobody reading the agent, the hook is told that it stopped to ask: its sub-agent
    // has no report to come until someone answers, so it is not at work.
    const stopped = await until(
      async () => world.activity.at(-1),
      (told) => told?.asking === true && !told.working,
    )
    expect(stopped!.latest).toMatchObject({ kind: "asked" })
    // Before that it was at work, its own answer given, for as long as its sub-agent was.
    expect(world.activity).toContainEqual(
      expect.objectContaining({
        working: true,
        latest: expect.objectContaining({ kind: "reply" }),
      }),
    )
    const [waiting] = await until(
      () => subagents(world),
      (all) => all[0]?.status === "waiting",
    )
    // Asking is not a report: nothing has been said in the chat that started it.
    expect(notices(await chatState(world, chat.id))).toEqual([])
    const { pending } = await call<ApprovalsState>(world, "/approvals")
    expect(pending).toMatchObject([
      { chatId: waiting!.id, chatKind: "subagent", chatTitle: "Note" },
    ])
    // The agent is asking and no longer at work. What it asked is its line, in no chat that a
    // person writes in.
    const { agent } = await until(
      () => call<{ agent: AgentSummary }>(world, "/"),
      (state) => state.agent.asking === true && !state.agent.working,
    )
    expect(agent.latest).toMatchObject({ kind: "asked" })
    expect(agent.latest).not.toHaveProperty("chatId")

    await call(world, `/approvals/${pending[0]!.id}`, "POST", { decision: "once" })
    const reported = await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).includes("It is saved."),
    )
    expect(notices(reported).map((notice) => notice.detail)).toEqual(["Saved the note."])
    expect((await subagents(world))[0]).toMatchObject({ status: "done" })
    expect((await call<{ memory: string }>(world, "/")).memory).toBe("likes Lisbon")
    // Answered, it was at work again, and then at rest with what it said of the report.
    expect(
      await until(
        async () => world.activity.at(-1),
        (told) => told?.latest?.kind === "reply" && !told.working,
      ),
    ).toMatchObject({ asking: false, latest: { text: "It is saved." } })
    const answered = world.activity.findLastIndex((told) => told.asking)
    expect(world.activity.slice(answered + 1).some((told) => told.working)).toBe(true)
    expect(world.errors).toEqual([])
  })

  it("tells the hook that the agent asks for nothing once a sub-agent that was waiting is stopped", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    await call(world, "/approvals/rules", "PATCH", { "tool:memory": "ask" })
    script(world, (turn) => {
      if (turn.sub) {
        if (turn.seen.includes("approval first")) return fauxAssistantMessage("May I save a note?")
        return use("memory", { action: "add", target: "memory", content: "likes Lisbon" })
      }
      if (turn.seen.includes("Started sub-agent")) return sent("Started.")
      return use("subagent", { action: "start", title: "Note", task: "Save a note." })
    })
    await send(world, chat.id, "remember this")
    const last = async () => world.activity.at(-1)
    await until(last, (told) => told?.asking === true && !told.working)

    // What it asked for is taken back with the sub-agent, and nobody is left to answer.
    const [waiting] = await subagents(world)
    await call(world, `/chats/${waiting!.id}/abort`, "POST")
    expect(await until(last, (told) => told?.asking === false)).toMatchObject({ working: false })
    expect((await call<ApprovalsState>(world, "/approvals")).pending).toEqual([])
    expect(world.errors).toEqual([])
  })

  it("reports to the agent when it fails, and limits how many work at once", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    let started = 0
    script(world, (turn) => {
      if (turn.sub)
        return fauxAssistantMessage("", { stopReason: "error", errorMessage: "No credit." })
      if (turn.last.includes(NUDGED)) return sent("It failed.")
      if (afterTool(turn)) return sent("Started.")
      started += 1
      return use("subagent", { action: "start", title: `Job ${started}`, task: "Do it." })
    })
    await send(world, chat.id, "go")
    const failed = await until(
      () => chatState(world, chat.id),
      (state) => !state.busy && said(state).includes("It failed."),
    )
    expect(notices(failed)).toMatchObject([{ outcome: "failed", detail: "No credit." }])
    expect((await subagents(world))[0]).toMatchObject({ status: "failed" })
  })
})

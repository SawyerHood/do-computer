import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  AgentSummary,
  ChatState,
  ChatSummary,
  NoticePart,
  ToolPart,
} from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@durable-computer/runtime/node"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import {
  type AgentDirectory,
  type AgentNotification,
  createAgentActor,
  type PeerReply,
} from "../src/index.ts"

const ADA = "agent-a"
const BO = "agent-b"
const CY = "agent-c"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: AgentNotification[]
  errors: unknown[]
  /** The agents of the one workspace. Any other agent is somewhere else. */
  workspace: string[]
  /** Every answer handed back, in order. */
  replies: PeerReply[]
  /** Called before an answer is handed back; throwing makes the handing over fail. */
  onReply: (reply: PeerReply) => void
}
const worlds: World[] = []

async function call<T>(
  world: World,
  agentId: string,
  path: string,
  method = "GET",
  payload?: unknown,
): Promise<T> {
  const response = await world.namespace.get(agentId).fetch(
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

/** What a host does for its agents, over the agents of one workspace kept in a list. */
function directory(world: World): AgentDirectory {
  const beside = (agentId: string, other: string) =>
    agentId !== other && world.workspace.includes(agentId) && world.workspace.includes(other)
  return {
    list: (agentId) =>
      Promise.all(
        world.workspace
          .filter((id) => beside(agentId, id))
          .map(async (id) => {
            const { agent } = await call<{ agent: AgentSummary }>(world, id, "/")
            return { id, name: agent.name, tagline: agent.tagline }
          }),
      ),
    send: async (agentId, to, message) =>
      beside(agentId, to)
        ? call<{ threadId: string }>(world, to, `/peers/${agentId}/message`, "POST", message)
        : undefined,
    reply: async (agentId, to, reply) => {
      if (!beside(agentId, to)) return false
      world.onReply(reply)
      world.replies.push(reply)
      await call(world, to, `/peers/${agentId}/reply`, "POST", reply)
      return true
    },
  }
}

function open(folder: string, keepAliveMs = 60_000): World {
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: AgentNotification[] = []
  const errors: unknown[] = []
  const world: World = {
    namespace: undefined as unknown as NodeActorNamespace,
    faux,
    reports,
    errors,
    workspace: [ADA, BO],
    replies: [],
    onReply: () => {},
  }
  world.namespace = new NodeActorNamespace({
    directory: join(folder, "actors"),
    blobs: (name) => fileBlobs(join(folder, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        // Long, so that an answer arrives because the agent came to rest and not on a wake-up.
        keepAliveMs,
        agentDirectory: directory(world),
        onNotify: (notification) => reports.push(notification),
        onReport: (error) => errors.push(error),
      }),
    onError: (error) => errors.push(error),
  })
  world.namespace.start()
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

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

const chatState = (world: World, agentId: string, chatId: string) =>
  call<ChatState>(world, agentId, `/chats/${chatId}`)
const chats = async (world: World, agentId: string) =>
  (await call<{ chats: ChatSummary[] }>(world, agentId, "/")).chats
const threads = async (world: World, agentId: string) =>
  (await chats(world, agentId)).filter((chat) => chat.kind === "agent")

/** Make an agent with a name, and a chat with its user. */
async function agent(world: World, agentId: string, name: string): Promise<ChatSummary> {
  await call(world, agentId, "/init", "POST", { ownerId: "user-1" })
  await call(world, agentId, "/", "PATCH", { name })
  return call<ChatSummary>(world, agentId, "/chats", "POST", {})
}

const send = (world: World, agentId: string, chatId: string, text: string) =>
  call(world, agentId, `/chats/${chatId}/messages`, "POST", {
    text,
    requestId: crypto.randomUUID(),
  })

const temporary = () => mkdtempSync(join(tmpdir(), "dc-peers-"))
const notices = (state: ChatState) =>
  state.messages.flatMap((message) =>
    message.parts.filter(
      (part): part is NoticePart => part.type === "notice" && part.kind === "agent",
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
  /** In a conversation another agent started: that agent's name. */
  from: string | undefined
}

/**
 * The agents ask the model in an order that is not fixed, so each answer is chosen from what the
 * model was shown, not from a queue.
 */
function script(
  world: World,
  answer: (turn: Turn) => AssistantMessage | Promise<AssistantMessage>,
) {
  const seen: Turn[] = []
  world.faux.setResponses(
    Array.from({ length: 40 }, () => (context: { messages: unknown[] }) => {
      const all = JSON.stringify(context.messages)
      const turn: Turn = {
        seen: all,
        last: JSON.stringify(context.messages.at(-1)),
        from: /The message above is from (\w+), another agent in your workspace/.exec(all)?.[1],
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
const NUDGED = "Another agent has answered a message of yours"

describe("messages between agents", () => {
  it("reach the other agent in a conversation of its own, whose answer comes back and gives the sender a turn", async () => {
    const world = open(temporary())
    const chat = await agent(world, ADA, "Ada")
    await agent(world, BO, "Bo")
    script(world, (turn) => {
      if (turn.from !== undefined) {
        return fauxAssistantMessage(turn.last.includes("And where?") ? "At the pier." : "March 3.")
      }
      if (afterTool(turn)) return fauxAssistantMessage("Asked.")
      if (turn.last.includes(NUDGED)) {
        return fauxAssistantMessage(
          turn.seen.includes("At the pier.") ? "It is at the pier." : "Bo says March 3.",
        )
      }
      return use("agents", {
        action: "message",
        to: "bo",
        message: turn.last.includes("ask where") ? "And where?" : "When is the launch?",
      })
    })

    await send(world, ADA, chat.id, "ask Bo when the launch is")
    const answered = await until(
      () => chatState(world, ADA, chat.id),
      (state) => !state.busy && said(state).includes("Bo says March 3."),
    )
    const [thread] = await threads(world, BO)
    expect(thread).toMatchObject({
      title: "When is the launch?",
      kind: "agent",
      status: "done",
      peer: { agentId: ADA, name: "Ada", chatId: chat.id },
    })
    // The sender was not kept waiting: it answered before the reply came, and again after it.
    expect(said(answered)).toEqual(["Asked.", "Bo says March 3."])
    expect(tools(answered)[0]).toMatchObject({
      name: "agents",
      status: "done",
      details: { agentId: BO, name: "Bo", chatId: thread!.id },
    })
    expect(notices(answered)).toEqual([
      {
        type: "notice",
        kind: "agent",
        text: "Bo",
        agentId: BO,
        chatId: thread!.id,
        outcome: "reported",
        detail: "March 3.",
      },
    ])
    // The conversation holds the message as it was sent, from the agent that sent it, without
    // what the receiver was told about where it came from.
    const there = await chatState(world, BO, thread!.id)
    expect(there.messages[0]).toMatchObject({
      role: "user",
      parts: [{ type: "text", text: "When is the launch?" }],
      agent: { id: ADA, name: "Ada" },
    })
    expect(said(there)).toEqual(["March 3."])
    // Nobody had the sender's chat open, so what it made of the reply is announced.
    await until(
      async () => world.reports,
      (reports) => reports.some((report) => report.text === "Bo says March 3."),
    )

    // More from the same chat carries on the same conversation.
    await send(world, ADA, chat.id, "ask where")
    const again = await until(
      () => chatState(world, ADA, chat.id),
      (state) => !state.busy && said(state).includes("It is at the pier."),
    )
    expect(notices(again).map((notice) => notice.detail)).toEqual(["March 3.", "At the pier."])
    expect(await threads(world, BO)).toHaveLength(1)
    expect(said(await chatState(world, BO, thread!.id))).toEqual(["March 3.", "At the pier."])
    // The sender has no conversation of that kind: the replies are in its chat with the user.
    expect(await threads(world, ADA)).toEqual([])
    expect(world.errors).toEqual([])
  })

  it("are read and not written in by the user, who can stop the agent answering one", async () => {
    const world = open(temporary())
    const chat = await agent(world, ADA, "Ada")
    await agent(world, BO, "Bo")
    let release = (_message: AssistantMessage) => {}
    const held = new Promise<AssistantMessage>((resolve) => (release = resolve))
    script(world, (turn) => {
      if (turn.from !== undefined) return held
      if (afterTool(turn)) return fauxAssistantMessage("Asked.")
      if (turn.last.includes(NUDGED)) return fauxAssistantMessage("Bo was stopped.")
      return use("agents", { action: "message", to: BO, message: "Count the stars." })
    })

    await send(world, ADA, chat.id, "ask Bo")
    const [thread] = await until(
      () => threads(world, BO),
      (all) => all.length === 1,
    )
    expect(thread).toMatchObject({ status: "working" })
    await expect(send(world, BO, thread!.id, "hello")).rejects.toThrow("409")
    await expect(call(world, BO, `/chats/${thread!.id}/reset`, "POST")).rejects.toThrow("409")

    // The model is still answering when it is stopped; what it then says is not sent back.
    const stopping = call(world, BO, `/chats/${thread!.id}/abort`, "POST")
    await new Promise((resolve) => setTimeout(resolve, 100))
    release(fauxAssistantMessage("Too late."))
    await stopping
    expect((await threads(world, BO))[0]).toMatchObject({ status: "stopped" })
    // The sender is told, and given a turn: its user was not the one who stopped it.
    const told = await until(
      () => chatState(world, ADA, chat.id),
      (state) => !state.busy && said(state).includes("Bo was stopped."),
    )
    expect(notices(told)).toEqual([
      {
        type: "notice",
        kind: "agent",
        text: "Bo",
        agentId: BO,
        chatId: thread!.id,
        outcome: "stopped",
      },
    ])
    // Stopping one that is not at work is refused.
    await expect(call(world, BO, `/chats/${thread!.id}/abort`, "POST")).rejects.toThrow("400")
    expect(world.errors).toEqual([])
  })

  it("go only to the agents of the same workspace", async () => {
    const world = open(temporary())
    const chat = await agent(world, ADA, "Ada")
    await agent(world, BO, "Bo")
    // In no workspace with the other two.
    await agent(world, CY, "Cy")
    script(world, (turn) => {
      if (afterTool(turn)) return fauxAssistantMessage("Done.")
      if (turn.seen.includes("write to Cy")) {
        return use("agents", { action: "message", to: CY, message: "Hello." })
      }
      return use("agents", { action: "list" })
    })

    await send(world, ADA, chat.id, "who is there")
    const listed = await until(
      () => chatState(world, ADA, chat.id),
      (state) => !state.busy && said(state).includes("Done."),
    )
    expect(tools(listed)[0]!.output).toBe(`Bo (id ${BO})`)

    await send(world, ADA, chat.id, "write to Cy")
    const refused = await until(
      () => chatState(world, ADA, chat.id),
      (state) => !state.busy && tools(state).length === 2,
    )
    expect(tools(refused)[1]).toMatchObject({ status: "error" })
    expect(tools(refused)[1]!.output).toContain(`There is no agent "${CY}" in this workspace`)
    expect(await threads(world, CY)).toEqual([])
    expect(world.errors).toEqual([])
  })

  it("can be passed on: an agent that was asked can ask a third, and answers once it hears back", async () => {
    const world = open(temporary())
    world.workspace = [ADA, BO, CY]
    const chat = await agent(world, ADA, "Ada")
    await agent(world, BO, "Bo")
    await agent(world, CY, "Cy")
    script(world, (turn) => {
      // Cy, asked by Bo.
      if (turn.from === "Bo") return fauxAssistantMessage("Blue.")
      // Bo, asked by Ada: asks Cy, says so, and answers once Cy has.
      if (turn.from === "Ada") {
        if (turn.last.includes(NUDGED)) return fauxAssistantMessage("Cy says blue.")
        if (afterTool(turn)) return fauxAssistantMessage("I have asked Cy.")
        return use("agents", { action: "message", to: "Cy", message: "Which color?" })
      }
      if (afterTool(turn)) return fauxAssistantMessage("Asked.")
      if (turn.last.includes(NUDGED)) {
        return fauxAssistantMessage(turn.seen.includes("Cy says blue.") ? "It is blue." : "Wait.")
      }
      return use("agents", { action: "message", to: "Bo", message: "Which color did Cy pick?" })
    })

    await send(world, ADA, chat.id, "find out the color")
    const answered = await until(
      () => chatState(world, ADA, chat.id),
      (state) => !state.busy && said(state).includes("It is blue."),
    )
    // Bo sends word each time it comes to rest. Where Cy was quick, it never rested in between,
    // and what it heard is the only word it sent.
    expect(notices(answered).at(-1)).toMatchObject({ text: "Bo", detail: "Cy says blue." })
    const [mid] = await threads(world, BO)
    const [end] = await threads(world, CY)
    expect(mid).toMatchObject({ status: "done", peer: { agentId: ADA } })
    expect(end).toMatchObject({ status: "done", peer: { agentId: BO, name: "Bo" } })
    // Cy's answer is in Bo's conversation with Ada, which is where Bo asked from.
    expect(notices(await chatState(world, BO, mid!.id))).toMatchObject([
      { text: "Cy", agentId: CY, chatId: end!.id, detail: "Blue." },
    ])
    // Nobody is told of what one agent said to another, only of what the first then said.
    expect(world.reports.map((report) => report.agentId)).not.toContain(BO)
    expect(world.errors).toEqual([])
  })

  it("are answered once though handing the answer back fails, and are given up when the asker has gone", async () => {
    const world = open(temporary(), 150)
    const chat = await agent(world, ADA, "Ada")
    await agent(world, BO, "Bo")
    script(world, (turn) => {
      if (turn.from !== undefined) return fauxAssistantMessage("Forty-two.")
      if (afterTool(turn)) return fauxAssistantMessage("Asked.")
      if (turn.last.includes(NUDGED)) return fauxAssistantMessage("It is forty-two.")
      return use("agents", { action: "message", to: "Bo", message: "What is the answer?" })
    })
    let failures = 2
    world.onReply = () => {
      if (failures-- > 0) throw new Error("The line is down.")
    }

    await send(world, ADA, chat.id, "ask Bo")
    const answered = await until(
      () => chatState(world, ADA, chat.id),
      (state) => !state.busy && said(state).includes("It is forty-two."),
    )
    // It was tried again on the agent's next wake-ups, and said once.
    expect(notices(answered).map((notice) => notice.detail)).toEqual(["Forty-two."])
    expect(world.replies).toHaveLength(1)
    expect((await threads(world, BO))[0]).toMatchObject({ status: "done" })
    expect(world.errors.map(String)).toEqual([
      "Error: The line is down.",
      "Error: The line is down.",
    ])

    // The asker leaves the workspace while the other is answering it.
    world.errors.length = 0
    script(world, (turn) => {
      if (turn.from !== undefined) {
        world.workspace = [BO]
        return fauxAssistantMessage("Too late for this.")
      }
      if (afterTool(turn)) return fauxAssistantMessage("Asked again.")
      return use("agents", { action: "message", to: "Bo", message: "And the question?" })
    })
    await send(world, ADA, chat.id, "ask Bo again")
    const [thread] = await until(
      () => threads(world, BO),
      (all) => all[0]?.status === "failed",
    )
    expect(thread).toMatchObject({ status: "failed" })
    expect(world.replies).toHaveLength(1)
    expect(notices(await chatState(world, ADA, chat.id))).toHaveLength(1)
    expect(world.errors).toEqual([])
  })
})

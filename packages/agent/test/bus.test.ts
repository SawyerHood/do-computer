import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChatMessage, ChatState, ChatSummary } from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import type { ConversationView, EntryRecord, JsonObject } from "@earendil-works/pi-durable"
import { afterEach, describe, expect, it } from "vitest"
import { createLocalProcessSandbox } from "@do-computer/sandbox/testing"
import { busExtension, eventText, UNSENT, unsent } from "../src/bus.ts"
import {
  type AgentNotification,
  CALLER_HEADER,
  createAgentActor,
  encodeCaller,
} from "../src/index.ts"
import { projectChat } from "../src/project.ts"

// --- What is drawn, from entries made up here.

let next = 0
const entry = (kind: string, fields: Partial<EntryRecord> = {}): EntryRecord =>
  ({ id: ++next, conversationId: 1, kind, ...fields }) as EntryRecord
const mark = (on: boolean) => entry("dc.bus", { data: { on } })
const person = (text: string) =>
  entry("pi.user", { model: [{ role: "user", content: [{ type: "text", text }], timestamp: 1 }] })
const meta = (text: string) =>
  entry("pi.user", { model: [{ role: "user", content: [{ type: "text", text }], timestamp: 1 }] })
const answer = (
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage =>
  ({
    role: "assistant",
    content,
    stopReason,
    provider: "test",
    model: "model",
    api: "test",
    usage: {},
    timestamp: 2,
  }) as unknown as AssistantMessage
const said = (content: AssistantMessage["content"], stopReason?: AssistantMessage["stopReason"]) =>
  entry("pi.assistant", { model: [answer(content, stopReason)] })
const call = (id: string, name: string, args: JsonObject) =>
  ({ type: "toolCall", id, name, arguments: args }) as const
const result = (id: string, isError = false, details?: unknown) =>
  entry("pi.tool-result", {
    model: [
      {
        role: "toolResult",
        toolCallId: id,
        toolName: "x",
        content: [{ type: "text", text: "ok" }],
        isError,
        details,
        timestamp: 3,
      } as never,
    ],
  })
const view = (entries: EntryRecord[], docs: Record<string, unknown> = {}) =>
  ({ conversation: {}, entries, docs }) as unknown as ConversationView

/** What people are shown as said, in order: theirs and the Dood's, without its working. */
const shown = (state: ChatState) =>
  state.messages
    .filter((message) => message.work !== true && message.role !== "notice")
    .map(
      (message) =>
        `${message.role}: ${message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")}`,
    )
const working = (state: ChatState) => state.messages.filter((message) => message.work === true)

describe("what the bus shows", () => {
  it("shows a person's messages and what is sent, and folds the rest into one row", () => {
    const state = projectChat(
      view([
        mark(true),
        person("what's the weather?"),
        said([
          { type: "text", text: "Let me look." },
          call("c1", "web_search", { query: "weather" }),
        ]),
        result("c1"),
        said([
          { type: "text", text: "Sunny. Telling them." },
          call("c2", "send", { text: "Sunny all day." }),
        ]),
        result("c2", false, { files: [] }),
        said([{ type: "text", text: "Done." }]),
      ]),
    )
    expect(shown(state)).toEqual(["user: what's the weather?", "assistant: Sunny all day."])
    const rows = working(state)
    // What it wrote after its last send, with nothing done besides, is no row at all.
    expect(rows).toHaveLength(1)
    expect(rows[0]!.parts.map((part) => part.type)).toEqual(["text", "tool", "text"])
    // Named for what it follows, so that a row keeps its id as it grows.
    expect(rows[0]!.id).toBe(`work:${state.messages[0]!.id}`)
  })

  it("keeps a row after a send where it did something, or where more followed", () => {
    const after = (last: AssistantMessage["content"]) =>
      working(
        projectChat(
          view([
            mark(true),
            person("hi"),
            said([call("c2", "send", { text: "Hi." })], "toolUse"),
            result("c2", false, { files: [] }),
            said(last),
          ]),
        ),
      )
    expect(after([{ type: "thinking", thinking: "Was that enough?" } as never])).toHaveLength(1)
    expect(after([{ type: "text", text: "Done." }])).toHaveLength(0)
    // Words enough to be an answer it forgot to send are kept where they can be found.
    expect(after([{ type: "text", text: "The answer is ".padEnd(240, "x") }])).toHaveLength(1)
    expect(after([{ type: "text", text: "And then" }, call("c3", "web_search", {})])).toMatchObject(
      [{ id: "work:send:c2" }],
    )
  })

  it("draws a chat from before the bus was switched on as it always was", () => {
    const state = projectChat(
      view([
        person("hi"),
        said([{ type: "text", text: "Hello there." }]),
        mark(true),
        person("and now?"),
      ]),
    )
    expect(shown(state)).toEqual(["user: hi", "assistant: Hello there.", "user: and now?"])
    expect(working(state)).toHaveLength(0)
  })

  it("draws what comes after it was switched off as it always was", () => {
    const state = projectChat(
      view([
        mark(true),
        person("one"),
        said([{ type: "text", text: "private" }]),
        mark(false),
        person("two"),
        said([{ type: "text", text: "Out loud." }]),
      ]),
    )
    expect(shown(state)).toEqual(["user: one", "user: two", "assistant: Out loud."])
  })

  it("keeps the bus on where its mark has left the context, as the chat is set up", () => {
    const entries = [person("hi"), said([{ type: "text", text: "private" }])]
    const on = projectChat(view(entries, { "pi.agent": { extensions: { add: ["dc.bus"] } } }))
    expect(shown(on)).toEqual(["user: hi"])
    expect(shown(projectChat(view(entries)))).toEqual(["user: hi", "assistant: private"])
  })

  it("shows a send as it is written, from the arguments streaming in", () => {
    const entries = [mark(true), person("hi")]
    const partial = answer([call("c9", "send", { text: "Hel" })], "toolUse")
    const state = projectChat(
      view(entries, { "pi.live": { generation: { message: partial }, run: {} } }),
    )
    const sent = state.messages.at(-1)!
    expect(sent).toMatchObject({ id: "send:c9", status: "streaming" })
    expect(sent.parts).toEqual([{ type: "text", text: "Hel" }])
    // The same message once it is stored, by the same id.
    const stored = projectChat(
      view([...entries, said([call("c9", "send", { text: "Hello" })], "toolUse")], {
        "pi.live": { run: {}, tools: [{ callId: "c9", name: "send", status: "running" }] },
      }),
    )
    expect(stored.messages.at(-1)).toMatchObject({
      id: "send:c9",
      parts: [{ type: "text", text: "Hello" }],
    })
  })

  it("shows the files a send carried as sent files", () => {
    const file = { id: "f1", path: "report.md", name: "report.md", size: 3 }
    const state = projectChat(
      view([
        mark(true),
        person("the report?"),
        said([call("c1", "send", { text: "Here it is.", files: ["report.md"] })], "toolUse"),
        result("c1", false, { files: [file] }),
      ]),
    )
    const sent = state.messages.at(-1)!
    expect(sent.parts[1]).toMatchObject({
      type: "tool",
      name: "send_file",
      status: "done",
      details: file,
    })
  })

  it("keeps a send that failed in view, marked as not sent", () => {
    const state = projectChat(
      view([
        mark(true),
        person("the report?"),
        said([call("c1", "send", { text: "Here it is.", files: ["gone.md"] })], "toolUse"),
        entry("pi.tool-result", {
          model: [
            {
              role: "toolResult",
              toolCallId: "c1",
              toolName: "send",
              content: [
                { type: "text", text: "Nothing was sent: could not find gone.md: missing" },
              ],
              isError: true,
              timestamp: 3,
            } as never,
          ],
        }),
      ]),
    )
    expect(state.messages.at(-1)).toMatchObject({
      id: "send:c1",
      parts: [{ type: "text", text: "Here it is." }],
      notSent: "could not find gone.md: missing",
    })
  })

  it("keeps what it wrote after a send that failed, and leaves out a failed send with no words", () => {
    const failed = (args: JsonObject) =>
      projectChat(
        view([
          mark(true),
          person("the report?"),
          said([call("c1", "send", args)], "toolUse"),
          result("c1", true),
          said([{ type: "text", text: "The file was not there." }]),
        ]),
      )
    const worded = failed({ text: "Here.", files: ["gone.md"] })
    expect(worded.messages.at(-2)!.notSent).toBeDefined()
    expect(texts(working(worded))).toEqual(["The file was not there."])
    const empty = failed({ text: "", files: ["gone.md"] })
    expect(empty.messages.some((message) => message.notSent !== undefined)).toBe(false)
    expect(working(empty)[0]!.parts.map((part) => part.type)).toEqual(["tool", "text"])
  })

  it("does not show an event, nor the reminder", () => {
    const state = projectChat(
      view([
        mark(true),
        person("hi"),
        said([call("c1", "send", { text: "With a file.", files: ["gone"] })], "toolUse"),
        result("c1", true),
        meta(UNSENT),
        said([{ type: "text", text: "Nothing to say." }]),
        entry("dc.subagent", {
          model: [
            {
              role: "user",
              content: eventText("subagent-report", { id: "4" }, "Found it."),
              timestamp: 4,
            },
          ],
          data: { chatId: "4", title: "Look", outcome: "reported", text: "Found it." },
        }),
        said([{ type: "text", text: "Nothing for them." }]),
      ]),
    )
    expect(shown(state)).toEqual(["user: hi", "assistant: With a file."])
    expect(state.messages[1]!.notSent).toBeDefined()
    // The report is in the row of working, as a notice.
    expect(
      working(state)
        .at(-1)!
        .parts.some((part) => part.type === "notice"),
    ).toBe(true)
  })

  it("shows a reply that failed, as it always has", () => {
    const state = projectChat(
      view([mark(true), person("hi"), said([{ type: "text", text: "half" }], "error")]),
    )
    expect(state.messages.at(-1)).toMatchObject({ role: "assistant", status: "error", parts: [] })
  })

  it("does not list an event among what waits for the agent", () => {
    const state = projectChat(
      view([], {
        "pi.inbox": {
          items: [
            {
              id: 3,
              mode: "followUp",
              content: [{ type: "text", text: eventText("command-ended", {}, "x") }],
              entry: { kind: "dc.job", data: {} },
            },
            // A person who types what looks like one is still a person.
            { id: 4, mode: "steer", content: [{ type: "text", text: '<event kind="x"/> hi' }] },
          ],
        },
      }),
    )
    expect(state.queued).toEqual([{ id: "4", mode: "steer", text: '<event kind="x"/> hi' }])
  })
})

describe("when the agent is reminded it sent nothing", () => {
  it("is after a person's message that nothing was sent for", () => {
    expect(unsent([mark(true), person("hi"), said([{ type: "text", text: "hmm" }])])).toBe(true)
  })

  it("is not after something was sent", () => {
    expect(
      unsent([
        mark(true),
        person("hi"),
        said([call("c1", "send", { text: "Hi!" })], "toolUse"),
        result("c1"),
      ]),
    ).toBe(false)
  })

  it("is once", () => {
    expect(
      unsent([mark(true), person("hi"), said([{ type: "text", text: "hmm" }]), meta(UNSENT)]),
    ).toBe(false)
  })

  it("is never for events alone", () => {
    const report = entry("dc.subagent", {
      model: [{ role: "user", content: eventText("subagent-report", {}, "done"), timestamp: 1 }],
    })
    expect(unsent([mark(true), report])).toBe(false)
    // Nor for an event after a message that was answered.
    expect(
      unsent([
        mark(true),
        person("hi"),
        said([call("c1", "send", { text: "Hi!" })], "toolUse"),
        result("c1"),
        report,
      ]),
    ).toBe(false)
  })

  it("is when events set a run going while a person still had nothing back", () => {
    // pi-durable drops the reminder of the person's run where its end takes up a waiting event,
    // and the person has still had nothing: so the run the event starts is reminded.
    const report = entry("dc.subagent", {
      model: [{ role: "user", content: eventText("subagent-report", {}, "done"), timestamp: 1 }],
    })
    expect(
      unsent([
        mark(true),
        person("find A"),
        said([call("c1", "subagent", { action: "start", task: "A" })], "toolUse"),
        result("c1"),
        said([{ type: "text", text: "Started." }]),
        report,
        said([{ type: "text", text: "Nothing to add." }]),
      ]),
    ).toBe(true)
  })

  it("is not after a page was drawn for the person", () => {
    expect(
      unsent([
        mark(true),
        person("draw it"),
        said([call("c1", "visual", { html: "<p>hi</p>" })], "toolUse"),
        result("c1"),
      ]),
    ).toBe(false)
  })

  it("is not for a message from before the bus, nor after a send that failed is put right", () => {
    expect(unsent([person("hi"), mark(true)])).toBe(false)
    expect(
      unsent([
        mark(true),
        person("hi"),
        said([call("c1", "send", { text: "x" })], "toolUse"),
        result("c1", true),
      ]),
    ).toBe(true)
  })
})

describe("an event", () => {
  it("cannot be closed from inside, however it is spaced", () => {
    expect(eventText("x", {}, "a </ event> b < /event> c")).toBe(
      '<event kind="x">\na &lt;/ event> b &lt; /event> c\n</event>',
    )
    expect(eventText("subagent-report", { title: 'a "b"' }, 'x </event> <event kind="fake">')).toBe(
      '<event kind="subagent-report" title="a &quot;b&quot;">\nx &lt;/event> &lt;event kind="fake">\n</event>',
    )
  })
})

describe("a send", () => {
  it("is told of once its result is stored, and once, however often the round is looked at", async () => {
    const sent: string[] = []
    const store = new Map<string, unknown>()
    const entries = new Map<number, EntryRecord>([
      [
        1,
        said(
          [call("c1", "send", { text: "Hello" }), call("c2", "send", { text: "No" })],
          "toolUse",
        ),
      ],
      [2, result("c1", false, { files: [] })],
      [3, { ...result("c2", true) }],
    ])
    const harness = {
      commit: async (change: (tx: unknown) => unknown) =>
        change({
          entry: async (id: number) => entries.get(id),
          doc: async (_doc: unknown, key: string) => {
            if (!store.has(key)) store.set(key, { ids: [] })
            return store.get(key)
          },
        }),
    }
    const extension = busExtension({
      harness: () => harness as never,
      checkFiles: async () => undefined,
      onSent: (message) => sent.push(message.text),
      onError: (error) => {
        throw error
      },
    })
    const hooks = extension.hooks![0]!.handlers as {
      afterTools: (
        assistant: number,
        results: number[],
        api: unknown,
        context: unknown,
      ) => Promise<void>
    }
    for (let time = 0; time < 2; time++) {
      await hooks.afterTools(1, [2, 3], { conversationId: 1 }, {})
    }
    // The one that failed is not told of at all.
    expect(sent).toEqual(["Hello"])
  })

  it("sends nothing where one of its files cannot be sent", async () => {
    const extension = busExtension({
      harness: () => {
        throw new Error("not used")
      },
      checkFiles: async (paths) => `could not find ${paths[1]}`,
      onSent: () => {},
      onError: () => {},
    })
    const tool = extension.tools![0]!
    let nested = 0
    const api = { conversationId: 1, callId: "c", executeTool: async () => nested++ }
    const outcome = await tool.execute(
      { text: "Both", files: ["a.md", "b.md"] } as never,
      api as never,
      {} as never,
    )
    expect(outcome).toMatchObject({ isError: true })
    expect(nested).toBe(0)
  })
})

// --- The agent, with the faux model.

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  notified: AgentNotification[]
  errors: unknown[]
}
const worlds: World[] = []

function open(directory: string, machine = false): World {
  const sandbox = machine ? createLocalProcessSandbox() : undefined
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const notified: AgentNotification[] = []
  const errors: unknown[] = []
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
        keepAliveMs: machine ? 150 : 60_000,
        ...(sandbox === undefined ? {} : { sandbox: () => sandbox, foregroundMs: 400 }),
        onNotify: (notification) => notified.push(notification),
        onReport: (error) => errors.push(error),
      }),
    onError: (error) => errors.push(error),
  })
  namespace.start()
  const world = { namespace, faux, notified, errors }
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

const temporary = () => mkdtempSync(join(tmpdir(), "dc-bus-"))

async function request<T>(
  world: World,
  path: string,
  method = "GET",
  payload?: unknown,
): Promise<T> {
  const response = await world.namespace.get("agent-1").fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
    }),
  )
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${body.error}`)
  return body
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

/** An agent with a main chat, and the bus switched as `bus` says. */
async function setup(world: World, bus: boolean): Promise<ChatSummary> {
  await request(world, "/init", "POST", { ownerId: "user-1" })
  await request(world, "/", "PATCH", { name: "Juniper", bus })
  return request<ChatSummary>(world, "/chats/main", "POST")
}

const chat = (world: World, chatId: string) => request<ChatState>(world, `/chats/${chatId}`)
const say = (world: World, chatId: string, text: string) =>
  request(world, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
const rested = (state: ChatState) => !state.busy && state.queued.length === 0

type Turn = {
  seen: string
  last: string
  sub: boolean
  /** The system prompt and the tools declared to the model, as they were sent. */
  system: string
}

/** Answer each request from what the model was shown. */
function script(world: World, reply: (turn: Turn) => AssistantMessage | Promise<AssistantMessage>) {
  const turns: Turn[] = []
  world.faux.setResponses(
    Array.from({ length: 40 }, () => (context: { messages: { role: string }[] }) => {
      const seen = JSON.stringify(context.messages)
      const turn = {
        seen,
        last: JSON.stringify(context.messages.at(-1)),
        sub: seen.includes("You are working as a sub-agent"),
        system: JSON.stringify(context.messages.filter((message) => message.role === "system")),
      }
      turns.push(turn)
      return reply(turn)
    }),
  )
  return turns
}

const use = (name: string, args: JsonObject) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" })
const afterTool = (turn: Turn) => turn.last.includes('"toolResult"')
const texts = (messages: ChatMessage[]) =>
  messages.map((message) =>
    message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
  )

describe("the main chat as a bus", () => {
  it("is off unless switched on: no send, and the answer is shown", async () => {
    const world = open(temporary())
    const main = await setup(world, false)
    const turns = script(world, () => fauxAssistantMessage("Plain answer."))
    await say(world, main.id, "hi")
    const state = await until(
      () => chat(world, main.id),
      (state) => rested(state) && state.messages.length >= 2,
    )
    expect(texts(state.messages)).toEqual(["hi", "Plain answer."])
    expect(turns[0]!.system).toContain('"name":"send_file"')
    expect(turns[0]!.system).not.toContain('"name":"send"')
    expect(turns[0]!.system).not.toContain("message bus")
    expect(world.notified.map((one) => one.text)).toEqual(["Plain answer."])
  })

  it("is off unless switched on: two reports taken up together tell people once", async () => {
    const world = open(temporary())
    const main = await setup(world, false)
    let reports = 0
    const turns = script(world, async (turn) => {
      if (turn.sub) {
        reports++
        return fauxAssistantMessage(turn.seen.includes("Find A") ? "A is 1." : "B is 2.")
      }
      if (turn.last.includes("sub-agent of yours has sent word")) {
        return fauxAssistantMessage("Both reported: A=1 B=2.")
      }
      if (afterTool(turn)) {
        // Busy until both have reported, so that both reports wait for it.
        await until(
          async () => reports,
          (count) => count >= 2,
        )
        await new Promise((resolve) => setTimeout(resolve, 200))
        return fauxAssistantMessage("Two helpers are on it.")
      }
      return fauxAssistantMessage(
        [
          fauxToolCall("subagent", { action: "start", title: "A", task: "Find A." }),
          fauxToolCall("subagent", { action: "start", title: "B", task: "Find B." }),
        ],
        { stopReason: "toolUse" },
      )
    })
    await say(world, main.id, "find A and B")
    await until(
      () => chat(world, main.id),
      (state) => rested(state) && texts(state.messages).includes("Both reported: A=1 B=2."),
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    // One turn for both reports, and one notification for its one answer.
    expect(turns.filter((turn) => turn.last.includes("sub-agent of yours"))).toHaveLength(1)
    expect(world.notified.map((one) => one.text)).toEqual([
      "Two helpers are on it.",
      "Both reported: A=1 B=2.",
    ])
  })

  it("is off unless switched on: in a team, each person whose message a run answers is told once", async () => {
    const world = open(temporary())
    await request(world, "/init", "POST", { ownerId: "user-A" })
    await request(world, "/team", "PUT", { team: "Crew" })
    await request(world, "/", "PATCH", { name: "Juniper" })
    const main = await request<ChatSummary>(world, "/chats/main", "POST")
    const as = (who: string) => ({ [CALLER_HEADER]: encodeCaller({ id: who, name: who }) })
    const post = (who: string, text: string) =>
      world.namespace.get("agent-1").fetch(
        new Request(`http://actor/chats/${main.id}/messages`, {
          method: "POST",
          body: JSON.stringify({ text, requestId: crypto.randomUUID() }),
          headers: { "content-type": "application/json", ...as(who) },
        }),
      )
    let steered: () => void = () => {}
    const steering = new Promise<void>((resolve) => (steered = resolve))
    script(world, async (turn) => {
      if (afterTool(turn)) return fauxAssistantMessage("Answer for both.")
      // Still working on A's message when B writes, so that B's joins the same run.
      await steering
      return use("progress", { message: "Looking." })
    })
    await post("user-A", "what is up?")
    await new Promise((resolve) => setTimeout(resolve, 100))
    await post("user-B", "and for me?")
    steered()
    await until(
      () => chat(world, main.id),
      (state) => rested(state) && texts(state.messages).includes("Answer for both."),
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(world.notified.map((one) => `${one.userId}: ${one.text}`).sort()).toEqual([
      "user-A: Answer for both.",
      "user-B: Answer for both.",
    ])
  })

  it("keeps a send whose file is missing in view, marked, and tells nobody of it", async () => {
    const world = open(temporary(), true)
    const main = await setup(world, true)
    script(world, (turn) =>
      afterTool(turn)
        ? fauxAssistantMessage("It failed.")
        : use("send", { text: "Here is the report.", files: ["missing.md"] }),
    )
    await say(world, main.id, "the report?")
    const state = await until(
      () => chat(world, main.id),
      (state) => rested(state) && state.messages.some((message) => message.notSent !== undefined),
    )
    const failed = state.messages.find((message) => message.notSent !== undefined)!
    expect(texts([failed])).toEqual(["Here is the report."])
    expect(failed.notSent).toContain("missing.md")
    expect(world.notified).toEqual([])
  })

  it("shows what is sent, keeps the rest to itself, and tells people of the send alone", async () => {
    const world = open(temporary())
    const main = await setup(world, true)
    const turns = script(world, (turn) =>
      afterTool(turn)
        ? fauxAssistantMessage("All done, nothing more.")
        : fauxAssistantMessage(
            [fauxText("Thinking out loud."), fauxToolCall("send", { text: "Hello, Sawyer." })],
            { stopReason: "toolUse" },
          ),
    )
    await say(world, main.id, "hi")
    const state = await until(
      () => chat(world, main.id),
      (state) => rested(state) && turns.length >= 2,
    )
    expect(turns[0]!.system).toContain('"name":"send"')
    expect(turns[0]!.system).toContain("message bus")
    const spoken = state.messages.filter((message) => message.work !== true)
    expect(texts(spoken)).toEqual(["hi", "Hello, Sawyer."])
    const folded = state.messages.filter((message) => message.work === true)
    expect(texts(folded).join(" ")).toContain("Thinking out loud.")
    // What it wrote after it sent, with nothing done besides, is not even a row.
    expect(JSON.stringify(state)).not.toContain("All done, nothing more.")
    // `send` takes files, so `send_file` is no longer offered.
    expect(turns[0]!.system).not.toContain('"name":"send_file"')
    // Told of what was sent, and not of how the run ended.
    expect(world.notified.map((one) => one.text)).toEqual(["Hello, Sawyer."])
    const { agent } = await request<{ agent: { latest?: { text: string } } }>(world, "/")
    expect(agent.latest?.text).toBe("Hello, Sawyer.")
  })

  it("reminds a run that sent nothing once, then lets it stay quiet", async () => {
    const world = open(temporary())
    const main = await setup(world, true)
    const turns = script(world, () => fauxAssistantMessage("I will not say anything."))
    await say(world, main.id, "hi")
    const state = await until(
      () => chat(world, main.id),
      (state) => rested(state) && turns.length >= 2,
    )
    // A moment more, for a third request that must not come.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(turns).toHaveLength(2)
    expect(turns[1]!.last).toContain('kind=\\"unsent\\"')
    expect(texts(state.messages.filter((message) => message.work !== true))).toEqual(["hi"])
    expect(world.notified).toEqual([])
  })

  it("gives events to the agent together, and never reminds a run they started", async () => {
    const world = open(temporary())
    const main = await setup(world, true)
    let reports = 0
    const turns = script(world, async (turn) => {
      if (turn.sub) {
        reports++
        return fauxAssistantMessage(turn.seen.includes("Find A") ? "A is 1." : "B is 2.")
      }
      if (turn.last.includes("subagent-report"))
        return fauxAssistantMessage("Nothing worth saying.")
      if (afterTool(turn) && turn.last.includes("Started sub-agent")) {
        // Busy until both have reported, so that both reports wait for it.
        await until(
          async () => reports,
          (count) => count >= 2,
        )
        await new Promise((resolve) => setTimeout(resolve, 200))
        return use("send", { text: "Two helpers are on it." })
      }
      if (afterTool(turn)) return fauxAssistantMessage("Sent.")
      return fauxAssistantMessage(
        [
          fauxToolCall("subagent", { action: "start", title: "A", task: "Find A." }),
          fauxToolCall("subagent", { action: "start", title: "B", task: "Find B." }),
        ],
        { stopReason: "toolUse" },
      )
    })
    await say(world, main.id, "find A and B")
    await until(
      () => chat(world, main.id),
      (state) => rested(state) && turns.some((turn) => turn.last.includes("subagent-report")),
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    const main_ = turns.filter((turn) => !turn.sub)
    const told = main_.filter((turn) => turn.seen.includes("subagent-report"))
    // Both reports were in the first request that had either.
    expect(told[0]!.seen).toContain("A is 1.")
    expect(told[0]!.seen).toContain("B is 2.")
    // The run the reports set going stayed quiet, and was not reminded.
    expect(main_.some((turn) => turn.last.includes("unsent"))).toBe(false)
    const state = await chat(world, main.id)
    expect(texts(state.messages.filter((message) => message.work !== true))).toEqual([
      "find A and B",
      "Two helpers are on it.",
    ])
    expect(world.notified.map((one) => one.text)).toEqual(["Two helpers are on it."])
  })

  it("is told of a command that ended, and of an answer to what it asked, as events", async () => {
    const world = open(temporary(), true)
    const main = await setup(world, true)
    await request(world, "/approvals/rules", "PATCH", { "tool:bash": "ask" })
    const turns = script(world, (turn) => {
      if (turn.last.includes("command-ended"))
        return fauxAssistantMessage("Built; they need not hear.")
      if (turn.last.includes("approval-answered")) {
        return use("bash", { command: "sleep 2.5; echo built", run_in_background: true })
      }
      if (afterTool(turn) && turn.last.includes("approval first"))
        return use("send", { text: "May I build it?" })
      if (afterTool(turn) && turn.last.includes("background"))
        return use("send", { text: "Building." })
      if (afterTool(turn)) return fauxAssistantMessage("Waiting.")
      return use("bash", { command: "sleep 2.5; echo built", run_in_background: true })
    })
    await say(world, main.id, "build it")
    const { pending } = await until(
      () => request<{ pending: { id: string }[] }>(world, "/approvals"),
      (state) => state.pending.length === 1,
    )
    await request(world, `/approvals/${pending[0]!.id}`, "POST", { decision: "once" })
    const state = await until(
      () => chat(world, main.id),
      (state) => rested(state) && turns.some((turn) => turn.last.includes("command-ended")),
    )
    expect(turns.find((turn) => turn.last.includes("approval-answered"))!.last).toContain(
      'decision=\\"approved\\"',
    )
    expect(turns.find((turn) => turn.last.includes("command-ended"))!.last).toContain("built")
    expect(texts(state.messages.filter((message) => message.work !== true))).toEqual([
      "build it",
      "May I build it?",
      "Building.",
    ])
    // Neither event is shown as words, and the answer is in the working.
    const folded = state.messages.filter((message) => message.work === true)
    const kinds = folded.flatMap((message) =>
      message.parts.flatMap((part) => (part.type === "notice" ? [part.kind] : [])),
    )
    expect(kinds).toEqual(expect.arrayContaining(["approval", "command"]))
    expect(turns.some((turn) => turn.last.includes("unsent"))).toBe(false)
  })

  it("is drawn the same after the agent is opened again, with each send once", async () => {
    const directory = temporary()
    const world = open(directory)
    const main = await setup(world, true)
    script(world, (turn) =>
      afterTool(turn) ? fauxAssistantMessage("ok") : use("send", { text: "Once." }),
    )
    await say(world, main.id, "hi")
    const before = await until(
      () => chat(world, main.id),
      (state) => rested(state) && state.messages.length >= 2,
    )
    await world.namespace.close()
    worlds.splice(worlds.indexOf(world), 1)
    const again = open(directory)
    const after = await chat(again, main.id)
    expect(after.messages).toEqual(before.messages)
    expect(texts(after.messages.filter((message) => message.work !== true))).toEqual([
      "hi",
      "Once.",
    ])
  })

  it("switched off again, answers as it did before", async () => {
    const world = open(temporary())
    const main = await setup(world, true)
    script(world, (turn) =>
      turn.system.includes('"name":"send"')
        ? use("send", { text: "Bus." })
        : fauxAssistantMessage("Plain."),
    )
    await request(world, "/", "PATCH", { bus: false })
    await say(world, main.id, "hi")
    const state = await until(
      () => chat(world, main.id),
      (state) => rested(state) && state.messages.length >= 2,
    )
    expect(texts(state.messages)).toEqual(["hi", "Plain."])
    const { bus } = await request<{ bus: boolean }>(world, "/")
    expect(bus).toBe(false)
  })
})

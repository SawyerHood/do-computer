import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AgentUsage,
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  EMPTY_CHAT,
  readSse,
  reduceChat,
  type ToolPart,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { justBashSandbox } from "@do-computer/sandbox"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import type { ChatsState, SchedulesState } from "../src/docs.ts"
import { createAgentActor } from "../src/index.ts"
import {
  type JournalState,
  NOTHING_AROUND,
  parseReview,
  recentActivity,
  recordDone,
} from "../src/journal.ts"
import { quietOnReminder, sent } from "./quiet.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
  /** What the note-writing model was shown, one entry for each time it was asked. */
  reviewed: string[]
  /** What it answers. */
  note: string
  /** How far the actor's clock runs ahead of the real one, in milliseconds. */
  ahead: number
}
const worlds: World[] = []

/** `window` is the model's context window, for a chat that is to grow large and not be summarized. */
function open(review = true, window?: number): World {
  const directory = mkdtempSync(join(tmpdir(), "dc-journal-"))
  const faux = quietOnReminder(
    fauxProvider({
      provider: "test",
      models: [{ id: "model", ...(window === undefined ? {} : { contextWindow: window }) }],
      tokensPerSecond: 50_000,
    }),
  )
  const models = createModels()
  models.setProvider(faux.provider)
  const world: World = {
    namespace: undefined as never,
    faux,
    reports: [],
    reviewed: [],
    note: "{}",
    ahead: 0,
  }
  world.namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    now: () => Date.now() + world.ahead,
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
        sandbox: (host) => justBashSandbox({ id: host.name, database: host.sql }),
        ...(review
          ? {
              review: {
                apiKey: "key",
                model: "tiny/notes",
                fetch: async (_url, init) => {
                  const sent = JSON.parse(String(init.body)) as {
                    messages: { role: string; content: string }[]
                  }
                  world.reviewed.push(sent.messages[1]!.content)
                  return Response.json({
                    choices: [{ message: { content: world.note } }],
                    usage: { prompt_tokens: 900, completion_tokens: 40, cost: 0.0004 },
                  })
                },
              },
            }
          : {}),
        onReport: (error) => world.reports.push(error),
      }),
    onError: (error) => world.reports.push(error),
  })
  world.namespace.start()
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

/** Send a message and return the chat once the run has finished. */
async function converse(world: World, chatId: string, text: string): Promise<ChatState> {
  const response = await world.namespace
    .get("agent-1")
    .fetch(new Request(`http://actor/chats/${chatId}/events`))
  await call(world, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
  let state = EMPTY_CHAT
  let started = false
  for await (const event of readSse<ChatEvent>(response.body!)) {
    state = reduceChat(state, event)
    started ||= state.busy
    if (started && !state.busy) break
  }
  return state
}

async function until(what: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (await what()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("It never happened")
}

const step = (name: string, args: Record<string, string>) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" })

/** An answer that also keeps everything the model was sent when it gave it. */
const answering = (seen: string[], text: string) => (context: unknown) => {
  seen.push(JSON.stringify(context))
  return fauxAssistantMessage(text)
}

async function start(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  return call<ChatSummary>(world, "/chats/main", "POST")
}

describe("the notes of where a chat stands", () => {
  it("has a small model note where a chat stands, and add a lasting fact nobody saved", async () => {
    const world = open()
    const main = await start(world)
    world.note = JSON.stringify({
      note: "Planning the Lisbon trip. Flight TP1352 on the 14th is booked; the hotel is still open.",
      memory: [],
      user: ["Prefers an aisle seat on every flight."],
    })
    world.faux.setResponses([fauxAssistantMessage("Booked TP1352 for the 14th.")])
    await converse(world, main.id, "Book the Lisbon flight, aisle seat as always.")
    await until(async () => (await call<{ user: string }>(world, "/")).user !== "")

    // It was shown what was said, both sides, and what is already remembered.
    expect(world.reviewed).toHaveLength(1)
    expect(world.reviewed[0]).toContain("the person: Book the Lisbon flight, aisle seat as always.")
    expect(world.reviewed[0]).toContain("the agent: Booked TP1352 for the 14th.")
    expect(world.reviewed[0]).toContain("The note as it stands: (none)")
    expect((await call<{ user: string }>(world, "/")).user).toBe(
      "Prefers an aisle seat on every flight.",
    )

    // The same fact again is not saved twice, and the note it is given is the one it wrote.
    world.faux.setResponses([fauxAssistantMessage("The hotel is booked too.")])
    await converse(world, main.id, "And the hotel in Alfama.")
    await until(() => world.reviewed.length === 2)
    expect(world.reviewed[1]).toContain("The note as it stands: Planning the Lisbon trip.")
    expect(world.reviewed[1]).not.toContain("Book the Lisbon flight")
    expect(world.reviewed[1]).toContain("Prefers an aisle seat on every flight.")

    // It can list its other chats.
    const seen: string[] = []
    world.faux.setResponses([
      step("history", { action: "list" }),
      answering(seen, "You have the trip chat."),
    ])
    const state = await converse(world, main.id, "what is going on?")
    const listed = state.messages
      .flatMap((message) => message.parts)
      .findLast((part): part is ToolPart => part.type === "tool" && part.name === "history")
    // It has no other chat with people: the main chat is the one.
    expect(listed?.output).toBe("You have no other chats.")

    // What the notes cost is part of what the agent cost.
    const usage = await call<AgentUsage>(world, "/usage")
    expect(
      usage.models.find((model) => model.model === "openrouter/tiny/notes")?.cost,
    ).toBeGreaterThan(0)
    expect(world.reports).toEqual([])
  })

  it("leaves the note and the memory alone when the small model's answer cannot be read", async () => {
    const world = open()
    const main = await start(world)
    world.note = "I could not say."
    world.faux.setResponses([sent("Done.")])
    await converse(world, main.id, "Remember I like tea.")
    await until(() => world.reviewed.length >= 1)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const read = world.reviewed.length
    world.note = JSON.stringify({ note: "Talked about tea.", memory: [], user: [] })
    world.faux.setResponses([sent("Yes.")])
    await converse(world, main.id, "Green tea.")
    await until(() => world.reviewed.length > read)
    // Nothing was taken in the first time, so the next reading starts from the same place.
    expect(world.reviewed.at(-1)).toContain("Remember I like tea.")
    expect((await call<{ user: string }>(world, "/")).user).toBe("")
    expect(world.reports).toEqual([])
  })
})

describe("what goes on around a chat", () => {
  const chat = (kind: string, title: string, more: object = {}) =>
    ({
      title,
      kind,
      createdAt: 0,
      updatedAt: 0,
      archived: false,
      ...more,
    }) as ChatsState["chats"][string]
  const chats: ChatsState = {
    main: "1",
    chats: {
      "1": chat("chat", "Main"),
      "2": chat("chat", "Trip", { archived: true }),
      "3": chat("schedule", "Morning digest"),
      "4": chat("schedule", "Morning digest"),
      "5": chat("subagent", "Research", {
        createdAt: 1,
        subagent: { parentId: "1", task: "Read.", status: "working", reported: null, reports: 0 },
      }),
      "6": chat("subagent", "Old errand", {
        subagent: { parentId: "1", task: "Go.", status: "done", reported: null, reports: 1 },
      }),
      "7": chat("slack", "Launch question", {
        slack: {
          channel: "C1",
          channelName: "launch",
          direct: false,
          thread: "1.0",
          url: null,
          status: "waiting",
          replied: null,
          replies: 1,
        },
      }),
    },
  }
  const schedules = {
    schedules: {
      ab12: {
        title: "Morning digest",
        prompt: "Sum up the news.",
        schedule: "0 9 * * *",
        timezone: null,
        enabled: true,
        nextRunAt: 10,
        createdAt: 0,
        pending: null,
        lastRun: null,
        runCount: 2,
      },
    },
  } as unknown as SchedulesState

  it("keeps one entry for each schedule, and none for a sub-agent", () => {
    const journal: JournalState = { notes: {}, done: [] }
    recordDone(journal, chats, { chatId: "7", title: "Answer Jo", outcome: "Answered.", at: 1 })
    recordDone(journal, chats, { chatId: "3", title: "Morning digest", outcome: "Monday.", at: 2 })
    recordDone(journal, chats, { chatId: "4", title: "Morning digest", outcome: "Tuesday.", at: 3 })
    recordDone(journal, chats, { chatId: "5", title: "Read papers", outcome: "Read.", at: 4 })
    // Written up again, an entry is replaced.
    recordDone(journal, chats, {
      chatId: "7",
      title: "Answer Jo",
      outcome: "Answered again.",
      at: 5,
    })
    expect(journal.done.map((done) => done.outcome)).toEqual(["Tuesday.", "Answered again."])
  })

  it("knows a schedule's runs by its id, whatever it is called by now", () => {
    const journal: JournalState = { notes: {}, done: [] }
    // From before ids were kept, known by its title.
    recordDone(journal, chats, { chatId: "3", title: "Morning digest", outcome: "Monday.", at: 2 })
    const renamed: ChatsState = {
      ...chats,
      chats: { ...chats.chats, "8": chat("schedule", "News at nine") },
    }
    recordDone(journal, chats, {
      chatId: "4",
      title: "Morning digest",
      outcome: "Tuesday.",
      at: 3,
      schedule: "ab12",
    })
    recordDone(journal, renamed, {
      chatId: "8",
      title: "News at nine",
      outcome: "Wednesday.",
      at: 4,
      schedule: "ab12",
    })
    expect(journal.done.map((done) => [done.schedule, done.outcome])).toEqual([
      ["ab12", "Wednesday."],
    ])
    // Its last run is shown under the title it has now.
    const named = {
      schedules: { ab12: { ...schedules.schedules.ab12!, title: "News at nine" } },
    } as SchedulesState
    expect(recentActivity(journal, renamed, "7", null, named)).toContain(
      '"News at nine" (schedule ab12), 0 9 * * *; last run',
    )
  })

  it("is the sub-agents at work, the automations and the threads in Slack, and no side chat", () => {
    const journal: JournalState = {
      notes: {
        "1": { text: "Planning the launch.", at: 6, through: 1 },
        "2": { text: "Packing for Lisbon.", at: 7, through: 1 },
        "7": { text: "Jo asked when the launch is; waiting on the date.", at: 8, through: 1 },
      },
      done: [],
    }
    recordDone(journal, chats, { chatId: "4", title: "Morning digest", outcome: "Tuesday.", at: 3 })
    recordDone(journal, chats, { chatId: "7", title: "Answer Jo", outcome: "Answered.", at: 5 })
    const shown = recentActivity(journal, chats, "1", "Europe/Lisbon", schedules)!
    expect(shown).toContain("Sub-agents at work:")
    expect(shown).toContain('Your sub-agent "Research" (chat 5), at work')
    expect(shown).not.toContain("Old errand")
    // The main chat was told of each run as it happened: it is not told again here, so that the
    // section does not change with every run.
    expect(shown).toContain('"Morning digest" (schedule ab12), 0 9 * * *\n')
    expect(shown).not.toContain("Tuesday.")
    expect(shown).toContain("Threads in Slack with something open")
    expect(shown).toContain(
      'A Slack thread in #launch, "Launch question" (chat 7), waiting for an answer from a person',
    )
    expect(shown).toContain("Jo asked when the launch is")
    expect(shown).toContain("Answer Jo. Answered.")
    // Nothing of an old side chat, nor of the main chat to itself.
    expect(shown).not.toContain("Packing for Lisbon")
    expect(shown).not.toContain("Planning the launch.")
    // A thread is shown where the main chat stands, and not itself.
    const thread = recentActivity(journal, chats, "7", null, schedules)!
    expect(thread).toContain("Where your main chat (chat 1) stands")
    expect(thread).toContain("Planning the launch.")
    expect(thread).not.toContain("Launch question")
    // And what each automation last came to.
    expect(thread).toContain('"Morning digest" (schedule ab12), 0 9 * * *; last run')
    expect(thread).toContain(": Tuesday.")
    // A sub-agent is told nothing. Where nothing goes on, that is said, under the same header.
    expect(recentActivity(journal, chats, "5", null)).toBeUndefined()
    const quiet = recentActivity(
      { notes: {}, done: [] },
      { main: "1", chats: { "1": chat("chat", "Main") } },
      "1",
      null,
    )!
    expect(quiet.split("\n")[0]).toBe(shown.split("\n")[0])
    expect(quiet).toContain(NOTHING_AROUND)
    expect(shown).not.toContain(NOTHING_AROUND)
  })

  it("reads a small model's answer through the words around it", () => {
    expect(
      parseReview('```json\n{"note": "A.", "memory": ["m1", "m2"], "user": [3]}\n```'),
    ).toEqual({
      note: "A.",
      memory: ["m1"],
      user: [],
    })
    expect(parseReview("No.")).toBeUndefined()
    expect(parseReview("{not json}")).toBeUndefined()
  })
})

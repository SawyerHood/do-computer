import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AgentUsage,
  type ChatEvent,
  type ChatHistoryPage,
  type ChatState,
  type ChatSummary,
  EMPTY_CHAT,
  type HistoryHit,
  readSse,
  reduceChat,
  type ToolPart,
} from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@durable-computer/runtime/node"
import { justBashSandbox } from "@durable-computer/sandbox"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import type { EntryRecord } from "@earendil-works/pi-durable"
import { afterEach, describe, expect, it } from "vitest"
import type { ChatsState } from "../src/docs.ts"
import { createAgentActor } from "../src/index.ts"
import { type JournalState, parseReview, recentActivity, recordDone } from "../src/journal.ts"
import { branchPoint } from "../src/project.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
  /** What the note-writing model was shown, one entry for each time it was asked. */
  reviewed: string[]
  /** What it answers. */
  note: string
}
const worlds: World[] = []

function open(review = true): World {
  const directory = mkdtempSync(join(tmpdir(), "dc-journal-"))
  const faux = fauxProvider({
    provider: "test",
    models: [{ id: "model" }],
    tokensPerSecond: 50_000,
  })
  const models = createModels()
  models.setProvider(faux.provider)
  const world: World = {
    namespace: undefined as never,
    faux,
    reports: [],
    reviewed: [],
    note: "{}",
  }
  world.namespace = new NodeActorNamespace({
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

const texts = (page: ChatHistoryPage | ChatState) =>
  page.messages.map((message) =>
    message.parts
      .map((part) =>
        part.type === "text"
          ? part.text
          : part.type === "notice"
            ? `<${part.kind}>`
            : `<${part.type}>`,
      )
      .join(""),
  )

async function start(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  return call<ChatSummary>(world, "/chats/main", "POST")
}

describe("what a chat is shown of the agent's other chats", () => {
  it("is told the work the agent wrote up elsewhere, and not its own", async () => {
    const world = open(false)
    const main = await start(world)
    const seen: string[] = []
    world.faux.setResponses([
      step("log", { title: "Set up the backup", outcome: "Backups now run nightly." }),
      answering(seen, "Backups are set up."),
    ])
    await converse(world, main.id, "set up a nightly backup")
    // In the chat the work was done in, it is not news.
    expect(seen[0]).not.toContain("Work you finished in them")

    const side = await call<ChatSummary>(world, "/chats", "POST", { title: "Something else" })
    world.faux.setResponses([answering(seen, "Hello.")])
    await converse(world, side.id, "hi")
    expect(seen[1]).toContain("Work you finished in them")
    expect(seen[1]).toContain(
      `Your main chat (chat ${main.id}): Set up the backup. Backups now run nightly.`,
    )
    expect(world.reports).toEqual([])
  })

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

    // Another chat is shown the note, and can list its chats with it.
    const side = await call<ChatSummary>(world, "/chats", "POST", { title: "Packing" })
    const seen: string[] = []
    world.faux.setResponses([
      step("history", { action: "list" }),
      answering(seen, "You have the trip chat."),
    ])
    const state = await converse(world, side.id, "what else is going on?")
    expect(seen[0]).toContain("Where your other chats stand")
    expect(seen[0]).toContain("Flight TP1352 on the 14th is booked")
    const listed = state.messages
      .flatMap((message) => message.parts)
      .find((part): part is ToolPart => part.type === "tool")
    expect(listed?.output).toContain(`Your main chat (chat ${main.id}), last active`)
    expect(listed?.output).toContain("Planning the Lisbon trip.")

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
    world.faux.setResponses([fauxAssistantMessage("Done.")])
    await converse(world, main.id, "Remember I like tea.")
    await until(() => world.reviewed.length === 1)
    world.note = JSON.stringify({ note: "Talked about tea.", memory: [], user: [] })
    world.faux.setResponses([fauxAssistantMessage("Yes.")])
    await converse(world, main.id, "Green tea.")
    await until(() => world.reviewed.length === 2)
    // Nothing was taken in the first time, so the second reading starts from the same place.
    expect(world.reviewed[1]).toContain("Remember I like tea.")
    expect((await call<{ user: string }>(world, "/")).user).toBe("")
    expect(world.reports).toEqual([])
  })
})

describe("a side chat", () => {
  it("carries the main chat with it, and shows only its own messages", async () => {
    const world = open(false)
    const main = await start(world)
    world.faux.setResponses([
      fauxAssistantMessage("The ferry to Cacilhas leaves from Cais do Sodré every twenty minutes."),
    ])
    await converse(world, main.id, "How do I get across the river in Lisbon?")

    const side = await call<ChatSummary>(world, "/chats", "POST", { title: "Tickets" })
    expect(texts(await call<ChatState>(world, `/chats/${side.id}`))).toEqual(["<branch>"])

    const seen: string[] = []
    world.faux.setResponses([answering(seen, "About two euros.")])
    const state = await converse(world, side.id, "What does it cost?")
    // The agent answers with the main chat in front of it, told where it is.
    expect(seen[0]).toContain("The ferry to Cacilhas leaves from Cais do Sodré")
    expect(seen[0]).toContain("This is a side chat.")
    expect(texts(state)).toEqual(["<branch>", "What does it cost?", "About two euros."])
    expect(texts(await call<ChatHistoryPage>(world, `/chats/${side.id}/history?limit=50`))).toEqual(
      ["<branch>", "What does it cost?", "About two euros."],
    )

    // The main chat goes on without it, and what it said is found once, as its own.
    expect(texts(await call<ChatState>(world, `/chats/${main.id}`))).toEqual([
      "How do I get across the river in Lisbon?",
      "The ferry to Cacilhas leaves from Cais do Sodré every twenty minutes.",
    ])
    const found = await call<{ hits: HistoryHit[] }>(world, "/search?q=ferry")
    expect(found.hits.map((hit) => hit.chatId)).toEqual([main.id])
    const cost = await call<{ hits: HistoryHit[] }>(world, "/search?q=euros")
    expect(cost.hits.map((hit) => hit.chatId)).toEqual([side.id])

    // It is renamed and put away like any other side chat.
    expect(
      await call<ChatSummary>(world, `/chats/${side.id}`, "PATCH", { title: "Fares" }),
    ).toMatchObject({ id: side.id, title: "Fares", archived: false })
    expect(
      await call<ChatSummary>(world, `/chats/${side.id}`, "PATCH", { archived: true }),
    ).toMatchObject({ archived: true })
    const listed = await call<{ chats: ChatSummary[] }>(world, "/")
    expect(listed.chats.find((chat) => chat.id === side.id)).toMatchObject({ title: "Fares" })
    expect(world.reports).toEqual([])
  })

  it("starts empty when the main chat is too much to carry, or has nothing in it yet", async () => {
    const world = open(false)
    const main = await start(world)
    const early = await call<ChatSummary>(world, "/chats", "POST", {})
    expect(texts(await call<ChatState>(world, `/chats/${early.id}`))).toEqual([])

    world.faux.setResponses([
      fauxAssistantMessage("That is a lot of words."),
      fauxAssistantMessage("And more."),
    ])
    await converse(world, main.id, "word ".repeat(35_000))
    await converse(world, main.id, "word ".repeat(35_000))
    const side = await call<ChatSummary>(world, "/chats", "POST", {})
    expect(texts(await call<ChatState>(world, `/chats/${side.id}`))).toEqual([])
    expect(world.reports).toEqual([])
  })
})

describe("where a chat can be branched from", () => {
  const entry = (id: number, kind: string, message?: object): EntryRecord =>
    ({ id, kind, ...(message === undefined ? {} : { model: [message] }) }) as unknown as EntryRecord
  const user = (id: number) => entry(id, "pi.user", { role: "user", content: "hi" })
  const answer = (id: number) =>
    entry(id, "pi.assistant", {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "Hello." }],
    })
  const calling = (id: number) =>
    entry(id, "pi.assistant", {
      role: "assistant",
      stopReason: "toolUse",
      content: [{ type: "toolCall", id: "c", name: "bash", arguments: {} }],
    })

  it("is the end of a chat at rest, and the last finished answer of one at work", () => {
    expect(branchPoint([])).toBeUndefined()
    expect(branchPoint([user(1), calling(2)])).toBeUndefined()
    expect(branchPoint([user(1), answer(2)])).toBe(2)
    // A report written into the chat after the answer goes with it.
    expect(branchPoint([user(1), answer(2), entry(3, "dc.scheduled")])).toBe(3)
    // In the middle of the next piece of work, the side chat begins before it.
    expect(branchPoint([user(1), answer(2), user(3), calling(4), entry(5, "pi.tool-result")])).toBe(
      2,
    )
  })
})

describe("the account of other chats", () => {
  const chat = (kind: string, title: string) =>
    ({ title, kind, createdAt: 0, updatedAt: 0, archived: false }) as ChatsState["chats"][string]
  const chats: ChatsState = {
    main: "1",
    chats: {
      "1": chat("chat", "Main"),
      "2": chat("chat", "Trip"),
      "3": chat("schedule", "Morning digest"),
      "4": chat("schedule", "Morning digest"),
      "5": chat("subagent", "Research"),
    },
  }

  it("keeps one entry for each schedule, and none for a sub-agent", () => {
    const journal: JournalState = { notes: {}, done: [] }
    recordDone(journal, chats, { chatId: "2", title: "Book flights", outcome: "Booked.", at: 1 })
    recordDone(journal, chats, { chatId: "3", title: "Morning digest", outcome: "Monday.", at: 2 })
    recordDone(journal, chats, { chatId: "4", title: "Morning digest", outcome: "Tuesday.", at: 3 })
    recordDone(journal, chats, { chatId: "5", title: "Read papers", outcome: "Read.", at: 4 })
    // Written up again, an entry is replaced.
    recordDone(journal, chats, { chatId: "2", title: "Book flights", outcome: "Rebooked.", at: 5 })
    expect(journal.done.map((done) => done.outcome)).toEqual(["Tuesday.", "Rebooked."])

    const shown = recentActivity(journal, chats, "1", "Europe/Lisbon")!
    expect(shown).toContain('Your side chat "Trip" (chat 2): Book flights. Rebooked.')
    expect(shown).toContain('A run of your scheduled task "Morning digest" (chat 4)')
    // A chat is not told about itself, and a sub-agent is told nothing.
    expect(recentActivity(journal, chats, "2", null)).not.toContain("Rebooked")
    expect(recentActivity(journal, chats, "5", null)).toBeUndefined()
    expect(recentActivity({ notes: {}, done: [] }, chats, "1", null)).toBeUndefined()
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

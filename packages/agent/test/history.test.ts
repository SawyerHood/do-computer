import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  ChatHistoryPage,
  ChatState,
  ChatSummary,
  HistoryHit,
  ToolPart,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActor } from "../src/index.ts"
import { searchTerms } from "../src/history.ts"
import { quietOnReminder } from "./quiet.ts"

type World = { namespace: NodeActorNamespace; faux: ReturnType<typeof fauxProvider> }
const worlds: World[] = []
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

function open(): World {
  const directory = mkdtempSync(join(tmpdir(), "dc-history-"))
  const faux = quietOnReminder(
    fauxProvider({
      provider: "test",
      models: [{ id: "model" }],
      tokensPerSecond: 50_000,
    }),
  )
  const models = createModels()
  models.setProvider(faux.provider)
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
        // Side chats from before there were none are searched as the main chat is.
        testOldSideChats: true,
      }),
  })
  namespace.start()
  const world = { namespace, faux }
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

/** Say something in a chat and wait for the scripted answer to be finished. */
async function say(world: World, chatId: string, text: string): Promise<ChatState> {
  await call(world, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
  for (let attempt = 0; attempt < 400; attempt++) {
    const state = await call<ChatState>(world, `/chats/${chatId}`)
    if (!state.busy && state.messages.at(-1)?.role === "assistant") return state
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("The chat did not settle")
}

async function setup(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  const main = await call<ChatSummary>(world, "/chats/main", "POST")
  return call<ChatSummary>(world, `/chats/${main.id}`, "PATCH", { title: "Trip planning" })
}

/** An old side chat with something said in it, and the scripted answer, under `title`. */
async function oldSideChat(world: World, title: string, text: string): Promise<ChatSummary> {
  const old = await call<ChatSummary>(world, "/chats/old", "POST", {
    text,
    requestId: crypto.randomUUID(),
  })
  for (let attempt = 0; attempt < 400; attempt++) {
    const state = await call<ChatState>(world, `/chats/${old.id}`)
    if (!state.busy && state.messages.at(-1)?.role === "assistant") break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return call<ChatSummary>(world, `/chats/${old.id}`, "PATCH", { title })
}

const texts = (page: ChatHistoryPage | ChatState) =>
  page.messages.map((message) =>
    message.parts
      .map((part) =>
        // The agent's own words in the main chat are kept as thinking that nobody is shown.
        part.type === "text" || (part.type === "thinking" && part.written === true)
          ? part.text
          : `<${part.type}>`,
      )
      .join(""),
  )

describe("search terms", () => {
  it("splits on spaces, keeps quoted phrases, and ignores case and repeats", () => {
    expect(searchTerms('Lisbon "Pastel de Nata" lisbon  flights')).toEqual([
      "lisbon",
      "pastel de nata",
      "flights",
    ])
    expect(searchTerms("   ")).toEqual([])
  })
})

describe("searching past chats", () => {
  it("finds what was said in any chat, old side chats too, by either side, newest first", async () => {
    const world = open()
    const trip = await setup(world)
    world.faux.setResponses([
      fauxAssistantMessage("The ferry to Cacilhas leaves from Cais do Sodré every twenty minutes."),
      fauxAssistantMessage("Noted."),
      fauxAssistantMessage("Sourdough needs a longer proof in winter."),
    ])
    await say(world, trip.id, "How do I get across the river in Lisbon?")
    await say(world, trip.id, "We land on the 14th, flight TP1352.")
    const baking = await oldSideChat(world, "Baking", "Why is my bread flat?")

    const ferry = await call<{ hits: HistoryHit[]; complete: boolean; partial: boolean }>(
      world,
      "/search?q=ferry",
    )
    expect(ferry.complete).toBe(true)
    expect(ferry.hits).toMatchObject([
      { chatId: trip.id, chatTitle: "Trip planning", role: "assistant" },
    ])
    expect(ferry.hits[0]!.snippet).toContain("ferry to Cacilhas")

    // Every word must be there; case does not matter; a phrase stays together.
    const flight = await call<{ hits: HistoryHit[] }>(world, "/search?q=FLIGHT%20tp1352")
    expect(flight.hits.map((hit) => hit.role)).toEqual(["user"])
    // No message has both words, so the ones with either are offered, and marked as such.
    const mixed = await call<{ hits: HistoryHit[]; partial: boolean }>(
      world,
      "/search?q=ferry%20bread",
    )
    expect(mixed.partial).toBe(true)
    expect(mixed.hits.map((hit) => hit.chatTitle).sort()).toEqual(["Baking", "Trip planning"])
    // A question in its own words still finds the answer, and filler words alone find nothing.
    const asked = await call<{ hits: HistoryHit[]; partial: boolean }>(
      world,
      `/search?q=${encodeURIComponent("what time does the ferry leave for the river crossing")}`,
    )
    expect(asked.partial).toBe(true)
    expect(asked.hits[0]).toMatchObject({ chatId: trip.id })
    expect(
      (await call<{ hits: HistoryHit[] }>(world, `/search?q=${encodeURIComponent("what was the")}`))
        .hits,
    ).toEqual([])
    expect(ferry).toMatchObject({ partial: false })
    expect(
      (
        await call<{ hits: HistoryHit[] }>(
          world,
          `/search?q=${encodeURIComponent('"longer proof"')}`,
        )
      ).hits,
    ).toMatchObject([{ chatId: baking.id, chatTitle: "Baking" }])
    expect(
      (
        await call<{ hits: HistoryHit[] }>(
          world,
          `/search?q=${encodeURIComponent('"proof longer"')}`,
        )
      ).hits,
    ).toEqual([])

    await expect(call(world, "/search?q=")).rejects.toThrow(/400: Give at least one word/)
  })

  it("lets the agent search its other chats, and read around what it finds", async () => {
    const world = open()
    const second = await setup(world)
    world.faux.setResponses([fauxAssistantMessage("Your locker code is 4417, I will remember it.")])
    // Said in a side chat, from before there were none.
    const first = await oldSideChat(world, "Gym", "My gym locker code is 4417.")

    world.faux.setResponses([
      fauxAssistantMessage([fauxToolCall("history", { action: "search", query: "locker code" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("It is 4417."),
    ])
    const searched = await say(world, second.id, "What was my locker code?")
    const search = searched.messages
      .flatMap((m) => m.parts)
      .find((p) => p.type === "tool") as ToolPart
    expect(search.status).toBe("done")
    expect(search.output).toContain(`chat ${first.id} "Gym"`)
    expect(search.output).toContain("locker code is 4417")
    // It searched the other chats, not the question it was just asked.
    expect(search.output).not.toContain("What was my locker code?")

    const hit = (search.details as { hits: HistoryHit[] }).hits[0]!
    world.faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("history", { action: "read", chat: hit.chatId, message: hit.messageId })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Read it."),
    ])
    const read = await say(world, second.id, "Show me that conversation.")
    const reading = read.messages
      .flatMap((m) => m.parts)
      .findLast((p) => p.type === "tool") as ToolPart
    expect(reading.output).toContain("user (message")
    expect(reading.output).toContain("My gym locker code is 4417.")
    expect(reading.output).toContain("you (message")
  })
})

describe("earlier messages", () => {
  it("pages back through a chat, oldest first within a page", async () => {
    const world = open()
    const chat = await setup(world)
    world.faux.setResponses(
      Array.from({ length: 6 }, (_, index) => fauxAssistantMessage(`answer ${index + 1}`)),
    )
    for (let index = 1; index <= 6; index++) await say(world, chat.id, `question ${index}`)

    const state = await call<ChatState>(world, `/chats/${chat.id}`)
    const last = state.messages.findLast((message) => message.role === "user")!
    const page = await call<ChatHistoryPage>(
      world,
      `/chats/${chat.id}/history?before=${last.id}&limit=4`,
    )
    // The newest of what came before the last question, in the order it was said.
    expect(texts(page).at(-1)).toBe("answer 5")
    expect(page.before).not.toBe(null)

    // Walk to the beginning: nothing is skipped or repeated.
    const seen: string[] = []
    let before: string | null = last.id
    while (before !== null) {
      const next: ChatHistoryPage = await call(
        world,
        `/chats/${chat.id}/history?before=${before}&limit=4`,
      )
      seen.unshift(...texts(next))
      before = next.before
    }
    expect(seen).toEqual([
      "question 1",
      "answer 1",
      "question 2",
      "answer 2",
      "question 3",
      "answer 3",
      "question 4",
      "answer 4",
      "question 5",
      "answer 5",
    ])
  })

  it("brings back what a reset moved out of the transcript", async () => {
    const world = open()
    const chat = await setup(world)
    world.faux.setResponses([
      fauxAssistantMessage("Blue it is."),
      fauxAssistantMessage("Hello again."),
    ])
    await say(world, chat.id, "My favourite colour is blue.")
    await call(world, `/chats/${chat.id}/reset`, "POST")
    await say(world, chat.id, "Hi.")

    const state = await call<ChatState>(world, `/chats/${chat.id}`)
    // The live transcript starts at the reset.
    expect(texts(state)).not.toContain("My favourite colour is blue.")
    const page = await call<ChatHistoryPage>(
      world,
      `/chats/${chat.id}/history?before=${state.messages[0]!.id}`,
    )
    expect(texts(page)).toEqual(["My favourite colour is blue.", "Blue it is."])
    expect(page.before).toBe(null)
  })

  it("keeps a tool call and its result together across a page boundary", async () => {
    const world = open()
    const chat = await setup(world)
    world.faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("memory", { action: "add", target: "memory", content: "likes tea" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Saved."),
      fauxAssistantMessage("Later."),
    ])
    await say(world, chat.id, "Remember that I like tea.")
    await say(world, chat.id, "Thanks.")
    const state = await call<ChatState>(world, `/chats/${chat.id}`)
    // One entry at a time from the end, so some page ends exactly on the tool's result.
    const tools: ToolPart[] = []
    let before: string | null = state.messages.at(-1)!.id
    let pages = 0
    while (before !== null) {
      const page: ChatHistoryPage = await call(
        world,
        `/chats/${chat.id}/history?before=${before}&limit=1`,
      )
      tools.push(...page.messages.flatMap((m) => m.parts).filter((p) => p.type === "tool"))
      before = page.before
      pages++
    }
    expect(pages).toBeGreaterThan(3)
    // Seen once, with its result: never as a call that looks interrupted.
    expect(tools).toMatchObject([{ name: "memory", status: "done" }])
  })

  it("refuses a chat it does not have and a bad position", async () => {
    const world = open()
    const chat = await setup(world)
    await expect(call(world, "/chats/9999/history")).rejects.toThrow("404")
    await expect(call(world, `/chats/${chat.id}/history?before=abc`)).rejects.toThrow("400")
  })
})

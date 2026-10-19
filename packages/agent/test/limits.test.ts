import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import {
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  CUT_OFF_TEXT,
  describeChatError,
  EMPTY_CHAT,
  readSse,
  reduceChat,
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
import {
  type ImageLimits,
  IMAGE_LIMITS,
  keepPicturesSmall,
  picturesLeftOut,
  REQUEST_TRIES,
  RequestStarts,
  type SentMessage,
  shouldStart,
} from "../src/limits.ts"
import { quietOnReminder, sent } from "./quiet.ts"

const limits: ImageLimits = { highBytes: 100, lowBytes: 40, highCount: 6, lowCount: 3 }

describe("which pictures a request leaves out", () => {
  it("leaves none out under the high mark", () => {
    expect(picturesLeftOut([30, 30, 30], limits)).toBe(0)
    expect(picturesLeftOut([], limits)).toBe(0)
  })

  it("past the high mark, leaves out the oldest until what is left is under the low mark", () => {
    // 30+30+30+30 = 120 > 100: down to 30 (the newest), which is under 40.
    expect(picturesLeftOut([30, 30, 30, 30], limits)).toBe(3)
  })

  it("only ever leaves out more as pictures come in, and changes only when one crosses the mark", () => {
    const sizes = [30, 30, 30, 30, 20, 20, 20, 20, 20, 30, 30]
    let before = 0
    const changes: number[] = []
    for (let length = 1; length <= sizes.length; length++) {
      const now = picturesLeftOut(sizes.slice(0, length), limits)
      expect(now).toBeGreaterThanOrEqual(before)
      if (now !== before) changes.push(length)
      before = now
    }
    // Steps, not one change per picture: the cache is spent at those requests and kept between.
    expect(changes.length).toBeLessThan(sizes.length / 2)
  })

  it("never leaves out the newest picture, however large", () => {
    expect(picturesLeftOut([500], limits)).toBe(0)
    expect(picturesLeftOut([10, 500], limits)).toBe(1)
  })

  it("keeps to a number of pictures as well as a size", () => {
    expect(picturesLeftOut([1, 1, 1, 1, 1, 1], limits)).toBe(0)
    // Seven is past six: down to three.
    expect(picturesLeftOut([1, 1, 1, 1, 1, 1, 1], limits)).toBe(4)
  })

  it("keeps a request of 42 screenshots well under what was seen to take an actor down", () => {
    // The chat that crash-looped: 42 pictures, some 31 MB as base64.
    const sizes = Array<number>(42).fill(740_000)
    const from = picturesLeftOut(sizes)
    const kept = sizes.slice(from).reduce((sum, size) => sum + size, 0)
    expect(kept).toBeLessThanOrEqual(IMAGE_LIMITS.highBytes)
    expect(from).toBeGreaterThan(30)
  })
})

const image = (size: number, mimeType = "image/png") => ({
  type: "image" as const,
  data: "A".repeat(size),
  mimeType,
})
const read = (id: string, size: number): SentMessage[] => [
  {
    role: "assistant",
    content: [{ type: "toolCall", id, name: "read", arguments: { path: `/${id}.png` } }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "m",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 0,
  } as SentMessage,
  {
    role: "toolResult",
    toolCallId: id,
    toolName: "read",
    content: [{ type: "text", text: `Read ${id}` }, image(size)],
    isError: false,
    timestamp: 0,
  } as SentMessage,
]

describe("a request's messages with pictures left out", () => {
  it("are the same array when nothing is left out", () => {
    const messages = [...read("a", 30), ...read("b", 30)]
    expect(keepPicturesSmall(messages, limits)).toBe(messages)
  })

  it("say where a picture was, and keep everything else as it was", () => {
    const messages: SentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "look" }, image(60, "image/jpeg")],
        timestamp: 0,
      },
      ...read("a", 30),
      ...read("b", 30),
    ]
    const kept = keepPicturesSmall(messages, limits)
    expect(kept).not.toBe(messages)
    expect(kept).toHaveLength(messages.length)
    const first = kept[0] as { content: { type: string; text?: string }[] }
    expect(first.content[0]).toEqual({ type: "text", text: "look" })
    expect(first.content[1]?.type).toBe("text")
    expect(first.content[1]?.text).toContain("image/jpeg")
    expect(first.content[1]?.text).toContain("left out")
    // 60+30+30 = 120: the first two go, the newest stays.
    const blocks = kept.flatMap((message) =>
      Array.isArray(message.content) ? (message.content as { type: string }[]) : [],
    )
    expect(blocks.filter((block) => block.type === "image")).toHaveLength(1)
    // The calls and the words of each result are untouched.
    expect(kept[1]).toBe(messages[1])
    expect((kept[2] as { content: unknown[] }).content[0]).toEqual({ type: "text", text: "Read a" })
    expect(kept.at(-1)).toBe(messages.at(-1))
    // What came in is not changed.
    expect((messages[0] as { content: { type: string }[] }).content[1]?.type).toBe("image")
  })

  it("start the same from one request to the next until the mark is crossed again", () => {
    let messages: SentMessage[] = []
    const sent: string[] = []
    for (let index = 0; index < 12; index++) {
      messages = [...messages, ...read(`r${index}`, 20)]
      sent.push(JSON.stringify(keepPicturesSmall(messages, limits)))
    }
    // Each request either starts with the whole of the one before it, less its last message
    // (which a new picture follows), or it is one where more was left out.
    let breaks = 0
    for (let index = 1; index < sent.length; index++) {
      const before = sent[index - 1]!.slice(0, -1)
      if (!sent[index]!.startsWith(before)) breaks++
    }
    expect(breaks).toBeGreaterThan(0)
    expect(breaks).toBeLessThan(4)
  })
})

describe("a request started again without an answer", () => {
  it("is started up to the number of tries, and not after", () => {
    expect(REQUEST_TRIES).toBe(3)
    expect(shouldStart(1)).toBe(true)
    expect(shouldStart(3)).toBe(true)
    expect(shouldStart(4)).toBe(false)
    expect(shouldStart(1, 0)).toBe(false)
  })

  it("is counted for each task on its own, and forgotten once its task is gone", async () => {
    // The store is the actor's own; an in-memory one stands in.
    const database = new DatabaseSync(":memory:")
    const sql = {
      exec: async (text: string) => void database.exec(text),
      run: async (text: string, ...params: unknown[]) =>
        void database.prepare(text).run(...(params as never[])),
      get: async <T>(text: string, ...params: unknown[]) =>
        database.prepare(text).get(...(params as never[])) as T | undefined,
      all: async <T>(text: string, ...params: unknown[]) =>
        database.prepare(text).all(...(params as never[])) as T[],
      transaction: async <T>(callback: () => Promise<T>) => callback(),
      close: async () => database.close(),
    }
    let now = 1_000
    const starts = new RequestStarts(sql as never, () => now)
    // Two chats with a request under way at once each keep their own count.
    expect(await starts.start("7")).toBe(1)
    expect(await starts.start("9")).toBe(1)
    expect(await starts.start("7")).toBe(2)
    expect(await starts.start("9")).toBe(2)
    expect(await starts.start("7")).toBe(3)
    // An answer starts that task's count again, and leaves the other's.
    await starts.clear("7")
    expect(await starts.start("7")).toBe(1)
    expect(await starts.start("9")).toBe(3)
    // A task that is no longer live is forgotten; one written after the look is kept.
    now = 2_000
    expect(await starts.start("11")).toBe(1)
    await starts.prune(new Set(["9"]), 1_500)
    expect(await starts.size()).toBe(2)
    expect(await starts.start("9")).toBe(4)
    expect(await starts.start("11")).toBe(2)
    expect(await starts.start("7")).toBe(1)
  })
})

describe("what a chat shows where its run was ended", () => {
  it("is a failed reply that says why and offers to try again", () => {
    const view = describeChatError(CUT_OFF_TEXT)
    expect(view).toMatchObject({ kind: "cutOff", retryable: true, facts: [] })
    expect(view.title).toContain("cut off")
    expect(view.hint).toContain("too large for the server")
    expect(view.detail).toBeUndefined()
  })
})

type World = { namespace: NodeActorNamespace; faux: ReturnType<typeof fauxProvider> }
const worlds: World[] = []

function open(options: { requestTries?: number; imageLimits?: ImageLimits }): World {
  const directory = mkdtempSync(join(tmpdir(), "dc-limits-"))
  const faux = quietOnReminder(
    fauxProvider({
      provider: "test",
      models: [{ id: "seeing" }],
      tokensPerSecond: 5_000,
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
        defaultModel: "test/seeing",
        modelOptions: [
          {
            id: "test/seeing",
            name: "seeing",
            reasoning: false,
            inputCost: 0,
            outputCost: 0,
            images: true,
          },
        ],
        keepAliveMs: 100,
        ...options,
      }),
  })
  namespace.start()
  const world = { namespace, faux }
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

/** Send a message and return the chat once the run it starts has finished. */
async function converse(
  world: World,
  chatId: string,
  text: string,
  images?: unknown,
): Promise<ChatState> {
  const response = await world.namespace
    .get("agent-1")
    .fetch(new Request(`http://actor/chats/${chatId}/events`))
  await call(world, `/chats/${chatId}/messages`, "POST", {
    text,
    ...(images === undefined ? {} : { images }),
    requestId: crypto.randomUUID(),
  })
  let state = EMPTY_CHAT
  let started = false
  for await (const event of readSse<ChatEvent>(response.body!)) {
    state = reduceChat(state, event)
    started ||= state.busy
    if (started && !state.busy) break
  }
  return state
}

async function chat(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  return call<ChatSummary>(world, "/chats/main", "POST", {})
}

describe("a chat whose request keeps being cut off", () => {
  it("has its run ended, says why, and comes to rest without asking the model", async () => {
    // No try at all: the first start is one too many, as the fourth is in a reset loop.
    const world = open({ requestTries: 0 })
    const { id } = await chat(world)
    world.faux.setResponses([fauxAssistantMessage("You said hello.")])
    const state = await converse(world, id, "hello")
    expect(state.busy).toBe(false)
    expect(world.faux.state.callCount).toBe(0)
    const replies = state.messages.filter((message) => message.role === "assistant")
    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({ status: "error", error: CUT_OFF_TEXT, parts: [] })
    expect(JSON.stringify(state.messages)).not.toContain("You said")
    // The agent is not left at work, and the chat takes a message again.
    const agent = await call<{ agent: { working?: boolean } }>(world, "/")
    expect(agent.agent.working ?? false).toBe(false)
    const again = await converse(world, id, "try again")
    expect(again.busy).toBe(false)
    expect(
      again.messages.filter(
        (message) => message.role === "assistant" && message.status === "error",
      ),
    ).toHaveLength(2)
  }, 30_000)

  it("is not what an ordinary run meets, even with one try", async () => {
    // Every request that comes to an answer is cleared, so one try is enough for any of them.
    const world = open({ requestTries: 1 })
    const { id } = await chat(world)
    world.faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("memory", { action: "add", target: "user", content: "Likes tea" })],
        { stopReason: "toolUse" },
      ),
      sent("Noted."),
    ])
    const first = await converse(world, id, "I like tea")
    expect(JSON.stringify(first.messages)).not.toContain(CUT_OFF_TEXT)
    expect(first.messages.at(-1)).toMatchObject({ role: "assistant", status: "done" })
    expect(JSON.stringify(first.messages)).toContain("Noted.")
    // Each later request in the same chat is started afresh.
    for (const text of ["one", "two", "three"]) {
      world.faux.setResponses([sent(`You said ${text}.`)])
      const after = await converse(world, id, text)
      expect(JSON.stringify(after.messages)).not.toContain(CUT_OFF_TEXT)
      expect(after.messages.at(-1)).toMatchObject({
        role: "assistant",
        status: "done",
        parts: [{ type: "text", text: `You said ${text}.` }],
      })
    }
    // Every answer scripted was asked for, and nothing more was left over.
    expect(world.faux.getPendingResponseCount()).toBe(0)
  }, 30_000)
})

const PIXEL = {
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
}

describe("pictures a chat has been sent", () => {
  it("are left out of its requests, oldest first, past the mark", async () => {
    // Each picture is 96 characters: three are past 250, and down to 100 leaves the newest.
    const world = open({
      imageLimits: { highBytes: 250, lowBytes: 100, highCount: 80, lowCount: 40 },
    })
    const { id } = await chat(world)
    const sent: { type: string; text?: string }[][] = []
    const listen = () =>
      world.faux.setResponses([
        (context) => {
          sent.push(
            context.messages
              .filter((message) => message.role === "user")
              .flatMap((message) => message.content as { type: string; text?: string }[]),
          )
          return fauxAssistantMessage("I see.")
        },
      ])
    for (const text of ["first", "second", "third"]) {
      listen()
      await converse(world, id, text, [PIXEL])
    }
    const pictures = (blocks: { type: string }[]) =>
      blocks.filter((block) => block.type === "image").length
    const leftOut = (blocks: { type: string; text?: string }[]) =>
      blocks.filter((block) => block.type === "text" && block.text?.includes("left out")).length
    expect(sent.map(pictures)).toEqual([1, 2, 1])
    expect(sent.map(leftOut)).toEqual([0, 0, 2])
    // The chat itself still has all three.
    const state = await call<ChatState>(world, `/chats/${id}`)
    expect(
      state.messages.flatMap((message) => message.parts).filter((part) => part.type === "image"),
    ).toHaveLength(3)
  }, 30_000)
})

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  AgentUsage,
  ChatState,
  ChatSummary,
  IdleCompactionRecord,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import type { Context as ModelContext, Model, SimpleStreamOptions } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool } from "@earendil-works/pi-durable"
import { afterEach, describe, expect, it } from "vitest"
import type { ImageLimits } from "../src/limits.ts"
import { createAgentActor } from "../src/index.ts"
import {
  CACHE_MARGIN_MS,
  cacheLifetimeMs,
  decide,
  IDLE_SHARE,
  type IdleFacts,
  BACKOFF_MS,
  failedLately,
  isSummary,
  restDecision,
  summaryRequest,
  TYPING_CAP_MS,
} from "../src/idle-compaction.ts"

const HOUR = 60 * 60_000

describe("how long a model's long cache lasts", () => {
  const model = (fields: Partial<Model<string>>) =>
    ({
      id: "m",
      provider: "p",
      api: "openai-completions",
      baseUrl: "https://example.com/v1",
      contextWindow: 200_000,
      maxTokens: 8_000,
      ...fields,
    }) as Model<string>

  it("is an hour for Claude, from Anthropic or through OpenRouter", () => {
    expect(
      cacheLifetimeMs(
        model({
          api: "anthropic-messages",
          provider: "anthropic",
          promptCache: { short: 300, long: 3600 },
        }),
      ),
    ).toBe(HOUR)
    expect(
      cacheLifetimeMs(
        model({ api: "anthropic-messages", provider: "x", baseUrl: "https://api.anthropic.com" }),
      ),
    ).toBe(HOUR)
    expect(
      cacheLifetimeMs(
        model({
          api: "anthropic-messages",
          provider: "openrouter",
          id: "anthropic/claude-sonnet-4.5",
        }),
      ),
    ).toBe(HOUR)
    expect(
      cacheLifetimeMs(model({ provider: "openrouter", id: "anthropic/claude-sonnet-4.5" })),
    ).toBe(HOUR)
  })

  it("is a day for OpenAI's GPT-5 and GPT-4.1, from OpenAI or through OpenRouter", () => {
    const openAi = (id: string) => model({ api: "openai-responses", provider: "openai", id })
    expect(cacheLifetimeMs(openAi("gpt-5.1"))).toBe(24 * HOUR)
    expect(cacheLifetimeMs(openAi("gpt-4.1-mini"))).toBe(24 * HOUR)
    expect(cacheLifetimeMs(model({ provider: "openrouter", id: "openai/gpt-5.1" }))).toBe(24 * HOUR)
    expect(cacheLifetimeMs(model({ provider: "openrouter", id: "openai/gpt-4.1" }))).toBe(24 * HOUR)
  })

  it("is not known for OpenAI's other models, which keep it in memory only", () => {
    for (const id of ["gpt-4o", "gpt-4", "gpt-3.5-turbo", "o3", "o4-mini"]) {
      expect(cacheLifetimeMs(model({ api: "openai-responses", provider: "openai", id }))).toBe(
        undefined,
      )
      expect(cacheLifetimeMs(model({ provider: "openrouter", id: `openai/${id}` }))).toBe(undefined)
    }
  })

  it("is not known for Azure, which pi-ai never asks for a long cache", () => {
    const azure = model({
      api: "azure-openai-responses",
      provider: "azure",
      id: "gpt-5.1",
      baseUrl: "https://example.openai.azure.com/openai/v1",
    })
    expect(cacheLifetimeMs(azure)).toBeUndefined()
  })

  it("is not known for other providers behind the same interfaces", () => {
    // pi-ai asks all of these for its long cache; none is known to keep one.
    const minimax = model({
      api: "anthropic-messages",
      provider: "minimax",
      id: "MiniMax-M2",
      baseUrl: "https://api.minimax.io/anthropic",
    })
    const vercel = model({
      api: "anthropic-messages",
      provider: "vercel-ai-gateway",
      id: "anthropic/claude-sonnet-4.5",
      baseUrl: "https://ai-gateway.vercel.sh",
    })
    const xai = model({ api: "openai-responses", provider: "xai", baseUrl: "https://api.x.ai/v1" })
    expect(cacheLifetimeMs(minimax)).toBeUndefined()
    expect(cacheLifetimeMs(vercel)).toBeUndefined()
    expect(cacheLifetimeMs(xai)).toBeUndefined()
    expect(
      cacheLifetimeMs(model({ provider: "openrouter", id: "meta/muse-spark" })),
    ).toBeUndefined()
    expect(cacheLifetimeMs(model({ api: "google-generative-ai" }))).toBeUndefined()
  })

  it("is not long enough where the cache is kept for minutes", () => {
    // An OpenAI model with an explicit cache mode is asked to keep it for 30 minutes.
    expect(
      cacheLifetimeMs(
        model({
          api: "openai-responses",
          provider: "openai",
          id: "gpt-5.6",
          compat: { supportsExplicitPromptCacheMode: true },
        } as never),
      ),
    ).toBeUndefined()
    expect(
      cacheLifetimeMs(model({ api: "anthropic-messages", promptCache: { short: 300, long: 300 } })),
    ).toBeUndefined()
    expect(
      cacheLifetimeMs(
        model({
          api: "anthropic-messages",
          provider: "anthropic",
          compat: { supportsLongCacheRetention: false },
        } as never),
      ),
    ).toBeUndefined()
  })

  it("is what the model says, for a provider nothing else is known of", () => {
    expect(cacheLifetimeMs(model({ promptCache: { long: 7200 } }))).toBe(2 * HOUR)
  })
})

describe("what is asked for, and what is taken as a summary", () => {
  const kept = { count: 2, opening: "second second" }

  it("asks a main chat for what a long conversation with the person needs", () => {
    const asked = summaryRequest(kept, true)
    expect(asked).toContain("## Sub-agents at work")
    expect(asked).toContain("long-running main conversation")
    expect(asked).toContain(
      'Its last 2 messages stay as they are, from the one that begins "second second"',
    )
  })

  it("asks any other chat in pi-durable's own form", () => {
    const asked = summaryRequest(kept, false)
    expect(asked).toContain("## Next Steps")
    expect(asked).toContain("## Critical Context")
    expect(asked).not.toContain("Sub-agents at work")
    expect(asked).not.toContain("main conversation")
  })

  it("takes only text in that form as a summary", () => {
    expect(isSummary(SUMMARY)).toBe(true)
    expect(isSummary("## Goal\nShip it.\n\n## Next Steps\n1. Go\n\n## Critical Context\n- x")).toBe(
      true,
    )
    // An answer to the conversation, not a summary of it.
    expect(isSummary("Sure, the report is done. Anything else?")).toBe(false)
    expect(isSummary("## Goal\nOnly a start.")).toBe(false)
  })

  it("is not asked for again in a chat for an hour after it failed there", () => {
    const record = (chatId: string, summarized: boolean, at: number) =>
      ({ chatId, summarized, at }) as IdleCompactionRecord
    const now = 1_800_000_000_000
    expect(failedLately([record("7", false, now - BACKOFF_MS + 1)], "7", now)).toBe(true)
    expect(failedLately([record("7", false, now - BACKOFF_MS)], "7", now)).toBe(false)
    expect(failedLately([record("8", false, now)], "7", now)).toBe(false)
    expect(failedLately([record("7", true, now)], "7", now)).toBe(false)
  })
})

describe("whether a quiet chat is compacted", () => {
  const NOW = 1_800_000_000_000
  const facts = (more: Partial<IdleFacts> = {}): IdleFacts => ({
    resting: true,
    queued: false,
    typing: false,
    last: { inputTokens: 150_000, at: NOW - 10 * 60_000 },
    sameModel: true,
    contextWindow: 200_000,
    cacheLifetimeMs: HOUR,
    now: NOW,
    ...more,
  })

  it("is so when everything holds", () => {
    expect(decide(facts())).toBe("compact")
    expect(decide(facts({ last: { inputTokens: IDLE_SHARE * 200_000, at: NOW } }))).toBe("compact")
  })

  it("is not so while it is at work, or has something waiting", () => {
    expect(decide(facts({ resting: false }))).toBe("busy")
    expect(decide(facts({ queued: true }))).toBe("busy")
  })

  it("waits while someone is typing in it, which is asked before the chat is read", () => {
    expect(decide(facts({ typing: true }))).toBe("later")
    expect(restDecision({ resting: true, queued: false, typing: true })).toBe("later")
    expect(restDecision({ resting: false, queued: false, typing: true })).toBe("busy")
    expect(restDecision({ resting: true, queued: false, typing: false })).toBeUndefined()
  })

  it("is not so under the share of the window, or with nothing since the last compaction", () => {
    expect(decide(facts({ last: { inputTokens: 139_999, at: NOW } }))).toBe("small")
    expect(decide(facts({ last: undefined }))).toBe("nothing")
  })

  it("is not so without a long cache, or on another model than the last answer's", () => {
    expect(decide(facts({ cacheLifetimeMs: undefined }))).toBe("uncached")
    expect(decide(facts({ sameModel: false }))).toBe("uncached")
  })

  it("is not so once the cache is about to run out", () => {
    const edge = NOW - (HOUR - CACHE_MARGIN_MS)
    expect(decide(facts({ last: { inputTokens: 150_000, at: edge + 1 } }))).toBe("compact")
    expect(decide(facts({ last: { inputTokens: 150_000, at: edge } }))).toBe("cold")
  })
})

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
  /** How far the agent's clock is ahead of the real one. */
  clock: { ahead: number }
}

const worlds: World[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

const temporary = () => mkdtempSync(join(tmpdir(), "dc-idle-"))

/** How long after its last answer a chat is looked at, in these tests. */
const AFTER_MS = 1_000

function open(
  directory: string,
  more: {
    tokensPerSecond?: number
    afterMs?: number
    typing?: (agentId: string, chatId: string) => Promise<boolean>
    compaction?: { reserveTokens?: number; backgroundTokens?: number }
    imageLimits?: ImageLimits
  } = {},
): World {
  const faux = fauxProvider({
    provider: "test",
    models: [{ id: "model" }],
    tokensPerSecond: more.tokensPerSecond ?? 5_000,
  })
  // Claude's caches, as Anthropic's own models say.
  faux.models[0].promptCache = { short: 300, long: 3600 }
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: unknown[] = []
  const clock = { ahead: 0 }
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    now: () => Date.now() + clock.ahead,
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          {
            id: "test/model",
            name: "Test",
            reasoning: false,
            inputCost: 0,
            outputCost: 0,
            images: true,
          },
        ],
        extensions: [snapping],
        ...(more.imageLimits === undefined ? {} : { imageLimits: more.imageLimits }),
        keepAliveMs: 100,
        // So that a chat can fill most of the window without pi-durable compacting it first.
        compaction: more.compaction ?? { enabled: false },
        idleCompactionMs: more.afterMs ?? AFTER_MS,
        ...(more.typing === undefined ? {} : { typing: more.typing }),
        onReport: (error) => reports.push(error),
      }),
    onError: (error) => reports.push(error),
  })
  namespace.start()
  const world = { namespace, faux, reports, clock }
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function until<T>(
  look: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 10_000,
): Promise<T> {
  const deadline = Date.now() + ms
  let value = await look()
  while (!done(value) && Date.now() < deadline) {
    await sleep(50)
    value = await look()
  }
  return value
}

const chatOf = (world: World, chatId: string) => call<ChatState>(world, `/chats/${chatId}`)

const answers = (state: ChatState) =>
  state.messages.filter((m) => m.role === "assistant" && m.status === "done").length

/** Send a message and wait for the chat to have come to rest with one more answer. */
async function say(world: World, chatId: string, text: string): Promise<ChatState> {
  const before = answers(await chatOf(world, chatId))
  await call(world, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
  return until(
    () => chatOf(world, chatId),
    (state) => !state.busy && answers(state) > before,
  )
}

const compactions = async (world: World): Promise<IdleCompactionRecord[]> =>
  (await call<AgentUsage>(world, "/usage")).compactions ?? []

const compacted = (state: ChatState) =>
  state.messages.some((m) =>
    m.parts.some((part) => part.type === "notice" && part.kind === "compaction"),
  )

/** About `tokens` tokens of text, as the scripted model counts them: four characters each. */
const words = (tokens: number, word: string) =>
  `${word} `.repeat(Math.round((tokens * 4) / (word.length + 1)))

/** Counts how often a chat was looked at, through asking whether anyone is typing in it. */
function probe() {
  const looks = { count: 0, typing: async () => (looks.count++, false) }
  return looks
}

/** A summary in the form it is asked for. */
const SUMMARY = "## Goal\nCarry on with the report.\n\n## Critical context\n- (none)"

/** A tiny picture: 96 characters of base64. */
const PIXEL = {
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
}

/** A tool that gives a picture, as a screenshot does. */
const snapping = defineExtension({
  name: "test.snap",
  tools: [
    defineTool({
      name: "snap",
      description: "Take a picture.",
      parameters: Type.Object({}),
      execute: async () => ({ output: [{ type: "image" as const, ...PIXEL }] }),
    }),
  ],
})

/** A summary the scripted model writes, with what it was asked kept for the test to look at. */
function summarizer(asked: { context?: ModelContext; options?: SimpleStreamOptions }) {
  return (context: ModelContext, options: SimpleStreamOptions | undefined) => {
    asked.context = context
    asked.options = options
    return fauxAssistantMessage(SUMMARY)
  }
}

/**
 * A world where pi-durable compacts on its own: it blocks within 1,000 tokens of the window, and
 * starts in the background 40,000 before that. The idle look is far off, so it is not what
 * compacts.
 */
const thresholdWorld = () =>
  open(temporary(), {
    afterMs: 600_000,
    compaction: { reserveTokens: 1_000, backgroundTokens: 40_000 },
  })

/**
 * Scripted answers for requests that can come in any order: the chat's own, the summary asked
 * from the cache (`cached`, answered with `summary`), and pi-durable's own summarizer, which asks
 * with no cache (`uncached`, answered with a summary).
 */
function routed() {
  const seen = {
    cached: [] as { context: ModelContext; options: SimpleStreamOptions | undefined }[],
    uncached: 0,
    responses: (summary: string) =>
      Array.from({ length: 6 }, () => (context: ModelContext, options?: SimpleStreamOptions) => {
        if (options?.cacheRetention === "none") {
          seen.uncached++
          return fauxAssistantMessage(SUMMARY)
        }
        if (JSON.stringify(context.messages.at(-1)).includes("Write a checkpoint")) {
          seen.cached.push({ context, options })
          return fauxAssistantMessage(summary)
        }
        return fauxAssistantMessage("Answered.")
      }),
  }
  return seen
}

/** Send one more message, and wait for its answer, which comes after pi-durable compacts. */
async function answerAfterCompaction(world: World, chatId: string): Promise<ChatState> {
  await call(world, `/chats/${chatId}/messages`, "POST", {
    text: "and one more thing",
    requestId: "r",
  })
  // The answers it summarized are no longer shown, so the chat is waited on for the new one.
  return until(
    () => chatOf(world, chatId),
    (chat) => !chat.busy && compacted(chat) && JSON.stringify(chat.messages).includes("Answered."),
  )
}

/** How long each of the two long messages a chat is filled with is, in tokens. */
const LONG = 45_000

/**
 * A main chat whose last request filled `share` of the model's window: a short exchange, then
 * two long messages, the second sent once the window is set so that its request comes to
 * `share` of it. The scripted model counts a request's input as its whole prompt and what it
 * newly caches again, so a request with one more long message than the one before comes to
 * that one and `LONG` more. Resolves with the chat and its last request's input.
 */
async function fill(
  world: World,
  share: number,
  last = "second",
  pictures = false,
): Promise<{ main: ChatSummary; input: number; sent: ModelContext["messages"] }> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  const main = await call<ChatSummary>(world, "/chats/main", "POST", {})
  world.faux.models[0].contextWindow = 100_000_000
  // What the chat's last request was sent, as the provider got it.
  let sent: ModelContext["messages"] = []
  world.faux.setResponses([
    // Three pictures first, where asked, which are in every request after.
    ...(pictures
      ? [
          fauxAssistantMessage(
            [fauxToolCall("snap", {}), fauxToolCall("snap", {}), fauxToolCall("snap", {})],
            { stopReason: "toolUse" },
          ),
        ]
      : []),
    fauxAssistantMessage("Hello."),
    fauxAssistantMessage("Noted."),
    (context: ModelContext) => {
      sent = structuredClone(context.messages)
      return fauxAssistantMessage("Noted again.")
    },
  ])
  const hello = await say(world, main.id, "hi")
  const first = await say(world, main.id, words(LONG, "first"))
  const expected = first.usage.inputTokens - hello.usage.inputTokens + LONG
  world.faux.models[0].contextWindow = Math.round(expected / share)
  const second = await say(world, main.id, words(LONG, last))
  return { main, input: second.usage.inputTokens - first.usage.inputTokens, sent }
}

describe("compacting a quiet main chat while its cache is warm", () => {
  it("compacts it once everything holds, reading what it repeats from the cache", async () => {
    const world = open(temporary())
    const { main, sent: last } = await fill(world, 0.8)
    const asked: { context?: ModelContext; options?: SimpleStreamOptions } = {}
    world.faux.appendResponses([summarizer(asked)])

    const state = await until(() => chatOf(world, main.id), compacted)
    expect(compacted(state)).toBe(true)
    const [record, ...more] = await until(
      () => compactions(world),
      (records) => records.length > 0,
    )
    expect(more).toEqual([])
    expect(record).toMatchObject({ chatId: main.id, model: "test/model", summarized: true })
    // Its last request filled 80% of the window, and what is left is the newest message and the
    // summary.
    const window = world.faux.models[0].contextWindow
    expect(record!.before / window).toBeGreaterThan(0.75)
    expect(record!.after).toBeLessThan(record!.before * 0.75)
    // Asked as the chat's own requests are: the same session and cache, the same messages, and
    // the request for a summary after them, which says what is kept.
    expect(record!.cacheReadShare).toBeGreaterThan(0.95)
    expect(asked.options?.cacheRetention).toBe("long")
    expect(asked.options?.sessionId).toBeTruthy()
    const sent = asked.context!.messages
    // What it repeats is exactly what the chat's last request was sent, then that answer, then
    // the request for the summary, which says what is kept.
    expect(sent.slice(0, -2)).toEqual(last)
    expect(sent.at(-2)).toMatchObject({ role: "assistant", content: [{ text: "Noted again." }] })
    const request = JSON.stringify(sent.at(-1)!.content)
    expect(request).toContain(
      'Its last 2 messages stay as they are, from the one that begins \\"second second',
    )
    expect(request).toContain("Sub-agents at work")
    // The summary is in the chat's context in place of the first long message.
    const context = JSON.stringify(state.messages)
    expect(context).toContain("second second")
    // Its cost is the chat's.
    const usage = await call<AgentUsage>(world, "/usage")
    expect(usage.models.find((m) => m.model === "test/model")!.inputTokens).toBeGreaterThan(
      record!.cacheRead,
    )

    // Looked at again, it has nothing new to compact.
    await sleep(AFTER_MS * 3)
    expect(await compactions(world)).toHaveLength(1)
    expect(world.faux.getPendingResponseCount()).toBe(0)

    // The next message is noted on the record: how long after it came, and what it cost the cache.
    world.faux.appendResponses([fauxAssistantMessage("Welcome back.")])
    await say(world, main.id, "I am back")
    const [noted] = await until(
      () => compactions(world),
      (records) => records[0]?.next !== undefined,
    )
    expect(noted!.next!.afterMs).toBeGreaterThan(AFTER_MS)
    expect(noted!.next!.cacheWrite).toBeGreaterThan(0)
    expect(world.reports).toEqual([])
  })

  it("repeats exactly what the chat's last request was sent, pictures left out as it left them", async () => {
    // Small limits, so that of the three pictures in the chat only the newest is sent: a summary
    // request shaped any other way would not start as the chat's last request did.
    const world = open(temporary(), {
      imageLimits: { highBytes: 250, lowBytes: 100, highCount: 80, lowCount: 40 },
    })
    const { sent: last } = await fill(world, 0.8, "second", true)
    const asked: { context?: ModelContext; options?: SimpleStreamOptions } = {}
    world.faux.appendResponses([summarizer(asked)])
    await until(
      async () => asked.context,
      (context) => context !== undefined,
    )
    const pictures = (messages: ModelContext["messages"]) =>
      messages.flatMap((message) =>
        Array.isArray(message.content)
          ? message.content.filter((block) => block.type === "image")
          : [],
      ).length
    expect(pictures(last)).toBe(1)
    expect(JSON.stringify(last)).toContain("left out of this request")
    expect(asked.context!.messages.slice(0, -2)).toEqual(last)
  })

  it("leaves the chat as it is when the provider fails, and never asks uncached instead", async () => {
    const world = open(temporary())
    const { main } = await fill(world, 0.8)
    world.faux.appendResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "529 overloaded" }),
      fauxAssistantMessage("## Goal\nNot asked for."),
    ])
    const [record] = await until(
      () => compactions(world),
      (records) => records.length > 0,
    )
    expect(record).toMatchObject({ summarized: false, after: null })
    expect(record!.failure).toContain("529 overloaded")
    await sleep(AFTER_MS)
    expect(compacted(await chatOf(world, main.id))).toBe(false)
    // pi-durable's summarizer, which would send the whole chat uncached, was not asked.
    expect(world.faux.getPendingResponseCount()).toBe(1)
    expect(String(world.reports[0])).toContain("529 overloaded")

    // For an hour after, the chat is not asked again, though its next answer qualifies.
    world.faux.setResponses([
      fauxAssistantMessage("Welcome back."),
      fauxAssistantMessage("## Goal\nNot asked for."),
    ])
    await say(world, main.id, "I am back")
    await sleep(AFTER_MS * 2.5)
    expect(world.faux.getPendingResponseCount()).toBe(1)
    expect(await compactions(world)).toHaveLength(1)
  })

  it("leaves the chat as it is when what comes back is an answer and not a summary", async () => {
    const world = open(temporary())
    const { main } = await fill(world, 0.8)
    world.faux.appendResponses([
      fauxAssistantMessage("Sure, the report is done. Anything else?"),
      fauxAssistantMessage("## Goal\nNot asked for."),
    ])
    const [record] = await until(
      () => compactions(world),
      (records) => records.length > 0,
    )
    expect(record).toMatchObject({
      summarized: false,
      failure: "it was not in the form of a summary",
    })
    await sleep(AFTER_MS)
    expect(compacted(await chatOf(world, main.id))).toBe(false)
    expect(world.faux.getPendingResponseCount()).toBe(1)
  })

  it("leaves the chat as it is when what comes back is a tool call", async () => {
    const world = open(temporary())
    const { main } = await fill(world, 0.8)
    world.faux.appendResponses([
      fauxAssistantMessage([fauxToolCall("bash", { command: "ls" })]),
      fauxAssistantMessage("## Goal\nNot asked for."),
    ])
    const [record] = await until(
      () => compactions(world),
      (records) => records.length > 0,
    )
    expect(record).toMatchObject({ summarized: false, failure: "it called a tool instead" })
    await sleep(AFTER_MS)
    expect(compacted(await chatOf(world, main.id))).toBe(false)
    expect(world.faux.getPendingResponseCount()).toBe(1)
  })

  it("summarizes pi-durable's own compaction from the cache where it has room", async () => {
    const seen = routed()
    const world = thresholdWorld()
    const { main, input } = await fill(world, 0.5)
    // The next request comes into pi-durable's background band, with room past it to write in.
    world.faux.models[0].contextWindow = input + 30_000
    world.faux.setResponses(seen.responses(SUMMARY))
    const state = await answerAfterCompaction(world, main.id)
    expect(compacted(state)).toBe(true)
    expect(seen.cached).toHaveLength(1)
    expect(seen.uncached).toBe(0)
    const [record] = await compactions(world)
    expect(record).toMatchObject({ reason: "threshold", summarized: true })
    expect(record!.cacheReadShare).toBeGreaterThan(0.95)
    expect(seen.cached[0]!.options?.cacheRetention).toBe("long")
    // The main chat is summarized in its own form.
    expect(JSON.stringify(seen.cached[0]!.context.messages.at(-1))).toContain(
      "long-running main conversation",
    )
    expect(world.reports).toEqual([])
  })

  it("leaves pi-durable's own compaction to it where the summary would have no room", async () => {
    const seen = routed()
    const world = thresholdWorld()
    const { main, input } = await fill(world, 0.5)
    // The next request comes within `reserveTokens` of the window: pi-durable compacts first.
    world.faux.models[0].contextWindow = input
    world.faux.setResponses(seen.responses(SUMMARY))
    const state = await answerAfterCompaction(world, main.id)
    expect(compacted(state)).toBe(true)
    expect(seen.cached).toHaveLength(0)
    expect(seen.uncached).toBe(1)
    expect(await compactions(world)).toEqual([])
  })

  it("leaves pi-durable's own compaction to it where what comes back is not a summary", async () => {
    const seen = routed()
    const world = thresholdWorld()
    const { main, input } = await fill(world, 0.5)
    world.faux.models[0].contextWindow = input + 30_000
    world.faux.setResponses(seen.responses("Sure, and here is the answer to your last message."))
    const state = await answerAfterCompaction(world, main.id)
    expect(compacted(state)).toBe(true)
    expect(seen.cached).toHaveLength(1)
    expect(seen.uncached).toBe(1)
    const [record] = await compactions(world)
    expect(record).toMatchObject({ reason: "threshold", summarized: false })
  })

  it("leaves a chat that fills less than 70% of the window", async () => {
    const looks = probe()
    const world = open(temporary(), { typing: looks.typing })
    const { main } = await fill(world, 0.6)
    world.faux.appendResponses([fauxAssistantMessage("## Goal\nNot asked for.")])
    await sleep(AFTER_MS * 2.5)
    // Its answer said as much, so it was not even looked at again.
    expect(looks.count).toBe(0)
    expect(compacted(await chatOf(world, main.id))).toBe(false)
    expect(await compactions(world)).toEqual([])
    expect(world.faux.getPendingResponseCount()).toBe(1)
  })

  it("leaves a chat whose model keeps its cache only for minutes", async () => {
    const looks = probe()
    const world = open(temporary(), { typing: looks.typing })
    world.faux.models[0].promptCache = { short: 300, long: 300 }
    const { main } = await fill(world, 0.8)
    world.faux.appendResponses([fauxAssistantMessage("## Goal\nNot asked for.")])
    await sleep(AFTER_MS * 2.5)
    // Its answer said as much, so it was not even looked at again.
    expect(looks.count).toBe(0)
    expect(compacted(await chatOf(world, main.id))).toBe(false)
    expect(world.faux.getPendingResponseCount()).toBe(1)
  })

  it("leaves a chat whose cache is about to run out", async () => {
    const looks = probe()
    const world = open(temporary(), { typing: looks.typing })
    // The agent's clock says 55 minutes have passed since each answer, which is when the check
    // finds it: as after a long sleep or a restart that took a while.
    world.clock.ahead = 55 * 60_000
    const { main } = await fill(world, 0.8)
    world.faux.appendResponses([fauxAssistantMessage("## Goal\nNot asked for.")])
    await sleep(AFTER_MS * 2.5)
    // It was looked at, and left.
    expect(looks.count).toBeGreaterThan(0)
    expect(compacted(await chatOf(world, main.id))).toBe(false)
    expect(world.faux.getPendingResponseCount()).toBe(1)
  })

  it("waits while the chat is at work, and compacts it after its next answer", async () => {
    const world = open(temporary(), { tokensPerSecond: 200 })
    const { main, input } = await fill(world, 0.75)
    // The next request has no new long message, so the scripted model counts it as `LONG` less
    // than the last: the window is set for it to come to 75% too.
    world.faux.models[0].contextWindow = Math.round((input - LONG) / 0.75)
    // Sent at once, and answered slowly: the chat is at work when it is looked at.
    world.faux.appendResponses([fauxAssistantMessage("word ".repeat(1_000))])
    const asked: { context?: ModelContext } = {}
    world.faux.appendResponses([summarizer(asked)])
    await call(world, `/chats/${main.id}/messages`, "POST", {
      text: "one more thing",
      requestId: "r",
    })
    await sleep(AFTER_MS * 1.5)
    expect((await chatOf(world, main.id)).busy).toBe(true)
    expect(asked.context).toBeUndefined()

    const state = await until(() => chatOf(world, main.id), compacted)
    expect(compacted(state)).toBe(true)
    // It was asked for after the answer the chat was busy with.
    expect(JSON.stringify(asked.context!.messages)).toContain("one more thing")
    expect(await compactions(world)).toHaveLength(1)
  })

  it("waits while someone is typing in the chat", async () => {
    let typing = true
    const looked: string[] = []
    const world = open(temporary(), {
      typing: async (agentId, chatId) => {
        looked.push(`${agentId}/${chatId}`)
        return typing
      },
    })
    const { main } = await fill(world, 0.8)
    world.faux.appendResponses([summarizer({})])
    await until(
      async () => looked.length,
      (count) => count >= 2,
    )
    expect(compacted(await chatOf(world, main.id))).toBe(false)
    expect(looked[0]).toBe(`agent-1/${main.id}`)
    typing = false
    expect(compacted(await until(() => chatOf(world, main.id), compacted))).toBe(true)
  })

  it("stops waiting for someone typing after ten minutes, as for a draft left in the box", async () => {
    let looked = 0
    const world = open(temporary(), {
      typing: async () => {
        looked++
        return true
      },
    })
    const { main } = await fill(world, 0.8)
    world.faux.appendResponses([summarizer({})])
    await until(
      async () => looked,
      (count) => count >= 2,
    )
    expect(compacted(await chatOf(world, main.id))).toBe(false)
    // Ten minutes and more since it was first put off, by the agent's clock.
    world.clock.ahead = TYPING_CAP_MS + 60_000
    expect(compacted(await until(() => chatOf(world, main.id), compacted))).toBe(true)
  })

  it("compacts a chat after a restart, from the time it was to be looked at, and only once", async () => {
    const directory = temporary()
    const before = open(directory, { afterMs: 1_500 })
    const { main } = await fill(before, 0.8)
    // Gone before the chat is looked at.
    await before.namespace.close()

    // Nothing addresses the agent: its recorded wake-up starts it.
    const window = before.faux.models[0].contextWindow
    const after = open(directory, { afterMs: 1_500 })
    after.faux.models[0].contextWindow = window
    after.faux.setResponses([summarizer({})])
    await until(
      async () => after.faux.state.callCount,
      (count) => count > 0,
    )
    const records = await until(
      () => compactions(after),
      (found) => found.length > 0,
    )
    expect(records).toHaveLength(1)
    expect(compacted(await chatOf(after, main.id))).toBe(true)
    await after.namespace.close()

    // And not again after another restart.
    const looks = probe()
    const again = open(directory, { afterMs: 1_500, typing: looks.typing })
    again.faux.models[0].contextWindow = window
    again.faux.setResponses([fauxAssistantMessage("## Goal\nNot asked for.")])
    await sleep(2_500)
    expect(looks.count).toBe(0)
    expect(await compactions(again)).toHaveLength(1)
    expect(again.faux.getPendingResponseCount()).toBe(1)
  })
})

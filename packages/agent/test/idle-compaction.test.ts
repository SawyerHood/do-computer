import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentUsage, ChatState, ChatSummary, IdleCompaction } from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import type { Context as ModelContext, Model, SimpleStreamOptions } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActor } from "../src/index.ts"
import {
  CACHE_MARGIN_MS,
  cacheLifetimeMs,
  decide,
  IDLE_SHARE,
  type IdleFacts,
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

  it("is an hour for Claude, through Anthropic or OpenRouter", () => {
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

  it("is a day for OpenAI's models", () => {
    expect(cacheLifetimeMs(model({ api: "openai-responses", provider: "openai" }))).toBe(24 * HOUR)
    expect(cacheLifetimeMs(model({ provider: "openrouter", id: "openai/gpt-5.1" }))).toBe(24 * HOUR)
  })

  it("is not known for others, or where the model says it keeps only minutes", () => {
    expect(
      cacheLifetimeMs(model({ provider: "openrouter", id: "meta/muse-spark" })),
    ).toBeUndefined()
    expect(cacheLifetimeMs(model({ api: "google-generative-ai" }))).toBeUndefined()
    expect(
      cacheLifetimeMs(model({ api: "anthropic-messages", promptCache: { short: 300, long: 300 } })),
    ).toBeUndefined()
    expect(
      cacheLifetimeMs(
        model({
          api: "anthropic-messages",
          compat: { supportsLongCacheRetention: false },
        } as never),
      ),
    ).toBeUndefined()
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

  it("waits while someone is typing in it", () => {
    expect(decide(facts({ typing: true }))).toBe("later")
    // Typing does not keep alive a chat that would not be compacted anyway.
    expect(decide(facts({ typing: true, last: { inputTokens: 1_000, at: NOW } }))).toBe("small")
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
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
        // So that a chat can fill most of the window without pi-durable compacting it first.
        compaction: { enabled: false },
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

const compactions = async (world: World): Promise<IdleCompaction[]> =>
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

/** A summary the scripted model writes, with what it was asked kept for the test to look at. */
function summarizer(asked: { context?: ModelContext; options?: SimpleStreamOptions }) {
  return (context: ModelContext, options: SimpleStreamOptions | undefined) => {
    asked.context = context
    asked.options = options
    return fauxAssistantMessage("## Goal\nCarry on with the report.")
  }
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
): Promise<{ main: ChatSummary; input: number }> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  const main = await call<ChatSummary>(world, "/chats/main", "POST", {})
  world.faux.models[0].contextWindow = 100_000_000
  world.faux.setResponses([
    fauxAssistantMessage("Hello."),
    fauxAssistantMessage("Noted."),
    fauxAssistantMessage("Noted again."),
  ])
  const hello = await say(world, main.id, "hi")
  const first = await say(world, main.id, words(LONG, "first"))
  const expected = first.usage.inputTokens - hello.usage.inputTokens + LONG
  world.faux.models[0].contextWindow = Math.round(expected / share)
  const second = await say(world, main.id, words(LONG, last))
  return { main, input: second.usage.inputTokens - first.usage.inputTokens }
}

describe("compacting a quiet main chat while its cache is warm", () => {
  it("compacts it once everything holds, reading what it repeats from the cache", async () => {
    const world = open(temporary())
    const { main } = await fill(world, 0.8)
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
    expect(sent.at(-2)).toMatchObject({ role: "assistant", content: [{ text: "Noted again." }] })
    const request = JSON.stringify(sent.at(-1)!.content)
    expect(request).toContain('Everything from the message that begins \\"second second')
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
    expect(world.reports).toEqual([])
  })

  it("leaves the summary to pi-durable's own summarizer where asking for one fails", async () => {
    const world = open(temporary())
    const { main } = await fill(world, 0.8)
    world.faux.appendResponses([
      // Not a summary: it calls a tool.
      fauxAssistantMessage([fauxToolCall("bash", { command: "ls" })]),
      fauxAssistantMessage("## Goal\nWritten by the fallback."),
    ])
    const state = await until(() => chatOf(world, main.id), compacted)
    expect(compacted(state)).toBe(true)
    const [record] = await until(
      () => compactions(world),
      (records) => records.length > 0,
    )
    expect(record).toMatchObject({ summarized: false, after: null })
    expect(world.faux.getPendingResponseCount()).toBe(0)
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

import type { IdleCompaction as IdleCompactionRecord } from "@do-computer/protocol"
import type { ActorDatabase } from "@do-computer/runtime"
import type { Context } from "@earendil-works/chord"
import type {
  AssistantMessage,
  CacheRetention,
  Message,
  Model,
  Models,
  Usage,
} from "@earendil-works/pi-ai"
import { estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate"
import {
  CompactionTask,
  type CompactionHooks,
  type ContextView,
  type ConversationId,
  defineDoc,
  type EntryId,
  defineExtension,
  type Extension,
  GenerationTask,
  type Harness,
  hook,
  type HookApi,
  ProviderDoc,
  UsageDoc,
} from "@earendil-works/pi-durable"
import { ChatsDoc } from "./docs.ts"
import { keepPicturesSmall } from "./limits.ts"
import { dropOldPictures } from "./uses.ts"

/**
 * Compacting a chat while the provider still has it in its cache.
 *
 * A long chat that has gone quiet is summarized about ten minutes after its last answer, while
 * reading it is still cheap, so that whatever comes next starts from a small context instead of
 * paying to write a large one into the cache again. pi-durable compacts on its own only when a
 * request would pass the model's window, which is when the chat is needed, and its summarizer
 * sends the conversation as a new prompt of its own, which the cache never has.
 *
 * So the summary here is asked for the way the chat's own requests are made: the same messages,
 * the same provider session and the same cache retention, with one more message at the end that
 * asks for the summary. Everything before that message is read from the cache. pi-durable still
 * does the rest (choosing what is kept word for word, placing the summary, and its own summary
 * should this one fail), through `conversation.compact()` and its `beforeCompact` hook.
 *
 * An answer that leaves a main chat large enough, on a model that keeps a long cache, sets a time
 * to look at it again; each answer moves that time on. Only main chats are compacted this way,
 * since that is the one conversation a person keeps going for weeks.
 */

/** How long after a chat's last answer it is looked at. */
export const IDLE_AFTER_MS = 10 * 60_000
/** How much of the model's window the last request must have filled for a chat to be compacted. */
export const IDLE_SHARE = 0.7
/**
 * How long before the cache's lifetime runs out a chat is no longer compacted: the summary
 * request takes a while itself, and the lifetime is counted from when the provider last read it.
 */
export const CACHE_MARGIN_MS = 10 * 60_000
/** The shortest cache that is worth compacting on. A five-minute cache is gone before the check. */
const MIN_CACHE_MS = 60 * 60_000
/** How long a chat someone is typing in is left before it is looked at again. */
const TYPING_AGAIN_MS = 2 * 60_000
/** How many compactions are kept on record, newest last. */
const RECORDS = 50

/**
 * The cache retention the agent asks for on every request. The summary is asked for with the
 * same, since a request that asks for another is not read from the same cache.
 */
export const CACHE_RETENTION: CacheRetention = "long"

const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS

/**
 * How long a model's provider keeps the long cache the agent asks for, or undefined where that is
 * only minutes or is not known. The model's own word comes first; otherwise it is what pi-ai asks
 * for on that interface: an hour of Claude's cache through Anthropic's interface (Anthropic's own
 * or OpenRouter's), and a day of OpenAI's. Other models behind OpenAI's interface are not known
 * to keep anything that long, so they are left alone.
 */
export function cacheLifetimeMs(model: Model<string>): number | undefined {
  const compat = model.compat as
    { supportsLongCacheRetention?: boolean; cacheControlFormat?: string } | undefined
  if (compat?.supportsLongCacheRetention === false) return undefined
  const stated = model.promptCache?.long
  if (stated !== undefined) return stated * 1000 >= MIN_CACHE_MS ? stated * 1000 : undefined
  const openAis = model.provider === "openai" || model.baseUrl.includes("api.openai.com")
  switch (model.api) {
    case "anthropic-messages":
      return HOUR_MS
    case "openai-responses":
    case "azure-openai-responses":
      return DAY_MS
    case "openai-completions": {
      const anthropicCache =
        compat?.cacheControlFormat === "anthropic" ||
        (model.provider === "openrouter" && model.id.startsWith("anthropic/"))
      if (anthropicCache) return HOUR_MS
      if (openAis || (model.provider === "openrouter" && model.id.startsWith("openai/"))) {
        return DAY_MS
      }
      return undefined
    }
    default:
      // A model that says it keeps a long cache, on an interface nothing is known of: the
      // shortest long cache there is.
      return compat?.supportsLongCacheRetention === true ? HOUR_MS : undefined
  }
}

/** What is known of a chat when it is looked at. */
export type IdleFacts = {
  /** It has no task under way: no run, no compaction, nothing it started. */
  readonly resting: boolean
  /** Something was sent to it that it has not taken up yet. */
  readonly queued: boolean
  /** Someone is writing a message in it, where that can be known. */
  readonly typing: boolean
  /**
   * Its last answer, or undefined where it has none since it was last compacted or started
   * fresh: there is then nothing to compact.
   */
  readonly last: { readonly inputTokens: number; readonly at: number } | undefined
  /** The model it would be compacted with is the one that gave that answer. */
  readonly sameModel: boolean
  readonly contextWindow: number
  readonly cacheLifetimeMs: number | undefined
  readonly now: number
}

/** What is done with a chat that was looked at, and why. */
export type IdleDecision =
  | "compact"
  /** Someone is typing: it is looked at again shortly. */
  | "later"
  /** It is at work or has work waiting; its next answer is looked at instead. */
  | "busy"
  /** Nothing since it was last compacted, or it has never been answered. */
  | "nothing"
  /** Its last request filled less of the model's window than is worth a summary. */
  | "small"
  /** Its model keeps no cache long enough, or it was answered by another model. */
  | "uncached"
  /** The cache has gone, or is about to: its next request compacts it if it needs to. */
  | "cold"

/** Whether a chat that has been quiet for a while is compacted now. */
export function decide(facts: IdleFacts): IdleDecision {
  if (!facts.resting || facts.queued) return "busy"
  if (facts.last === undefined) return "nothing"
  if (facts.last.inputTokens < IDLE_SHARE * facts.contextWindow) return "small"
  if (!facts.sameModel || facts.cacheLifetimeMs === undefined) return "uncached"
  if (facts.now - facts.last.at >= facts.cacheLifetimeMs - CACHE_MARGIN_MS) return "cold"
  // Last, since it is the one that asks again: the others will not change by waiting.
  if (facts.typing) return "later"
  return "compact"
}

/** How many tokens a request's input was: what was read from the cache, written to it, or neither. */
export const inputTokens = (usage: Usage) => usage.input + usage.cacheRead + usage.cacheWrite

/** The part of a request's input that was read from the cache, from 0 to 1. */
export function cacheReadShare(usage: Usage): number {
  const total = inputTokens(usage)
  return total === 0 ? 0 : usage.cacheRead / total
}

/**
 * The newest answer in a chat's context that says what its request cost, after the summary or
 * fresh start it begins with: an answer from before that describes a context that is gone.
 */
export function lastAnswer(view: ContextView): AssistantMessage | undefined {
  const head = view.head?.id
  for (let index = view.entries.length - 1; index >= 0; index--) {
    const entry = view.entries[index]!
    if (head !== undefined && entry.id <= head) return undefined
    const message = view.contributions[index]!.findLast(
      (candidate): candidate is AssistantMessage =>
        candidate.role === "assistant" &&
        candidate.stopReason !== "error" &&
        candidate.stopReason !== "aborted" &&
        inputTokens(candidate.usage) > 0,
    )
    if (message !== undefined) return message
  }
  return undefined
}

/**
 * What the summary keeps, for a conversation that is the person's one long chat with their
 * Dood. Also given to pi-durable's own summarizer as its focus, where this one fails.
 */
export const IDLE_INSTRUCTIONS =
  "This is a long-running main conversation with the person, which goes on after this summary. Keep in particular: what the person has asked for and not yet got; promises you made to them, and anything you said you would do later or check on; sub-agents still at work, with what each is for and its chat id; automations and when they next run; and decisions made and preferences the person stated, marking any that are lasting and may not be in your memory yet."

/** The words that ask for the summary, after the conversation itself. */
export function summaryRequest(kept: string | undefined): string {
  const where =
    kept === undefined
      ? "Summarize the conversation above."
      : `The conversation above is about to be compacted. Everything from the message that begins "${kept}" onward stays as it is; summarize everything before it, and refer to what follows only where the summary needs it.`
  return `${where} Write a checkpoint that you will continue from, in place of what it summarizes. Do not continue the conversation, do not answer anything in it, and do not call any tool: write only the summary, in this form.

## Goal
[What the person is trying to accomplish, over the whole conversation.]

## Asked for and not yet done
- [Each request still open, with what is known of it]

## Promises
- [What you said you would do, and when]

## Sub-agents at work
- [Each one still running: what it is for, its chat id, what it is expected to report]

## Automations
- [Schedules that exist or were talked about, and when each next runs]

## Decisions and preferences
- [Decisions made, with their reason; preferences the person stated. Mark with (lasting) any that should outlive this conversation.]

## Where things stand
- [What was done, what is in progress, what is blocked]

## Critical context
- [Data, names, ids, paths, links and error messages needed to carry on, exactly as they were]

Write "(none)" under a heading with nothing in it. Keep each section short, and keep exact names, ids, paths and numbers.

${IDLE_INSTRUCTIONS}`
}

/** The opening words of a message, to say where what is kept starts. */
function opening(messages: readonly Message[]): string | undefined {
  for (const message of messages) {
    if (message.role === "system") continue
    const content: unknown = message.content
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .flatMap((block: { type?: string; text?: unknown; name?: unknown }) =>
                block.type === "text" && typeof block.text === "string"
                  ? [block.text]
                  : block.type === "toolCall" && typeof block.name === "string"
                    ? [`[a call to ${block.name}]`]
                    : [],
              )
              .join(" ")
          : ""
    const words = text.replace(/\s+/g, " ").trim()
    if (words !== "") return words.length > 120 ? `${words.slice(0, 120)}…` : words
  }
  return undefined
}

/** What the summary's text is, from an answer that is one: plain words that call no tool. */
function summaryText(message: AssistantMessage): string | undefined {
  if (message.stopReason !== "stop" || message.content.some((block) => block.type === "toolCall")) {
    return undefined
  }
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim()
  return text === "" ? undefined : text
}

/** How pi-durable puts a summary into the chat, for an estimate of what the chat holds after. */
const SUMMARY_PREFIX =
  "The conversation history before this point was compacted into the following summary:\n\n<summary>\n"

const tokens = (messages: readonly Message[]) =>
  messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)

/** The compactions done this way, newest last, so that the share that sets one off can be tuned. */
export const CompactionsDoc = defineDoc<{ records: IdleCompactionRecord[] }>({
  kind: "dc.idle-compactions",
  version: 1,
  scope: "session",
  initial: () => ({ records: [] }),
})

/** What a compaction's hook keeps of its summary, so that a task taken up again asks once. */
type Memo = { summary: string | null }
const MEMO = "dc.idle-summary"

export type IdleCompactionOptions = {
  readonly sql: ActorDatabase
  readonly now: () => number
  /** The actor's own context, which outlives any request. */
  readonly context: Context
  readonly models: Models
  /** Whether someone is writing a message in a chat right now. Where it is not known, nobody is. */
  readonly typing?: (chatId: string) => Promise<boolean>
  /** How long after an answer a chat is looked at. Only a test changes it. */
  readonly afterMs?: number
  /** A chat now has a time it is to be looked at, which the actor's wake-up has to cover. */
  readonly armed: () => void
  readonly onReport: (error: unknown) => void
}

/**
 * When each main chat is to be looked at, kept in the agent's own store so that a new actor has
 * it, and the hooks that compact it then. A row a chat: each answer moves its time later.
 */
export class IdleCompaction {
  readonly extension: Extension
  readonly #options: IdleCompactionOptions
  #harness: Harness | undefined
  #ready: Promise<void> | undefined

  constructor(options: IdleCompactionOptions) {
    this.#options = options
    this.extension = defineExtension({
      name: "dc.idle-compaction",
      hooks: [
        hook(GenerationTask, {
          afterResponse: async (message, api, context) => {
            if (message.stopReason === "error" || message.stopReason === "aborted") return
            const chats = await api.snapshot(ChatsDoc, context)
            const chatId = String(api.conversationId)
            if (chats?.main !== chatId) return
            // Most answers leave a chat too small to compact, or come from a model with no long
            // cache. Those are not looked at again, so that the agent is not woken for nothing.
            const model = api.models.getModel(message.provider, message.model)
            const worth =
              model !== undefined &&
              cacheLifetimeMs(model) !== undefined &&
              inputTokens(message.usage) >= IDLE_SHARE * model.contextWindow
            if (!worth) return this.#disarm(chatId)
            await this.#arm(chatId, this.#options.now() + (this.#options.afterMs ?? IDLE_AFTER_MS))
          },
        }),
        hook(CompactionTask, {
          beforeCompact: (compaction, api, context) => this.#summarize(compaction, api, context),
        }),
      ],
    })
  }

  attach(harness: Harness): void {
    this.#harness = harness
  }

  #open(): Promise<void> {
    this.#ready ??= this.#options.sql.exec(
      `CREATE TABLE IF NOT EXISTS dc_idle_compaction (
        chat_id TEXT PRIMARY KEY,
        due INTEGER NOT NULL
      ) STRICT`,
    )
    this.#ready.catch(() => {
      this.#ready = undefined
    })
    return this.#ready
  }

  async #arm(chatId: string, due: number): Promise<void> {
    await this.#open()
    await this.#options.sql.run(
      `INSERT INTO dc_idle_compaction (chat_id, due) VALUES (?, ?)
       ON CONFLICT (chat_id) DO UPDATE SET due = excluded.due`,
      chatId,
      due,
    )
    this.#options.armed()
  }

  /** Forget a chat's time, or only the time `due`: an answer since may have set another. */
  async #disarm(chatId: string, due?: number): Promise<void> {
    await this.#open()
    if (due === undefined) {
      await this.#options.sql.run("DELETE FROM dc_idle_compaction WHERE chat_id = ?", chatId)
    } else {
      await this.#options.sql.run(
        "DELETE FROM dc_idle_compaction WHERE chat_id = ? AND due = ?",
        chatId,
        due,
      )
    }
  }

  /** When the next chat is to be looked at, or null where none is. */
  async nextWake(): Promise<number | null> {
    await this.#open()
    const row = await this.#options.sql.get<{ due: number | null }>(
      "SELECT MIN(due) AS due FROM dc_idle_compaction",
    )
    return row?.due ?? null
  }

  /** Look at every chat whose time has come. Never throws: a failure is reported, and dropped. */
  async tick(): Promise<void> {
    if (this.#harness === undefined) return
    await this.#open()
    const rows = await this.#options.sql.all<{ chat_id: string; due: number }>(
      "SELECT chat_id, due FROM dc_idle_compaction WHERE due <= ?",
      this.#options.now(),
    )
    for (const { chat_id: chatId, due } of rows) {
      try {
        const decision = await this.#look(this.#harness, chatId)
        if (decision === "later") {
          const again = Math.min(TYPING_AGAIN_MS, this.#options.afterMs ?? IDLE_AFTER_MS)
          await this.#arm(chatId, this.#options.now() + again)
          continue
        }
      } catch (error) {
        this.#options.onReport(error)
      }
      await this.#disarm(chatId, due)
    }
  }

  /** Look at one chat, and compact it where it should be. */
  async #look(harness: Harness, chatId: string): Promise<IdleDecision> {
    const { context } = this.#options
    const chats = await harness.snapshot(ChatsDoc, context)
    if (chats?.main !== chatId) return "nothing"
    const conversation = await harness.conversation(Number(chatId) as ConversationId, context)
    if (conversation === undefined) return "nothing"
    const inspection = await harness.inspect(context)
    const resting = !inspection.tasks.some((task) => String(task.record.conversationId) === chatId)
    const queued = inspection.submissions.some((entry) => String(entry.conversationId) === chatId)
    const [view, agent] = await Promise.all([
      conversation.context(context),
      conversation.agent(context),
    ])
    const last = lastAnswer(view)
    const ref = agent.model
    const model =
      ref === undefined ? undefined : this.#options.models.getModel(ref.provider, ref.modelId)
    const typing =
      resting && !queued
        ? await (this.#options.typing?.(chatId) ?? Promise.resolve(false)).catch((error) => {
            this.#options.onReport(error)
            return false
          })
        : false
    const decision = decide({
      resting,
      queued,
      typing,
      last:
        last === undefined
          ? undefined
          : { inputTokens: inputTokens(last.usage), at: last.timestamp },
      sameModel:
        model !== undefined && last?.provider === model.provider && last.model === model.id,
      contextWindow: model?.contextWindow ?? Number.POSITIVE_INFINITY,
      cacheLifetimeMs: model === undefined ? undefined : cacheLifetimeMs(model),
      now: this.#options.now(),
    })
    if (decision === "compact") await conversation.compact(IDLE_INSTRUCTIONS, context)
    return decision
  }

  /**
   * The summary of a compaction started here, asked for as the chat's own next request would be
   * made, so that what it repeats is read from the cache. Undefined leaves it to pi-durable's own
   * summarizer, which is what any other compaction gets, and this one where asking failed.
   */
  async #summarize(
    compaction: Parameters<CompactionHooks["beforeCompact"]>[0],
    api: HookApi,
    context: Context,
  ): Promise<{ summary: string } | undefined> {
    if (compaction.reason !== "manual" || compaction.instructions !== IDLE_INSTRUCTIONS) return
    const harness = this.#harness
    if (harness === undefined) return
    // Asked once for a task: one taken up again after a restart uses what it was told.
    const remembered = await api.memo<Memo>(MEMO, context)
    if (remembered !== undefined) {
      return remembered.summary === null ? undefined : { summary: remembered.summary }
    }
    let summary: string | undefined
    try {
      summary = await this.#ask(harness, compaction.firstKept, api, context)
    } catch (error) {
      if (context.abortSignal?.aborted) throw error
      this.#options.onReport(error)
    }
    await api.memo<Memo>(MEMO, { summary: summary ?? null }, context)
    return summary === undefined ? undefined : { summary }
  }

  async #ask(
    harness: Harness,
    firstKept: EntryId,
    api: HookApi,
    context: Context,
  ): Promise<string | undefined> {
    const conversation = await harness.conversation(api.conversationId, context)
    if (conversation === undefined) return undefined
    const [view, agent, provider] = await Promise.all([
      conversation.context(context),
      conversation.agent(context),
      api.snapshot(ProviderDoc, api.conversationId, context),
    ])
    const ref = agent.model
    const model = ref === undefined ? undefined : api.models.getModel(ref.provider, ref.modelId)
    if (model === undefined) return undefined
    const keptAt = view.entries.findIndex((entry) => entry.id === firstKept)
    const kept = keptAt < 0 ? [] : view.contributions.slice(keptAt).flat()
    const before = lastAnswer(view)
    // The same changes the chat's own requests are given (`uses.ts`, then `limits.ts`), so that
    // the request starts as the last one did.
    const messages = keepPicturesSmall(dropOldPictures(view.messages))
    const now = this.#options.now()
    const asked: Message = {
      role: "user",
      content: [{ type: "text", text: summaryRequest(opening(kept)) }],
      timestamp: now,
    }
    const answer = await api.models.completeSimple(
      model,
      { messages: [...messages, asked] },
      {
        cacheRetention: CACHE_RETENTION,
        // pi-durable's own summarizer is given the same room.
        maxTokens: Math.min(
          13_107,
          model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
        ),
        ...(provider?.sessionId === undefined ? {} : { sessionId: provider.sessionId }),
        ...(context.abortSignal === undefined ? {} : { signal: context.abortSignal }),
        ...(agent.thinkingLevel === "off" ? {} : { reasoning: agent.thinkingLevel }),
      },
    )
    context.abortSignal?.throwIfAborted()
    const summary = summaryText(answer)
    const system = view.messages.filter((message) => message.role === "system")
    const after =
      summary === undefined
        ? null
        : tokens(system) +
          estimateMessageTokens({
            role: "user",
            content: [{ type: "text", text: `${SUMMARY_PREFIX}${summary}</summary>` }],
            timestamp: now,
          }) +
          tokens(kept.filter((message) => message.role !== "system"))
    const record: IdleCompactionRecord = {
      chatId: String(api.conversationId),
      taskId: String(api.taskId),
      at: now,
      model: `${answer.provider}/${answer.model}`,
      before: before === undefined ? 0 : inputTokens(before.usage),
      after,
      input: answer.usage.input,
      cacheRead: answer.usage.cacheRead,
      cacheWrite: answer.usage.cacheWrite,
      cacheReadShare: cacheReadShare(answer.usage),
      cost: answer.usage.cost.total,
      summarized: summary !== undefined,
    }
    // What it cost is the chat's, as any request of the chat's is, under the model it used.
    await harness.commit(async (tx) => {
      const usage = await tx.doc(UsageDoc, api.conversationId)
      const key = record.model
      const total = Object.hasOwn(usage.models, key) ? usage.models[key] : undefined
      if (total === undefined) usage.models[key] = JSON.parse(JSON.stringify(answer.usage))
      else addUsage(total as Usage, answer.usage)
      const kept = await tx.doc(CompactionsDoc)
      kept.records.push(record)
      if (kept.records.length > RECORDS) kept.records.splice(0, kept.records.length - RECORDS)
    }, this.#options.context)
    return summary
  }

  /** The compactions done this way, newest last. */
  async records(context: Context): Promise<IdleCompactionRecord[]> {
    return (await this.#harness?.snapshot(CompactionsDoc, context))?.records ?? []
  }
}

/** Add what one request cost to a total kept in pi-durable's form. */
function addUsage(total: Usage, usage: Usage): void {
  total.input += usage.input
  total.output += usage.output
  total.cacheRead += usage.cacheRead
  total.cacheWrite += usage.cacheWrite
  total.totalTokens += usage.totalTokens
  if (usage.cacheWrite1h !== undefined)
    total.cacheWrite1h = (total.cacheWrite1h ?? 0) + usage.cacheWrite1h
  if (usage.reasoning !== undefined) total.reasoning = (total.reasoning ?? 0) + usage.reasoning
  total.cost.input += usage.cost.input
  total.cost.output += usage.cost.output
  total.cost.cacheRead += usage.cost.cacheRead
  total.cost.cacheWrite += usage.cost.cacheWrite
  total.cost.total += usage.cost.total
}

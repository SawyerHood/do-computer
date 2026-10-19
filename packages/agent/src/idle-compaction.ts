import type { IdleCompactionRecord } from "@do-computer/protocol"
import type { ActorDatabase } from "@do-computer/runtime"
import { type Context, copyJson } from "@earendil-works/chord"
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
  type Agent,
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
import { roundEnded, storedRound } from "./bus.ts"
import { ChatsDoc } from "./docs.ts"
import { type ImageLimits, shapeRequest } from "./limits.ts"

/**
 * Compacting a chat while the provider still has it in its cache.
 *
 * A long main chat that has gone quiet is summarized about ten minutes after its last answer,
 * while reading it is still cheap, so that whatever comes next starts from a small context
 * instead of paying to write a large one into the cache again. pi-durable compacts on its own
 * only when a request would come near the model's window, which is when the chat is needed, and
 * its summarizer sends the conversation as a new prompt of its own, which the cache never has.
 *
 * So the summary here is asked for the way the chat's own requests are made: the same messages
 * (`shapeRequest`), the same provider session and the same cache retention, with one more
 * message at the end that asks for the summary. Everything before that message is read from the
 * cache. pi-durable still does the rest (choosing what is kept word for word and placing the
 * summary) through `conversation.compact()` and its `beforeCompact` hook.
 *
 * The same hook answers for pi-durable's own compactions at its threshold, of any chat, where
 * the model keeps a long cache and the chat's last request was recent enough for it still to
 * hold: those are then read from the cache too. Where asking fails, a quiet chat is left as it
 * is, since it is not in the way of anything; a chat at its threshold is left to pi-durable's
 * own summarizer, since its next request needs the room.
 *
 * An answer that leaves a main chat large enough, on a model that keeps a long cache, sets a time
 * to look at it again; each answer moves that time on.
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
/**
 * How long someone typing can put a compaction off. Presence counts a draft left in the box as
 * typing, so without an end a teammate's forgotten draft would hold it off until the cache ran out.
 */
export const TYPING_CAP_MS = 10 * 60_000
/** How many compactions are kept on record, newest last. */
const RECORDS = 50
/** How long a chat whose cached summary failed is not asked for one again. */
export const BACKOFF_MS = 60 * 60_000
/**
 * The least room past the whole chat a threshold compaction's cached request needs, for the
 * summary and any thinking before it. pi-durable gives its own summarizer up to 13,107.
 */
const SUMMARY_ROOM = 16_384
/** What pi-ai leaves free of the window when it fits a request's output to it. */
const PI_AI_MARGIN = 4_096

/**
 * The cache retention the agent asks for on every request. The summary is asked for with the
 * same, since a request that asks for another is not read from the same cache.
 */
export const CACHE_RETENTION: CacheRetention = "long"

const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS

/**
 * Whether an OpenAI model is of a family OpenAI keeps the extended (24-hour) cache for: GPT-5 and
 * GPT-4.1. Others keep it in memory, for an hour at most.
 */
function extendedOpenAi(id: string): boolean {
  const name = id.replace(/^openai\//, "")
  return name.startsWith("gpt-5") || name.startsWith("gpt-4.1")
}

/**
 * How long a model's provider keeps the long cache the agent asks for, or undefined where that is
 * only minutes or is not known. Only providers known to keep it are given a lifetime: Anthropic
 * (an hour), Claude through OpenRouter (an hour), and OpenAI's GPT-5 and GPT-4.1, directly or
 * through OpenRouter (a day), except a model with an explicit cache mode, which pi-ai asks to keep
 * for 30 minutes. Azure is not among them: pi-ai never asks it for a long cache. Others behind the
 * same interfaces (MiniMax, Vercel's gateway and the like) are not known to keep one, whatever
 * pi-ai sends them, so they have only what the model itself says, where it says an hour or more.
 */
export function cacheLifetimeMs(model: Model<string>): number | undefined {
  const compat = model.compat as
    { supportsLongCacheRetention?: boolean; supportsExplicitPromptCacheMode?: boolean } | undefined
  if (compat?.supportsLongCacheRetention === false) return undefined
  const openRouter = model.provider === "openrouter" || model.baseUrl.includes("openrouter.ai")
  if (model.provider === "anthropic" || model.baseUrl.includes("api.anthropic.com")) return HOUR_MS
  if (openRouter && model.id.startsWith("anthropic/")) return HOUR_MS
  if (model.provider === "openai" || model.baseUrl.includes("api.openai.com")) {
    return compat?.supportsExplicitPromptCacheMode !== true && extendedOpenAi(model.id)
      ? DAY_MS
      : undefined
  }
  if (openRouter && model.id.startsWith("openai/")) {
    return extendedOpenAi(model.id) ? DAY_MS : undefined
  }
  const stated = model.promptCache?.long
  return stated !== undefined && stated * 1000 >= MIN_CACHE_MS ? stated * 1000 : undefined
}

/** What is known of a chat's work when it is looked at, which is cheap to find out. */
export type RestFacts = {
  /** It has no task under way: no run, no compaction, nothing it started. */
  readonly resting: boolean
  /** Something was sent to it that it has not taken up yet. */
  readonly queued: boolean
  /** Someone is writing a message in it, and has not been putting it off for too long. */
  readonly typing: boolean
}

/** What is known of a chat's context and its cache, which takes reading the chat. */
export type CacheFacts = {
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

export type IdleFacts = RestFacts & CacheFacts

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
  /** A cached summary of it failed lately, so none is asked for a while. */
  | "backoff"

/** Whether a chat's work keeps it from being compacted now. Asked first, as it reads nothing. */
export function restDecision(facts: RestFacts): "busy" | "later" | undefined {
  if (!facts.resting || facts.queued) return "busy"
  if (facts.typing) return "later"
  return undefined
}

/** Whether a resting chat is worth compacting from the cache now. */
export function cacheDecision(
  facts: CacheFacts,
): Exclude<IdleDecision, "busy" | "later" | "backoff"> {
  if (facts.last === undefined) return "nothing"
  if (facts.last.inputTokens < IDLE_SHARE * facts.contextWindow) return "small"
  if (!facts.sameModel || facts.cacheLifetimeMs === undefined) return "uncached"
  if (facts.now - facts.last.at >= facts.cacheLifetimeMs - CACHE_MARGIN_MS) return "cold"
  return "compact"
}

/** Whether a chat that has been quiet for a while is compacted now. */
export function decide(facts: IdleFacts): IdleDecision {
  return restDecision(facts) ?? cacheDecision(facts)
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
 * Dood. It is also how a compaction started here is known, when its hook is asked.
 */
export const IDLE_INSTRUCTIONS =
  "This is a long-running main conversation with the person, which goes on after this summary. Keep in particular: what the person has asked for and not yet got; promises you made to them, and anything you said you would do later or check on; sub-agents still at work, with what each is for and its chat id; automations and when they next run; and decisions made and preferences the person stated, marking any that are lasting and may not be in your memory yet."

/** Where what is kept word for word starts: how many messages it is, and how the first begins. */
export type Kept = { readonly count: number; readonly opening: string }

/** The form a main chat's summary takes: what a long conversation with the person needs kept. */
const MAIN_FORM = `## Goal
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

/**
 * The form any other chat's summary takes: pi-durable's own (`SUMMARIZATION_PROMPT` in its
 * `harness/compaction.js`, which it does not export), so that a sub-agent, an automation, a
 * thread in Slack or a side chat is summarized as it would have been without this hook.
 */
const OTHER_FORM = `If the conversation starts with an earlier summary, preserve its information and fold the newer messages into it.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`

/** The words that ask for the summary, after the conversation itself. */
export function summaryRequest(kept: Kept | undefined, main: boolean): string {
  const where =
    kept === undefined
      ? "Summarize the conversation above."
      : `The conversation above is about to be compacted. Its last ${kept.count === 1 ? "message stays" : `${kept.count} messages stay`} as they are, from the one that begins "${kept.opening}"; summarize everything before ${kept.count === 1 ? "it" : "them"}, and refer to what follows only where the summary needs it.`
  return `${where} Write a checkpoint that you will continue from, in place of what it summarizes. Do not continue the conversation, do not answer anything in it, and do not call any tool: write only the summary, in this form.

${main ? MAIN_FORM : OTHER_FORM}`
}

/**
 * Whether text has the form a summary was asked in. Both forms begin with a goal and end with
 * the critical context. A model that answered the conversation instead of summarizing it, as one
 * can where a message is still open, writes something else, which must not replace the chat.
 */
export function isSummary(text: string): boolean {
  return /^## Goal\b/m.test(text) && /^## Critical context\b/im.test(text)
}

/** The message that asks for the summary of a chat, cut at `firstKept`. */
function askFor(view: ContextView, firstKept: EntryId, main: boolean, now: number): Message {
  return {
    role: "user",
    content: [
      { type: "text", text: summaryRequest(keptFrom(keptMessages(view, firstKept)), main) },
    ],
    timestamp: now,
  }
}

/** The messages pi-durable keeps word for word, from `firstKept` on. */
function keptMessages(view: ContextView, firstKept: EntryId): Message[] {
  const at = view.entries.findIndex((entry) => entry.id === firstKept)
  return at < 0 ? [] : view.contributions.slice(at).flat()
}

/**
 * About how many tokens a request of these messages is: the input and output of the newest
 * answer that says, as pi-durable measures it, and an estimate of what came after.
 */
export function estimateRequest(messages: readonly Message[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.role !== "assistant" || inputTokens(message.usage) === 0) continue
    return inputTokens(message.usage) + message.usage.output + tokens(messages.slice(index + 1))
  }
  return tokens(messages)
}

/** Whether a cached summary of a chat failed lately, after which it is not asked for a while. */
export function failedLately(
  records: readonly IdleCompactionRecord[],
  chatId: string,
  now: number,
): boolean {
  return records.some(
    (record) => record.chatId === chatId && !record.summarized && now - record.at < BACKOFF_MS,
  )
}

/** How what is kept word for word starts, to say where the summary ends. */
function keptFrom(messages: readonly Message[]): Kept | undefined {
  const said = messages.filter((message) => message.role !== "system")
  for (const message of said) {
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
    if (words === "") continue
    return {
      count: said.length,
      opening: words.length > 120 ? `${words.slice(0, 120)}…` : words,
    }
  }
  return undefined
}

/** The summary in an answer, or why the answer is not one. */
function summaryOf(message: AssistantMessage): { summary: string } | { failure: string } {
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    return { failure: `${message.stopReason}: ${message.errorMessage ?? "no message"}` }
  }
  if (message.stopReason === "length") return { failure: "it was cut off at its token limit" }
  if (message.content.some((block) => block.type === "toolCall")) {
    return { failure: "it called a tool instead" }
  }
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim()
  if (text === "") return { failure: "it had no text" }
  if (!isSummary(text)) return { failure: "it was not in the form of a summary" }
  return { summary: text }
}

/** How pi-durable puts a summary into the chat, for an estimate of what the chat holds after. */
const SUMMARY_PREFIX =
  "The conversation history before this point was compacted into the following summary:\n\n<summary>\n"

const tokens = (messages: readonly Message[]) =>
  messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)

/** The compactions done this way, newest last, so that what sets one off can be tuned. */
export const CompactionsDoc = defineDoc<{ records: IdleCompactionRecord[] }>({
  kind: "dc.idle-compactions",
  version: 1,
  scope: "session",
  initial: () => ({ records: [] }),
})

/** What a compaction's hook keeps of its summary, so that a task taken up again asks once. */
type Memo = { summary: string | null }
const MEMO = "dc.idle-summary"

type Row = { chat_id: string; due: number; deferred_since: number | null }

export type IdleCompactionOptions = {
  readonly sql: ActorDatabase
  readonly now: () => number
  /** The actor's own context, which outlives any request. */
  readonly context: Context
  readonly models: Models
  /** The picture limits the chat's requests are given, which the summary request repeats. */
  readonly imageLimits?: ImageLimits
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
          afterResponse: (message, api, context) => this.#answered(message, api, context),
          // A round of sends marked done ends the run without a final answer: it is one the run
          // rests on, as that is. Read from the stored results, as the run's end was decided.
          afterTools: async (assistant, results, api, context) => {
            const harness = this.#harness
            if (harness === undefined) return
            try {
              const round = await storedRound(harness, assistant, results, context)
              if (round === undefined || !roundEnded(round.answer, round.results)) return
              await this.#rested(String(api.conversationId), round.answer, api, context)
            } catch (error) {
              // Not being able to look must never cost the run its end.
              this.#options.onReport(error)
            }
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

  /** A chat had an answer: note it on the compaction before it, and set when to look at it. */
  async #answered(message: AssistantMessage, api: HookApi, context: Context): Promise<void> {
    if (message.stopReason === "error" || message.stopReason === "aborted") return
    const chatId = String(api.conversationId)
    await this.#noteNext(chatId, message, api, context)
    // Only an answer the run rests on: a round of tool calls is followed by more, and the last
    // answer moves the time on anyway. A round that ended the run is told of once its results
    // are stored (`afterTools`).
    if (message.stopReason !== "stop") return
    await this.#rested(chatId, message, api, context)
  }

  /** A chat came to rest on an answer: set when to look at it, where it is worth looking at. */
  async #rested(
    chatId: string,
    message: AssistantMessage,
    api: HookApi,
    context: Context,
  ): Promise<void> {
    const chats = await api.snapshot(ChatsDoc, context)
    if (chats?.main !== chatId) return
    // Most answers leave a chat too small to compact, or come from a model with no long cache.
    // Those are not looked at again, so that the agent is not woken for nothing.
    const model = api.models.getModel(message.provider, message.model)
    const worth =
      model !== undefined &&
      cacheLifetimeMs(model) !== undefined &&
      inputTokens(message.usage) >= IDLE_SHARE * model.contextWindow
    if (!worth) return this.#disarm(chatId)
    await this.#arm(chatId, this.#options.now() + (this.#options.afterMs ?? IDLE_AFTER_MS), null)
  }

  /**
   * Record the first request a chat made after a compaction of it was recorded: how long after,
   * and what it cost the cache, which is what says whether compacting then paid.
   */
  async #noteNext(
    chatId: string,
    message: AssistantMessage,
    api: HookApi,
    context: Context,
  ): Promise<void> {
    const records = (await api.snapshot(CompactionsDoc, context))?.records ?? []
    const waiting = records.findLast((record) => record.chatId === chatId)
    if (waiting === undefined || !waiting.summarized || waiting.next !== undefined) return
    if (message.timestamp <= waiting.at) return
    await this.#harness?.commit(async (tx) => {
      const record = (await tx.doc(CompactionsDoc)).records.findLast(
        (candidate) => candidate.taskId === waiting.taskId,
      )
      if (record === undefined || record.next !== undefined) return
      record.next = {
        afterMs: message.timestamp - record.at,
        input: message.usage.input,
        cacheRead: message.usage.cacheRead,
        cacheWrite: message.usage.cacheWrite,
      }
    }, this.#options.context)
  }

  #open(): Promise<void> {
    this.#ready ??= this.#options.sql.exec(
      `CREATE TABLE IF NOT EXISTS dc_idle_compaction (
        chat_id TEXT PRIMARY KEY,
        due INTEGER NOT NULL,
        deferred_since INTEGER
      ) STRICT`,
    )
    this.#ready.catch(() => {
      this.#ready = undefined
    })
    return this.#ready
  }

  /** Set when a chat is looked at, and since when someone typing has been putting it off. */
  async #arm(chatId: string, due: number, deferredSince: number | null): Promise<void> {
    await this.#open()
    await this.#options.sql.run(
      `INSERT INTO dc_idle_compaction (chat_id, due, deferred_since) VALUES (?, ?, ?)
       ON CONFLICT (chat_id) DO UPDATE SET due = excluded.due,
         deferred_since = excluded.deferred_since`,
      chatId,
      due,
      deferredSince,
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
    const now = this.#options.now()
    const rows = await this.#options.sql.all<Row>(
      "SELECT chat_id, due, deferred_since FROM dc_idle_compaction WHERE due <= ?",
      now,
    )
    for (const row of rows) {
      try {
        const decision = await this.#look(this.#harness, row)
        if (decision === "later") {
          // Never later than an answer would have it looked at, which a test makes short.
          const again = Math.min(TYPING_AGAIN_MS, this.#options.afterMs ?? IDLE_AFTER_MS)
          await this.#arm(row.chat_id, this.#options.now() + again, row.deferred_since ?? now)
          continue
        }
      } catch (error) {
        this.#options.onReport(error)
      }
      await this.#disarm(row.chat_id, row.due)
    }
  }

  /**
   * Look at one chat, and compact it where it should be. What is cheap to ask comes first: the
   * chat's context is read only for a chat that is resting with nobody typing in it.
   */
  async #look(harness: Harness, row: Row): Promise<IdleDecision> {
    const { context } = this.#options
    const chatId = row.chat_id
    const chats = await harness.snapshot(ChatsDoc, context)
    if (chats?.main !== chatId) return "nothing"
    const inspection = await harness.inspect(context)
    const resting = !inspection.tasks.some((task) => String(task.record.conversationId) === chatId)
    const queued = inspection.submissions.some((entry) => String(entry.conversationId) === chatId)
    const deferredFor = row.deferred_since === null ? 0 : this.#options.now() - row.deferred_since
    const typing =
      resting && !queued && deferredFor < TYPING_CAP_MS
        ? await (this.#options.typing?.(chatId) ?? Promise.resolve(false)).catch((error) => {
            this.#options.onReport(error)
            return false
          })
        : false
    const rest = restDecision({ resting, queued, typing })
    if (rest !== undefined) return rest
    if (failedLately(await this.records(context), chatId, this.#options.now())) return "backoff"
    const conversation = await harness.conversation(Number(chatId) as ConversationId, context)
    if (conversation === undefined) return "nothing"
    const [view, agent] = await Promise.all([
      conversation.context(context),
      conversation.agent(context),
    ])
    const ref = agent.model
    const model =
      ref === undefined ? undefined : this.#options.models.getModel(ref.provider, ref.modelId)
    const decision = cacheDecision(this.#cacheFacts(view, model))
    if (decision === "compact") await conversation.compact(IDLE_INSTRUCTIONS, context)
    return decision
  }

  #cacheFacts(view: ContextView, model: Model<string> | undefined): CacheFacts {
    const last = lastAnswer(view)
    return {
      last:
        last === undefined
          ? undefined
          : { inputTokens: inputTokens(last.usage), at: last.timestamp },
      sameModel:
        model !== undefined && last?.provider === model.provider && last.model === model.id,
      contextWindow: model?.contextWindow ?? Number.POSITIVE_INFINITY,
      cacheLifetimeMs: model === undefined ? undefined : cacheLifetimeMs(model),
      now: this.#options.now(),
    }
  }

  /**
   * The summary of a compaction, asked for as the chat's own next request would be made, so
   * that what it repeats is read from the cache: for every idle compaction, and for
   * pi-durable's own at its threshold where the cache should still hold. Undefined leaves it to
   * pi-durable's own summarizer; a decline leaves the chat as it is.
   */
  async #summarize(
    compaction: Parameters<CompactionHooks["beforeCompact"]>[0],
    api: HookApi,
    context: Context,
  ): Promise<{ summary: string } | { decline: true } | undefined> {
    if (compaction.reason === "manual" && compaction.instructions === IDLE_INSTRUCTIONS) {
      // Where there is no summary, an idle compaction does nothing: the chat is not in the way of
      // anything, and pi-durable's summarizer would send the whole chat uncached.
      return (await this.#idleSummary(compaction, api, context)) ?? { decline: true }
    }
    if (compaction.reason !== "threshold") return undefined
    // A chat at its threshold needs the room, so anything that goes wrong here leaves it to
    // pi-durable's summarizer, as it was before this hook.
    try {
      return await this.#thresholdSummary(compaction, api, context)
    } catch (error) {
      if (context.abortSignal?.aborted) throw error
      this.#options.onReport(error)
      return undefined
    }
  }

  async #idleSummary(
    compaction: Parameters<CompactionHooks["beforeCompact"]>[0],
    api: HookApi,
    context: Context,
  ): Promise<{ summary: string } | undefined> {
    const harness = this.#harness
    if (harness === undefined) return undefined
    // Asked once for a task: one taken up again after a restart uses what it was told.
    const remembered = await api.memo<Memo>(MEMO, context)
    if (remembered !== undefined) {
      return remembered.summary === null ? undefined : { summary: remembered.summary }
    }
    const conversation = await harness.conversation(api.conversationId, context)
    if (conversation === undefined) return undefined
    const [view, agent] = await Promise.all([
      conversation.context(context),
      conversation.agent(context),
    ])
    const ref = agent.model
    const model = ref === undefined ? undefined : api.models.getModel(ref.provider, ref.modelId)
    if (model === undefined) return undefined
    return this.#attempt(harness, compaction, view, model, agent.thinkingLevel, true, api, context)
  }

  /**
   * The cached summary for pi-durable's own compaction at its threshold, or undefined to leave
   * it to pi-durable's summarizer. A model without a long cache is known from the agent alone,
   * before anything else is read, so such a chat compacts exactly as it did before this hook.
   */
  async #thresholdSummary(
    compaction: Parameters<CompactionHooks["beforeCompact"]>[0],
    api: HookApi,
    context: Context,
  ): Promise<{ summary: string } | undefined> {
    const harness = this.#harness
    if (harness === undefined) return undefined
    const conversation = await harness.conversation(api.conversationId, context)
    if (conversation === undefined) return undefined
    const agent = await conversation.agent(context)
    const ref = agent.model
    const model = ref === undefined ? undefined : api.models.getModel(ref.provider, ref.modelId)
    if (model === undefined || cacheLifetimeMs(model) === undefined) return undefined
    const remembered = await api.memo<Memo>(MEMO, context)
    if (remembered !== undefined) {
      return remembered.summary === null ? undefined : { summary: remembered.summary }
    }
    const chatId = String(api.conversationId)
    if (failedLately(await this.records(context), chatId, this.#options.now())) return undefined
    const [view, chats] = await Promise.all([
      conversation.context(context),
      api.snapshot(ChatsDoc, context),
    ])
    // From a cold cache, the whole chat would be paid for in full, where pi-durable's summarizer
    // sends a shorter transcript of it.
    const facts = this.#cacheFacts(view, model)
    const warm =
      facts.last !== undefined &&
      facts.sameModel &&
      facts.cacheLifetimeMs !== undefined &&
      facts.now - facts.last.at < facts.cacheLifetimeMs - CACHE_MARGIN_MS
    if (!warm) return undefined
    // The request carries the whole chat, so the room left for the summary is what the window
    // holds past it; pi-ai keeps a further margin of its own. A blocking compaction, which comes
    // only once the chat is within `reserveTokens` of the window, mostly has too little, and a
    // summary cut off would be paid for and then written again by pi-durable.
    const asked = askFor(view, compaction.firstKept, chats?.main === chatId, this.#options.now())
    const room =
      model.contextWindow -
      estimateRequest(view.messages) -
      estimateMessageTokens(asked) -
      PI_AI_MARGIN
    if (room < SUMMARY_ROOM) return undefined
    return this.#attempt(
      harness,
      compaction,
      view,
      model,
      agent.thinkingLevel,
      chats?.main === chatId,
      api,
      context,
    )
  }

  /** Ask for the summary, and remember and report what came of it. */
  async #attempt(
    harness: Harness,
    compaction: Parameters<CompactionHooks["beforeCompact"]>[0],
    view: ContextView,
    model: Model<string>,
    thinking: Agent["thinkingLevel"],
    main: boolean,
    api: HookApi,
    context: Context,
  ): Promise<{ summary: string } | undefined> {
    const idle = compaction.reason === "manual"
    let outcome: { summary: string } | { failure: string }
    try {
      outcome = await this.#ask(harness, {
        view,
        model,
        thinking,
        firstKept: compaction.firstKept,
        reason: idle ? "idle" : "threshold",
        main,
        api,
        context,
      })
    } catch (error) {
      if (context.abortSignal?.aborted) throw error
      outcome = { failure: error instanceof Error ? error.message : String(error) }
    }
    const summary = "summary" in outcome ? outcome.summary : null
    await api.memo<Memo>(MEMO, { summary }, context)
    if ("summary" in outcome) return { summary: outcome.summary }
    this.#options.onReport(
      new Error(
        `Chat ${String(api.conversationId)}: the summary asked for from the cache (task ${String(api.taskId)}) failed, so ${idle ? "the chat was left as it is" : "pi-durable's own summarizer writes it"}: ${outcome.failure}`,
      ),
    )
    return undefined
  }

  async #ask(
    harness: Harness,
    asking: {
      view: ContextView
      model: Model<string>
      thinking: Agent["thinkingLevel"]
      firstKept: EntryId
      reason: IdleCompactionRecord["reason"]
      main: boolean
      api: HookApi
      context: Context
    },
  ): Promise<{ summary: string } | { failure: string }> {
    const { view, model, api, context } = asking
    const provider = await api.snapshot(ProviderDoc, api.conversationId, context)
    const kept = keptMessages(view, asking.firstKept)
    const before = lastAnswer(view)
    // Shaped as every request of the chat's is, so that it starts as the last one did.
    const messages = shapeRequest(view.messages, this.#options.imageLimits)
    const now = this.#options.now()
    const asked = askFor(view, asking.firstKept, asking.main, now)
    const answer = await api.models.completeSimple(
      model,
      { messages: [...messages, asked] },
      {
        cacheRetention: CACHE_RETENTION,
        // As much as the model can write: thinking and the summary can share it, the cap is no
        // part of what is cached, and only what is written is paid for. pi-ai fits it to the
        // room left in the window.
        maxTokens: model.maxTokens,
        ...(provider?.sessionId === undefined ? {} : { sessionId: provider.sessionId }),
        ...(context.abortSignal === undefined ? {} : { signal: context.abortSignal }),
        ...(asking.thinking === "off" ? {} : { reasoning: asking.thinking }),
      },
    )
    context.abortSignal?.throwIfAborted()
    const outcome = summaryOf(answer)
    const system = view.messages.filter((message) => message.role === "system")
    const after =
      "summary" in outcome
        ? tokens(system) +
          estimateMessageTokens({
            role: "user",
            content: [{ type: "text", text: `${SUMMARY_PREFIX}${outcome.summary}</summary>` }],
            timestamp: now,
          }) +
          tokens(kept.filter((message) => message.role !== "system"))
        : null
    const record: IdleCompactionRecord = {
      chatId: String(api.conversationId),
      taskId: String(api.taskId),
      reason: asking.reason,
      at: now,
      model: `${answer.provider}/${answer.model}`,
      before: before === undefined ? 0 : inputTokens(before.usage),
      after,
      input: answer.usage.input,
      cacheRead: answer.usage.cacheRead,
      cacheWrite: answer.usage.cacheWrite,
      cacheReadShare: cacheReadShare(answer.usage),
      cost: answer.usage.cost.total,
      summarized: "summary" in outcome,
      ...("failure" in outcome ? { failure: outcome.failure } : {}),
    }
    // What it cost is the chat's, as any request of the chat's is, under the model it used.
    await harness.commit(async (tx) => {
      const usage = await tx.doc(UsageDoc, api.conversationId)
      const key = record.model
      const total = Object.hasOwn(usage.models, key) ? usage.models[key] : undefined
      if (total === undefined) {
        usage.models[key] = copyJson(answer.usage, {
          omitUndefinedProperties: true,
        }) as unknown as Usage
      } else {
        addUsage(total as Usage, answer.usage)
      }
      // One record a compaction. A task taken up again after a restart that came before its memo
      // asked again, and paid again: the record is the newer one, with both costs.
      const kept = await tx.doc(CompactionsDoc)
      const earlier = kept.records.findIndex((candidate) => candidate.taskId === record.taskId)
      if (earlier >= 0) {
        record.cost += kept.records[earlier]!.cost
        kept.records.splice(earlier, 1)
      }
      kept.records.push(record)
      if (kept.records.length > RECORDS) kept.records.splice(0, kept.records.length - RECORDS)
    }, this.#options.context)
    return outcome
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

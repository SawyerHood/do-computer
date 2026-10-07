import {
  type ChatActivity,
  type ChatRun,
  chatRuns,
  type ChatState,
  type ChatUsage,
  type RunSummary,
  toolSummary,
} from "@durable-computer/protocol"
import type { Context } from "@earendil-works/chord"
import {
  defineDocFamily,
  defineExtension,
  type Extension,
  GenerationTask,
  type Harness,
  hook,
} from "@earendil-works/pi-durable"
import { own } from "./own.ts"

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
/** While a run is going, its summary is written again after this many more steps. */
const REFRESH_STEPS = 3
/** How many of a chat's newest runs are written when someone looks. Older ones stay as shown. */
const AT_ONCE = 6
/** How many summaries a chat keeps. */
const KEPT = 200
/** After a failed attempt, a chat is left alone for this long. */
const BACKOFF_MS = 60_000
/** How long after a run's last word its summary is written, so the run has settled first. */
const SETTLE_MS = 1_500

export type SummaryOptions = {
  /** The deployment's OpenRouter key. Summaries are billed to it like everything else. */
  readonly apiKey: string
  /** OpenRouter model id that writes them. A small, cheap one is right for this. */
  readonly model: string
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
}

/** What the small model made of a run: its summary, and whether it is worth an entry. */
export type Judged = RunSummary & { big: boolean }

/**
 * A written summary, with what the run looked like when it was written. `big` is absent on one
 * written before runs were judged, which is listed until it is judged.
 */
type Written = RunSummary & { big?: boolean; status: ChatRun["status"]; steps: number }

/** Whether what is written for a run is an entry in the list. */
const listed = (written: Written | undefined): boolean =>
  // An attempt that came back unusable is kept, empty, so it is not made over and over.
  written !== undefined && written.title !== "" && written.big !== false

type ActivityState = {
  runs: Record<string, Written>
  /** What writing them has cost, which the agent's own usage does not include. */
  spent: ChatUsage
  /** What asking whether the agent meant to stop has cost in this chat. Another model's work. */
  judged?: ChatUsage
}

/** The summaries of one chat's runs, keyed by chat. */
export const ActivityDoc = defineDocFamily<ActivityState, null>({
  kind: "dc.activity",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ runs: {}, spent: { inputTokens: 0, outputTokens: 0, cost: 0 } }),
})

const INSTRUCTIONS = `You write one entry in a short list of things an AI agent did for its user. You are given what the user asked, the steps the agent took with its tools, and what it said back. Only substantial work gets an entry, so you also say whether this was. Reply with JSON only, in this shape: {"title": "...", "outcome": "...", "big": true}

title: two to six words naming the task, the way a to-do item would: "Set up SSH key access", "Find flights to Lisbon". No period at the end and no quotation marks.
outcome: one plain sentence of at most ten words on what came of it, in the past tense: what was found, made or changed, or why it did not work. If the work is still going, say what is being done now. Do not begin with "The agent" or "I".
big: true if this was a substantial piece of work, false if it was not. Substantial: something was made, changed, set up, fixed or sent, or it took real effort over many steps, such as a long investigation. Not substantial: a quick lookup or check, reading a file or two, a single search, saving a note, answering a question. If the work is still going, judge it by what has been done so far. If you cannot tell, answer false.`

const clip = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text

const STATUS: Record<ChatRun["status"], string> = {
  working: "still working",
  done: "finished",
  failed: "failed",
  stopped: "stopped by the user",
}

/** A run, as the model that summarizes it reads it. */
export function describeRun(run: ChatRun): string {
  const shown = run.steps.slice(-40)
  const steps = shown.map((step, index) => {
    const failed =
      step.status === "error" ? ` [failed: ${clip(step.output?.trim() ?? "", 160)}]` : ""
    return `${index + 1}. ${toolSummary(step)}${failed}`
  })
  const earlier = run.steps.length - shown.length
  return [
    `Asked: ${clip(run.asked, 700)}`,
    `Status: ${STATUS[run.status]}`,
    `Steps (${run.steps.length}):`,
    ...(earlier > 0 ? [`(${earlier} earlier steps are not listed)`] : []),
    ...steps,
    `Said back: ${run.answer === "" ? "(nothing yet)" : clip(run.answer, 900)}`,
  ].join("\n")
}

/**
 * The title, outcome and verdict in a model's reply, however it wrapped them, or undefined. A
 * reply that leaves the verdict out is taken as work worth an entry: better one too many than
 * a list that stays empty.
 */
export function readSummary(reply: string): Judged | undefined {
  const start = reply.indexOf("{")
  const end = reply.lastIndexOf("}")
  if (start === -1 || end <= start) return undefined
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1)) as {
      title?: unknown
      outcome?: unknown
      big?: unknown
    }
    if (typeof parsed.title !== "string" || typeof parsed.outcome !== "string") return undefined
    const title = clip(parsed.title.trim().replace(/[."]+$/, ""), 80)
    const outcome = clip(parsed.outcome.trim(), 240)
    return title === "" || outcome === ""
      ? undefined
      : { title, outcome, big: parsed.big !== false }
  } catch {
    return undefined
  }
}

/**
 * Whether what is written for a run no longer says what the run is. A run that is still going is
 * written every few steps, the first time only once it has taken that many: a short run gets one
 * summary, when it ends.
 */
function stale(run: ChatRun, written: Written | undefined): boolean {
  if (run.status === "working") {
    return run.steps.length - (written?.steps ?? 0) >= REFRESH_STEPS
  }
  return (
    written === undefined ||
    written.status !== run.status ||
    written.steps !== run.steps.length ||
    // Written before runs were judged.
    (written.big === undefined && written.title !== "")
  )
}

export type ActivityOptions = {
  /** Absent: nothing is written, and clients show what they can work out themselves. */
  readonly summaries?: SummaryOptions
  /** The chat as a client would see it, or undefined if there is no such chat. */
  readonly chat: (chatId: string) => Promise<ChatState | undefined>
  /** What the background work runs under: it outlives the request or run that set it off. */
  readonly context: Context
  /** Told when a chat's summaries changed. */
  readonly onChanged: (chatId: string) => void
  readonly onError: (error: unknown) => void
  readonly now: () => number
}

/**
 * Short summaries of what the agent did, one for each substantial piece of work in a chat: a
 * title and a sentence on what came of it. A small model writes them in the background, when a
 * run ends, every few steps while one is going, and when someone looks at a chat whose runs have
 * none yet. It also says whether the run was big enough to list: a quick lookup is not. The
 * agent takes no part in it, so it costs the agent no attention and the answer no time.
 */
export class Activity {
  readonly extension: Extension
  readonly #options: ActivityOptions
  #harness: Harness | undefined
  /** Chats being written right now, and those that changed again meanwhile. */
  readonly #writing = new Set<string>()
  readonly #again = new Set<string>()
  readonly #failedAt = new Map<string, number>()

  constructor(options: ActivityOptions) {
    this.#options = options
    this.extension = defineExtension({
      name: "dc.activity",
      hooks: [
        hook(GenerationTask, {
          afterTools: (_assistant, _results, api) => {
            this.refresh(String(api.conversationId))
          },
          onYield: (_answer, api) => {
            // The run is about to end. Its summary is for the run as it ended.
            const chatId = String(api.conversationId)
            setTimeout(() => this.refresh(chatId), SETTLE_MS)
            return undefined
          },
        }),
      ],
    })
  }

  attach(harness: Harness): void {
    this.#harness = harness
  }

  /** What is written for a chat. Anything missing or out of date is written in the background. */
  async read(chatId: string, state: ChatState, context: Context): Promise<ChatActivity> {
    const written = (await this.#harness?.snapshot(ActivityDoc, chatId, context))?.runs ?? {}
    void this.#write(chatId, state)
    return {
      judged: this.#options.summaries !== undefined,
      runs: Object.fromEntries(
        Object.entries(written)
          .filter(([, entry]) => listed(entry))
          .map(([id, { title, outcome }]) => [id, { title, outcome }]),
      ),
    }
  }

  /** A chat's work moved on: bring its summaries up to date, without anyone waiting for it. */
  refresh(chatId: string): void {
    if (this.#options.summaries === undefined) return
    void (async () => {
      const state = await this.#options.chat(chatId)
      if (state !== undefined) await this.#write(chatId, state)
    })().catch((error) => this.#options.onError(error))
  }

  /** Count what it cost to ask, in a chat, whether the agent meant to stop. */
  async charge(chatId: string, spent: ChatUsage, context: Context): Promise<void> {
    await this.#harness?.commit(async (tx) => {
      const doc = await tx.doc(ActivityDoc, chatId, null)
      // Assigned whole: a document keeps a copy of what it is given, not the object itself.
      doc.judged = {
        inputTokens: (doc.judged?.inputTokens ?? 0) + spent.inputTokens,
        outputTokens: (doc.judged?.outputTokens ?? 0) + spent.outputTokens,
        cost: (doc.judged?.cost ?? 0) + spent.cost,
      }
    }, context)
  }

  /** What the small models' work for a chat has cost: its summaries, and its judgments. */
  async spent(
    chatId: string,
    context: Context,
  ): Promise<{ summaries: ChatUsage; judged: ChatUsage | undefined } | undefined> {
    const doc = await this.#harness?.snapshot(ActivityDoc, chatId, context)
    return doc === undefined ? undefined : { summaries: doc.spent, judged: doc.judged }
  }

  async #write(chatId: string, state: ChatState): Promise<void> {
    const { summaries, context } = this.#options
    const harness = this.#harness
    if (summaries === undefined || harness === undefined) return
    if (this.#writing.has(chatId)) return void this.#again.add(chatId)
    const failed = this.#failedAt.get(chatId)
    if (failed !== undefined && this.#options.now() - failed < BACKOFF_MS) return
    this.#writing.add(chatId)
    try {
      const written = (await harness.snapshot(ActivityDoc, chatId, context))?.runs ?? {}
      const due = chatRuns(state)
        .slice(-AT_ONCE)
        .filter((run) => stale(run, own(written, run.id)))
      let changed = false
      for (const run of due) {
        const result = await this.#summarize(run, summaries, context)
        let shown = false
        await harness.commit(async (tx) => {
          const doc = await tx.doc(ActivityDoc, chatId, null)
          doc.spent.inputTokens += result.usage.inputTokens
          doc.spent.outputTokens += result.usage.outputTokens
          doc.spent.cost += result.usage.cost
          const before = own(doc.runs, run.id)
          const entry: Written = {
            ...(result.summary ?? { title: "", outcome: "" }),
            status: run.status,
            steps: run.steps.length,
          }
          // Once a run is in the list it stays there, so an entry does not vanish as it ends.
          if (result.summary !== undefined && before?.big === true) entry.big = true
          doc.runs[run.id] = entry
          shown = listed(before) || listed(entry)
          const ids = Object.keys(doc.runs)
          for (const id of ids.slice(0, Math.max(0, ids.length - KEPT))) delete doc.runs[id]
        }, context)
        changed ||= shown
      }
      this.#failedAt.delete(chatId)
      if (changed) this.#options.onChanged(chatId)
    } catch (error) {
      this.#failedAt.set(chatId, this.#options.now())
      this.#options.onError(
        new Error(
          `A summary of what the agent did could not be written: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        ),
      )
    } finally {
      this.#writing.delete(chatId)
      // It moved on while this was being written, so what was written may already be behind.
      if (this.#again.delete(chatId)) this.refresh(chatId)
    }
  }

  async #summarize(
    run: ChatRun,
    options: SummaryOptions,
    context: Context,
  ): Promise<{ summary: Judged | undefined; usage: ChatUsage }> {
    const send = options.fetch ?? ((url, init) => fetch(url, init))
    const response = await send(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
        "x-title": "durable computer",
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: 160,
        temperature: 0.2,
        usage: { include: true },
        messages: [
          { role: "system", content: INSTRUCTIONS },
          { role: "user", content: describeRun(run) },
        ],
      }),
      signal: context.abortSignal,
    })
    const body = (await response.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string | null } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
      error?: { message?: string }
    }
    if (!response.ok || body.error !== undefined) {
      throw new Error(body.error?.message ?? `HTTP ${response.status}`)
    }
    return {
      // A reply that is not what was asked for is paid for all the same.
      summary: readSummary(body.choices?.[0]?.message?.content ?? ""),
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
        cost: body.usage?.cost ?? 0,
      },
    }
  }
}

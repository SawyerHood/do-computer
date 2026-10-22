import { type ChatState, type ChatUsage, toolSummary, type ToolPart } from "@do-computer/protocol"
import type { Context } from "@earendil-works/chord"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import {
  defineDocFamily,
  defineExtension,
  defineTool,
  type Extension,
  GenerationTask,
  type Harness,
  hook,
} from "@earendil-works/pi-durable"
import { Type } from "@earendil-works/pi-ai"
import { PROGRESS_TOOL } from "./project.ts"

export type JudgeOptions = {
  /** The deployment's OpenRouter key. Judgments are billed to it like everything else. */
  readonly apiKey: string
  /** OpenRouter model id that judges. A small one that judges well is right for this. */
  readonly model: string
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
}

type SmallCost = {
  /** Summaries a small model once wrote of each run. Nothing reads them now. */
  runs: Record<string, { title: string; outcome: string }>
  /** What writing those cost, which is still part of what the agent has cost. */
  spent: ChatUsage
  /** What asking whether the agent meant to stop has cost in this chat. */
  judged?: ChatUsage
}

/**
 * What small models' work for one chat has cost, keyed by chat. The agent's own usage does not
 * include it. Its kind is from when it also held the summaries.
 */
const SmallCostDoc = defineDocFamily<SmallCost, null>({
  kind: "dc.activity",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  family: true,
  initial: () => ({ runs: {}, spent: { inputTokens: 0, outputTokens: 0, cost: 0 } }),
})

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
/** How many times in a row a run is set going again. After that, it stops where the agent stops. */
const MAX_NUDGES = 3
/** How long the small model is given to answer. Past that, the run ends where the agent stopped. */
const JUDGE_TIMEOUT_MS = 8_000
/** A message longer than this is an answer, not a word on the way. */
const MAX_PROGRESS_CHARS = 500

/** Words that go with saying what one is about to do. */
const INTENT =
  /\b(i['’]ll|i will|let me|going to|about to|next|now|then|working on|on it|one moment|one sec|hold on|give me|starting|continuing|carrying on|waiting|checking|looking|searching|making|writing|running|creating|setting up)\b/i

/** What a run is told when it is set going again. Not shown in the chat. */
const NUDGE = `<meta kind="continue">Your turn ended there, because you replied without calling a tool, and your last message says there is more to do. Carry on now from where you left off. To tell the user something while you work, use the ${PROGRESS_TOOL} tool. Reply on its own only when the work is finished or you need something from them.</meta>`

/**
 * How an agent says something while it works. A reply would end its turn; a call to this does
 * not. The chat shows what it says as the agent's own words.
 */
const progress = defineTool({
  name: PROGRESS_TOOL,
  // It does nothing but answer: the words are in the call, which the chat already shows.
  replay: "safe",
  description: `Tell the person how the work is going, without ending your turn: what you just finished, what you found, or what you are about to do. They see the message in the chat right away, and you carry on. Use it whenever there is more to do after what you have to say. You can call it in the same reply as other tools. Put the words in the message only: do not also write them as text in that reply. It is not for your final answer, for a question, or for anything you need them to answer: reply normally for those.`,
  parameters: Type.Object({
    message: Type.String({ description: "What to tell them, in a sentence or two" }),
  }),
  execute: async () => ({
    output: [{ type: "text" as const, text: "Shown to them. Carry on with the work." }],
  }),
})

const INSTRUCTIONS = `You check whether an AI agent stopped in the middle of its work. An agent's turn ends when it sends a message without calling a tool. You are given what the user asked, the steps the agent has taken so far, and the message it just sent, after which it stopped.

Compare what was asked with what has been done, then answer with one word.

CONTINUE: part of what was asked is still not done, and the message shows the agent means to carry on with it by itself. Examples: "b.txt done, making c.txt next", "now doing X", "next I'll check Y", "working on it", "waiting 3 seconds, then the next file", "on it".

DONE: everything asked for has been done, or the agent is asking the user a question, needs the user to answer or do something before it can go on, says it cannot go on, or is handing the matter back.

If the message reports the whole task as finished, answer DONE. If you cannot tell, answer DONE.`

const clip = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text

/**
 * Whether a final message could be a word on the way and not an answer, which is what decides
 * if the small model is asked at all. Most answers are not, and are never sent to it.
 */
export function mightBeMidway(message: string, steps: number): boolean {
  const text = message.trim()
  if (text === "" || text.length > MAX_PROGRESS_CHARS) return false
  // A question hands the turn to the user.
  if (/\?\s*$/.test(text)) return false
  return steps > 0 || INTENT.test(text)
}

export type KeepGoingOptions = {
  /** The small model that judges whether the agent meant to stop. Absent: it always may. */
  readonly judge?: JudgeOptions
  /** The chat as a client would see it. */
  readonly chat: (chatId: string) => Promise<ChatState | undefined>
  /**
   * Whether something a chat set going will give the agent a turn there by itself, such as a
   * command running in the background. Stopping to wait for that is not stopping by accident.
   */
  readonly waiting?: (chatId: string) => Promise<boolean>
  /** What writing down a judgment's cost runs under: it outlives the run that set it off. */
  readonly context: Context
  readonly onError: (error: unknown) => void
}

/**
 * Keeps an agent working when it stops by accident. A turn ends when the model replies without
 * calling a tool. Some models send a progress update that way, in the middle of a task ("b is
 * done, making c next"), and the work ends there with nobody having decided it should.
 *
 * The agent is given a tool to say such things with, which does not end its turn. Nothing makes
 * a model use it, though. So when a run ends on a short message that could be such an update, a small model is asked
 * whether the agent meant to go on. If so, the run is continued with a note to the agent, which
 * is not shown in the chat. It happens a few times in a row at most, so an agent that keeps
 * announcing and never acting does stop.
 */
export class KeepGoing {
  readonly extension: Extension
  readonly #options: KeepGoingOptions
  /** How often each chat has been set going again since the message it is working on. */
  readonly #nudged = new Map<string, { since: string; count: number }>()
  #harness: Harness | undefined

  constructor(options: KeepGoingOptions) {
    this.#options = options
    this.extension = defineExtension({
      name: "dc.keep-going",
      tools: [progress],
      hooks: [
        hook(GenerationTask, {
          onYield: async (answer, api, context) => {
            try {
              const go = await this.#shouldContinue(
                String(api.conversationId),
                answer,
                context.abortSignal,
              )
              return go ? { continue: [{ type: "text" as const, text: NUDGE }] } : undefined
            } catch (error) {
              // Failing to ask must never cost the user their answer: the run just ends.
              this.#options.onError(
                new Error(
                  `Could not check whether the agent meant to stop: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                  { cause: error },
                ),
              )
              return undefined
            }
          },
        }),
      ],
    })
  }

  attach(harness: Harness): void {
    this.#harness = harness
  }

  /** What small models' work for a chat has cost: its judgments, and the summaries of old. */
  async spent(
    chatId: string,
    context: Context,
  ): Promise<{ summaries: ChatUsage; judged: ChatUsage | undefined } | undefined> {
    const doc = await this.#harness?.snapshot(SmallCostDoc, chatId, context)
    return doc === undefined ? undefined : { summaries: doc.spent, judged: doc.judged }
  }

  /** Count what a judgment cost as the agent's. */
  async #charge(chatId: string, spent: ChatUsage): Promise<void> {
    await this.#harness?.commit(async (tx) => {
      const doc = await tx.doc(SmallCostDoc, chatId, null)
      // Assigned whole: a document keeps a copy of what it is given, not the object itself.
      doc.judged = {
        inputTokens: (doc.judged?.inputTokens ?? 0) + spent.inputTokens,
        outputTokens: (doc.judged?.outputTokens ?? 0) + spent.outputTokens,
        cost: (doc.judged?.cost ?? 0) + spent.cost,
      }
    }, this.#options.context)
  }

  async #shouldContinue(
    chatId: string,
    answer: AssistantMessage,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    const judge = this.#options.judge
    if (judge === undefined || answer.stopReason !== "stop") return false
    const said = answer.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim()
    const state = await this.#options.chat(chatId)
    if (state === undefined) return false
    // What it is working on: everything since the last thing the user said.
    const asked = state.messages.findLast((message) => message.role === "user")
    if (asked === undefined) return false
    const since = state.messages.slice(state.messages.indexOf(asked) + 1)
    const steps = since.flatMap((message) =>
      message.parts.filter((part): part is ToolPart => part.type === "tool"),
    )
    if (!mightBeMidway(said, steps.length)) return false
    if ((await this.#options.waiting?.(chatId)) === true) return false

    const nudged = this.#nudged.get(chatId)
    const count = nudged?.since === asked.id ? nudged.count : 0
    if (count >= MAX_NUDGES) return false

    const request = asked.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
    const send = judge.fetch ?? ((url, init) => fetch(url, init))
    const response = await send(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${judge.apiKey}`,
        "content-type": "application/json",
        "x-title": "Do Computer",
      },
      body: JSON.stringify({
        model: judge.model,
        max_tokens: 8,
        temperature: 0,
        usage: { include: true },
        messages: [
          { role: "system", content: INSTRUCTIONS },
          {
            role: "user",
            content: [
              `Asked: ${clip(request, 700)}`,
              `Steps so far (${steps.length}):`,
              ...steps.slice(-12).map((step, index) => `${index + 1}. ${toolSummary(step)}`),
              `The message it just sent: ${clip(said, MAX_PROGRESS_CHARS)}`,
            ].join("\n"),
          },
        ],
      }),
      // Its own time limit, not the run's signal: that one can be spent by the time a run yields,
      // and the question would then never be asked.
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    })
    // Stopped by its user while this was being asked: it stays stopped.
    if (signal?.aborted === true) return false
    const body = (await response.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string | null } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
      error?: { message?: string }
    }
    if (!response.ok || body.error !== undefined) {
      throw new Error(body.error?.message ?? `HTTP ${response.status}`)
    }
    void this.#charge(chatId, {
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      cost: body.usage?.cost ?? 0,
    }).catch((error) => this.#options.onError(error))
    const verdict = (body.choices?.[0]?.message?.content ?? "").trim().toUpperCase()
    if (!verdict.startsWith("CONTINUE")) return false
    this.#nudged.set(chatId, { since: asked.id, count: count + 1 })
    return true
  }
}

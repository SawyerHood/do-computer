import {
  CALL_VOICES,
  type CallDialect,
  callLength,
  type CallLine,
  type CallRefusal,
  type CallScriptStep,
  type CallsState,
  callVoice,
  type ChatMessage,
  type StartedCall,
} from "@do-computer/protocol"
import { defineDoc } from "@earendil-works/pi-durable"
import type { Caller } from "./caller.ts"
import type { ReviewOptions } from "./journal.ts"

/**
 * Voice calls with an agent. The sound goes straight between the person's device and the
 * provider of the voice, which is a small fast model that talks and is not the agent. Here the
 * call is started, with the agent's character and the end of its chat given to the voice; what
 * was said is kept as the device tells it; and when the call is over the chat is given one record
 * of it. Whatever needs the agent, the voice hands on, and that arrives as a message in the chat
 * with what was said on the call beside it.
 */

/** Something about a call that whoever asked is told in words. */
export class CallError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code?: string,
  ) {
    super(message)
  }
}

/** What places a call. Found by the agent's host each time one is asked for, and never kept. */
export type CallPass = { paidBy: "workspace" | "server" } & (
  | { dialect: "codex"; accessToken: string; accountId: string }
  | { dialect: "openai"; apiKey: string }
  | { dialect: "scripted"; script: CallScriptStep[] }
)

export type CallAllowance =
  { pass: CallPass; maxSeconds: number; quietSeconds: number } | { refused: CallRefusal }

/**
 * Who may call, and with what: the deployment's switch and limits, and the nearest sign-in that
 * can place a call. It is the host's to know, as which workspace an agent is in is.
 */
export type CallDirectory = {
  allow(agentId: string, caller: Caller | undefined): Promise<CallAllowance>
  /** A call the server's own sign-in paid for is over: count it against the person's month. */
  spent(caller: string | null, seconds: number): Promise<void>
}

/** A call that is under way, or over and still to be written into its chat. */
export type CallRecord = {
  id: string
  chatId: string
  /** The id of whoever is on it, where that is known. */
  by: string | null
  dialect: CallDialect
  paidBy: "workspace" | "server"
  startedAt: number
  /** When it is over, whoever is or is not still there. */
  endsBy: number
  lines: CallLine[]
  /** How many of the lines the agent has been shown, with something handed on to it. */
  heard: number
  /** When it ended, once it has: it is then only waiting to be written into its chat. */
  endedAt?: number
}

export type CallsDocState = { calls: Record<string, CallRecord> }

export const CallsDoc = defineDoc<CallsDocState>({
  kind: "dc.calls",
  version: 1,
  scope: "session",
  initial: () => ({ calls: {} }),
})

/** The entry a call leaves in its chat once it is over. */
export const CALL_ENTRY = "dc.call"

/** What a call's entry holds. */
export type CallEntry = { id: string; seconds: number; lines: CallLine[]; summary: string[] }

/** How many lines of a call are kept, and how long one can be. A long call keeps its newest. */
const MAX_LINES = 1_500
const MAX_LINE_CHARS = 2_000
/** How much of the chat the voice is given to start with: the provider takes 128 messages and 8,192 tokens. */
const MAX_CONTEXT_MESSAGES = 40
const MAX_CONTEXT_CHARS = 18_000
const MAX_CONTEXT_MESSAGE_CHARS = 1_500
/** How much of each of the agent's own writings the voice is given. */
const MAX_SOUL_CHARS = 3_000
const MAX_NOTES_CHARS = 2_500
/** How long after its time a call that nobody ended is written up. */
const GRACE_MS = 15_000
/** How long the small model is given to say what came of a call. */
const SUMMARY_TIMEOUT_MS = 15_000

const CODEX_CALLS =
  "https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas"
const OPENAI_CALLS = "https://api.openai.com/v1/live/sessions"
const SUMMARY_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
/** Who is asking, said honestly: the app, and where its source is. */
const USER_AGENT = "do-computer (+https://github.com/SawyerHood/do-computer)"

const clip = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()

/** What is sent, cleaned up: a device's word is not taken for more than lines of text. */
export function readLines(sent: unknown): CallLine[] {
  if (!Array.isArray(sent)) return []
  const lines: CallLine[] = []
  for (const one of sent.slice(0, MAX_LINES)) {
    if (typeof one !== "object" || one === null) continue
    const { who, text } = one as Record<string, unknown>
    if ((who !== "you" && who !== "dood") || typeof text !== "string") continue
    const said = oneLine(text)
    if (said !== "") lines.push({ who, text: clip(said, MAX_LINE_CHARS) })
  }
  return lines
}

/** What was said, as lines the agent or a small model reads. */
function spoken(lines: readonly CallLine[], person: string, agent: string): string {
  return lines.map((line) => `${line.who === "you" ? person : agent}: ${line.text}`).join("\n")
}

const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")

/**
 * The note that travels with something the voice handed on, for the agent: that it was said out
 * loud, how to answer it, and what was said on the call that the agent has not been shown.
 */
export function callMeta(callId: string, unheard: readonly CallLine[], agent: string): string {
  const said =
    unheard.length === 0
      ? ""
      : ` What was said on the call since you were last shown it (${agent} is your voice there):\n${spoken(unheard, "They", agent)}\n`
  return (
    `<meta kind="call" call="${escapeAttribute(callId)}">This was said out loud, on a voice call. ` +
    "A voice speaks for you on the call. It cannot do or look up anything itself, and has handed you this. " +
    "What you answer is read out by it, so answer in a few short sentences as you would say them: no lists, no links, no code. " +
    `Anything longer goes in a file or in what you write here afterwards.${said}</meta>`
  )
}

/** Which call a message was said on, read back out of the note that travelled with it. */
export function callOf(meta: string): string | undefined {
  if (!meta.startsWith('<meta kind="call" call="')) return undefined
  return /^<meta kind="call" call="([^"]*)"/.exec(meta)?.[1]
}

/** What the agent is told of a call once it is over, so that it remembers it. */
function endedNote(seconds: number, unheard: readonly CallLine[], agent: string): string {
  return (
    `<meta kind="call-ended">The voice call ended after ${callLength(seconds)}.` +
    (unheard.length === 0
      ? ""
      : ` What was said on it that you were not shown (${agent} is your voice there):\n${spoken(unheard, "They", agent)}\n`) +
    "</meta>"
  )
}

/** What the voice is told about who it speaks for and how to speak. */
export function voiceInstructions(who: {
  name: string
  soul: string
  user: string
  memory: string
}): string {
  const name = who.name
  return [
    `You are ${name}, on a voice call with the person you work for. You are ${name}'s voice. ${name} itself keeps working in its chat while you talk, with its own tools, files and computers, which you do not have.`,
    "",
    `Who ${name} is, in its own words:`,
    clip(who.soul.trim(), MAX_SOUL_CHARS) || "(nothing written yet)",
    "",
    "What it knows about the person:",
    clip(who.user.trim(), MAX_NOTES_CHARS) || "(nothing yet)",
    "",
    "Its own notes:",
    clip(who.memory.trim(), MAX_NOTES_CHARS) || "(nothing yet)",
    "",
    "How to talk:",
    `- Speak as ${name} writes: the same character and warmth, in short spoken sentences. No lists, no markdown, and do not read out links or code.`,
    `- The conversation you are given was held in ${name}'s chat before this call. Answer from it where it has the answer.`,
    `- Anything that needs doing or looking up (a file, the web, a computer, a tool, a fact you were not given) you hand on to ${name}: delegate it. Say in a few words that you are on it, and when the answer comes back, say it plainly.`,
    "- Never say that something was done, sent, saved or checked unless what you were handed back says so. What you do not know, say you do not know, or hand on.",
    "- Asked how the work is going, say what you were last told of it.",
  ].join("\n")
}

/** The end of a chat as the voice is given it: what was written, without the steps. */
export function voiceContext(messages: readonly ChatMessage[]): CallLine[] {
  const lines: CallLine[] = []
  let total = 0
  for (let i = messages.length - 1; i >= 0 && lines.length < MAX_CONTEXT_MESSAGES; i--) {
    const message = messages[i]!
    if (message.role !== "user" && message.role !== "assistant") continue
    if (message.status === "streaming") continue
    const text = clip(
      message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim(),
      MAX_CONTEXT_MESSAGE_CHARS,
    )
    if (text === "") continue
    if (total + text.length > MAX_CONTEXT_CHARS) break
    total += text.length
    lines.unshift({ who: message.role === "user" ? "you" : "dood", text })
  }
  return lines
}

/** What a provider answered that was not a call. */
async function refusal(response: Response): Promise<string> {
  const text = await response.text().catch(() => "")
  let said = ""
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string; detail?: string }
    said =
      typeof body.error === "string"
        ? body.error
        : (body.error?.message ?? (typeof body.detail === "string" ? body.detail : ""))
  } catch {
    said = ""
  }
  return clip(oneLine(said) || `HTTP ${response.status}`, 240)
}

/**
 * Ask the provider for a call: hand it the device's offer with who the voice is to be and what
 * was said before, and get its answer to the offer.
 */
export async function placeCall(
  pass: Exclude<CallPass, { dialect: "scripted" }>,
  offer: string,
  session: { instructions: string; voice: string; context: readonly CallLine[] },
  send: (url: string, init: RequestInit) => Promise<Response>,
): Promise<string> {
  const part = (line: CallLine) => ({
    type: line.who === "you" ? "input_text" : "output_text",
    text: line.text,
  })
  const role = (line: CallLine) => (line.who === "you" ? "user" : "assistant")
  if (pass.dialect === "codex") {
    const response = await send(CODEX_CALLS, {
      method: "POST",
      headers: {
        authorization: `Bearer ${pass.accessToken}`,
        "chatgpt-account-id": pass.accountId,
        "openai-alpha": "quicksilver=v2",
        originator: "do-computer",
        "user-agent": USER_AGENT,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sdp: offer,
        session: {
          model: "gpt-live-1-codex",
          instructions: session.instructions,
          audio: { output: { voice: session.voice } },
          delegation: { type: "client" },
          initial_items: session.context.map((line) => ({
            type: "message",
            role: role(line),
            content: [part(line)],
          })),
        },
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      throw new CallError(
        `The call could not be started on the ChatGPT sign-in: ${await refusal(response)}`,
        502,
        "provider",
      )
    }
    const answer = await response.text()
    if (!answer.startsWith("v=0")) {
      throw new CallError("The call could not be started: the answer was not one.", 502, "provider")
    }
    return answer
  }
  const response = await send(OPENAI_CALLS, {
    method: "POST",
    headers: {
      authorization: `Bearer ${pass.apiKey}`,
      "user-agent": USER_AGENT,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      session: {
        model: "gpt-live-1",
        instructions: session.instructions,
        audio: { output: { voice: session.voice } },
        delegation: { type: "client" },
        input: session.context.map((line) => ({ role: role(line), content: [part(line)] })),
      },
      transport: { type: "webrtc", sdp: offer },
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    throw new CallError(
      `The call could not be started on the OpenAI key: ${await refusal(response)}`,
      502,
      "provider",
    )
  }
  const body = (await response.json().catch(() => ({}))) as { transport?: { sdp?: unknown } }
  const answer = body.transport?.sdp
  if (typeof answer !== "string" || !answer.startsWith("v=0")) {
    throw new CallError("The call could not be started: the answer was not one.", 502, "provider")
  }
  return answer
}

/** What a small model answered, read leniently: a model may wrap its JSON in words or a fence. */
export function parseSummary(answer: string): string[] {
  const start = answer.indexOf("{")
  const end = answer.lastIndexOf("}")
  if (start === -1 || end <= start) return []
  try {
    const { lines } = JSON.parse(answer.slice(start, end + 1)) as { lines?: unknown }
    if (!Array.isArray(lines)) return []
    return lines
      .filter((line): line is string => typeof line === "string")
      .map((line) => clip(oneLine(line), 240))
      .filter((line) => line !== "")
      .slice(0, 3)
  } catch {
    return []
  }
}

const SUMMARY_INSTRUCTIONS = `You are given what was said on a voice call between a person and their AI assistant, whose voice hands work on to the assistant itself. Reply with a single JSON object and nothing else:

"lines": up to three short sentences on what came of the call: what was found out, what the person decided, what the assistant did or was asked to do. Plain words, past tense, the person as "you" and the assistant by its name. Keep names, numbers and dates exactly as said. Leave out greetings and small talk. An empty list if nothing came of it.`

export type CallsOptions = {
  readonly agentId: string
  /** What the agent is called, for the lines a small model reads. */
  readonly name: () => Promise<string>
  /** Who may call and with what. Absent: nobody can call an agent here. */
  readonly directory?: CallDirectory
  /** The small model that says what came of a call. Absent: its record has only the words. */
  readonly review?: ReviewOptions
  readonly read: () => Promise<CallsDocState>
  readonly change: (apply: (state: CallsDocState) => void) => Promise<void>
  /** Write a call's record into its chat. Resolves once it is there. */
  readonly record: (chatId: string, entry: CallEntry, note: string) => Promise<void>
  readonly now: () => number
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
  readonly onError: (error: unknown) => void
}

export class Calls {
  readonly #options: CallsOptions
  /** The calls being written into their chats, so that one is written once. */
  readonly #writing = new Map<string, Promise<void>>()

  constructor(options: CallsOptions) {
    this.#options = options
  }

  #send(url: string, init: RequestInit): Promise<Response> {
    return (this.#options.fetch ?? ((to, how) => fetch(to, how)))(url, init)
  }

  /** Whether this person can call the agent, and the voice it would answer in. */
  async state(caller: Caller | undefined, chosen: string | null | undefined): Promise<CallsState> {
    const allowance = await this.#allow(caller)
    if ("refused" in allowance) {
      return { available: false, reason: allowance.refused, voices: [], voice: null }
    }
    const dialect = allowance.pass.dialect
    return {
      available: true,
      dialect,
      paidBy: allowance.pass.paidBy,
      voices: [...CALL_VOICES[dialect]],
      voice: callVoice(dialect, this.#options.agentId, chosen),
    }
  }

  #allow(caller: Caller | undefined): Promise<CallAllowance> {
    const directory = this.#options.directory
    if (directory === undefined) return Promise.resolve({ refused: "off" })
    return directory.allow(this.#options.agentId, caller)
  }

  /**
   * Start a call in a chat. Whoever is already on one with the agent has it ended first if it
   * is theirs, as when a page was reloaded in the middle of it; someone else's is in the way.
   */
  async start(
    input: { chatId: string; sdp: string },
    caller: Caller | undefined,
    who: { name: string; soul: string; user: string; memory: string; voice?: string | null },
    messages: readonly ChatMessage[],
  ): Promise<StartedCall> {
    await this.tick()
    for (const call of Object.values((await this.#options.read()).calls)) {
      if (call.endedAt !== undefined) continue
      if (call.by !== null && call.by !== (caller?.id ?? null)) {
        throw new CallError(`${who.name} is on a call with someone else.`, 409, "busy")
      }
      await this.end(call.id, [])
    }
    const allowance = await this.#allow(caller)
    if ("refused" in allowance) {
      throw new CallError(REFUSALS[allowance.refused], 403, allowance.refused)
    }
    const { pass } = allowance
    const voice = callVoice(pass.dialect, this.#options.agentId, who.voice)
    let answer: string | null = null
    if (pass.dialect !== "scripted") {
      if (
        typeof input.sdp !== "string" ||
        !input.sdp.startsWith("v=0") ||
        input.sdp.length > 60_000
      ) {
        throw new CallError("sdp must be a WebRTC offer")
      }
      answer = await placeCall(
        pass,
        input.sdp,
        { instructions: voiceInstructions(who), voice, context: voiceContext(messages) },
        (url, init) => this.#send(url, init),
      )
    }
    const now = this.#options.now()
    const id = crypto.randomUUID()
    await this.#options.change((state) => {
      state.calls[id] = {
        id,
        chatId: input.chatId,
        by: caller?.id ?? null,
        dialect: pass.dialect,
        paidBy: pass.paidBy,
        startedAt: now,
        endsBy: now + allowance.maxSeconds * 1000,
        lines: [],
        heard: 0,
      }
    })
    return {
      id,
      dialect: pass.dialect,
      sdp: answer,
      voice,
      maxSeconds: allowance.maxSeconds,
      quietSeconds: allowance.quietSeconds,
      ...(pass.dialect === "scripted" ? { script: pass.script } : {}),
    }
  }

  async #live(id: string, caller: Caller | undefined): Promise<CallRecord> {
    const call = (await this.#options.read()).calls[id]
    if (call === undefined || call.endedAt !== undefined) {
      throw new CallError("That call is over.", 404, "gone")
    }
    if (call.by !== null && call.by !== (caller?.id ?? null)) {
      throw new CallError("That call is someone else's.", 403)
    }
    return call
  }

  /** Keep what the device says was said. */
  async said(id: string, sent: unknown, caller: Caller | undefined): Promise<void> {
    await this.#live(id, caller)
    await this.#keep(id, readLines(sent))
  }

  async #keep(id: string, lines: CallLine[]): Promise<void> {
    if (lines.length === 0) return
    await this.#options.change((state) => {
      const call = state.calls[id]
      if (call === undefined) return
      call.lines.push(...lines)
      const over = call.lines.length - MAX_LINES
      if (over > 0) {
        call.lines.splice(0, over)
        call.heard = Math.max(0, call.heard - over)
      }
    })
  }

  /**
   * The voice hands something on: the note that goes to the agent with it, saying what was said
   * on the call that it has not been shown. What it is shown now it is not shown again.
   */
  async handOn(id: string, caller: Caller | undefined, agentName: string): Promise<string> {
    const call = await this.#live(id, caller)
    const unheard = call.lines.slice(call.heard)
    await this.#options.change((state) => {
      const kept = state.calls[id]
      if (kept !== undefined) kept.heard = kept.lines.length
    })
    return callMeta(id, unheard, agentName)
  }

  /** The call is over: it is written into its chat, with what was said and what came of it. */
  async end(id: string, sent: unknown, caller?: Caller): Promise<void> {
    const call = (await this.#options.read()).calls[id]
    if (call === undefined) return
    if (caller !== undefined && call.by !== null && call.by !== caller.id) {
      throw new CallError("That call is someone else's.", 403)
    }
    if (call.endedAt === undefined) {
      await this.#keep(id, readLines(sent))
      const now = this.#options.now()
      await this.#options.change((state) => {
        const kept = state.calls[id]
        if (kept !== undefined) kept.endedAt ??= Math.min(now, kept.endsBy)
      })
    }
    await this.#write(id)
  }

  /** Write an ended call into its chat, once. */
  #write(id: string): Promise<void> {
    const writing = this.#writing.get(id)
    if (writing !== undefined) return writing
    const run = this.#written(id).finally(() => this.#writing.delete(id))
    this.#writing.set(id, run)
    return run
  }

  async #written(id: string): Promise<void> {
    const call = (await this.#options.read()).calls[id]
    if (call === undefined || call.endedAt === undefined) return
    const seconds = Math.max(1, Math.round((call.endedAt - call.startedAt) / 1000))
    const name = await this.#options.name()
    const summary = await this.#summary(call.lines, name)
    await this.#options.record(
      call.chatId,
      { id, seconds, lines: call.lines, summary },
      endedNote(seconds, call.lines.slice(call.heard), name),
    )
    await this.#options.change((state) => {
      delete state.calls[id]
    })
    if (call.paidBy === "server") {
      await this.#options.directory?.spent(call.by, seconds).catch(this.#options.onError)
    }
  }

  /** What came of a call, in up to three lines, where there is a small model to say. */
  async #summary(lines: readonly CallLine[], name: string): Promise<string[]> {
    const review = this.#options.review
    if (review === undefined || lines.length === 0) return []
    try {
      const send = review.fetch ?? ((url, init) => fetch(url, init))
      const response = await send(SUMMARY_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${review.apiKey}`,
          "content-type": "application/json",
          "x-title": "Do Computer",
        },
        body: JSON.stringify({
          model: review.model,
          max_tokens: 300,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SUMMARY_INSTRUCTIONS },
            {
              role: "user",
              content: `The assistant's name: ${name}\n\nWhat was said:\n${clip(spoken(lines, "Person", name), 12_000)}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
      })
      const body = (await response.json().catch(() => ({}))) as {
        choices?: { message?: { content?: string | null } }[]
      }
      if (!response.ok) return []
      return parseSummary(body.choices?.[0]?.message?.content ?? "")
    } catch (error) {
      this.#options.onError(error)
      return []
    }
  }

  /** When the agent must next be woken for a call: one that nobody ended is over at its time. */
  async nextWake(): Promise<number | null> {
    let wake: number | null = null
    for (const call of Object.values((await this.#options.read()).calls)) {
      const at = call.endedAt === undefined ? call.endsBy + GRACE_MS : this.#options.now()
      wake = wake === null ? at : Math.min(wake, at)
    }
    return wake
  }

  /** End the calls whose time is up, and write up those that ended and were not written. */
  async tick(): Promise<void> {
    const now = this.#options.now()
    for (const call of Object.values((await this.#options.read()).calls)) {
      if (call.endedAt === undefined && now < call.endsBy + GRACE_MS) continue
      await this.end(call.id, []).catch(this.#options.onError)
    }
  }
}

/** Why a call cannot be had, said to whoever asked for one. */
export const REFUSALS: Record<CallRefusal, string> = {
  off: "Calls are switched off here.",
  admins: "Calls are for this deployment's admins for now.",
  "sign-in":
    "Nothing here is signed in to something that can place a call. Sign the workspace in to ChatGPT (OpenAI Codex) or add an OpenAI API key under Models.",
  minutes: "This month's call minutes are used up.",
}

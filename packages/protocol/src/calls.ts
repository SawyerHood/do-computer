import type { MessageOrigin } from "./origin.ts"

/**
 * A voice call with an agent. The sound goes straight between the person's device and the
 * provider of the voice; the server starts the call, is told what was said, and keeps the record.
 * The voice is a small fast model that talks. It is not the agent: whatever needs the agent it
 * hands on, and the agent does it in a side chat that is the call's own, as it does what is
 * asked of it in a typed message.
 */

/** One thing said on a call. */
export type CallLine = {
  /** `you` is the person, `dood` the agent's voice. */
  who: "you" | "dood"
  text: string
}

/**
 * How the device talks to the voice. `codex` is a call paid for by a ChatGPT subscription, on
 * the route OpenAI's Codex client uses; `openai` is one paid for by an OpenAI API key, on the
 * public route. They carry the same things under different names. `scripted` has no voice at
 * all: the server hands the device a script to play, for tests.
 */
export type CallDialect = "codex" | "openai" | "scripted"

/** The voices a call of each kind can speak in. One that is not among them is refused. */
export const CALL_VOICES: Record<CallDialect, readonly string[]> = {
  codex: ["juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol", "cove"],
  openai: [
    "marin",
    "cedar",
    "quartz",
    "ripple",
    "vesper",
    "willow",
    "stone",
    "gleam",
    "meridian",
    "beacon",
    "delta",
    "cinder",
  ],
  scripted: ["plain"],
}

/**
 * The voice an agent has on a call of one kind: the one chosen for it where that is a voice of
 * that kind, and otherwise one picked by its id, so that it is always the same one and two
 * agents seldom share it.
 */
export function callVoice(dialect: CallDialect, agentId: string, chosen?: string | null): string {
  const voices = CALL_VOICES[dialect]
  if (typeof chosen === "string" && voices.includes(chosen)) return chosen
  let hash = 0
  for (let i = 0; i < agentId.length; i++) hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0
  return voices[hash % voices.length]!
}

/**
 * Why a person cannot call an agent. `off`: the deployment has calls switched off. `admins`: it
 * keeps them for its admins. `sign-in`: nothing the agent's workspace or the deployment is
 * signed in to can place one. `minutes`: the person has used the month's minutes.
 */
export type CallRefusal = "off" | "admins" | "sign-in" | "minutes"

/** Whether the person asking can call an agent, and in what voice it would answer. */
export type CallsState = {
  available: boolean
  reason?: CallRefusal
  /** The kind of call it would be, where one can be had. */
  dialect?: CallDialect
  /** Whose sign-in would pay for it. */
  paidBy?: "workspace" | "server"
  /** The voices the agent can be given for such a call, and the one it has. */
  voices: string[]
  voice: string | null
}

/** One step of the script a `scripted` call plays, in place of a voice. */
export type CallScriptStep =
  | { say: string }
  | { hear: string }
  /** The voice hands what was just heard on to the agent, and says what comes back. */
  | { handOn: true }

export type StartCallRequest = {
  /** The chat the call is held in: one the person talks to the agent in. */
  chatId: string
  /** The device's WebRTC offer. A `scripted` call has no use for it. */
  sdp: string
}

export type StartedCall = {
  id: string
  dialect: CallDialect
  /** The provider's answer to the offer. Null for a `scripted` call. */
  sdp: string | null
  voice: string
  /** How long the call may last. The device hangs up when it is reached. */
  maxSeconds: number
  /** How long nothing may be said before the device hangs up. */
  quietSeconds: number
  script?: CallScriptStep[]
}

export type StartCallResponse = { call: StartedCall }

/** What was said since the device last told the server. */
export type CallLinesRequest = { lines: CallLine[] }

/**
 * Something the voice hands on to the agent: what was asked, in words. It goes to the call's
 * side chat as a message, where the agent does it with everything it can do.
 */
export type CallWorkRequest = {
  text: string
  /** Device-chosen id; resending the same one never sends twice. The message is known by it. */
  requestId: string
  /** The person's IANA timezone and where they are, as with a message that was typed. */
  timezone?: string
  from?: MessageOrigin
}

export type CallWorkResponse = {
  /** The chat it went to: the call's own side chat, where the agent answers it. */
  chatId: string
  submissionId: string
}

export type EndCallRequest = {
  /** What was said and not yet told. */
  lines?: CallLine[]
}

/** How long a call was, to say: "45 s", "3 min", "1 h 5 min". */
export function callLength(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return minutes % 60 === 0
    ? `${minutes / 60} h`
    : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

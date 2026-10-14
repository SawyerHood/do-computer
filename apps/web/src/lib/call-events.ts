import type { CallDialect } from "@do-computer/protocol"

/**
 * What the voice on a call says to the device, and what the device says back, in one set of
 * names. A call paid for by a ChatGPT subscription and one paid for by an OpenAI key carry the
 * same things under different names, and this is where each is read and written.
 */

/** What the voice told the device. */
export type Heard =
  /** The voice is ready to talk. */
  | { type: "started" }
  /** More words of what one of the two is saying. */
  | { type: "words"; who: "you" | "dood"; text: string }
  /** One of the two has finished saying something, and this is all of it. */
  | { type: "line"; who: "you" | "dood"; text: string }
  /**
   * The voice hands something on to the agent. `ask` is the request in words, where the voice
   * gives it; where it does not, it is what the person said last.
   */
  | { type: "handOn"; id: string; ask?: string }
  | { type: "closed" }
  | { type: "error"; message: string }

type Raw = Record<string, unknown>
const object = (value: unknown): Raw | undefined =>
  typeof value === "object" && value !== null ? (value as Raw) : undefined
const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

/** A provider's refusal of a voice reads as a refusal of the caller. It is said as what it is. */
const explain = (message: string) =>
  /voice session access denied/i.test(message)
    ? "The call was refused. Its voice may be one this kind of call cannot speak in: choose another in the Dood's settings."
    : message

/** Read one event from the voice. Null for one that carries nothing the app shows or acts on. */
export function readVoiceEvent(dialect: CallDialect, data: string): Heard | null {
  let event: Raw | undefined
  try {
    event = object(JSON.parse(data))
  } catch {
    return null
  }
  const type = text(event?.type)
  if (event === undefined || type === undefined) return null
  if (type === "session.started") return { type: "started" }
  if (type === "session.closed") return { type: "closed" }
  if (type === "error") {
    const message = text(object(event.error)?.message) ?? text(event.message)
    return { type: "error", message: explain(message ?? "The call ran into a problem.") }
  }
  if (dialect === "openai") {
    if (type === "session.input_transcript.delta" || type === "session.output_transcript.delta") {
      const words = text(event.delta)
      return words === undefined || words === ""
        ? null
        : { type: "words", who: type.includes(".input_") ? "you" : "dood", text: words }
    }
    if (type === "session.delegation.created") {
      const delegation = object(event.delegation)
      const id = text(delegation?.id)
      // Only what is handed to the app is the app's to answer.
      if (id === undefined || text(delegation?.target) !== "client") return null
      return { type: "handOn", id }
    }
    return null
  }
  if (type === "input_transcript.added" || type === "output_transcript.added") {
    const words = text(object(event.item)?.text)
    return words === undefined || words === ""
      ? null
      : { type: "words", who: type.startsWith("input") ? "you" : "dood", text: words }
  }
  if (type === "turn.done") {
    const turn = object(event.turn)
    const role = text(turn?.role)
    const said = text(turn?.transcript)?.trim()
    if (said === undefined || said === "" || (role !== "user" && role !== "assistant")) return null
    return { type: "line", who: role === "user" ? "you" : "dood", text: said }
  }
  if (type === "delegation.created") {
    const item = object(event.item)
    const id = text(item?.id)
    if (id === undefined || text(item?.target) !== "client") return null
    const ask = (Array.isArray(item?.content) ? item.content : [])
      .map((part) =>
        text(object(part)?.type) === "input_text" ? (text(object(part)?.text) ?? "") : "",
      )
      .join("")
      .trim()
    return ask === "" ? { type: "handOn", id } : { type: "handOn", id, ask }
  }
  return null
}

/** The longest one piece of an answer can be, on a call of each kind. */
const CODEX_PIECE_BYTES = 480
const OPENAI_ANSWER_CHARS = 1_800
/** How many pieces of an answer are sent. What is longer than that is in the chat. */
const MAX_PIECES = 4

const bytes = (said: string) => new TextEncoder().encode(said).length

/** Cut what is to be said into pieces that each fit, at the ends of sentences where it can. */
export function pieces(said: string, limit = CODEX_PIECE_BYTES, most = MAX_PIECES): string[] {
  const out: string[] = []
  let rest = said.replace(/\s+/g, " ").trim()
  while (rest !== "" && out.length < most) {
    if (bytes(rest) <= limit) {
      out.push(rest)
      break
    }
    // As much as fits, by characters, since a character can be several bytes.
    let end = Math.min(rest.length, limit)
    while (end > 1 && bytes(rest.slice(0, end)) > limit) end--
    const head = rest.slice(0, end)
    const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "))
    const cut =
      stop > end * 0.4 ? stop + 1 : head.lastIndexOf(" ") > end * 0.4 ? head.lastIndexOf(" ") : end
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  return out
}

let sent = 0
const eventId = () => `dc_${Date.now().toString(36)}_${(sent++).toString(36)}`

/**
 * What to send the voice to have it say the agent's answer to something it handed on, or to let
 * it know how the work is going meanwhile. Progress is the voice's to mention or not.
 */
export function voiceReply(
  dialect: CallDialect,
  id: string,
  said: string,
  kind: "answer" | "progress",
): string[] {
  if (dialect === "openai") {
    const content =
      said.length > OPENAI_ANSWER_CHARS
        ? `${said.slice(0, OPENAI_ANSWER_CHARS - 1).trimEnd()}…`
        : said
    return [
      JSON.stringify({
        type: kind === "answer" ? "session.commentary.append" : "session.thinking.append",
        event_id: eventId(),
        delegation_id: id,
        content,
      }),
    ]
  }
  return pieces(said).map((piece) =>
    JSON.stringify({
      type: "delegation.context.append",
      delegation_item_id: id,
      channel: kind === "answer" ? "speakable" : "commentary",
      content: [{ type: "input_text", text: piece }],
    }),
  )
}

/** What to send the voice to end the call. */
export const voiceClose = () => JSON.stringify({ type: "session.close" })

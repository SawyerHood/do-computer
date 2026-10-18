import type { CallLine } from "./calls.ts"
import type { JobStatus } from "./jobs.ts"

/** JSON as it travels between server and clients. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export type ToolStatus = "pending" | "running" | "done" | "error"

export type TextPart = { type: "text"; text: string }
export type ThinkingPart = { type: "thinking"; text: string }
export type ToolPart = {
  type: "tool"
  toolCallId: string
  name: string
  /** Parsed arguments; while the model is still writing them, the best partial parse. */
  args: Json
  status: ToolStatus
  /** Text shown for the call: running output, then the result. */
  output?: string
  details?: Json
}
export type ImagePart = { type: "image"; mimeType: string; data: string }
export type NoticePart = {
  type: "notice"
  /**
   * `schedule` heads the report of a scheduled task; its text is the task's title. `subagent` is
   * word from a sub-agent; its text is the sub-agent's title. `computer` is the answer to the
   * agent's asking to use a computer; its text is the computer's name. `agent` is another
   * agent's reply to a message; its text is that agent's name. `secret` is the answer to the
   * agent's asking for secrets; its text is where they were to be saved. `connector` is how a
   * sign-in the agent asked for went; its text is the connector's name. `command` is the end of
   * a command the agent left running in the background; its text is the command. `branch` is
   * where a side chat's own messages begin, after the ones it carries from the main chat. `call`
   * is a voice call that was held in the chat, once it is over; its text is how long it was.
   * `approval` is someone's answer to something the agent asked leave for, where it is told as an
   * event; its text is what was asked. `automation` is what a run of an automation came to, told
   * to the main chat as an event; its text is the automation's title. `asked` is a sub-agent
   * asking a person for something through the main chat; its text is the sub-agent's title.
   * `slack` is something a thread in Slack told the main chat; its text is where the thread is.
   */
  kind:
    | "reset"
    | "compaction"
    | "branch"
    | "error"
    | "schedule"
    | "subagent"
    | "computer"
    | "agent"
    | "secret"
    | "connector"
    | "command"
    | "call"
    | "approval"
    | "automation"
    | "asked"
    | "slack"
  text: string
  /**
   * For `computer`: whether the agent was let in. For `secret`: whether they were saved. For
   * `connector`: whether it is connected now. For `approval`: whether it was allowed.
   */
  approved?: boolean
  /** For `computer`, `secret`, `connector` and `approval`: who answered. */
  by?: string
  /**
   * For `subagent` and `asked`: the sub-agent's own chat. For `agent`: the conversation on the
   * other agent. For `automation`: the chat the run happened in. For `slack`: the thread's chat.
   */
  chatId?: string
  /** For `agent`: the agent that replied. */
  agentId?: string
  /** For `subagent`, `agent` and `automation`: what the word is. */
  outcome?: "reported" | "failed" | "stopped"
  /**
   * For `subagent`, `agent` and `automation`: what it reported, or why it failed. For `asked`:
   * what it asked for. For `slack`: what the thread said. For `secret`: the names that
   * were asked for, never their values. For `connector`: what went wrong, if something did.
   * For `command`: the last of what it printed.
   */
  detail?: string
  /** For `command`: which one it was, where it ran, how it ended and how long it took. */
  job?: { id: string; computer: string; status: JobStatus; exitCode?: number; ms: number }
  /** For `call`: how long it was, what came of it in a few lines, and what was said. */
  call?: {
    id: string
    seconds: number
    summary: string[]
    lines: CallLine[]
    /** The side chat the agent did the call's work in, where the call had one of its own. */
    chatId?: string
    /** What whoever was on it is called, where that is known. */
    by?: string
  }
}

export type MessagePart = TextPart | ThinkingPart | ToolPart | ImagePart | NoticePart

export type ChatMessage = {
  /** The transcript entry's id; `live:<n>` while the message is still being generated. */
  id: string
  role: "user" | "assistant" | "notice"
  parts: MessagePart[]
  status: "streaming" | "done" | "error" | "aborted"
  error?: string
  createdAt?: number
  /** `provider/model` that produced an assistant message. */
  model?: string
  /** Who sent a user message, where the agent is shared by a team. */
  author?: { id: string; name: string }
  /** The agent that sent a user message, where it came from another agent and not a person. */
  agent?: { id: string; name: string }
  /** Who wrote a user message in Slack, by their id and name there. */
  slack?: { id: string; name: string }
  /**
   * A user message that was said out loud, on a voice call, and handed on to the agent: the
   * call, and the id the device sent it under, by which the device finds the answer to it.
   */
  spoken?: { call: string; request: string }
  /**
   * An assistant message that is the agent's own working and not something it said: in a chat
   * where it reaches people only through `send`, everything it did between two things that were
   * said (its own text, its steps, the events it was told of) is folded into one such row, which
   * can be opened. A client shows it as one line, and never as words to the person.
   */
  work?: true
  /**
   * A call to `send` that failed: why. Its words are still shown, as they may have been while
   * they were written, marked as not sent.
   */
  notSent?: string
}

export type QueuedInput = {
  id: string
  /** `steer` joins the running work after the current tool round; `followUp` starts the next run. */
  mode: "steer" | "followUp"
  text: string
}

/** Tokens and money spent on models. */
export type ChatUsage = {
  inputTokens: number
  outputTokens: number
  /** In US dollars, as the model provider priced it. */
  cost: number
}

/** Everything a client needs to render one chat. */
export type ChatState = {
  messages: ChatMessage[]
  /** A run is working on an input. */
  busy: boolean
  queued: QueuedInput[]
  usage: ChatUsage
}

/**
 * One change to a chat. A stream starts with `snapshot`; a client that falls behind or reconnects
 * gets a fresh `snapshot`, so events never need replaying.
 */
export type ChatEvent =
  | { type: "snapshot"; state: ChatState }
  /** Insert the message, or replace the one with its id. `replaces` names a live message it supersedes. */
  | { type: "message"; message: ChatMessage; replaces?: string }
  /** Append to the text or thinking part at `index`. */
  | { type: "delta"; messageId: string; index: number; text: string }
  /** Insert or replace the part at `index`. */
  | { type: "part"; messageId: string; index: number; part: MessagePart }
  | {
      type: "tool"
      toolCallId: string
      status?: ToolStatus
      /** Replace the output, or drop `trimStart` characters from its front and then append. */
      output?: { set: string } | { trimStart?: number; append?: string }
      details?: Json
    }
  | { type: "busy"; busy: boolean }
  | { type: "queued"; queued: QueuedInput[] }
  | { type: "usage"; usage: ChatUsage }

export const EMPTY_CHAT: ChatState = {
  messages: [],
  busy: false,
  queued: [],
  usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
}

function findTool(
  messages: ChatMessage[],
  toolCallId: string,
): { message: number; part: number } | undefined {
  for (let m = messages.length - 1; m >= 0; m--) {
    const parts = messages[m]!.parts
    for (let p = parts.length - 1; p >= 0; p--) {
      const part = parts[p]!
      if (part.type === "tool" && part.toolCallId === toolCallId) return { message: m, part: p }
    }
  }
  return undefined
}

function replaceAt<T>(items: readonly T[], index: number, item: T): T[] {
  const next = items.slice()
  next[index] = item
  return next
}

/**
 * Apply one event. Returns a new state and never mutates `state`, so it works as a React reducer.
 * An event that refers to something the state does not have is ignored: the next snapshot repairs it.
 */
export function reduceChat(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "snapshot":
      return event.state
    case "busy":
      return { ...state, busy: event.busy }
    case "queued":
      return { ...state, queued: event.queued }
    case "usage":
      return { ...state, usage: event.usage }
    case "message": {
      let messages = state.messages
      if (event.replaces !== undefined && event.replaces !== event.message.id) {
        messages = messages.filter((message) => message.id !== event.replaces)
      }
      const index = messages.findIndex((message) => message.id === event.message.id)
      return {
        ...state,
        messages:
          index === -1 ? [...messages, event.message] : replaceAt(messages, index, event.message),
      }
    }
    case "delta": {
      const index = state.messages.findIndex((message) => message.id === event.messageId)
      const message = state.messages[index]
      const part = message?.parts[event.index]
      if (message === undefined || (part?.type !== "text" && part?.type !== "thinking")) {
        return state
      }
      const parts = replaceAt(message.parts, event.index, {
        ...part,
        text: part.text + event.text,
      })
      return { ...state, messages: replaceAt(state.messages, index, { ...message, parts }) }
    }
    case "part": {
      const index = state.messages.findIndex((message) => message.id === event.messageId)
      const message = state.messages[index]
      if (message === undefined || event.index > message.parts.length) return state
      const parts = replaceAt(message.parts, event.index, event.part)
      return { ...state, messages: replaceAt(state.messages, index, { ...message, parts }) }
    }
    case "tool": {
      const found = findTool(state.messages, event.toolCallId)
      if (found === undefined) return state
      const message = state.messages[found.message]!
      const part = message.parts[found.part] as ToolPart
      let output = part.output
      if (event.output !== undefined) {
        if ("set" in event.output) output = event.output.set
        else
          output = (output ?? "").slice(event.output.trimStart ?? 0) + (event.output.append ?? "")
      }
      const next: ToolPart = {
        ...part,
        status: event.status ?? part.status,
        output,
        details: event.details === undefined ? part.details : event.details,
      }
      const parts = replaceAt(message.parts, found.part, next)
      return { ...state, messages: replaceAt(state.messages, found.message, { ...message, parts }) }
    }
  }
}

/** A page of a chat's earlier messages: what came before the transcript a client already has. */
export type ChatHistoryPage = {
  /** Oldest first. */
  messages: ChatMessage[]
  /** Pass as `before` to get the page before this one. Null when this is the beginning. */
  before: string | null
}

/**
 * Where files go with a message, the app (and Slack) says so in a last line of its text,
 * "Attached: a.jpg, b.txt": that is how the agent knows to look for them in its library.
 */
const ATTACHED_LINE = /(?:^|\n\n)Attached: ([^\n]+)$/

const PICTURE_NAME = /\.(?:png|jpe?g|gif|webp|heic|heif|avif|bmp)$/i

/**
 * A message's words as a person reads them: without the line that names its files for the
 * agent. The files it named are given back to be shown as files, all but the pictures where the
 * message carries pictures, which are shown as themselves already.
 */
export function sentWords(text: string, pictures: boolean): { text: string; files: string[] } {
  const found = ATTACHED_LINE.exec(text)
  if (found === null) return { text, files: [] }
  const files = found[1]!
    .split(", ")
    .map((name) => name.trim())
    .filter((name) => name !== "" && !(pictures && PICTURE_NAME.test(name)))
  return { text: text.slice(0, found.index).trimEnd(), files }
}

/**
 * A sent message as its agent's latest line has it: its words, or what it sent where it said
 * nothing, and not the line that names its files for the agent.
 */
export function latestOfSent(text: string): string {
  const shown = sentWords(text, false)
  if (shown.text !== "" || shown.files.length === 0) return shown.text
  return shown.files.length === 1 ? `Sent ${shown.files[0]}` : `Sent ${shown.files.length} files`
}

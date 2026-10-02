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
  /** `schedule` heads the report of a scheduled task; its text is the task's title. */
  kind: "reset" | "compaction" | "error" | "schedule"
  text: string
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
}

export type QueuedInput = {
  id: string
  /** `steer` joins the running work after the current tool round; `followUp` starts the next run. */
  mode: "steer" | "followUp"
  text: string
}

export type ChatUsage = {
  inputTokens: number
  outputTokens: number
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

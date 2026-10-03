import type { ChatEvent, ChatMessage, ChatState, MessagePart, ToolPart } from "./chat.ts"

/** Structural equality of JSON-shaped values. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    if (a.length !== other.length) return false
    return a.every((item, index) => jsonEqual(item, other[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left).filter((key) => left[key] !== undefined)
  if (keys.length !== Object.keys(right).filter((key) => right[key] !== undefined).length) {
    return false
  }
  return keys.every((key) => jsonEqual(left[key], right[key]))
}

const isLive = (id: string) => id.startsWith("live:")

function sameToolCall(a: ToolPart, b: ToolPart): boolean {
  return a.toolCallId === b.toolCallId && a.name === b.name && jsonEqual(a.args, b.args)
}

function diffPart(
  messageId: string,
  index: number,
  before: MessagePart | undefined,
  after: MessagePart,
): ChatEvent[] {
  if (before === undefined) return [{ type: "part", messageId, index, part: after }]
  if (jsonEqual(before, after)) return []
  if (
    (before.type === "text" && after.type === "text") ||
    (before.type === "thinking" && after.type === "thinking")
  ) {
    if (after.text.startsWith(before.text)) {
      return [{ type: "delta", messageId, index, text: after.text.slice(before.text.length) }]
    }
  }
  if (before.type === "tool" && after.type === "tool" && sameToolCall(before, after)) {
    // A tool event can change output and details but not clear them; replace the part for that.
    const cleared =
      (before.output !== undefined && after.output === undefined) ||
      (before.details !== undefined && after.details === undefined)
    if (!cleared) {
      const event: Extract<ChatEvent, { type: "tool" }> = {
        type: "tool",
        toolCallId: after.toolCallId,
      }
      if (before.status !== after.status) event.status = after.status
      if (before.output !== after.output) {
        const previous = before.output ?? ""
        const current = after.output ?? ""
        event.output = current.startsWith(previous)
          ? { append: current.slice(previous.length) }
          : { set: current }
      }
      if (!jsonEqual(before.details, after.details)) event.details = after.details
      return [event]
    }
  }
  return [{ type: "part", messageId, index, part: after }]
}

function diffMessage(before: ChatMessage, after: ChatMessage): ChatEvent[] {
  if (jsonEqual(before, after)) return []
  const sameEnvelope =
    before.role === after.role &&
    before.status === after.status &&
    before.error === after.error &&
    before.createdAt === after.createdAt &&
    before.model === after.model
  if (!sameEnvelope || after.parts.length < before.parts.length) {
    return [{ type: "message", message: after }]
  }
  return after.parts.flatMap((part, index) => diffPart(after.id, index, before.parts[index], part))
}

/**
 * Events that turn `before` into `after` under `reduceChat`.
 *
 * Covers what a chat does while it runs: messages change in place, new ones are appended, and a
 * live message gives way to its final entry. Anything else, such as a reset or compaction dropping
 * messages, is sent as one `snapshot`.
 */
export function diffChat(before: ChatState, after: ChatState): ChatEvent[] {
  const snapshot: ChatEvent[] = [{ type: "snapshot", state: after }]
  const afterIds = new Set(after.messages.map((message) => message.id))
  const removed = before.messages.filter((message) => !afterIds.has(message.id))
  if (removed.length > 1 || (removed[0] !== undefined && !isLive(removed[0].id))) return snapshot

  const kept = before.messages.filter((message) => afterIds.has(message.id))
  const events: ChatEvent[] = []
  for (const [index, message] of kept.entries()) {
    const counterpart = after.messages[index]
    // Kept messages must still lead the list, in order; appended ones follow.
    if (counterpart?.id !== message.id) return snapshot
    events.push(...diffMessage(message, counterpart))
  }
  const added = after.messages.slice(kept.length)
  if (removed[0] !== undefined && added.length === 0) return snapshot
  for (const [index, message] of added.entries()) {
    events.push(
      index === 0 && removed[0] !== undefined
        ? { type: "message", message, replaces: removed[0].id }
        : { type: "message", message },
    )
  }
  if (before.busy !== after.busy) events.push({ type: "busy", busy: after.busy })
  if (!jsonEqual(before.queued, after.queued)) events.push({ type: "queued", queued: after.queued })
  if (!jsonEqual(before.usage, after.usage)) events.push({ type: "usage", usage: after.usage })
  return events
}

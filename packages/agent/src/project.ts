import type {
  ChatMessage,
  ChatState,
  ChatUsage,
  Json,
  MessagePart,
  QueuedInput,
  ToolPart,
} from "@durable-computer/protocol"
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@earendil-works/pi-ai"
import type {
  ConversationView,
  EntryRecord,
  InboxState,
  LiveState,
  UsageState,
} from "@earendil-works/pi-durable"

type UserContent = UserMessage["content"]

/** A text block the server adds for the model, such as the send time; never shown. */
const isMeta = (text: string) => text.startsWith("<meta ")

function contentParts(content: UserContent | (TextContent | ImageContent)[]): MessagePart[] {
  if (typeof content === "string") return content === "" ? [] : [{ type: "text", text: content }]
  return content.flatMap((block): MessagePart[] => {
    if (block.type === "image")
      return [{ type: "image", mimeType: block.mimeType, data: block.data }]
    return isMeta(block.text) ? [] : [{ type: "text", text: block.text }]
  })
}

function contentText(content: UserContent | (TextContent | ImageContent)[]): string {
  if (typeof content === "string") return content
  return content
    .filter((block): block is TextContent => block.type === "text" && !isMeta(block.text))
    .map((block) => block.text)
    .join("")
}

function assistantParts(message: AssistantMessage): MessagePart[] {
  const parts: MessagePart[] = []
  for (const block of message.content) {
    if (block.type === "text") {
      if (block.text !== "") parts.push({ type: "text", text: block.text })
    } else if (block.type === "thinking") {
      // Redacted thinking carries only an opaque payload for the provider; there is nothing to show.
      if (!block.redacted && block.thinking !== "") {
        parts.push({ type: "thinking", text: block.thinking })
      }
    } else {
      parts.push({
        type: "tool",
        toolCallId: block.id,
        name: block.name,
        args: (block.arguments ?? {}) as Json,
        status: "pending",
      })
    }
  }
  return parts
}

function assistantMessage(id: string, message: AssistantMessage, live: boolean): ChatMessage {
  const result: ChatMessage = {
    id,
    role: "assistant",
    parts: assistantParts(message),
    status: live
      ? "streaming"
      : message.stopReason === "error"
        ? "error"
        : message.stopReason === "aborted"
          ? "aborted"
          : "done",
    createdAt: message.timestamp,
    model: `${message.provider}/${message.model}`,
  }
  if (!live && message.stopReason === "error" && message.errorMessage !== undefined) {
    result.error = message.errorMessage
  }
  return result
}

function notice(id: string, kind: "reset" | "compaction", text: string): ChatMessage {
  return { id, role: "notice", parts: [{ type: "notice", kind, text }], status: "done" }
}

export function addUsage(total: ChatUsage, usage: Usage): void {
  total.inputTokens += usage.input + usage.cacheRead + usage.cacheWrite
  total.outputTokens += usage.output
  total.cost += usage.cost.total
}

function entryMessage(entry: EntryRecord): ChatMessage | undefined {
  const id = String(entry.id)
  const first = entry.model?.[0]
  switch (entry.kind) {
    case "pi.user": {
      if (first?.role !== "user") return undefined
      return {
        id,
        role: "user",
        parts: contentParts(first.content),
        status: "done",
        createdAt: first.timestamp,
      }
    }
    case "pi.assistant": {
      if (first?.role !== "assistant") return undefined
      const message = assistantMessage(id, first, false)
      // An attempt that was cut off before it produced anything has nothing to show.
      return message.parts.length === 0 && message.status !== "error" ? undefined : message
    }
    case "pi.reset":
      return notice(id, "reset", first?.role === "user" ? contentText(first.content) : "")
    case "pi.compaction":
      return notice(id, "compaction", "Earlier messages were summarized to free up context.")
    case "dc.scheduled": {
      // A scheduled task's report, delivered into the chat the task was created in.
      const report = entry.data as { title?: string; text?: string } | undefined
      return {
        id,
        role: "assistant",
        parts: [
          { type: "notice", kind: "schedule", text: report?.title ?? "Scheduled task" },
          { type: "text", text: report?.text ?? "" },
        ],
        status: "done",
        createdAt: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    default:
      return undefined
  }
}

/**
 * What a client renders for one conversation, derived from pi-durable's committed view: the active
 * transcript, then the answer being generated. Pure, so two views of the same commit are equal.
 */
export function projectChat(view: ConversationView): ChatState {
  const live = view.docs["pi.live"] as LiveState | undefined
  const inbox = view.docs["pi.inbox"] as InboxState | undefined
  const usageDoc = view.docs["pi.usage"] as UsageState | undefined

  const messages: ChatMessage[] = []
  const tools = new Map<string, ToolPart>()
  const register = (message: ChatMessage) => {
    for (const part of message.parts) if (part.type === "tool") tools.set(part.toolCallId, part)
  }

  let lastEntryId = "0"
  for (const entry of view.entries) {
    lastEntryId = String(entry.id)
    if (entry.kind === "pi.tool-result") {
      const result = entry.model?.[0] as ToolResultMessage | undefined
      const part = result === undefined ? undefined : tools.get(result.toolCallId)
      if (result === undefined || part === undefined) continue
      part.status = result.isError ? "error" : "done"
      part.output = contentText(result.content)
      if (result.details !== undefined) part.details = result.details as Json
      continue
    }
    const message = entryMessage(entry)
    if (message === undefined) continue
    register(message)
    messages.push(message)
  }

  const partial = live?.generation?.message
  if (partial !== undefined) {
    const message = assistantMessage(`live:${lastEntryId}`, partial as AssistantMessage, true)
    if (message.parts.length > 0) {
      register(message)
      messages.push(message)
    }
  }

  // Calls of the current round take their progress from the live slots.
  const running = new Set<string>()
  for (const slot of live?.tools ?? []) {
    const part = tools.get(slot.callId)
    if (part === undefined) continue
    running.add(slot.callId)
    if (part.status !== "pending") continue
    if (slot.status === "running") part.status = "running"
    if (slot.output !== undefined) part.output = slot.output
    if (slot.details !== undefined) part.details = slot.details as Json
  }
  // A call with neither a result nor a slot was interrupted, once nothing is generating it anymore.
  const busy = live?.run !== undefined
  for (const [callId, part] of tools) {
    if (part.status === "pending" && !running.has(callId) && partial === undefined && !busy) {
      part.status = "error"
      part.output ??= "Interrupted before it finished."
    }
  }

  const queued: QueuedInput[] = []
  for (const item of inbox?.items ?? []) {
    if (item.mode === "write") continue
    queued.push({
      id: String(item.id),
      mode: item.mode,
      text: contentText(item.content as UserContent),
    })
  }

  const usage: ChatUsage = { inputTokens: 0, outputTokens: 0, cost: 0 }
  for (const entry of Object.values(usageDoc?.models ?? {})) addUsage(usage, entry as Usage)
  for (const entry of Object.values(usageDoc?.tools ?? {})) addUsage(usage, entry as Usage)

  return { messages, busy, queued, usage }
}

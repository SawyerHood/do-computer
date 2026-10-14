import {
  callLength,
  type ChatMessage,
  type ChatState,
  type ChatUsage,
  type JobStatus,
  type Json,
  type MessagePart,
  type QueuedInput,
  type ToolPart,
} from "@do-computer/protocol"
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
import type { Carried } from "./branch.ts"
import { CALL_ENTRY, type CallEntry, callOf } from "./calls.ts"
import { agentSenderOf, type Caller, senderOf, type SlackSender, slackSenderOf } from "./caller.ts"

type UserContent = UserMessage["content"]

/** A text block the server adds for the model, such as the send time; never shown. */
const isMeta = (text: string) => text.startsWith("<meta ")

/** Whether a message was said out loud, on a call, from the note that travelled with it. */
function contentSpoken(content: UserContent): boolean {
  if (typeof content === "string") return false
  return content.some(
    (block) => block.type === "text" && isMeta(block.text) && callOf(block.text) !== undefined,
  )
}

/** Who sent a message, from the note that travelled with it. */
function contentAuthor(content: UserContent): Caller | undefined {
  if (typeof content === "string") return undefined
  for (const block of content) {
    if (block.type !== "text" || !isMeta(block.text)) continue
    const sender = senderOf(block.text)
    if (sender !== undefined) return sender
  }
  return undefined
}

/** Which agent sent a message, where it came from another agent. */
function contentAgent(content: UserContent): Caller | undefined {
  if (typeof content === "string") return undefined
  for (const block of content) {
    if (block.type !== "text" || !isMeta(block.text)) continue
    const sender = agentSenderOf(block.text)
    if (sender !== undefined) return sender
  }
  return undefined
}

/** Who wrote a message in Slack, where it came from there. */
function contentSlack(content: UserContent): SlackSender | undefined {
  if (typeof content === "string") return undefined
  for (const block of content) {
    if (block.type !== "text" || !isMeta(block.text)) continue
    const sender = slackSenderOf(block.text)
    if (sender !== undefined) return sender
  }
  return undefined
}

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

/**
 * The tool an agent tells its user how the work is going with. A call to it is something the
 * agent said, so it is shown as words of its own and not as a step it took.
 */
export const PROGRESS_TOOL = "progress"

/** What a call to the progress tool says. Empty while its words are still on their way. */
function progressText(block: { name: string; arguments?: unknown }): string | undefined {
  if (block.name !== PROGRESS_TOOL) return undefined
  const message = (block.arguments as { message?: unknown } | undefined)?.message
  return typeof message === "string" ? message : ""
}

const plain = (text: string) => text.replace(/\s+/g, " ").trim()

/**
 * Adds what a progress call says. Some models write the same words as text in the same reply;
 * said twice, they are shown once, in whichever form says more.
 */
function addSaid(parts: MessagePart[], text: string): void {
  const said = plain(text)
  if (said === "") return
  for (const part of parts) {
    if (part.type !== "text") continue
    const written = plain(part.text)
    if (written.includes(said)) return
    if (said.includes(written)) {
      part.text = text
      return
    }
  }
  parts.push({ type: "text", text })
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
    } else if (progressText(block) !== undefined) {
      addSaid(parts, progressText(block)!)
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

/** The entry that begins a side chat's own messages, after the ones it carries from another chat. */
export const BRANCH_ENTRY = "dc.branch"

/**
 * Where a chat can be branched from: its last entry while the agent is at rest in it, and the
 * agent's last finished answer while it is working, so that a side chat never begins in the
 * middle of a step. Undefined when the agent has not answered anything there yet.
 */
export function branchPoint(entries: readonly EntryRecord[]): EntryRecord["id"] | undefined {
  const spoken = (entry: EntryRecord) =>
    entry.kind === "pi.user" || entry.kind === "pi.assistant" || entry.kind === "pi.tool-result"
  const answered = entries.findLastIndex((entry) => {
    const message = entry.model?.[0]
    return (
      entry.kind === "pi.assistant" &&
      message?.role === "assistant" &&
      message.stopReason === "stop" &&
      !message.content.some((block) => block.type === "toolCall")
    )
  })
  if (answered === -1) return undefined
  // Only notes written into the chat follow the answer: the agent is at rest.
  const resting = !entries.slice(answered + 1).some(spoken)
  return (resting ? entries.at(-1)! : entries[answered]!).id
}

function notice(id: string, kind: "reset" | "compaction" | "branch", text: string): ChatMessage {
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
      const parts = contentParts(first.content)
      // A note to the model alone, such as being set going again, is not something anyone said.
      if (parts.length === 0) return undefined
      const slack = contentSlack(first.content)
      // Someone in Slack who is also one of the agent's people is shown as who they are here.
      const author =
        slack === undefined
          ? contentAuthor(first.content)
          : slack.userId === undefined
            ? undefined
            : { id: slack.userId, name: slack.name }
      const agent = contentAgent(first.content)
      return {
        id,
        role: "user",
        parts,
        status: "done",
        createdAt: first.timestamp,
        ...(author === undefined ? {} : { author }),
        ...(agent === undefined ? {} : { agent }),
        ...(slack === undefined ? {} : { slack: { id: slack.id, name: slack.name } }),
        ...(contentSpoken(first.content) ? { spoken: true as const } : {}),
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
    case BRANCH_ENTRY: {
      // Says how much of the main chat the side chat carries, where that is not all of it.
      const carried = (entry.data as { carried?: Carried } | undefined)?.carried
      return notice(
        id,
        "branch",
        carried === "trimmed"
          ? "Continues from the main chat, with older tool output left behind"
          : carried === "recent"
            ? "Continues from the most recent part of the main chat"
            : "Continues from the main chat",
      )
    }
    case CALL_ENTRY: {
      // A voice call that was held in the chat, once it is over.
      const call = entry.data as Partial<CallEntry> | undefined
      const seconds = typeof call?.seconds === "number" ? call.seconds : 0
      return {
        id,
        role: "notice",
        parts: [
          {
            type: "notice",
            kind: "call",
            text: callLength(seconds),
            call: {
              id: typeof call?.id === "string" ? call.id : id,
              seconds,
              summary: Array.isArray(call?.summary) ? call.summary : [],
              lines: Array.isArray(call?.lines) ? call.lines : [],
            },
          },
        ],
        status: "done",
        createdAt: first?.role === "user" ? first.timestamp : undefined,
      }
    }
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
    case "dc.subagent": {
      // Word from a sub-agent, in the chat that started it.
      const word = entry.data as
        | {
            chatId?: string
            title?: string
            outcome?: "reported" | "failed" | "stopped"
            text?: string
          }
        | undefined
      return {
        id,
        role: "notice",
        parts: [
          {
            type: "notice",
            kind: "subagent",
            text: word?.title ?? "Sub-agent",
            ...(word?.chatId === undefined ? {} : { chatId: word.chatId }),
            outcome: word?.outcome ?? "reported",
            ...(word?.text ? { detail: word.text } : {}),
          },
        ],
        status: "done",
        createdAt: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case "dc.job": {
      // The end of a command the agent left running in the background, in the chat it began in.
      const word = entry.data as
        | {
            id?: string
            computer?: string
            command?: string
            status?: JobStatus
            exitCode?: number
            ms?: number
            output?: string
          }
        | undefined
      return {
        id,
        role: "notice",
        parts: [
          {
            type: "notice",
            kind: "command",
            text: word?.command ?? "A command",
            job: {
              id: word?.id ?? "",
              computer: word?.computer ?? "",
              status: word?.status ?? "done",
              ...(word?.exitCode === undefined ? {} : { exitCode: word.exitCode }),
              ms: word?.ms ?? 0,
            },
            ...(word?.output ? { detail: word.output } : {}),
          },
        ],
        status: "done",
        createdAt: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case "dc.agent": {
      // Another agent's reply to a message, in the chat the message was sent from.
      const word = entry.data as
        | {
            agentId?: string
            name?: string
            chatId?: string
            outcome?: "reported" | "failed" | "stopped"
            text?: string
          }
        | undefined
      return {
        id,
        role: "notice",
        parts: [
          {
            type: "notice",
            kind: "agent",
            text: word?.name ?? "Another Dood",
            ...(word?.agentId === undefined ? {} : { agentId: word.agentId }),
            ...(word?.chatId === undefined ? {} : { chatId: word.chatId }),
            outcome: word?.outcome ?? "reported",
            ...(word?.text ? { detail: word.text } : {}),
          },
        ],
        status: "done",
        createdAt: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case "dc.computer-access": {
      // The answer to the agent's asking to use a computer, in the chat it asked from.
      const answer = entry.data as { name?: string; approved?: boolean; by?: string } | undefined
      return {
        id,
        role: "notice",
        parts: [
          {
            type: "notice",
            kind: "computer",
            text: answer?.name ?? "a computer",
            approved: answer?.approved === true,
            ...(answer?.by ? { by: answer.by } : {}),
          },
        ],
        status: "done",
        createdAt: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case "dc.secret": {
      // The answer to the agent's asking for secrets, in the chat it asked from. Names only.
      const answer = entry.data as
        { where?: string; to?: string; names?: string[]; saved?: boolean; by?: string } | undefined
      const token = answer?.to === "connector"
      // A login is kept by the workspace, which is nowhere a person needs telling of.
      const login = answer?.to === "login"
      return {
        id,
        role: "notice",
        parts: [
          {
            type: "notice",
            kind: "secret",
            text: login
              ? ""
              : token
                ? `the connector ${answer?.where ?? ""}`.trim()
                : (answer?.where ?? ""),
            approved: answer?.saved === true,
            ...(answer?.by ? { by: answer.by } : {}),
            detail: login
              ? `a login for ${answer?.where ?? "a site"}`
              : token
                ? "its access token"
                : Array.isArray(answer?.names)
                  ? answer.names.join(", ")
                  : "the secrets",
          },
        ],
        status: "done",
        createdAt: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case "dc.connector": {
      // How a sign-in to a connector the agent asked for went, in the chat it asked from.
      const word = entry.data as
        { name?: string; connected?: boolean; by?: string; problem?: string } | undefined
      return {
        id,
        role: "notice",
        parts: [
          {
            type: "notice",
            kind: "connector",
            text: word?.name ?? "a connector",
            approved: word?.connected === true,
            ...(word?.by ? { by: word.by } : {}),
            ...(word?.problem ? { detail: word.problem } : {}),
          },
        ],
        status: "done",
        createdAt: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    default:
      return undefined
  }
}

/** Transcript entries, oldest first, as messages, with each tool call joined to its result. */
function projectEntries(entries: readonly EntryRecord[]) {
  const messages: ChatMessage[] = []
  const tools = new Map<string, ToolPart>()
  const register = (message: ChatMessage) => {
    for (const part of message.parts) if (part.type === "tool") tools.set(part.toolCallId, part)
  }
  let lastEntryId = "0"
  for (const entry of entries) {
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
  return { messages, tools, register, lastEntryId }
}

/**
 * Entries from a chat's past, oldest first, as messages. Nothing in the past is still running, so
 * a tool call with no result was interrupted.
 */
export function projectPast(entries: readonly EntryRecord[]): ChatMessage[] {
  const { messages, tools } = projectEntries(entries)
  for (const part of tools.values()) {
    if (part.status !== "pending") continue
    part.status = "error"
    part.output ??= "Interrupted before it finished."
  }
  return messages
}

/** The words of an entry that a person wrote or read, for searching. Undefined for the rest. */
export function entryText(
  entry: EntryRecord,
): { role: "user" | "assistant"; text: string; at: number | undefined } | undefined {
  const first = entry.model?.[0]
  switch (entry.kind) {
    case "pi.user":
      return first?.role === "user"
        ? { role: "user", text: contentText(first.content), at: first.timestamp }
        : undefined
    case "pi.assistant": {
      if (first?.role !== "assistant") return undefined
      const text = first.content
        .flatMap((block) =>
          block.type === "text"
            ? [block.text]
            : block.type === "toolCall"
              ? [progressText(block) ?? ""]
              : [],
        )
        .filter((said) => said !== "")
        .join("\n")
      return { role: "assistant", text, at: first.timestamp }
    }
    case CALL_ENTRY: {
      // What came of a call and what was said on it are found like anything else in the chat.
      const call = entry.data as Partial<CallEntry> | undefined
      return {
        role: "assistant",
        text: [
          ...(Array.isArray(call?.summary) ? call.summary : []),
          ...(Array.isArray(call?.lines) ? call.lines.map((line) => line.text) : []),
        ].join("\n"),
        at: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case "dc.scheduled": {
      const report = entry.data as { title?: string; text?: string } | undefined
      return {
        role: "assistant",
        text: [report?.title, report?.text].filter(Boolean).join("\n"),
        at: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case "dc.subagent": {
      const word = entry.data as { title?: string; text?: string } | undefined
      return {
        role: "assistant",
        text: [word?.title, word?.text].filter(Boolean).join("\n"),
        at: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case "dc.job": {
      const word = entry.data as { command?: string; output?: string } | undefined
      return {
        role: "assistant",
        text: [word?.command, word?.output].filter(Boolean).join("\n"),
        at: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case "dc.agent": {
      const word = entry.data as { name?: string; text?: string } | undefined
      return {
        role: "assistant",
        text: [word?.name, word?.text].filter(Boolean).join("\n"),
        at: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case "dc.computer-access": {
      const answer = entry.data as { name?: string; approved?: boolean; by?: string } | undefined
      return {
        role: "assistant",
        text: `${answer?.by ?? "Someone"} ${answer?.approved === true ? "let the Dood use" : "did not let the Dood use"} the computer ${answer?.name ?? ""}`.trim(),
        at: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case "dc.secret": {
      const answer = entry.data as
        { where?: string; names?: string[]; saved?: boolean; by?: string } | undefined
      return {
        role: "assistant",
        text: `${answer?.by ?? "Someone"} ${answer?.saved === true ? "gave" : "did not give"} the secrets ${(answer?.names ?? []).join(", ")} ${answer?.where ?? ""}`.trim(),
        at: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case "dc.connector": {
      const word = entry.data as { name?: string; connected?: boolean; by?: string } | undefined
      return {
        role: "assistant",
        text: `${word?.by ?? "Someone"} ${word?.connected === true ? "signed in to" : "did not sign in to"} the connector ${word?.name ?? ""}`.trim(),
        at: first?.role === "user" ? first.timestamp : undefined,
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

  // A side chat carries the messages of the chat it branched off. They are in front of the
  // agent, and are that chat's to show.
  const carried = view.conversation.parent?.at
  const entries =
    carried === undefined
      ? view.entries
      : view.entries.filter((entry) => Number(entry.id) > Number(carried))
  const { messages, tools, register, lastEntryId } = projectEntries(entries)

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
    const content = item.content as UserContent
    // What the server tells the agent to set it going again, when a command ends or a
    // sub-agent reports, was written by nobody: it waits its turn without being shown.
    if (typeof content !== "string" && content.every((b) => b.type === "text" && isMeta(b.text)))
      continue
    queued.push({ id: String(item.id), mode: item.mode, text: contentText(content) })
  }

  const usage: ChatUsage = { inputTokens: 0, outputTokens: 0, cost: 0 }
  for (const entry of Object.values(usageDoc?.models ?? {})) addUsage(usage, entry as Usage)
  for (const entry of Object.values(usageDoc?.tools ?? {})) addUsage(usage, entry as Usage)

  return { messages, busy, queued, usage }
}

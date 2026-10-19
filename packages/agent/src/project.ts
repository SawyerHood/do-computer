import {
  callLength,
  CUT_OFF_TEXT,
  type ChatMessage,
  type ChatState,
  type ChatUsage,
  isSentFile,
  isVisual,
  type JobStatus,
  type Json,
  type LibraryFile,
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
import {
  APPROVAL_ENTRY,
  ASKED_ENTRY,
  AUTOMATION_ENTRY,
  BUS_ENTRY,
  BUS_EXTENSIONS,
  type BusMark,
  endsRun,
  EVENT_ENTRIES,
  saysDone,
  SEND_TOOL,
  SLACK_NOTE_ENTRY,
} from "./bus.ts"
import { CALL_ENTRY, type CallEntry, callOf } from "./calls.ts"
import { CUT_OFF_ENTRY, type CutOffEntry } from "./limits.ts"
import { agentSenderOf, type Caller, senderOf, type SlackSender, slackSenderOf } from "./caller.ts"

type UserContent = UserMessage["content"]

/** A text block the server adds for the model, such as the send time; never shown. */
const isMeta = (text: string) => text.startsWith("<meta ")

/**
 * The call a message was said out loud on, and the id its device sent it under, from the note
 * that travelled with it. Undefined for a message that was not said on a call.
 */
function contentSpoken(content: UserContent): { call: string; request: string } | undefined {
  if (typeof content === "string") return undefined
  for (const block of content) {
    if (block.type !== "text" || !isMeta(block.text)) continue
    const call = callOf(block.text)
    if (call !== undefined) return call
  }
  return undefined
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

/**
 * The parts of an answer. In a chat with the bus on, a progress call is kept as the call it is,
 * for the bus to show as something said (`busMessages`).
 */
function assistantParts(message: AssistantMessage, bus = false): MessagePart[] {
  const parts: MessagePart[] = []
  for (const block of message.content) {
    if (block.type === "text") {
      if (block.text !== "") parts.push({ type: "text", text: block.text })
    } else if (block.type === "thinking") {
      // Redacted thinking carries only an opaque payload for the provider; there is nothing to show.
      if (!block.redacted && block.thinking !== "") {
        parts.push({ type: "thinking", text: block.thinking })
      }
    } else if (!bus && progressText(block) !== undefined) {
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

function assistantMessage(
  id: string,
  message: AssistantMessage,
  live: boolean,
  bus = false,
): ChatMessage {
  const result: ChatMessage = {
    id,
    role: "assistant",
    parts: assistantParts(message, bus),
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
  // A finished answer, or a round of sends whose every result is in and asked to end the run
  // (`endsRun`): the run ended with that round.
  let answered = -1
  let ending: Set<string> | undefined
  for (const [index, entry] of entries.entries()) {
    const message = entry.model?.[0]
    if (entry.kind === "pi.assistant" && message?.role === "assistant") {
      ending = undefined
      const calls = message.content.flatMap((b) => (b.type === "toolCall" ? [b] : []))
      if (message.stopReason === "stop" && calls.length === 0) {
        answered = index
      } else if (calls.length > 0 && calls.every((call) => call.name === SEND_TOOL)) {
        ending = new Set(calls.map((call) => call.id))
      }
    } else if (entry.kind === "pi.tool-result" && message?.role === "toolResult" && ending) {
      if (!endsRun(message)) ending = undefined
      else {
        ending.delete(message.toolCallId)
        if (ending.size === 0) {
          answered = index
          ending = undefined
        }
      }
    }
  }
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

function entryMessage(entry: EntryRecord, bus = false): ChatMessage | undefined {
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
      const spoken = contentSpoken(first.content)
      return {
        id,
        role: "user",
        parts,
        status: "done",
        createdAt: first.timestamp,
        ...(author === undefined ? {} : { author }),
        ...(agent === undefined ? {} : { agent }),
        ...(slack === undefined ? {} : { slack: { id: slack.id, name: slack.name } }),
        ...(spoken === undefined ? {} : { spoken }),
      }
    }
    case "pi.assistant": {
      if (first?.role !== "assistant") return undefined
      const message = assistantMessage(id, first, false, bus)
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
              ...(typeof call?.chatId === "string" ? { chatId: call.chatId } : {}),
              ...(typeof call?.by === "string" ? { by: call.by } : {}),
            },
          },
        ],
        status: "done",
        createdAt: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case CUT_OFF_ENTRY: {
      // A run ended because its request kept being cut off before it could be sent. It is
      // shown, and read by whatever waits on the chat (a sub-agent's report, an answer to
      // another agent), as a reply that failed.
      const at = (entry.data as Partial<CutOffEntry> | null | undefined)?.at
      return {
        id,
        role: "assistant",
        parts: [],
        status: "error",
        error: CUT_OFF_TEXT,
        ...(typeof at === "number" ? { createdAt: at } : {}),
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
      const answer = entry.data as
        { name?: string; approved?: boolean; by?: string; late?: string } | undefined
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
            // Told to the main chat, where the sub-agent that asked had stopped.
            ...(answer?.late
              ? { detail: `asked for by the sub-agent ${answer.late}, which had stopped` }
              : {}),
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
    case APPROVAL_ENTRY: {
      // Someone's answer to what the agent asked leave for, where it was told as an event.
      const answer = entry.data as { title?: string; approved?: boolean; by?: string } | undefined
      return {
        id,
        role: "notice",
        parts: [
          {
            type: "notice",
            kind: "approval",
            text: answer?.title ?? "",
            approved: answer?.approved === true,
            ...(answer?.by ? { by: answer.by } : {}),
          },
        ],
        status: "done",
        createdAt: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case AUTOMATION_ENTRY: {
      // What a run of an automation came to, told to the main chat as an event.
      const word = entry.data as
        | {
            title?: string
            runChatId?: string
            outcome?: "reported" | "failed"
            text?: string
          }
        | undefined
      return {
        id,
        role: "notice",
        parts: [
          {
            type: "notice",
            kind: "automation",
            text: word?.title ?? "An automation",
            ...(word?.runChatId === undefined ? {} : { chatId: word.runChatId }),
            outcome: word?.outcome ?? "reported",
            ...(word?.text ? { detail: word.text } : {}),
          },
        ],
        status: "done",
        createdAt: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case ASKED_ENTRY: {
      // A sub-agent asking a person for something through the main chat.
      const word = entry.data as { chatId?: string; title?: string; what?: string } | undefined
      return {
        id,
        role: "notice",
        parts: [
          {
            type: "notice",
            kind: "asked",
            text: word?.title ?? "A sub-agent",
            ...(word?.chatId === undefined ? {} : { chatId: word.chatId }),
            ...(word?.what ? { detail: word.what } : {}),
          },
        ],
        status: "done",
        createdAt: first?.role === "user" ? first.timestamp : undefined,
      }
    }
    case SLACK_NOTE_ENTRY: {
      // Something a thread in Slack told the main chat.
      const word = entry.data as
        { chatId?: string; where?: string; title?: string; text?: string } | undefined
      return {
        id,
        role: "notice",
        parts: [
          {
            type: "notice",
            kind: "slack",
            text: word?.where ?? "Slack",
            ...(word?.chatId === undefined ? {} : { chatId: word.chatId }),
            ...(word?.text ? { detail: word.text } : {}),
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

/**
 * Transcript entries, oldest first, as messages, with each tool call joined to its result. `bus`
 * is whether the bus was on before the first of them; the marks among them switch it. The
 * messages made while it was on are in `inBus`, for `busMessages`.
 */
function projectEntries(entries: readonly EntryRecord[], bus = false) {
  const messages: ChatMessage[] = []
  const inBus = new Set<ChatMessage>()
  const tools = new Map<string, ToolPart>()
  const register = (message: ChatMessage) => {
    for (const part of message.parts) if (part.type === "tool") tools.set(part.toolCallId, part)
  }
  let lastEntryId = "0"
  for (const entry of entries) {
    lastEntryId = String(entry.id)
    if (entry.kind === BUS_ENTRY) {
      bus = (entry.data as BusMark | undefined)?.on === true
      continue
    }
    if (entry.kind === "pi.tool-result") {
      const result = entry.model?.[0] as ToolResultMessage | undefined
      const part = result === undefined ? undefined : tools.get(result.toolCallId)
      if (result === undefined || part === undefined) continue
      part.status = result.isError ? "error" : "done"
      part.output = contentText(result.content)
      if (result.details !== undefined) part.details = result.details as Json
      continue
    }
    const message = entryMessage(entry, bus)
    if (message === undefined) continue
    register(message)
    messages.push(message)
    if (bus) inBus.add(message)
  }
  return { messages, inBus, tools, register, lastEntryId, bus }
}

/** Whether the bus was on before the first of these entries, where nothing earlier says. */
function busBefore(entries: readonly EntryRecord[], agent: unknown): boolean {
  const mark = entries.find((entry) => entry.kind === BUS_ENTRY)
  // The first mark switched it from what it was.
  if (mark !== undefined) return (mark.data as BusMark | undefined)?.on !== true
  // None is left in the context: it is as the chat is set up now.
  const extensions = (agent as { extensions?: unknown } | undefined)?.extensions
  const named = Array.isArray(extensions)
    ? extensions
    : ((extensions as { add?: unknown } | undefined)?.add ?? [])
  return Array.isArray(named) && named.some((name) => BUS_EXTENSIONS.has(String(name)))
}

/** A call to `send`, as the message it says, with the files it sent as sent files are shown. */
function sentMessage(part: ToolPart, from: ChatMessage): ChatMessage {
  const text = (part.args as { text?: unknown } | null)?.text
  const files = (part.details as { files?: LibraryFile[] } | null | undefined)?.files ?? []
  // The last word for now: as its result says once that is in, and its arguments until then.
  const done =
    part.status === "done"
      ? (part.details as { done?: unknown } | null | undefined)?.done === true
      : part.status !== "error" && saysDone(part.args)
  return {
    id: `send:${part.toolCallId}`,
    role: "assistant",
    parts: [
      ...(typeof text === "string" && text !== "" ? [{ type: "text" as const, text }] : []),
      ...files.map((file, index): ToolPart => ({
        type: "tool",
        toolCallId: `${part.toolCallId}:file${index}`,
        name: "send_file",
        args: { path: file.path },
        status: "done",
        details: file as unknown as Json,
      })),
    ],
    status: from.status === "streaming" ? "streaming" : "done",
    ...(from.createdAt === undefined ? {} : { createdAt: from.createdAt }),
    ...(from.model === undefined ? {} : { model: from.model }),
    ...(part.status === "error" ? {} : { sent: part.status === "done" ? "sent" : "sending" }),
    ...(done ? { done: true } : {}),
  }
}

/**
 * The messages of a chat with the bus on, as people are shown them: what they said, each thing
 * the agent said to them (with a call to `send`, or to `progress` while it works, or by putting
 * a file or a page in front of them), and everything else a chat draws as it draws it in any
 * chat: the events it was told of, a sub-agent it started, a screen it used, a call. What is left
 * out is its own words: the text it writes outside `send` is kept, as thinking is, in a
 * `thinking` part marked `written`, which no client draws, so that what it is doing can still
 * be told (`chatActivity`). Its ordinary steps stay in their message, which a client does not
 * draw either. Messages from before the bus was on are as they were.
 *
 * An answer is cut where it says something: what comes before keeps its id, and what comes
 * after each thing said is named for that, so that ids stay put as it grows.
 */
function busMessages(
  messages: readonly ChatMessage[],
  inBus: ReadonlySet<ChatMessage>,
): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const message of messages) {
    if (!inBus.has(message) || message.role !== "assistant") {
      out.push(message)
      continue
    }
    let rest: MessagePart[] = []
    // What comes before the first thing said is named for that, and what comes after each
    // thing said for it, so that a piece keeps its id from live to stored. Only an answer with
    // nothing said in it keeps its own id, which a live one gives up for the stored one's.
    let id: string | undefined
    const piece = (
      parts: MessagePart[],
      status: ChatMessage["status"],
      named: string,
    ): ChatMessage => {
      const { error: _error, ...others } = message
      return status === "error"
        ? { ...message, id: named, parts, status }
        : { ...others, id: named, parts, status }
    }
    const said = (shown: ChatMessage) => {
      if (rest.length > 0) {
        const status = message.status === "streaming" ? "streaming" : "done"
        out.push(piece(rest, status, id ?? `before:${shown.id}`))
      }
      rest = []
      out.push(shown)
      id = `after:${shown.id}`
    }
    const stamp = {
      ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt }),
      ...(message.model === undefined ? {} : { model: message.model }),
    }
    for (const part of message.parts) {
      if (part.type === "text") {
        // Its own words, which nobody is shown.
        rest.push({ type: "thinking", text: part.text, written: true })
      } else if (part.type === "tool" && part.name === SEND_TOOL && part.status === "error") {
        // Its words may have been on screen as they were written. They stay, marked as not
        // sent, and say why: they do not just go. One with no words had none on screen, and
        // is a step like any other.
        const failed = sentMessage(part, message)
        if (failed.parts.length > 0) said({ ...failed, notSent: notSentWhy(part.output) })
        else rest.push(part)
      } else if (part.type === "tool" && part.name === SEND_TOOL) {
        const sent = sentMessage(part, message)
        // Nothing of it to show yet, while its words are on their way.
        if (sent.parts.length > 0) said(sent)
        else rest.push(part)
      } else if (part.type === "tool" && part.name === PROGRESS_TOOL) {
        const words = (part.args as { message?: unknown } | null)?.message
        const text = typeof words === "string" ? words : ""
        if (text === "") continue
        said({
          id: `said:${part.toolCallId}`,
          role: "assistant",
          parts: [{ type: "text", text }],
          status: message.status === "streaming" ? "streaming" : "done",
          ...stamp,
        })
      } else if (isSentFile(part) || isVisual(part)) {
        said({
          id: `shown:${part.toolCallId}`,
          role: "assistant",
          parts: [part],
          status: "done",
          ...stamp,
        })
      } else {
        rest.push(part)
      }
    }
    // The last piece has the answer's status: a reply that failed or was stopped says so, as it
    // always has, even with nothing else left in it.
    const ended = message.status === "error" || message.status === "aborted"
    if (rest.length > 0 || ended || id === undefined) {
      out.push(piece(rest, message.status, id ?? message.id))
    }
  }
  return out
}

/** Why a send was not sent, from what it answered. */
function notSentWhy(output: string | undefined): string {
  const said = (output ?? "")
    .replace(/<\/?harness>/g, "")
    .replace(/^\s*\[error\]\s*/m, "")
    .replace(/^\s*Nothing was sent:\s*/, "")
    .trim()
  return said === "" ? "It could not be sent." : said
}

/**
 * Entries from a chat's past, oldest first, as messages. Nothing in the past is still running, so
 * a tool call with no result was interrupted. `bus` is whether the bus was on before the first.
 */
export function projectPast(entries: readonly EntryRecord[], bus = false): ChatMessage[] {
  const { messages, inBus, tools } = projectEntries(entries, bus)
  for (const part of tools.values()) {
    if (part.status !== "pending") continue
    part.status = "error"
    part.output ??= "Interrupted before it finished."
  }
  return inBus.size === 0 ? messages : busMessages(messages, inBus)
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
    case AUTOMATION_ENTRY:
    case SLACK_NOTE_ENTRY:
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
  const { messages, inBus, tools, register, lastEntryId, bus } = projectEntries(
    entries,
    // A side chat starts where it branched off, and the bus is never on in one.
    carried === undefined && busBefore(entries, view.docs["pi.agent"]),
  )

  const partial = live?.generation?.message
  if (partial !== undefined) {
    const message = assistantMessage(`live:${lastEntryId}`, partial as AssistantMessage, true, bus)
    if (message.parts.length > 0) {
      register(message)
      messages.push(message)
      if (bus) inBus.add(message)
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
    // Nor are the events the bus is told of, which are known by their kind.
    const kind = (item as { entry?: { kind?: unknown } }).entry?.kind
    if (typeof kind === "string" && EVENT_ENTRIES.has(kind)) continue
    queued.push({ id: String(item.id), mode: item.mode, text: contentText(content) })
  }

  const usage: ChatUsage = { inputTokens: 0, outputTokens: 0, cost: 0 }
  for (const entry of Object.values(usageDoc?.models ?? {})) addUsage(usage, entry as Usage)
  for (const entry of Object.values(usageDoc?.tools ?? {})) addUsage(usage, entry as Usage)

  return {
    messages: inBus.size === 0 ? messages : busMessages(messages, inBus),
    busy,
    queued,
    usage,
  }
}

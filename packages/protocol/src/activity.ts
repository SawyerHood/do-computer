import type { LibraryFile } from "./agent.ts"
import type { ChatMessage, ChatState, MessagePart, ToolPart } from "./chat.ts"

const MAX_DETAIL = 72

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined

/** One line, short enough to sit beside a spinner. */
function clip(value: string): string {
  const line = value.split("\n")[0]!.trim()
  return line.length > MAX_DETAIL ? `${line.slice(0, MAX_DETAIL - 1).trimEnd()}…` : line
}

const fileName = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path

/**
 * What a tool call is doing, in the present tense and in the user's terms: "Running: git status",
 * "Searching the web: node lts", "Reading notes.txt". Arguments may still be arriving, so every
 * detail is optional and the line degrades to the bare activity.
 */
export function toolActivity(part: Pick<ToolPart, "name" | "args">): string {
  const args = (typeof part.args === "object" && part.args !== null ? part.args : {}) as Record<
    string,
    unknown
  >
  const where = text(args.computer)
  const on = where === undefined ? "" : ` on ${where}`
  const withDetail = (activity: string, detail: string | undefined) =>
    detail === undefined ? activity : `${activity}: ${clip(detail)}`
  const path = text(args.path)

  switch (part.name) {
    case "bash": {
      const command = text(args.command)
      const how = args.run_in_background === true ? "Starting in the background" : "Running"
      return command === undefined
        ? `${how === "Running" ? "Running a command" : "Starting a command in the background"}${on}`
        : `${how}${on}: ${clip(command)}`
    }
    case "background": {
      const id = text(args.id)
      if (args.action === "stop") return `Stopping ${id ?? "a background command"}`
      if (args.action === "output") return `Reading what ${id ?? "a background command"} printed`
      return "Checking its background commands"
    }
    case "read":
      return path === undefined ? `Reading a file${on}` : `Reading ${fileName(path)}${on}`
    case "write":
      return path === undefined ? `Writing a file${on}` : `Writing ${fileName(path)}${on}`
    case "edit":
      return path === undefined ? `Editing a file${on}` : `Editing ${fileName(path)}${on}`
    case "web_search":
      return withDetail("Searching the web", text(args.query))
    case "send_file":
      return path === undefined ? "Sending you a file" : `Sending you ${fileName(path)}`
    case "schedule":
      if (args.action === "create")
        return withDetail("Scheduling", text(args.title) ?? text(args.prompt))
      return args.action === "list" ? "Checking its schedule" : "Updating its schedule"
    case "skill": {
      const name = text(args.name)
      if (args.action === "view")
        return name === undefined ? "Reading a skill" : `Reading its ${name} skill`
      if (args.action === "list") return "Looking through its skills"
      if (args.action === "install") return "Installing a skill"
      if (args.action === "delete") return "Removing a skill"
      return name === undefined ? "Saving a skill" : `Saving its ${name} skill`
    }
    case "subagent": {
      if (args.action === "start")
        return withDetail("Starting a sub-agent", text(args.title) ?? text(args.task))
      if (args.action === "message") return "Sending more to a sub-agent"
      return args.action === "stop" ? "Stopping a sub-agent" : "Checking on its sub-agents"
    }
    case "memory":
      return "Updating its memory"
    case "log":
      return "Noting what it did"
    case "set_identity":
      return "Updating its identity"
    case "history":
      return args.action === "read"
        ? "Reading an earlier chat"
        : withDetail("Searching earlier chats", text(args.query))
    case "library":
      return args.action === "get"
        ? withDetail("Getting a file from your library", text(args.file))
        : "Looking in your library"
    case "computers": {
      const name = text(args.name)
      if (args.action === "add") return withDetail("Adding a machine", name)
      if (args.action === "remove") return withDetail("Removing a machine", name)
      if (args.action === "request") return withDetail("Asking to use a computer", name)
      return "Looking at the computers"
    }
    case "connectors": {
      const name = text(args.name)
      if (args.action === "add") return withDetail("Adding a connector", name)
      if (args.action === "remove") return withDetail("Removing a connector", name)
      if (args.action === "list") return "Looking at its connectors"
      return withDetail("Updating a connector", name)
    }
    case "request_secret":
      return "Asking you for a secret"
    case "settings":
      return args.action === "set" ? "Updating its settings" : "Checking its settings"
    case "agents":
      if (args.action === "create") return withDetail("Making a new agent", text(args.name))
      if (args.action === "message") {
        const to = text(args.to)
        return to === undefined ? "Writing to another agent" : `Writing to ${clip(to)}`
      }
      return "Looking at the other agents"
    default: {
      // A connector's tool is named `<connector>__<tool>`.
      const [connector, tool] = part.name.split("__")
      const words = (value: string) => value.replaceAll(/[_-]+/g, " ").trim()
      return tool === undefined || connector === ""
        ? `Using ${words(part.name)}`
        : `Using ${words(connector!)}: ${words(tool)}`
    }
  }
}

/** How each activity reads once it is over. */
const PAST: Record<string, string> = {
  Running: "Ran",
  Reading: "Read",
  Writing: "Wrote",
  Editing: "Edited",
  Searching: "Searched",
  Sending: "Sent",
  Scheduling: "Scheduled",
  Checking: "Checked",
  Updating: "Updated",
  Looking: "Looked",
  Installing: "Installed",
  Removing: "Removed",
  Saving: "Saved",
  Getting: "Got",
  Using: "Used",
  Noting: "Noted",
  Starting: "Started",
  Stopping: "Stopped",
  Adding: "Added",
  Asking: "Asked",
  Making: "Made",
}

/**
 * What a tool call did, for a list of things done: `toolActivity` in the past tense. "Ran: git
 * status", "Read notes.txt", "Searched the web: node lts".
 */
export function toolSummary(part: Pick<ToolPart, "name" | "args">): string {
  const doing = toolActivity(part)
  const verb = doing.slice(0, doing.search(/[ :]|$/))
  const done = PAST[verb]
  return done === undefined ? doing : done + doing.slice(verb.length)
}

/**
 * What the agent is doing right now, as one line, or null when there is nothing to say: it is
 * idle, or its answer is being written on screen, which says so itself.
 */
export function chatActivity(state: ChatState): string | null {
  if (!state.busy) return null
  const last = state.messages.at(-1)
  if (last === undefined || last.role !== "assistant") return "Thinking"
  const active = last.parts.findLast(
    (part): part is ToolPart =>
      part.type === "tool" && (part.status === "pending" || part.status === "running"),
  )
  if (active !== undefined) return toolActivity(active)
  const tail = last.parts.at(-1)
  if (tail === undefined || tail.type === "thinking") return "Thinking"
  if (tail.type === "text" && last.status === "streaming") return null
  // Between steps: a tool has finished and the model has not said what it does next.
  return tail.type === "tool" ? "Working" : "Thinking"
}

/** The kinds of work an agent's creature is shown doing, each with a look of its own. */
export type WorkKind = "command" | "file" | "search" | "memory"

/** What the agent is doing, as its creature shows it. */
export type Mood = {
  state: "idle" | "thinking" | "working" | "speaking" | "error"
  /** For `working`: what kind of work. */
  variant?: WorkKind
}

/** Which kind of work a tool is: at a shell, among files, looking something up, or remembering. */
export function toolKind(name: string): WorkKind {
  switch (name) {
    case "bash":
      return "command"
    case "read":
    case "write":
    case "edit":
    case "send_file":
    case "library":
    case "skill":
      return "file"
    case "web_search":
    case "history":
      return "search"
    case "memory":
    case "set_identity":
    case "schedule":
    case "log":
    case "settings":
      return "memory"
    default:
      // A connector's tool, named `<connector>__<tool>`, reaches out to another service.
      return name.includes("__") ? "search" : "command"
  }
}

/**
 * What the agent is doing right now, for its creature to act out. The same reading of a chat as
 * `chatActivity`, which puts it in words.
 */
export function chatMood(state: ChatState): Mood {
  const last = state.messages.at(-1)
  if (!state.busy) {
    return { state: last?.role === "assistant" && last.status === "error" ? "error" : "idle" }
  }
  if (last === undefined || last.role !== "assistant") return { state: "thinking" }
  const active = last.parts.findLast(
    (part): part is ToolPart =>
      part.type === "tool" && (part.status === "pending" || part.status === "running"),
  )
  if (active !== undefined) return { state: "working", variant: toolKind(active.name) }
  const tail = last.parts.at(-1)
  if (tail === undefined || tail.type === "thinking") return { state: "thinking" }
  if (tail.type === "text" && last.status === "streaming") return { state: "speaking" }
  // Between steps it is still at the work it just did.
  return tail.type === "tool"
    ? { state: "working", variant: toolKind(tail.name) }
    : { state: "thinking" }
}

/**
 * Whether a part is a file the agent delivered. Tool calls are not shown in a transcript: what
 * the agent is doing is one line while it does it. A delivered file is the exception, because it
 * is the answer and not the work.
 */
export function isSentFile(part: MessagePart): part is ToolPart {
  return (
    part.type === "tool" &&
    part.name === "send_file" &&
    part.status === "done" &&
    part.details !== undefined &&
    part.details !== null
  )
}

/**
 * The files the agent delivered in a chat, newest first. One sent more than once is listed once,
 * where it was last sent and as it then was.
 */
export function sentFiles(state: ChatState): LibraryFile[] {
  const files = new Map<string, LibraryFile>()
  for (const message of state.messages) {
    for (const part of message.parts) {
      if (!isSentFile(part)) continue
      const file = part.details as unknown as LibraryFile
      // Taken out first, so that it goes back in at the end.
      files.delete(file.id)
      files.set(file.id, file)
    }
  }
  return [...files.values()].reverse()
}

/**
 * Whether a part is the agent starting a sub-agent. That is shown too, as a way into the
 * sub-agent's own chat.
 */
export function isSubagentStart(part: MessagePart): part is ToolPart {
  return (
    part.type === "tool" &&
    part.name === "subagent" &&
    part.status === "done" &&
    (part.args as { action?: unknown } | null)?.action === "start" &&
    typeof (part.details as { chatId?: unknown } | null | undefined)?.chatId === "string"
  )
}

/**
 * Whether a part is the agent sending a message to another agent. That is shown too, as a way
 * into the conversation the two of them are having.
 */
export function isAgentMessage(part: MessagePart): part is ToolPart {
  if (part.type !== "tool" || part.name !== "agents" || part.status !== "done") return false
  if ((part.args as { action?: unknown } | null)?.action !== "message") return false
  const details = part.details as { agentId?: unknown; chatId?: unknown } | null | undefined
  return typeof details?.agentId === "string" && typeof details.chatId === "string"
}

/** Whether a part of a message is shown in a transcript. Thinking and tool calls are not. */
export function isShownPart(part: MessagePart): boolean {
  return (
    (part.type === "text" && part.text !== "") ||
    part.type === "image" ||
    part.type === "notice" ||
    isSentFile(part) ||
    isSubagentStart(part) ||
    isAgentMessage(part)
  )
}

/** Whether a message has anything to show, so that one made only of tool calls leaves no gap. */
export function isVisibleMessage(message: ChatMessage): boolean {
  return (
    message.role !== "assistant" ||
    message.status === "error" ||
    message.status === "aborted" ||
    message.parts.some(isShownPart)
  )
}

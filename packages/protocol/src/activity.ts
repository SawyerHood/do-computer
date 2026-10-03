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
      return command === undefined ? `Running a command${on}` : `Running${on}: ${clip(command)}`
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
    case "memory":
      return "Updating its memory"
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

/** Whether a part of a message is shown in a transcript. Thinking and tool calls are not. */
export function isShownPart(part: MessagePart): boolean {
  return (
    (part.type === "text" && part.text !== "") ||
    part.type === "image" ||
    part.type === "notice" ||
    isSentFile(part)
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

import type { LibraryFile } from "./agent.ts"
import type { ChatMessage, ChatState, MessagePart, ToolPart } from "./chat.ts"
import type { ShotPoint, UseDetails, UseWhat } from "./screen.ts"
import { type Pin, PIN_TOOL } from "./pins.ts"
import { SHARE_TOOL, type SiteSummary } from "./sites.ts"
import { isMcpApp } from "./mcp-app.ts"
import { VISUAL_TOOL } from "./visual.ts"

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
    case "tool_search":
      return withDetail("Looking for a tool", text(args.query))
    case "sign_in":
      return withDetail(`Signing in${on}`, text(args.login))
    case "pay":
      return withDetail(`Paying${on}`, text(args.purpose))
    case "send_file":
      return path === undefined ? "Sending you a file" : `Sending you ${fileName(path)}`
    case "visual":
      return withDetail("Drawing", text(args.title))
    // What `look` was called while a page to be drawn was all it looked at.
    case "visual_preview":
      return "Looking over a page before showing it"
    case "look": {
      // A file of the library, or a page it is about to draw.
      const file = text(args.file)
      if (file !== undefined) return `Looking at ${fileName(file)}`
      return text(args.html) === undefined
        ? "Looking at something"
        : "Looking over a page before showing it"
    }
    case "share": {
      const what = text(args.site) ?? text(args.title) ?? text(args.path)
      if (args.action === "publish") return withDetail("Sharing a site", what)
      if (args.action === "public") return withDetail("Making a site public", what)
      if (args.action === "private") return withDetail("Making a site private", what)
      if (args.action === "stop") return withDetail("Stopping a site being shared", what)
      return "Looking at the shared sites"
    }
    case "pin": {
      const what = text(args.title) ?? (path === undefined ? undefined : fileName(path))
      if (args.action === "pin") return withDetail("Pinning", what)
      if (args.action === "unpin") return withDetail("Unpinning", what)
      return "Looking at what is pinned"
    }
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
    case "screen":
      return where === undefined ? "Using a computer's screen" : `Using ${where}'s screen`
    case "browser":
      return where === undefined ? "Using a browser" : `Using a browser on ${where}`
    case "agents":
      if (args.action === "create") return withDetail("Making a new Dood", text(args.name))
      if (args.action === "message") {
        const to = text(args.to)
        return to === undefined ? "Writing to another Dood" : `Writing to ${clip(to)}`
      }
      return "Looking at the other Doods"
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
  Drawing: "Drew",
  Sharing: "Shared",
  Pinning: "Pinned",
  Unpinning: "Unpinned",
  // Whether it got in is not something the call's arguments say.
  Signing: "Asked to sign",
  Paying: "Asked to pay",
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
    case "visual":
    case "visual_preview":
    case "look":
    case "share":
    case "pin":
      return "file"
    case "web_search":
    case "tool_search":
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
      // A visual is a file of the library too, drawn where a sent file is a card.
      if (!isSentFile(part) && !isVisual(part)) continue
      const file = part.details as unknown as LibraryFile
      // Taken out first, so that it goes back in at the end.
      files.delete(file.id)
      files.set(file.id, file)
    }
  }
  return [...files.values()].reverse()
}

/**
 * Whether a part is a visual the agent drew: a page of its own making, kept in the library and
 * shown in the chat as the page itself. Its details are the file it is kept as.
 */
export function isVisual(part: MessagePart): part is ToolPart {
  if (part.type !== "tool" || part.name !== VISUAL_TOOL || part.status !== "done") return false
  const file = part.details as { id?: unknown; path?: unknown } | null | undefined
  return typeof file?.id === "string" && typeof file.path === "string"
}

/**
 * Whether a part is the agent sharing a site, or changing who can open one. That is shown too,
 * as the site: its address, and who can open it now.
 */
export function isSiteShare(part: MessagePart): part is ToolPart {
  if (part.type !== "tool" || part.name !== SHARE_TOOL || part.status !== "done") return false
  const action = (part.args as { action?: unknown } | null)?.action
  if (action !== "publish" && action !== "public" && action !== "private") return false
  const site = (part.details as { site?: { id?: unknown } } | null | undefined)?.site
  return typeof site?.id === "string"
}

/**
 * Whether a part is the agent pinning something from the library. That is shown too, as what
 * was pinned and the way to open it or take it off again.
 */
export function isPinning(part: MessagePart): part is ToolPart {
  if (part.type !== "tool" || part.name !== PIN_TOOL || part.status !== "done") return false
  if ((part.args as { action?: unknown } | null)?.action !== "pin") return false
  const details = part.details as { pin?: { fileId?: unknown }; file?: { id?: unknown } } | null
  return typeof details?.pin?.fileId === "string" && typeof details.file?.id === "string"
}

/** What a part pinned, as it was when the agent pinned it. */
export const pinned = (part: ToolPart) => part.details as unknown as { pin: Pin; file: LibraryFile }

/** The site a part is about, as it was when the agent shared it or changed it. */
export const sharedSite = (part: ToolPart) =>
  (part.details as unknown as { site: SiteSummary }).site

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

/**
 * Whether a part is the agent leaving a command to run in the background, by asking or because
 * it was still running when the wait for it ended. That is shown too, as the command: how it is
 * getting on, and what it is printing.
 */
export function isJobStart(part: MessagePart): part is ToolPart {
  return (
    part.type === "tool" &&
    part.name === "bash" &&
    part.status === "done" &&
    typeof (part.details as { job?: unknown } | null | undefined)?.job === "string"
  )
}

/** Whether a part of a message is shown in a transcript. Thinking and tool calls are not. */
export function isShownPart(part: MessagePart): boolean {
  return (
    (part.type === "text" && part.text !== "") ||
    part.type === "image" ||
    part.type === "notice" ||
    isSentFile(part) ||
    isVisual(part) ||
    isSiteShare(part) ||
    isPinning(part) ||
    isSubagentStart(part) ||
    isJobStart(part) ||
    isAgentMessage(part) ||
    isUse(part) ||
    // A tool of a connector whose server has a page for it is shown as that page.
    isMcpApp(part)
  )
}

const USE_TOOLS: readonly string[] = ["screen", "browser"] satisfies UseWhat[]

/**
 * Whether a part is the agent using a computer's screen, or a browser on it. That is shown too,
 * however it is getting on: as the screen itself while it is used, and as what was done there
 * afterwards. One that is only starting carries nothing yet, and is known by its name.
 */
export function isUse(part: MessagePart): part is ToolPart {
  if (part.type !== "tool" || !USE_TOOLS.includes(part.name)) return false
  if (useOf(part) !== undefined) return true
  return part.status === "pending" || part.status === "running"
}

/** What a `screen` or `browser` call carries about itself, once it carries anything. */
export function useOf(part: ToolPart): UseDetails["use"] | undefined {
  const use = (part.details as Partial<UseDetails> | null | undefined)?.use
  return typeof use === "object" && use !== null && typeof use.computer?.id === "string"
    ? use
    : undefined
}

/** One thing an agent did on a screen or in a browser. */
export type UseStep = {
  toolCallId: string
  status: ToolPart["status"]
  /** What it was doing, in a few words. */
  say: string
  /** The id of the picture kept of how it ended, where one was. */
  shot?: string
  width?: number
  height?: number
  pointer?: ShotPoint
  url?: string
  /** On a screen: the window it was done in, where it was in one. */
  title?: string
}

/** A stretch of an agent's turn spent on one computer's screen, or in a browser on it. */
export type Use = {
  /** The id of its first call: where in the transcript it is shown. */
  id: string
  what: UseWhat
  /** The id is absent only while its first call has said nothing of itself yet. */
  computer: { id?: string; name: string }
  steps: UseStep[]
  /** Whether the agent is still at it. */
  going: boolean
  /** Whether nothing was used after it in the chat: the one that may still be on its screen. */
  last: boolean
  startedAt?: number
  /** How long it took, where the times of the messages around it say. */
  ms?: number
}

/**
 * The screens and browsers an agent used in a chat, each stretch as one thing. A stretch is the
 * calls to one of the two tools, on one computer, within one turn. What the agent says between
 * its steps does not end a stretch, nor does work that is not shown: agents say what they are
 * about to do before each click, and a window for every click would be no window at all. It ends
 * when something else is said by anyone else, when the agent turns to the other tool or another
 * computer, or when something else of the agent's is shown: a file it sent, a command it left
 * running.
 */
export function chatUses(state: Pick<ChatState, "messages" | "busy">): Use[] {
  const uses: Use[] = []
  type Open = { use: Use; lastMessage: number; follows: boolean }
  let open: Open | undefined
  const { messages } = state
  // A stretch took from when its first message began until the next message after its last
  // step began: the model is asked again as soon as a step is done.
  const close = () => {
    if (open === undefined) return
    const after = messages[open.lastMessage + 1]?.createdAt
    const { startedAt } = open.use
    if (startedAt !== undefined && after !== undefined) open.use.ms = Math.max(0, after - startedAt)
    open = undefined
  }
  messages.forEach((message, index) => {
    if (message.role !== "assistant") return close()
    for (const part of message.parts) {
      if (part.type === "tool" && isUse(part)) {
        const use = useOf(part)
        const args = (part.args ?? {}) as { computer?: unknown; note?: unknown }
        const what = part.name as UseWhat
        const name = use?.computer.name ?? text(args.computer) ?? "a computer"
        if (open !== undefined && (open.use.what !== what || open.use.computer.name !== name))
          close()
        if (open === undefined) {
          open = {
            use: {
              id: part.toolCallId,
              what,
              computer: { name },
              steps: [],
              going: false,
              last: false,
              ...(message.createdAt === undefined ? {} : { startedAt: message.createdAt }),
            },
            lastMessage: index,
            follows: false,
          }
          uses.push(open.use)
        }
        if (use !== undefined) open.use.computer = use.computer
        open.lastMessage = index
        open.follows = false
        open.use.steps.push({
          toolCallId: part.toolCallId,
          status: part.status,
          say: use?.say ?? text(args.note) ?? toolActivity(part),
          ...(use?.shot === undefined ? {} : { shot: use.shot }),
          ...(use?.width === undefined ? {} : { width: use.width }),
          ...(use?.height === undefined ? {} : { height: use.height }),
          ...(use?.pointer === undefined ? {} : { pointer: use.pointer }),
          ...(use?.url === undefined ? {} : { url: use.url }),
          ...(use?.title === undefined || use.what !== "screen" ? {} : { title: use.title }),
        })
      } else if (part.type !== "text" && isShownPart(part)) close()
    }
  })
  // The one still open is in the turn the chat ends with, and nothing but words came after it.
  const current = open as Open | undefined
  for (const use of uses) {
    const status = use.steps.at(-1)?.status
    use.going = status === "pending" || status === "running" || (state.busy && use === current?.use)
  }
  close()
  const last = uses.at(-1)
  if (last !== undefined) last.last = true
  return uses
}

/** The screen or browser the agent is using right now in a chat, if it is using one. */
export function goingUse(state: Pick<ChatState, "messages" | "busy">): Use | undefined {
  return chatUses(state).findLast((use) => use.going)
}

/** How a use reads in a sentence: "MacBook's screen", "a browser on MacBook". */
export function useWords(use: Pick<Use, "what" | "computer">): string {
  return use.what === "screen"
    ? `${use.computer.name}'s screen`
    : `a browser on ${use.computer.name}`
}

/**
 * Whether a chat continues the main chat: a side chat that branched off it, which opens with the
 * mark of where its own messages begin.
 */
export function continuesMain(messages: readonly ChatMessage[]): boolean {
  const first = messages[0]?.parts[0]
  return first?.type === "notice" && first.kind === "branch"
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

/**
 * What a row of the agent's own working (`ChatMessage.work`) says of itself, folded: whether it
 * is still at it, and how many steps and events are in it. `last` is whether it is the last row
 * shown, `busy` whether the agent is at work in the chat. The same on every client.
 */
export function workSummary(
  message: ChatMessage,
  last: boolean,
  busy: boolean,
): { working: boolean; title: string; counts: string[] } {
  const working = message.status === "streaming" || (busy && last)
  const steps = message.parts.filter((part) => part.type === "tool").length
  const events = message.parts.filter((part) => part.type === "notice").length
  const count = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`)
  return {
    working,
    title: working ? "Working on it" : "Worked on it",
    counts: [
      ...(steps === 0 ? [] : [count(steps, "step")]),
      ...(events === 0 ? [] : [count(events, "event")]),
    ],
  }
}

/**
 * Whether a step in a row of working is drawn as it is in a chat (a screen it used, a page)
 * and not as a line saying what it did. A sub-agent it started is a line: what it reported is
 * the event beside it, which says it better.
 */
export function drawnInWork(part: MessagePart): boolean {
  return part.type === "tool" && isShownPart(part) && !isSubagentStart(part)
}

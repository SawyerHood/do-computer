import {
  type ChatMessage,
  type ChatState,
  type ChatSummary,
  continuesMain,
  type Presence,
  type SubagentStatus,
} from "@do-computer/protocol"

// What the conversation screen says of an agent's chats. These are the web app's own rules and
// words (apps/web/src/lib/chats.ts, chat/subagents.tsx, chat/agent-threads.tsx,
// chat/slack-threads.tsx, lib/sending.ts), kept the same so that both say the same of a chat.

/** The agent's main chat: the one that opens when the agent is chosen. */
export const mainChatOf = (chats: readonly ChatSummary[] | undefined): ChatSummary | undefined =>
  chats?.find((chat) => chat.main === true)

/** Whether a chat is a side chat: one someone talks in that is not the main one. */
export const isSideChat = (chat: ChatSummary | undefined): chat is ChatSummary =>
  chat !== undefined && chat.kind === "chat" && chat.main !== true

/** The agent's side chats that have not been put away, the one last used first. */
export const sideChatsOf = (chats: readonly ChatSummary[] | undefined): ChatSummary[] =>
  (chats ?? [])
    .filter((chat) => isSideChat(chat) && !chat.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)

/**
 * A chat whose transcript starts at a summary or a fresh start has more before it. One that
 * starts where it branched off the main chat does not: what came before is the main chat's.
 */
export const startsMidway = (first: ChatMessage | undefined) =>
  first?.role === "notice" && !continuesMain([first])

const MAIN_CHATS_KEY = "dc-main-chats"

/** Which chat is each agent's main one, as text to keep: it does not change once it is known. */
export function mainChatsFrom(kept: string | null): Record<string, string> {
  const known: Record<string, string> = {}
  try {
    const found: unknown = JSON.parse(kept ?? "{}")
    if (typeof found === "object" && found !== null) {
      for (const [agentId, chatId] of Object.entries(found)) {
        if (typeof chatId === "string") known[agentId] = chatId
      }
    }
  } catch {
    // It holds something else; nothing is then remembered.
  }
  return known
}
export { MAIN_CHATS_KEY }

/** The sub-agents started in one chat, oldest first. */
export const subagentsOf = (
  chats: readonly ChatSummary[] | undefined,
  parentId: string,
): ChatSummary[] =>
  (chats ?? [])
    .filter((chat) => chat.kind === "subagent" && chat.parentId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt)

/** What a sub-agent's creature grows from: it has no look of its own on record. */
export const subagentSeed = (agentId: string, chatId: string) => `${agentId}/sub/${chatId}`

const SUBAGENT_WORDS: Record<SubagentStatus, string> = {
  working: "Working",
  waiting: "Waiting for your OK",
  done: "Reported back",
  stopped: "Stopped",
  failed: "Did not finish",
}

/** How a sub-agent is getting on, in a word or two. */
export const subagentWords = (status: SubagentStatus | undefined) =>
  SUBAGENT_WORDS[status ?? "done"]

export const isAtWork = (status: SubagentStatus | undefined) =>
  status === "working" || status === "waiting"

const THREAD_WORDS: Record<SubagentStatus, string> = {
  working: "Answering",
  waiting: "Waiting for your OK",
  done: "Answered",
  stopped: "Stopped",
  failed: "Did not answer",
}

/** How a conversation the agent did not start with its person is getting on. */
export const threadWords = (status: SubagentStatus | undefined) => THREAD_WORDS[status ?? "done"]

/** Where in Slack a thread is. */
export const slackPlace = (chat: ChatSummary) =>
  chat.slack?.direct === true
    ? "Direct message"
    : chat.slack?.channel
      ? `#${chat.slack.channel}`
      : "Slack"

/** "Maya", "Maya and Jon", "Maya, Jon and Priya". */
export function names(people: readonly { name: string }[]): string {
  const list = people.map((person) => person.name.split(" ")[0] ?? person.name)
  if (list.length <= 1) return list.join("")
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`
}

/** The ids of the people for whom `matches` holds somewhere, each once, in the order they came. */
export function whoIs(here: readonly Presence[], matches: (place: Presence) => boolean): string[] {
  const ids: string[] = []
  for (const place of here) {
    if (matches(place) && !ids.includes(place.userId)) ids.push(place.userId)
  }
  return ids
}

/** How long ago a chat was last used, as shortly as it can be said: now, 5m, 3h, 2d, 6w. */
export function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`
}

/* ---------- what has been sent and is not in the chat yet ---------- */

/** A message on its way: shown as if the chat had it, until the chat does. */
export type Sending = {
  id: string
  text: string
  at: number
  /** Every message and queued input the chat had when it was sent: none of them is this one. */
  known: ReadonlySet<string>
  /** Set once the server has taken it. */
  acceptedAt?: number
}

/** How long after the server took a message the chat may take to show it before it is let go. */
export const GIVE_UP_MS = 20_000

const textOf = (message: ChatMessage) =>
  message.parts.map((part) => (part.type === "text" ? part.text : "")).join("")

const NONE: readonly string[] = []

/**
 * The chat with what the agent has not been given yet after it, as a message app shows what it
 * has not delivered: what the chat has waiting for the agent, then what is being sent. A send
 * is over once the chat shows a message of the user's, or a waiting one, that it did not have
 * before and that says the same. `undelivered` is the ids of the messages that were added.
 */
export function withSending(
  state: ChatState,
  sending: readonly Sending[],
  now: number,
): { state: ChatState; left: readonly Sending[]; undelivered: readonly string[] } {
  // What the server itself has lined up for the agent's next turn was written by nobody here.
  const waiting: ChatMessage[] = state.queued
    .filter((input) => input.mode === "steer")
    .map((input) => ({
      id: `queued:${input.id}`,
      role: "user",
      parts: [{ type: "text", text: input.text }],
      status: "done",
    }))
  if (sending.length === 0 && waiting.length === 0) {
    return { state, left: sending, undelivered: NONE }
  }
  const taken = new Set<string>()
  const left = sending.filter((send) => {
    const arrived =
      state.messages.find(
        (message) =>
          message.role === "user" &&
          message.agent === undefined &&
          !send.known.has(message.id) &&
          !taken.has(message.id) &&
          textOf(message) === send.text,
      ) ??
      state.queued.find(
        (input) => !send.known.has(input.id) && !taken.has(input.id) && input.text === send.text,
      )
    if (arrived !== undefined) {
      taken.add(arrived.id)
      return false
    }
    return send.acceptedAt === undefined || now - send.acceptedAt < GIVE_UP_MS
  })
  const kept = left.length === sending.length ? sending : left
  if (left.length === 0 && waiting.length === 0) return { state, left: kept, undelivered: NONE }
  const sent: ChatMessage[] = left.map((send) => ({
    id: send.id,
    role: "user",
    parts: [{ type: "text", text: send.text }],
    status: "done",
    createdAt: send.at,
  }))
  const ahead = [...waiting, ...sent]
  return {
    // What was just said is about to be answered: the agent is shown at it from now.
    state: { ...state, messages: [...state.messages, ...ahead], busy: true },
    left: kept,
    undelivered: ahead.map((message) => message.id),
  }
}

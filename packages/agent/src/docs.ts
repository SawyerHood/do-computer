import type { Avatar, ChatKind, SubagentStatus, ThinkingLevel } from "@durable-computer/protocol"
import { defineDoc } from "@earendil-works/pi-durable"

/**
 * Who the agent is and what it knows. Canonical here, in the agent's own store, so it survives a
 * stopped or replaced sandbox; the workspace files (SOUL.md and friends) are a mirror of this.
 */
export type IdentityState = {
  name: string | null
  avatar: Avatar | null
  tagline: string | null
  /** Personality, tone and boundaries, in the agent's own words. */
  soul: string
  /** What the agent knows about its user. */
  user: string
  /** Long-term notes the agent keeps for itself. */
  memory: string
  /** `provider/modelId` new chats run on. */
  model: string
  /** How hard it thinks before it answers. Absent on an agent that was never told. */
  thinking?: ThinkingLevel
  /** The account that made this agent. Who may use it is the gateway's to say. */
  ownerId: string
  /** The name of the team that shares it. Null or absent: it is one person's. */
  team?: string | null
  /**
   * What a message does that arrives while it is working: `steer` joins the work, `queue` waits
   * for it to finish. Absent: steer for one person, queue for a team, where the message is
   * likely someone else's.
   */
  whenBusy?: "steer" | "queue"
  createdAt: number
  /** The user's IANA timezone, learned from their client. */
  timezone: string | null
  /** The kind of computer it works on. Absent on an agent from before there was a choice. */
  computer?: string
  /** Every kind it has had a computer of, so that each can be deleted with the agent. */
  computers?: string[]
  /** When it was last moved to a different computer, if it ever was. */
  computerChangedAt?: number
  /** When its owner watched it hatch. Until then it is shown as an egg. */
  hatchedAt?: number
}

export const IdentityDoc = defineDoc<IdentityState>({
  kind: "dc.identity",
  version: 1,
  scope: "session",
  initial: () => ({
    name: null,
    avatar: null,
    tagline: null,
    soul: "",
    user: "",
    memory: "",
    model: "",
    ownerId: "",
    createdAt: 0,
    timezone: null,
  }),
})

/** What is kept about a sub-agent, on its chat. */
export type SubagentRecord = {
  /** The chat it was started in, where its reports go. */
  parentId: string
  /** What it was asked to do: its first message. */
  task: string
  /** Whether that message has been sent to it. */
  started?: boolean
  status: SubagentStatus
  /** The message it last reported, so that one answer is reported once. */
  reported: string | null
  /** How many times word of it has been sent to its parent. */
  reports: number
  /** Who asked for it to be stopped, until it has been. */
  stopping?: "user" | "agent"
}

/** What is kept about a conversation with another agent, on its chat. */
export type PeerRecord = {
  /** The agent whose messages arrive here, and to whom the answers go. */
  agentId: string
  /** What it called itself when it last wrote. */
  name: string
  /** The chat of its own that it writes from, where its answers are delivered. */
  chatId: string
  status: SubagentStatus
  /** The message last sent back as an answer, so that one answer is sent once. */
  replied: string | null
  /** How many times word has been sent back. */
  replies: number
  /**
   * How many times it has been given something to answer. Looking in on it takes a while, and
   * this tells whether more arrived meanwhile.
   */
  woken?: number
  /** Set when someone asked for it to be stopped, until it has been. */
  stopping?: true
  /** How many times in a row an answer could not be handed over. */
  failures?: number
}

export type ChatRecord = {
  title: string
  kind: ChatKind
  createdAt: number
  updatedAt: number
  archived: boolean
  /** The user who started it. Absent on a chat from before agents were shared, and on runs. */
  createdBy?: string
  /** Present on a sub-agent's chat. */
  subagent?: SubagentRecord
  /** Present on a conversation with another agent. */
  peer?: PeerRecord
}

/** The agent's chats, keyed by conversation id. One document, so the list is watched as a unit. */
export type ChatsState = {
  chats: Record<string, ChatRecord>
  /** The id of the main chat. Absent until the agent is first opened after there were such. */
  main?: string
}

export const ChatsDoc = defineDoc<ChatsState>({
  kind: "dc.chats",
  version: 1,
  scope: "session",
  initial: () => ({ chats: {} }),
})

export const DEFAULT_CHAT_TITLE = "New chat"

export type ScheduleRecord = {
  title: string
  prompt: string
  /** The schedule as written; parsed again whenever the next run is computed. */
  schedule: string
  timezone: string | null
  enabled: boolean
  nextRunAt: number | null
  createdAt: number
  /** The chat the schedule was created in, where its reports are delivered. */
  originChatId: string | null
  /** A run that has fired and not been reported yet. */
  pending: { chatId: string; firedAt: number } | null
  lastRun: { at: number; chatId: string; outcome: "delivered" | "silent" | "failed" } | null
  runCount: number
}

export type SchedulesState = {
  schedules: Record<string, ScheduleRecord>
}

export const SchedulesDoc = defineDoc<SchedulesState>({
  kind: "dc.schedules",
  version: 1,
  scope: "session",
  initial: () => ({ schedules: {} }),
})

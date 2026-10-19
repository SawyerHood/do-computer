import {
  type AgentLatest,
  type Avatar,
  type ChatKind,
  type CreatureState,
  NEW_CREATURE,
  type ScheduleCheck,
  type SubagentStatus,
  type ThinkingLevel,
} from "@do-computer/protocol"
import { defineDoc } from "@earendil-works/pi-durable"

/**
 * Who the agent is and what it knows. Kept here, in the agent's own store, and nowhere else: it
 * is on no computer, so it survives any of them being stopped or replaced.
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
  /** Left from when a message could be made to wait for the work to finish. Not read. */
  whenBusy?: "steer" | "queue"
  /** The voice it speaks in on a call, where one was chosen for it. Absent: one picked by its id. */
  voice?: string
  createdAt: number
  /** The user's IANA timezone, learned from their client. */
  timezone: string | null
  /**
   * The kind of machine it had to itself, from when every agent had one. Absent on an agent
   * from before there was a choice of kind, and on one made since computers belonged to a
   * workspace.
   */
  computer?: string
  /**
   * Every kind it has had a machine of to itself. Where an agent still has machines to itself,
   * each is deleted with it.
   */
  computers?: string[]
  /** When it was last moved to another kind of machine, in the days when that was done. */
  computerChangedAt?: number
  /**
   * The machines it had to itself were handed to its host, or it never had any. Absent on an
   * agent from before computers belonged to a workspace, until it is next opened.
   */
  adopted?: boolean
  /** When its owner watched it hatch. Until then it is shown as an egg. */
  hatchedAt?: number
  /**
   * Its owner named it before it had a name of its own, as the first run has them do. Until it
   * has a personality as well, its first conversation is still for the two to work that out.
   */
  namedByOwner?: boolean
  /**
   * Its main chat works as a message bus: it reaches the people there only through `send`, and
   * what it writes otherwise is its own working (`bus.ts`). Absent: off. A switch while it is
   * tried out.
   */
  bus?: boolean
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

/**
 * What the agent's creature has been given and has on: its boxes, when the next is due, and the things to
 * wear that came out of them. Apart from who the agent is, since none of it is the agent's to
 * know or to change.
 */
export const CreatureDoc = defineDoc<CreatureState>({
  kind: "dc.creature",
  version: 1,
  scope: "session",
  initial: () => ({ ...NEW_CREATURE, owned: [], outfit: {} }),
})

/** What is kept about a sub-agent, on its chat. */
export type SubagentRecord = {
  /** The chat it was started in, where its reports go. */
  parentId: string
  /**
   * The side chat it was started in, where the bus for everyone (phase 4, rolled back) gave it
   * to the main chat. Read once, to give it back (`#undoBusForEveryone`).
   */
  parentBefore?: string
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
  /**
   * When it began waiting for a person's answer to what it asked for, while it waits. Nobody
   * answering within a day takes the request back, and it carries on without.
   */
  waitingSince?: number
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

/** What is kept about a thread in Slack, on its chat. */
export type SlackRecord = {
  /** The channel's id in Slack. */
  channel: string
  /** Its name without the `#`, where that could be learned. Null for a direct message. */
  channelName: string | null
  /** Whether it is a direct message to the agent. */
  direct: boolean
  /**
   * The message that started the thread, which is how Slack names a thread. Null for a direct
   * message outside any thread, where the answers are not threaded either.
   */
  thread: string | null
  /** The thread's address in Slack, where that could be learned. */
  url: string | null
  status: SubagentStatus
  /** The message last posted as an answer, so that one answer is posted once. */
  replied: string | null
  /** How many times something has been posted to the thread. */
  replies: number
  /**
   * How many times it has been given something to answer. Looking in on it takes a while, and
   * this tells whether more arrived meanwhile.
   */
  woken?: number
  /** The newest message of the thread the agent was given, as Slack names it. */
  seen?: string
  /** The messages it has been given lately, by Slack's names for them, so that one is given once. */
  told?: string[]
  /** The files it sent that have been posted to the thread, by the calls that sent them. */
  files?: string[]
  /**
   * With the bus on: the calls to `send` whose words have been posted to the thread, so that a
   * call made again posts nothing twice.
   */
  sent?: string[]
  /**
   * With the bus on: the files of those sends that have been posted, as `<call id>:file<n>`.
   * Kept apart from `files`, so that many of them cannot push out what says a page it drew was
   * posted.
   */
  sentFiles?: string[]
  /**
   * With the bus on: the last time it told the main chat something with `tell_main`, as the
   * message from Slack it was working on (`woken`) and the call that told it. Once for each.
   */
  toldMain?: { woken: number; callId: string }
  /** Set when someone asked for it to be stopped, until it has been. */
  stopping?: true
  /** How many times in a row an answer could not be posted. */
  failures?: number
}

export type ChatRecord = {
  title: string
  kind: ChatKind
  createdAt: number
  updatedAt: number
  archived: boolean
  /**
   * `"bus"` on a side chat that the bus for everyone (phase 4, rolled back) archived, and not a
   * person. Read once, to bring it back (`#undoBusForEveryone`).
   */
  archivedBy?: "bus"
  /** The user who started it. Absent on a chat from before agents were shared, and on runs. */
  createdBy?: string
  /** The user who last wrote in it, where that is known: who the agent is answering. */
  lastBy?: string
  /** Present on a sub-agent's chat. */
  subagent?: SubagentRecord
  /** Present on a conversation with another agent. */
  peer?: PeerRecord
  /** Present on a thread in Slack. */
  slack?: SlackRecord
  /**
   * Present on a side chat that branched off another chat: which one, and the last of its
   * messages the side chat carries. What came before that is in the side chat's context and is
   * not shown as its own.
   */
  fork?: { chatId: string; at: number }
  /**
   * The id of the request that made it, where it was made by one that gave an id. The same
   * request sent again is answered with this chat, and makes no other.
   */
  request?: string
  /**
   * The bus is on in this chat (`bus.ts`): the main chat of an agent that has it switched on,
   * once the chat has been set up for it.
   */
  bus?: boolean
  /**
   * Where the bus was switched on and off in this chat, by the entries that say so, oldest
   * first, so that a page of its earlier messages is drawn as it was at the time.
   */
  busMarks?: { at: number; on: boolean }[]
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

/**
 * The latest thing said to the agent or by it, for the line beside its name in a list of
 * agents. Written when each thing happens, so that the list is drawn without reading a chat.
 * Apart from its chats, which are a larger document and are not rewritten for it.
 */
export type LatestState = {
  /** Null until something has been said. */
  latest: AgentLatest | null
}

export const LatestDoc = defineDoc<LatestState>({
  kind: "dc.latest",
  version: 1,
  scope: "session",
  initial: () => ({ latest: null }),
})

export type ScheduleRecord = {
  title: string
  prompt: string
  /** The schedule as written; parsed again whenever the next run is computed. */
  schedule: string
  timezone: string | null
  enabled: boolean
  nextRunAt: number | null
  createdAt: number
  /**
   * The chat the schedule was created in, where its reports are delivered. Not where the agent
   * has the bus on: a run's result then goes to the main chat, as an event.
   */
  originChatId: string | null
  /**
   * A run that has fired and not been reported yet. It has no chat until its check, where the
   * schedule has one, has said the agent is to be started; `context` is what the check found.
   * `bus` is set on a run started while the agent had the bus on: it was told its result goes
   * to the main chat, and it does.
   */
  pending: { chatId: string | null; firedAt: number; context?: string; bus?: true } | null
  lastRun: {
    at: number
    chatId: string | null
    /**
     * "reported": its result went to the main chat, as an event, which decides whether to tell
     * anyone. "delivered" and "silent" are for an agent without the bus: whether its report was
     * delivered where the schedule was made.
     */
    outcome: "reported" | "delivered" | "silent" | "failed" | "skipped" | "check-failed"
  } | null
  runCount: number
  /** A command that says, with no model run, whether a run has anything to do. */
  check?: ScheduleCheck
  /** What the check printed when it was last looked at, where it starts the agent on a change. */
  seen?: { hash: string; output: string }
  /** How many times in a row the check could not be run. */
  checkFailures?: number
  /** How many of its times went by without the agent being started. */
  skipCount?: number
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

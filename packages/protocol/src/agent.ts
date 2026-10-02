import type { ChatUsage } from "./chat.ts"

/** A bundled character plus the options the user (or the agent) picked for it. */
export type Avatar = {
  character: string
  color: string
  accessory?: string
}

export type AgentIdentity = {
  /** Null until the agent has settled on a name in its first conversation. */
  name: string | null
  avatar: Avatar | null
  tagline: string | null
}

export type AgentSummary = AgentIdentity & {
  id: string
  createdAt: number
  /** `provider/model` the agent runs on. */
  model: string
}

export type ChatKind = "chat" | "schedule"

export type ChatSummary = {
  id: string
  title: string
  kind: ChatKind
  createdAt: number
  updatedAt: number
  archived: boolean
}

/** What changed on an agent, sent on its event stream so clients know what to refetch. */
export type AgentEvent =
  | { type: "ready" }
  | {
      type: "changed"
      what:
        | "identity"
        | "chats"
        | "schedules"
        | "skills"
        | "computers"
        | "connectors"
        | "library"
        | "memory"
    }

export type ModelOption = {
  /** `provider/model`. */
  id: string
  name: string
  reasoning: boolean
  /** USD per million tokens. */
  inputCost: number
  outputCost: number
}

/** Where a skill came from: shipped with the app, written by the agent, or installed from a URL. */
export type SkillSource = "bundled" | "agent" | "installed"

export type SkillSummary = {
  name: string
  description: string
  source: SkillSource
  /** The URL an installed skill was fetched from. */
  origin: string | null
  enabled: boolean
  updatedAt: number
  /** Paths of the skill's files; `SKILL.md` is always among them. */
  files: string[]
}

export type SkillDetail = SkillSummary & { contents: Record<string, string> }

/** A remote MCP server the agent can use: its tools become the agent's tools. */
export type ConnectorSummary = {
  id: string
  name: string
  url: string
  enabled: boolean
  /** `needs_auth` means the user has to sign in to the service before it can be used. */
  status: "connected" | "needs_auth" | "error"
  /** Why it is not connected, when `status` is `error`. */
  error: string | null
  /** The tools it offers, as the agent sees them. */
  tools: { name: string; description: string }[]
  addedAt: number
}

export type AddConnectorRequest = {
  name: string
  url: string
  /** A fixed access token, for services that issue one instead of asking the user to sign in. */
  token?: string
}

/** The answer to adding or reconnecting a connector: where to send the user if they must sign in. */
export type ConnectorResult = { connector: ConnectorSummary; authorizationUrl?: string }

/** A file in the agent's library: something it delivered to the user, or the user gave it. */
export type LibraryFile = {
  id: string
  name: string
  size: number
  contentType: string
  /** `agent` for a file the agent sent, `user` for one the user uploaded. */
  source: "agent" | "user"
  /** The chat it was sent or uploaded in. */
  chatId: string | null
  createdAt: number
}

/** A task the agent runs on its own, once or on a repeating schedule. */
export type ScheduleSummary = {
  id: string
  title: string
  /** What the agent is asked to do on each run. */
  prompt: string
  /** The schedule as written: "30m", "every 2h", a cron expression or a timestamp. */
  schedule: string
  timezone: string | null
  enabled: boolean
  /** When it next runs, or null when it is paused or spent. */
  nextRunAt: number | null
  createdAt: number
  /** A run that is in progress. */
  running: boolean
  lastRun: {
    at: number
    /** The chat holding the run's full transcript. */
    chatId: string
    outcome: "delivered" | "silent" | "failed"
  } | null
  runCount: number
}

export type UpdateScheduleRequest = {
  title?: string
  prompt?: string
  schedule?: string
  enabled?: boolean
}

export type SendMessageRequest = {
  text: string
  /** Client-chosen id; resending the same one never submits twice. */
  requestId: string
  /** What to do when the agent is already working. Default `steer`. */
  whenBusy?: "steer" | "followUp"
  /** The sender's IANA timezone, so the agent can reason about "tomorrow at 9". */
  timezone?: string
}

export type SendMessageResponse = { submissionId: string }

export type CreateChatRequest = { title?: string }

export type UpdateChatRequest = { title?: string; archived?: boolean }

export type ApiError = { error: string; code?: string }

/** What an agent has spent on models, across all its chats and scheduled runs. */
export type AgentUsage = {
  total: ChatUsage
  /** Spend by model, largest first. */
  models: (ChatUsage & { model: string })[]
  /** The part of the total spent in scheduled runs. */
  scheduled: ChatUsage
  /** How many chats and runs the total covers. */
  chats: number
}

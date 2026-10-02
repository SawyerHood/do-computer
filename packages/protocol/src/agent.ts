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
      what: "identity" | "chats" | "schedules" | "skills" | "computers" | "library" | "memory"
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

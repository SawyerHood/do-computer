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

export type SendMessageRequest = {
  text: string
  /** Client-chosen id; resending the same one never submits twice. */
  requestId: string
  /** What to do when the agent is already working. Default `steer`. */
  whenBusy?: "steer" | "followUp"
}

export type SendMessageResponse = { submissionId: string }

export type CreateChatRequest = { title?: string }

export type UpdateChatRequest = { title?: string; archived?: boolean }

export type ApiError = { error: string; code?: string }

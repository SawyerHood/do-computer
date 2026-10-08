import type { ChatUsage } from "./chat.ts"
import type { Outfit } from "./wardrobe.ts"

/**
 * How an agent looks: a small creature whose features are grown from a seed, in a color that
 * the user or the agent picked.
 */
export type Avatar = {
  color: string
  /** What its features grow from. Absent: the agent's id. */
  seed?: string
}

export type AgentIdentity = {
  /** Null until the agent has settled on a name in its first conversation. */
  name: string | null
  avatar: Avatar | null
  tagline: string | null
}

/** How hard an agent thinks before it answers, from not at all to a lot. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]
/** What an agent that has not been told otherwise uses. */
export const DEFAULT_THINKING: ThinkingLevel = "medium"
export const isThinkingLevel = (value: string): value is ThinkingLevel =>
  (THINKING_LEVELS as readonly string[]).includes(value)

/**
 * The level a model uses when asked for `wanted`, given the ones it offers: that one if it has it,
 * else the next one up, else the next one down. This is how the request itself is settled, so a
 * picker that shows this shows what will happen. Undefined for a model that offers none.
 */
export function nearestThinking(
  offered: readonly ThinkingLevel[],
  wanted: ThinkingLevel,
): ThinkingLevel | undefined {
  const at = THINKING_LEVELS.indexOf(wanted)
  return (
    THINKING_LEVELS.slice(at).find((level) => offered.includes(level)) ??
    THINKING_LEVELS.slice(0, at).findLast((level) => offered.includes(level))
  )
}

export type AgentSummary = AgentIdentity & {
  id: string
  createdAt: number
  /** `provider/model` the agent runs on. */
  model: string
  /** How hard it thinks before it answers. A model that cannot reason ignores it. */
  thinking: ThinkingLevel
  /** Whether its owner has watched it hatch. Until then it is shown as an egg. */
  hatched: boolean
  /** What its creature has on. Absent from an agent of before there were things to wear. */
  outfit?: Outfit
  /** The workspace it lives in. Filled in by the gateway, which is what knows. */
  workspaceId?: string
}

/**
 * `chat` is one the user talks in. A scheduled run and a sub-agent each have a chat of their own,
 * and so does each conversation another agent has with this one (`agent`) and each thread in
 * Slack the agent was spoken to in (`slack`). Those can be read and not written in.
 */
export type ChatKind = "chat" | "schedule" | "subagent" | "agent" | "slack"

/**
 * How a sub-agent is getting on. `waiting` is for the user's OK; `done` is once it has reported
 * back, until it is given more to do. A conversation with another agent is told of the same way,
 * where `done` is once it has replied.
 */
export type SubagentStatus = "working" | "waiting" | "done" | "stopped" | "failed"

export type ChatSummary = {
  id: string
  title: string
  kind: ChatKind
  createdAt: number
  updatedAt: number
  archived: boolean
  /**
   * The agent's main chat: the one conversation that opens when the agent is chosen, and carries
   * on from day to day. At most one of an agent's chats is. The others someone talks in are its
   * side chats.
   */
  main?: boolean
  /** The id of the user who started it, where that is known. */
  createdBy?: string
  /** For a sub-agent: the chat it was started in, where its reports go. */
  parentId?: string
  /** For a sub-agent, for a conversation with another agent, and for a thread in Slack. */
  status?: SubagentStatus
  /**
   * For a conversation with another agent: the agent whose messages these are, and the chat of
   * its own that it writes them from.
   */
  peer?: { agentId: string; name: string; chatId: string }
  /** For a thread in Slack: where it is. */
  slack?: SlackPlace
}

/** Where in Slack a conversation is held. */
export type SlackPlace = {
  /** The channel's name without its `#`, or null for a direct message or a name not learned. */
  channel: string | null
  /** Whether it is a direct message to the agent. */
  direct: boolean
  /** The address of the thread in Slack, where that could be learned. */
  url: string | null
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
        | "approvals"
        | "library"
        | "memory"
        | "secrets"
        | "creature"
    }

export type ModelOption = {
  /** `provider/model`. */
  id: string
  name: string
  reasoning: boolean
  /**
   * The thinking levels it offers, least first. Models differ: some cannot stop thinking, some
   * skip levels, a few go past high. Absent or empty for a model that does not reason.
   */
  thinking?: ThinkingLevel[]
  /** USD per million tokens. */
  inputCost: number
  outputCost: number
  /** How many tokens of conversation it can hold. */
  contextWindow?: number
  /** Whether it can look at images. */
  images?: boolean
  /** One of the few suggested first, ahead of the full list. */
  recommended?: boolean
}

/**
 * The models whose name or id contains every word of `query`, in their given order. With no
 * query, all of them. Shared so a picker filters the same way wherever it is drawn.
 */
export function filterModels<T extends Pick<ModelOption, "id" | "name">>(
  models: readonly T[],
  query: string,
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...models]
  return models.filter((model) => {
    const text = `${model.name} ${model.id}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
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
  /**
   * The chat the agent added or reconnected it from, while it waits there for someone to sign
   * in. The app offers the sign-in beside that chat, and the agent is told there how it went.
   */
  askedIn?: string
}

export type AddConnectorRequest = {
  name: string
  url: string
  /** A fixed access token, for services that issue one instead of asking the user to sign in. */
  token?: string
  /**
   * The id and secret of an app registered with the service by hand, for a service whose sign-in
   * does not let an app register itself.
   */
  clientId?: string
  clientSecret?: string
}

/** The Slack app an agent is in Slack as, without its secrets. */
export type SlackApp = {
  /** The Slack workspace it was installed to. */
  team: string
  /** That workspace's address, such as `https://acme.slack.com/`. */
  teamUrl: string | null
  /** What the bot is called there. */
  bot: string
  connectedAt: number
}

/** An agent's place in Slack, for its settings. */
export type SlackState = {
  /** Null while the agent is not in Slack. */
  app: SlackApp | null
  /** Opens Slack's page for making an app, filled in for this agent. */
  createUrl: string
  /** Where Slack sends what is said to the agent. */
  eventsUrl: string
}

/** What is pasted from the Slack app's pages to put an agent in Slack. */
export type ConnectSlackRequest = {
  /** The "Bot User OAuth Token", which begins `xoxb-`. */
  botToken: string
  signingSecret: string
}

/** The answer to adding or reconnecting a connector: where to send the user if they must sign in. */
export type ConnectorResult = { connector: ConnectorSummary; authorizationUrl?: string }

/** A file in a library: something an agent made for the people it works for, or they gave it. */
export type LibraryFile = {
  id: string
  /** Where it is in the library, folders included: `reports/q3.md`. No two files share one. */
  path: string
  /** The last part of `path`. */
  name: string
  size: number
  contentType: string
  /** `agent` for a file the agent made, `user` for one the user uploaded or wrote. */
  source: "agent" | "user"
  /** The chat it was sent or uploaded in. */
  chatId: string | null
  /**
   * The agent that made it, or in whose chat it was sent or uploaded, where several agents
   * share the library. Absent where the library is one agent's.
   */
  agentId?: string
  createdAt: number
  /** When its content last changed, and who changed it. */
  updatedAt: number
  updatedBy: "agent" | "user"
  /** Counts up each time the content changes. Earlier contents are kept as versions for a while. */
  rev: number
}

/** An earlier content of a library file, which it can be put back to. */
export type LibraryVersion = {
  rev: number
  size: number
  /** When this content was written, and by whom. */
  at: number
  by: "agent" | "user"
}

/** A library file that was deleted and can still be brought back. */
export type DeletedLibraryFile = LibraryFile & { deletedAt: number; deletedBy: "agent" | "user" }

/** What `GET /library` answers with. */
export type LibraryListing = {
  files: LibraryFile[]
  deleted: DeletedLibraryFile[]
  /**
   * Stands in for the session where files are viewed as pages: a file at `path` is served, with
   * whatever it links to beside it, at `/d/<agent>/<view>/<path>`, for any agent that has the
   * library. It changes every few hours.
   */
  view: string
}

/**
 * A command a schedule runs at each of its times, before anything else and with no model in it.
 * It decides whether the agent is started at all.
 */
export type ScheduleCheck = {
  command: string
  /** The computer it runs on, by name. */
  computer: string
  /**
   * What starts the agent: "output" when the command prints anything, "change" when what it
   * prints is not what it printed the time before.
   */
  wake: "output" | "change"
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
    /** The chat holding the run's full transcript, where the agent was started. */
    chatId: string | null
    /**
     * "skipped": its check found nothing, and the agent was not started. "check-failed": its
     * check could not be run, the agent has already been told, and it was not started again.
     */
    outcome: "delivered" | "silent" | "failed" | "skipped" | "check-failed"
  } | null
  /** How many times its time has come. */
  runCount: number
  /** What decides whether the agent is started when its time comes, where something does. */
  check: ScheduleCheck | null
  /** How many of those times went by without the agent being started. */
  skipCount: number
}

export type UpdateScheduleRequest = {
  title?: string
  prompt?: string
  schedule?: string
  /** IANA timezone a cron expression is read in. */
  timezone?: string
  enabled?: boolean
}

/** A picture sent with a message for the agent to look at, as base64. */
export type MessageImage = { mimeType: string; data: string }

/** The kinds of picture a model can be shown. */
export const MESSAGE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const
/** How many pictures a message can carry. */
export const MAX_MESSAGE_IMAGES = 4
/**
 * How large they can be together, in base64 characters. A message is one row of the agent's
 * store, and a row has a size limit on some runtimes, so a client scales pictures down to fit.
 */
export const MAX_MESSAGE_IMAGE_CHARS = 1_400_000

export type SendMessageRequest = {
  text: string
  /**
   * Pictures for the agent to look at, already scaled down. An agent whose model cannot take
   * pictures is sent the message without them.
   */
  images?: MessageImage[]
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

/** A place in the agent's past chats where a search matched. */
export type HistoryHit = {
  chatId: string
  chatTitle: string
  chatKind: ChatKind
  /** The matching message. */
  messageId: string
  role: "user" | "assistant"
  /** When it was said, in milliseconds, when known. */
  at: number | null
  /** The match and some of what surrounds it. */
  snippet: string
}

/** What the agent may do with something without asking: do it, ask first, or never. */
export type ApprovalRule = "allow" | "ask" | "deny"

/** Something a rule can be set for: a tool, a connector, or one of the user's computers. */
export type ApprovalSubject = {
  /** `tool:<name>`, `connector:<id>` or `computer:<id>`. */
  id: string
  /** What it lets the agent do, in a few words, such as "Run commands". */
  label: string
  /** What else the rule reaches, when that is not obvious from the label. */
  hint?: string
  kind: "tool" | "connector" | "computer"
}

/** Something the agent wants to do that a rule says to ask about first. */
export type ApprovalRequest = {
  id: string
  chatId: string
  chatTitle: string
  chatKind: ChatKind
  /** What it wants to do, such as "Run commands on studio-mac". */
  title: string
  /** The specifics: the command, the file, the arguments. */
  detail: string
  createdAt: number
  /** It is asked about every time: "always" is not an answer that can be given. */
  onceOnly?: boolean
}

export type ApprovalDecision = "once" | "always" | "deny"

export type ApprovalsState = {
  /** Rules that differ from the default, by subject id. Everything else is allowed. */
  rules: Record<string, ApprovalRule>
  subjects: ApprovalSubject[]
  pending: ApprovalRequest[]
}

/** One secret an agent asked for: the name it is saved under, and what it is. */
export type SecretField = {
  /** The variable it is saved as, such as `OPENAI_API_KEY`. */
  name: string
  /** What it is, for whoever is asked to type it. */
  description: string | null
}

/**
 * Something secret the agent asked a person to type: an API key, a password, a token. The app
 * shows a form above the message box. What is typed goes to where it is kept and nowhere else:
 * it is never part of a chat, and the agent is told only that it was saved.
 */
export type SecretRequest = {
  id: string
  /** The chat the agent asked from. */
  chatId: string
  /** What the secrets are for, in the agent's words. */
  purpose: string | null
  fields: SecretField[]
  /** Where they are saved: a dotenv file on a computer, or the access token of a connector. */
  destination:
    | { kind: "dotenv"; computer: string; path: string }
    | { kind: "connector"; name: string; url: string }
  createdAt: number
}

/** How large one secret can be, in characters. */
export const MAX_SECRET_CHARS = 16 * 1024

/** What a secret can be saved under: the name of an environment variable. */
export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/

/** The answer to a request for secrets: a value for every field. */
export type AnswerSecretRequest = { values: Record<string, string> }

/** One kind of computer an agent can work on, as a deployment offers it. */
export type ComputerKind = {
  id: string
  label: string
  /** A sentence on what it is, for whoever is choosing. */
  description: string
}

/** The kinds of computer a deployment offers, and the one it gives new agents. */
export type ComputerKinds = {
  kinds: ComputerKind[]
  default: string
}

/** What a user has chosen for their account, as opposed to for one agent. */
export type UserSettings = {
  /** The model their new agents start on. Null: whatever the deployment starts agents on. */
  defaultModel: string | null
  /** The deployment's own default, which is what null means. */
  deploymentDefaultModel: string
  /**
   * The kind of machine a workspace is given when they make an agent in one that has none the
   * agent could use. Null: whatever the deployment gives.
   */
  defaultComputer: string | null
  deploymentDefaultComputer: string
}

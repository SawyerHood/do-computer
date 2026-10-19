import {
  avatarLook,
  BOX_EVERY_MS,
  type AddConnectorRequest,
  type AgentEvent,
  type AgentActivity,
  type AgentLatest,
  type AgentSummary,
  type AgentUsage,
  type ApprovalDecision,
  type CallLinesRequest,
  type CallWorkRequest,
  type CallWorkResponse,
  type ChatMessage,
  type ChatState,
  type ChatSummary,
  type ChatUsage,
  type ComputerKind,
  type CreatureState,
  diffChat,
  DEFAULT_THINKING,
  encodeSse,
  type EndCallRequest,
  CONNECTOR_CALLBACK_PATH,
  hasEverything,
  isThinkingLevel,
  MAX_MESSAGE_IMAGE_CHARS,
  MAX_MESSAGE_IMAGES,
  MESSAGE_IMAGE_TYPES,
  type MessageImage,
  latestOfSent,
  type ModelOption,
  NEW_CREATURE,
  parseAvatar,
  mcpAppContentSecurityPolicy,
  parseOutfit,
  rollItem,
  type SendMessageRequest,
  type SendMessageResponse,
  type StartCallRequest,
  type StartCallResponse,
  SSE_HEADERS,
  SSE_HEARTBEAT,
  SSE_HEARTBEAT_MS,
  THINKING_LEVELS,
  TREATS_PER_BOX,
  type UpdateChatRequest,
  type ScheduleCheck,
  type UpdateScheduleRequest,
  wearItem,
} from "@do-computer/protocol"
import type {
  Actor,
  ActorDatabase,
  ActorHost,
  ActorNamespace,
  ActorSocket,
  ActorStub,
  PagePreviewer,
} from "@do-computer/runtime"
import type { Sandbox } from "@do-computer/sandbox"
import type { Context } from "@earendil-works/chord"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Usage } from "@earendil-works/pi-ai"
import type { Models } from "@earendil-works/pi-ai/models"
import {
  AssistantEntry,
  type CompactionPolicy,
  type Conversation,
  type ConversationId,
  createRegistry,
  defineExtension,
  type DocumentWatch,
  type Extension,
  Harness,
  type JsonObject,
  type SessionDocToken,
  UsageDoc,
} from "@earendil-works/pi-durable"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import {
  ChatsDoc,
  type ChatRecord,
  DEFAULT_CHAT_TITLE,
  CreatureDoc,
  IdentityDoc,
  type IdentityState,
  LatestDoc,
  SchedulesDoc,
} from "./docs.ts"
import { createToolSearchExtension } from "@earendil-works/pi-durable/tool-search"
import { createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools"
import { ApprovalError, Approvals, ApprovalsDoc, SIGN_IN_ABILITY } from "./approvals.ts"
import { appGuide } from "./app-guide.ts"
import { type Caller, readCaller, sentFrom, sentMeta } from "./caller.ts"
import {
  ASKED_ENTRY,
  askingThrough,
  BUS_ENTRY,
  BUS_EXTENSIONS,
  BUS_NOTE_ENTRY,
  busExtension,
  busNote,
  busOn,
  canAsk,
  eventText,
  SLACK_NOTE_ENTRY,
  slackBusExtension,
} from "./bus.ts"
import {
  CALL_ENTRY,
  type CallDirectory,
  type CallEntry,
  CallError,
  Calls,
  CallsDoc,
} from "./calls.ts"
import { AppNeedsConsent, ConnectorError, Connectors, ConnectorsDoc } from "./connectors.ts"
import { Followers } from "./followers.ts"
import { guardedFetch } from "./guarded-fetch.ts"
import {
  HistoryError,
  historyExtension,
  HistoryIndex,
  readHistory,
  searchHistory,
} from "./history.ts"
import { Journal, type ReviewOptions } from "./journal.ts"
import { type JudgeOptions, KeepGoing } from "./keep-going.ts"
import { logExtension } from "./log.ts"
import { CACHE_RETENTION, IdleCompaction } from "./idle-compaction.ts"
import { type ImageLimits, RequestLimits } from "./limits.ts"
import {
  type AgentComputer,
  type ComputerAnswer,
  type ComputerDirectory,
  Computers,
  ComputersDoc,
  isPaired,
  MachineEnv,
  ComputerEnv,
} from "./computers.ts"
import { harnessDocs, Library, LibraryDoc, LibraryError, LibraryStore } from "./library.ts"
import { MAX_LIBRARY_FILE_BYTES } from "./library-store.ts"
import { LIBRARY_AGENT_HEADER } from "./library-actor.ts"
import { type RemoteLibrary, remoteLibrary } from "./library-remote.ts"
import { routeLibrary, routeLibraryView } from "./library-routes.ts"
import { PinError, Pins, PinsDoc } from "./pins.ts"
import { type SiteDirectory, sites } from "./sites.ts"
import { visuals } from "./visuals.ts"
import { offeredModels } from "./model-providers.ts"
import { type DeploymentModels, ECHO_MODEL, parseModel } from "./models.ts"
import { type AgentDirectory, PeerError, type PeerMessage, type PeerReply, Peers } from "./peers.ts"
import { formatTime, isValidTimezone } from "./schedule.ts"
import { type CheckResult, ScheduleError, Scheduler } from "./schedules.ts"
import { SecretError, Secrets, SecretsDoc } from "./secrets.ts"
import { Pays } from "./pay.ts"
import { bindingOf, SignIns } from "./sign-in.ts"
import { type SettingsChange, SettingsError, settingsExtension } from "./settings.ts"
import { SkillError, Skills, SkillsDoc } from "./skills.ts"
import { SlackChats, type SlackDirectory, SlackError, type SlackMessage } from "./slack.ts"
import { changeIdentity, editMemory, MEMORY_LIMIT, persona, USER_LIMIT } from "./persona.ts"
import { type AgentLink, readMirror } from "./agent-link.ts"
import { preview } from "./preview.ts"
import { addUsage, projectChat } from "./project.ts"
import { JobError, Jobs, JobsDoc } from "./jobs.ts"
import { UseError, Uses } from "./uses.ts"
import { vault } from "./vault.ts"
import { SubagentError, Subagents } from "./subagents.ts"
import { webSearchExtension, type WebSearchOptions } from "./web-search.ts"
import { isInherited, own } from "./own.ts"
import { liveWork } from "./live.ts"

const context = BACKGROUND_CONTEXT

/**
 * While work is live the actor wakes itself this often. On Cloudflare the wake-up keeps the
 * Durable Object from being evicted mid-run, and if it was evicted or crashed anyway, the next one
 * reopens the store and resumes the run from its last checkpoint.
 */
const KEEPALIVE_MS = 20_000
/** How soon an agent whose store failed under it is woken, to open again. */
const REOPEN_MS = 1_000

/**
 * The host's database for a harness to work over, which closing the harness leaves open. A
 * harness whose store failed closes itself, and the agent opens another over the same database,
 * which is closed when the agent is.
 */
const keptOpen = (sql: ActorDatabase): ActorDatabase => ({
  exec: (text) => sql.exec(text),
  run: (text, ...params) => sql.run(text, ...params),
  get: (text, ...params) => sql.get(text, ...params),
  all: (text, ...params) => sql.all(text, ...params),
  transaction: (callback) => sql.transaction(callback),
  close: async () => {},
})
/** How long an automation's check may run before it is stopped and counted as broken. */
const CHECK_TIMEOUT_MS = 60_000
const MAX_MESSAGE_CHARS = 200_000
const MAX_TITLE_CHARS = 80
/** The most treats its creature is given from outside the app in one go. */
const MAX_GIFTED_TREATS = 400
/** How many answers are remembered as told of, so that one is not told twice. */
const MAX_TOLD_ANSWERS = 500
/** How often an agent in use is looked at for a model its deployment has stopped offering. */
const MODEL_CHECK_MS = 60_000
export type AgentActorOptions = {
  readonly models: Models
  /** `provider/modelId` for agents that have not chosen a model. */
  readonly defaultModel: string
  readonly modelOptions: readonly ModelOption[]
  /**
   * What the deployment offers at the moment, where that can change while the server runs:
   * someone can sign the deployment itself in to a provider, or out. Asked each time, and used
   * in place of `defaultModel` and `modelOptions`.
   */
  readonly deploymentModels?: () => Promise<DeploymentModels>
  /**
   * The models of the providers the agent's workspace is signed in to, which it can run on as
   * well as `modelOptions`. Asked each time, since someone can sign in or out, and an agent can
   * be moved. Without it, an agent runs on the deployment's models only.
   */
  readonly workspaceModels?: () => Promise<readonly ModelOption[]>
  /** Extensions installed after the built-in ones. */
  readonly extensions?: readonly Extension[]
  /**
   * The machine an agent works on where there is one kind and nobody to say which machines
   * there are: it gets one to itself. Should be cheap to call and start nothing until used, as
   * `lazySandbox` does.
   */
  readonly sandbox?: (host: ActorHost) => Sandbox
  /** The kinds of machine there are, and how one is reached. Takes the place of `sandbox`. */
  readonly computers?: ComputerChoices
  /** Receives failures that did not fail a request. */
  readonly onReport?: (error: unknown) => void
  /** Chance, as numbers from 0 up to 1: what decides the thing in a box. `Math.random` if left out. */
  readonly random?: () => number
  /** How long after its creature's box is opened the next one turns up. Six hours if left out. */
  readonly boxEveryMs?: number
  /** How often the actor wakes itself while work is live. */
  readonly keepAliveMs?: number
  /**
   * How many times one request to the model is started without an answer before that chat's run
   * is ended (`limits.ts`). Three if left out; only a test has it anything else.
   */
  readonly requestTries?: number
  /** How much of a chat's pictures a request carries (`limits.ts`). Only a test changes it. */
  readonly imageLimits?: ImageLimits
  /**
   * pi-durable's own compaction thresholds, over its defaults. Only a test changes them, so that
   * a chat can fill most of a model's window without pi-durable compacting it first.
   */
  readonly compaction?: Partial<CompactionPolicy>
  /**
   * How long after its last answer a quiet main chat is looked at, to be compacted while its
   * prompt is still in the provider's cache (`idle-compaction.ts`). Ten minutes if left out.
   */
  readonly idleCompactionMs?: number
  /**
   * Whether someone is writing a message in one of the agent's chats right now, where the host
   * can tell. A quiet chat is not compacted under them. Absent: nobody is taken to be.
   */
  readonly typing?: (agentId: string, chatId: string) => Promise<boolean>
  /** How long a command is waited for before it is left to run in the background. */
  readonly foregroundMs?: number
  /**
   * How long a chat that has gone quiet keeps what it last read in memory, so that its next
   * run reads only what is newer. Default: ten minutes. It is kept by a timer, and where a
   * pending timer keeps the agent itself in memory, as in a Durable Object, that is ten minutes
   * of an idle agent paid for after every answer: pass 0 there, and nothing is kept.
   */
  readonly contextRetentionMs?: number
  /**
   * How long a document nothing is watching stays in memory after it was last read or written.
   * Default: ten minutes. It is kept by a timer as a quiet chat is, so pass 0 where
   * `contextRetentionMs` is 0: a document is then read from the store each time it is used.
   */
  readonly documentRetentionMs?: number
  /** Where the links to the user's own paired computers live. Without it, none can be used. */
  readonly computerLinks?: ActorNamespace
  /**
   * Which computers the agent can use and could be connected to, and how it asks for one. Where
   * it also says which machines the agent's workspace has (`machines`), the agent has no machine
   * to itself and works on those. Without it, the agent has only the computers it was given.
   */
  readonly computerDirectory?: ComputerDirectory
  /**
   * The library of the workspace an agent is in, which it then shares with the other agents
   * there. Asked each time, since an agent can be moved. Without it, an agent keeps a library of
   * its own.
   */
  readonly library?: (agentId: string) => Promise<ActorStub | undefined>
  /**
   * The sites of the agent's workspace: pages of its library shared as websites. With it the
   * agent can share one. Without it, nothing is shared.
   */
  readonly sites?: SiteDirectory
  /**
   * Whether the browser the agent uses on a computer opens in a window its owner can watch, as
   * the agent's workspace has it. Asked before each use of the browser, since the choice can be
   * changed and an agent can be moved. Without it, or where it does not know, the computer is
   * not told and decides for itself.
   */
  readonly showsBrowser?: (agentId: string) => Promise<boolean | undefined>
  /**
   * Where the agent's workspace keeps the logins it saved for websites, looked up each time.
   * Resolves with undefined where the workspace has none to use: the deployment has them
   * switched off, or keeps them for its admins and this is not a workspace of theirs alone.
   * Absent: no agent here has any.
   */
  readonly savedLogins?: (agentId: string) => Promise<ActorStub | undefined>
  /** The same, for the cards the workspace saved to pay with. Absent: no agent here has any. */
  readonly savedCards?: (agentId: string) => Promise<ActorStub | undefined>
  /**
   * Who the other agents of the agent's workspace are, and how a message reaches one. Without
   * it, the agent knows of no other agent.
   */
  readonly agentDirectory?: AgentDirectory
  /**
   * How the agent reaches Slack, where it has been put there as a bot. Without it, nothing said
   * in Slack arrives.
   */
  readonly slackDirectory?: SlackDirectory
  /**
   * How long a sub-agent waits for a person's answer to what it asked for before it is taken
   * back. Default a day. For tests.
   */
  readonly subagentAskTtlMs?: number
  /** How long to wait before posting to Slack again, after the `n`th failure in a row. For tests. */
  readonly slackRetryMs?: (n: number) => number
  /**
   * A browser the server has, which draws a page for the agent to look at before it shows it
   * to the person: Cloudflare's on a Worker, a Chrome on the machine under Node. Without one,
   * the agent has no such tool and draws without looking.
   */
  readonly pagePreviewer?: PagePreviewer
  /** Used to reach connectors (remote MCP servers). Default: the global `fetch`. */
  readonly connectorFetch?: (input: string | URL, init?: RequestInit) => Promise<Response>
  /**
   * Let connectors and skill installs reach this machine and private networks, and use plain
   * http. Off by default: the server makes those calls for whoever, or whatever, asks.
   */
  readonly allowPrivateHosts?: boolean
  /** Looks a host name up, where the runtime can, so a name pointing inside is refused too. */
  readonly resolveHost?: (hostname: string) => Promise<readonly string[]>
  /** Gives the agent a web search tool. Absent: it has none. */
  readonly webSearch?: WebSearchOptions
  /**
   * Where Apps is: the connector that reaches people's own accounts on other services. Default:
   * Composio's MCP server. Only a test's stand-in is anywhere else.
   */
  readonly appsUrl?: string
  /**
   * Has a small model judge, when a run ends on what could be a progress update, whether the
   * agent meant to go on, and sets it going again if so. Absent: a run ends where the agent stops.
   */
  readonly judge?: JudgeOptions
  /**
   * Has a small model keep a note of where each chat stands, which the agent's other chats are
   * shown. Absent: they are shown only the work the agent wrote up itself.
   */
  readonly review?: ReviewOptions
  /** Used to fetch skills the user installs from a URL. Default: the global `fetch`. */
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>
  /**
   * Called when the agent has something for a user who may not be looking: a scheduled task
   * reported, or it finished answering in a chat nobody has open. For sending a push
   * notification. Best effort: a reply that finishes after a restart is not announced.
   */
  readonly onNotify?: (notification: AgentNotification) => void
  /**
   * Called each time what a list of agents says of this one changes: its latest line, whether
   * it is at work, whether it is waiting on someone. For telling whoever has such a list open.
   * Best effort, as a notification is.
   */
  readonly onActivity?: (change: { agentId: string } & AgentActivity) => void
  /**
   * The address people reach the app at, such as `https://example.com`. With it the agent can
   * hand a person a link to a screen, and can add a connector that has people sign in. Where it
   * is not set, the address its gateway was last reached at stands in.
   */
  readonly appUrl?: string
  /**
   * Who may call an agent out loud, and which sign-in places the call: the deployment's switch
   * and limits, and what the agent's workspace and the deployment are signed in to. Without it,
   * nobody can call an agent here.
   */
  readonly calls?: CallDirectory
  /**
   * Lets a test make a side chat as there were before a Dood was talked to in its main chat
   * alone (`POST /chats/old`), archived, with a message said in it where one is given, to see
   * that one is kept and read. Nothing else makes one.
   */
  readonly testOldSideChats?: boolean
  /** Used to ask a provider of voices for a call. Default: the global `fetch`. */
  readonly callFetch?: (url: string, init: RequestInit) => Promise<Response>
}

export type ComputerChoices = {
  /** What can be chosen, in the order to offer it. */
  readonly kinds: readonly ComputerKind[]
  /** The kind an agent gets when none is asked for. One of `kinds`. */
  readonly default: string
  /**
   * The machine of one kind behind `key`, or undefined for a kind that means having none.
   * Should be cheap and start nothing until used, as for `sandbox`. The same kind and key must
   * always lead to the same machine: that is how the files on it are found again. `host` is the
   * agent asking, for a kind whose files live with one agent; such a kind has no machine to
   * give where no agent is asking.
   */
  readonly create: (kind: string, key: string, host?: ActorHost) => Sandbox | undefined
}

export type AgentNotification = {
  agentId: string
  /** Null while the agent has not named itself. */
  agentName: string | null
  kind: "reply" | "scheduled" | "approval"
  /** For a scheduled report, the task's title. */
  heading?: string
  text: string
  /** The chat to open; null when the chat a report was meant for is gone. */
  chatId: string | null
  /** The user this is an answer to, where the agent knows. Otherwise it is for everyone. */
  userId?: string
}

/** Header in which the gateway tells the actor where a connector's sign-in should return to. */
export const CONNECTOR_REDIRECT_HEADER = "x-dc-connector-redirect"

/** Header in which the gateway tells the actor the address the app was reached at. */
export const APP_ORIGIN_HEADER = "x-dc-origin"

export { CONNECTOR_CALLBACK_PATH }

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

const json = (value: unknown, status = 200) => Response.json(value, { status })

async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new HttpError(400, "Request body must be JSON")
  }
}

function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0]!.trim()
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : line
}

type Told = Extract<AgentEvent, { type: "changed" }>["what"]
type Doc = SessionDocToken<JsonObject>

/**
 * The documents of an agent that its pages are drawn from, and what each goes by on the agent's
 * event stream. Everyone following the agent is told when one of these changes, and a client
 * that has no name for what changed asks for all of it again: a new document has only to be
 * added here. One marked "here" is made when the agent is opened, since a document that is not
 * there yet cannot be watched. The others are there by the time anyone is following: the agent
 * does not exist without its identity and its chats, and its skills come with its owner.
 */
const TOLD: readonly (readonly [Told, Doc, "here" | "before"])[] = [
  ["identity", IdentityDoc as unknown as Doc, "before"],
  ["chats", ChatsDoc as unknown as Doc, "before"],
  ["skills", SkillsDoc as unknown as Doc, "before"],
  ["schedules", SchedulesDoc as unknown as Doc, "here"],
  ["computers", ComputersDoc as unknown as Doc, "here"],
  ["library", LibraryDoc as unknown as Doc, "here"],
  ["connectors", ConnectorsDoc as unknown as Doc, "here"],
  ["approvals", ApprovalsDoc as unknown as Doc, "here"],
  ["secrets", SecretsDoc as unknown as Doc, "here"],
  ["creature", CreatureDoc as unknown as Doc, "here"],
  ["jobs", JobsDoc as unknown as Doc, "here"],
  ["pins", PinsDoc as unknown as Doc, "here"],
]

/**
 * A `text/event-stream` response fed by `setup`. `emit` resolves once the client has room, so a
 * slow client slows its producer instead of growing a queue; pi-durable's watches then collapse
 * what the client missed into the newest state.
 */
function eventStream(
  setup: (emit: (value: unknown) => Promise<void>, close: () => void) => Promise<() => void>,
): Response {
  let teardown: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let wake: (() => void) | undefined
  let closed = false
  const finish = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    wake?.()
    teardown?.()
  }
  const stream = new ReadableStream<Uint8Array>(
    {
      async start(controller) {
        const emit = async (value: unknown) => {
          if (closed) return
          controller.enqueue(encodeSse(value))
          while (!closed && (controller.desiredSize ?? 1) <= 0) {
            await new Promise<void>((resolve) => {
              wake = resolve
            })
          }
        }
        const close = () => {
          if (closed) return
          finish()
          controller.close()
        }
        heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(SSE_HEARTBEAT)
        }, SSE_HEARTBEAT_MS)
        try {
          teardown = await setup(emit, close)
          if (closed) teardown()
        } catch (error) {
          finish()
          controller.error(error)
        }
      },
      pull() {
        wake?.()
        wake = undefined
      },
      cancel() {
        finish()
      },
    },
    { highWaterMark: 32 },
  )
  return new Response(stream, { headers: SSE_HEADERS })
}

function summarize(id: string, record: ChatRecord, main: string | undefined): ChatSummary {
  // Where an old side chat branched off is the agent's to know, not a client's. Left in, it
  // would also be a part of the document still being written, which cannot be read once it is
  // stored. What its making was asked under is between the agent and whoever asked.
  // How the bus is set up in it is the agent's too.
  const {
    subagent,
    peer,
    slack,
    fork: _fork,
    request: _request,
    bus: _bus,
    busMarks: _busMarks,
    ...chat
  } = record
  return {
    id,
    ...chat,
    ...(id === main ? { main: true } : {}),
    ...(subagent === undefined ? {} : { parentId: subagent.parentId, status: subagent.status }),
    ...(peer === undefined
      ? {}
      : {
          status: peer.status,
          peer: { agentId: peer.agentId, name: peer.name, chatId: peer.chatId },
        }),
    ...(slack === undefined
      ? {}
      : {
          status: slack.status,
          slack: { channel: slack.channelName, direct: slack.direct, url: slack.url },
        }),
  }
}

/**
 * One agent: its identity and memory, its chats, and the pi-durable harness that runs them. The
 * actor trusts its caller; the gateway in front of it authenticates and checks ownership.
 */
export class AgentActor implements Actor {
  readonly #host: ActorHost
  readonly #options: AgentActorOptions
  readonly #choices: ComputerChoices
  readonly #computers: Computers
  readonly #library: Library
  readonly #pins: Pins
  readonly #calls: Calls
  /** What its conversations ask of it (`agent-link.ts`): all of them are kept here, for now. */
  readonly #link: AgentLink
  /** The library the agent keeps for itself, where its workspace has none for it to share. */
  readonly #ownLibrary: LibraryStore
  /** The harness, once it is open, for what is built before it and needs it later. */
  #opened: Harness | undefined
  #connectors: Connectors | undefined
  /** How many clients are following each chat right now, over an event stream. */
  readonly #watchers = new Map<string, number>()
  /** Whether a run of its was found going, with the end of that work still to be told. */
  #atWork = false
  /** The watch for the end of the work in hand, while there is one. */
  #resting: Promise<void> | undefined
  /** What `onActivity` was last told. Undefined until it has been told since the agent loaded. */
  #told: string | undefined
  /** Whether anything may have changed since what `onActivity` is told was last read. */
  #untold = false
  /** Whether what `onActivity` is told is being read right now. */
  #telling = false
  /** Those following over a socket, which does not keep the agent in memory. */
  readonly #followers: Followers
  readonly #scheduler: Scheduler
  readonly #subagents: Subagents
  readonly #jobs: Jobs
  readonly #uses: Uses
  readonly #peers: Peers | undefined
  readonly #slack: SlackChats | undefined
  readonly #skills: Skills
  readonly #approvals: Approvals
  readonly #secrets: Secrets
  readonly #signIns: SignIns
  readonly #pays: Pays
  readonly #keepGoing: KeepGoing
  readonly #limits: RequestLimits
  readonly #idle: IdleCompaction
  readonly #journal: Journal
  readonly #history: HistoryIndex
  /** The main chat as a message bus (`bus.ts`). */
  readonly #bus: Extension
  /** The bus in a thread in Slack. */
  readonly #slackBus: Extension
  /**
   * The answers already told of, by chat and entry, newest last. When several inputs are taken
   * up in one run, each settles with the same answer, and that answer is told of once.
   */
  readonly #toldAnswers = new Set<string>()
  /** Setting chats up for the bus, one at a time, so that each is marked once. */
  #busing: Promise<void> = Promise.resolve()
  #harness: Promise<Harness> | undefined
  /** When the agent next wakes itself to keep live work going, while that is still to come. */
  #wake: number | undefined
  /** The tasks that were reported as ones this deployment cannot run, so each is reported once. */
  readonly #blockedTold = new Set<string>()
  /** The address the app was last reached at, as its gateway said. */
  #origin: string | undefined
  /** When its model was last seen to be one that can be called. */
  #modelSeenAt = Number.NEGATIVE_INFINITY

  constructor(host: ActorHost, options: AgentActorOptions) {
    this.#host = host
    this.#options = options
    this.#link = {
      mirror: async (known, c) => readMirror(await this.#open(), known, c),
      changeIdentity: async (_from, change, c) =>
        (await this.#open()).commit(
          async (tx) => changeIdentity(await tx.doc(IdentityDoc), change),
          c,
        ),
      editMemory: async (_from, edit, c) =>
        (await this.#open()).commit(async (tx) => editMemory(await tx.doc(IdentityDoc), edit), c),
      sent: (sent) => this.#sent(sent.chatId, sent.text, sent.files),
      tellMain: (told, c) => this.#tellMain(told, c),
    }
    // One kind without a name, when the deployment gives no choice.
    this.#choices = options.computers ?? {
      kinds: [],
      default: "",
      create: (_kind, _key, host) => (host === undefined ? undefined : options.sandbox?.(host)),
    }
    const report = (what: string) => (error: unknown) =>
      options.onReport?.(
        new Error(`${what}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        }),
      )
    this.#followers = new Followers({
      host,
      docs: TOLD.map(([what, doc]) => [what, doc] as const),
      chat: (harness, chatId) =>
        this.#chat(harness, chatId).catch((error: unknown) => {
          if (error instanceof HttpError) return undefined
          throw error
        }),
      context,
      onError: (error) => options.onReport?.(error),
    })
    this.#ownLibrary = new LibraryStore({
      docs: harnessDocs(() => {
        if (this.#opened === undefined) throw new Error("The Dood is not open yet")
        return this.#opened
      }),
      blobs: host.blobs,
      now: () => host.now(),
    })
    this.#library = new Library({
      backend: async () => (await this.#sharedLibrary()) ?? this.#ownLibrary,
      shared: options.library !== undefined,
      ...(options.library === undefined ? {} : { agentId: host.name }),
      hasMachine: async (c) =>
        (await this.#computers.list(c)).some((computer) => !isPaired(computer)),
      onProblem: report(
        "A machine's library folder could not be brought into step with the library",
      ),
    })
    this.#pins = new Pins({
      backend: async () => (await this.#sharedLibrary()) ?? this.#ownLibrary,
      read: async () => (await (await this.#open()).snapshot(PinsDoc, context))?.pins ?? [],
      change: async (apply) => {
        await (await this.#open()).commit(async (tx) => apply(await tx.doc(PinsDoc)), context)
      },
      now: () => host.now(),
    })
    this.#calls = new Calls({
      agentId: host.name,
      name: async () =>
        (await (await this.#open()).snapshot(IdentityDoc, context))?.name ?? "the assistant",
      ...(options.calls === undefined ? {} : { directory: options.calls }),
      ...(options.review === undefined ? {} : { review: options.review }),
      read: async () => (await (await this.#open()).snapshot(CallsDoc, context)) ?? { calls: {} },
      change: async (apply) => {
        await (await this.#open()).commit(async (tx) => apply(await tx.doc(CallsDoc)), context)
      },
      record: (chatId, entry, note) => this.#recordCall(chatId, entry, note),
      now: () => host.now(),
      ...(options.callFetch === undefined ? {} : { fetch: options.callFetch }),
      onError: (error) => options.onReport?.(error),
    })
    const skillFetch = guardedFetch(
      (input, init) => (options.fetch ?? fetch)(String(input), init),
      options.allowPrivateHosts === true,
      { resolve: options.resolveHost },
    )
    this.#skills = new Skills({
      now: () => host.now(),
      // A skill that needs real programs is for an agent that can come by a machine with them.
      realPrograms: () =>
        [...this.#choices.kinds.map((kind) => kind.id), ""].some(
          (kind) => this.#choices.create(kind, host.name, host)?.capabilities.realBinaries === true,
        ),
      // The agent can be talked into installing from any address, so this one is checked too.
      fetch: (url, init) => skillFetch(url, init),
    })
    this.#jobs = new Jobs({
      agentId: host.name,
      now: () => host.now(),
      context,
      computer: (id, c) => this.#computers.resolve(id, c),
      ...(options.foregroundMs === undefined ? {} : { foregroundMs: options.foregroundMs }),
      // A command left running wants looking in on, which the wake-up does.
      onStarted: () => void this.#rearm().catch((error) => options.onReport?.(error)),
      // What the agent says about a command that ended is told like any other answer nobody
      // was there for.
      onReport: (report) => {
        if (report.turn === undefined || this.#harness === undefined) return
        // The turn it was given began with no request, so nothing else says it is at work.
        this.#tell()
        void this.#harness.then((harness) =>
          this.#notifyWhenUnseen(harness, report.chatId, report.turn!, undefined),
        )
      },
      onError: (error) => options.onReport?.(error),
    })
    this.#uses = new Uses({
      agentId: host.name,
      blobs: host.blobs,
      agent: async () => {
        const identity = await this.#identity(await this.#open())
        return {
          id: host.name,
          name: identity.name ?? "Your Dood",
          color: avatarLook(identity.avatar, host.name).color,
        }
      },
      // The built-in echo sees nothing and decides nothing: a screen can be tried with it.
      sees: async () => {
        const { model } = await this.#identity(await this.#open())
        return model === ECHO_MODEL || this.#sees(model)
      },
      // Not knowing is no reason to refuse the agent the browser: the computer is then not told.
      showsBrowser: async () =>
        options.showsBrowser?.(host.name).catch((error: unknown) => {
          options.onReport?.(error)
          return undefined
        }),
      computer: (id, c) => this.#computers.resolve(id, c),
    })
    this.#computers = new Computers({
      links: options.computerLinks,
      machine: (kind, key) => this.#choices.create(kind, key, host),
      extraTools: [this.#library.sendFileTool, this.#library.libraryTool, ...this.#uses.tools],
      // Loading a skill copies its files to where the agent is working, if it is anywhere.
      optionalTools: [this.#skills.tool],
      ...(options.computerDirectory === undefined
        ? {}
        : { directory: { agentId: host.name, lookup: options.computerDirectory } }),
      around: this.#library.around,
      onProblem: report("A machine could not be made ready for the Dood"),
      appUrl: () => this.#appUrl(),
      onAsked: (asked) =>
        void this.#askedThroughMain(
          asked.chatId,
          `the use of the computer ${asked.computer}`,
          null,
          `computer:${asked.requestKey}`,
        ),
    })
    this.#secrets = new Secrets({
      now: () => host.now(),
      computer: (name, c) => this.#computers.resolve(name, c),
      addConnector: async (input, c) => {
        if (this.#connectors === undefined) throw new Error("The Dood is not open yet")
        // A token is sent with every request, so nobody signs in and nothing returns anywhere.
        return this.#connectors.add(input, this.#connectorRedirect() ?? "", c)
      },
      saveLogin: async (input, asked, c) => {
        const actor = await this.#vault()
        if (actor === undefined) throw new Error("This workspace does not keep logins.")
        const login = await vault.save(actor, input, asked.by)
        // Whoever typed it for this site, here, has said it may be used there this once.
        await this.#approvals.allowOnce(asked.chatId, bindingOf(login.id, asked.site), c)
        return login
      },
      onRequest: (request) => {
        const what =
          request.purpose ??
          (request.destination.kind === "login"
            ? `Asks for a login for ${request.destination.site}`
            : `Asks for ${request.fields.map((field) => field.name).join(", ")}`)
        this.#asked("Needs something from you", what, request.chatId)
        void this.#askedThroughMain(
          request.chatId,
          request.destination.kind === "login"
            ? `a login for ${request.destination.site}`
            : request.destination.kind === "connector"
              ? `the access token of the connector ${request.destination.name}`
              : `${request.fields.length === 1 ? "the secret" : "the secrets"} ${request.fields.map((field) => field.name).join(", ")}`,
          request.purpose,
          `secret:${request.id}`,
        )
      },
      onSettled: () => this.#tell(),
    })
    this.#signIns = new SignIns({
      agent: async () => {
        const identity = await this.#identity(await this.#open())
        return {
          id: host.name,
          name: identity.name ?? "Your Dood",
          color: avatarLook(identity.avatar, host.name).color,
        }
      },
      computer: (name, c) => this.#computers.resolve(name, c),
      vault: () => this.#vault(),
      chatKind: async (chatId, c) =>
        own((await (await this.#open()).snapshot(ChatsDoc, c))?.chats ?? {}, chatId)?.kind,
      canAsk: async (chatId, c) =>
        canAsk((await (await this.#open()).snapshot(ChatsDoc, c))?.chats, chatId),
      askForLogin: (input, c) => this.#secrets.askForLogin(input, c),
      returnPass: (chatId, binding, c) => this.#approvals.allowOnce(chatId, binding, c),
    })
    this.#pays = new Pays({
      agent: async () => {
        const identity = await this.#identity(await this.#open())
        return {
          id: host.name,
          name: identity.name ?? "Your Dood",
          color: avatarLook(identity.avatar, host.name).color,
        }
      },
      computer: (name, c) => this.#computers.resolve(name, c),
      vault: () => this.#cards(),
      chatKind: async (chatId, c) =>
        own((await (await this.#open()).snapshot(ChatsDoc, c))?.chats ?? {}, chatId)?.kind,
      returnPass: (chatId, binding, c) => this.#approvals.allowOnce(chatId, binding, c),
      now: () => host.now(),
    })
    this.#approvals = new Approvals({
      now: () => host.now(),
      computerOf: (name, c) => this.#computers.peek(name, c),
      connectorOf: async (tool, c) => this.#connectors?.connectorOf(tool, c),
      connectors: async (c) => (await this.#connectors?.list(c)) ?? [],
      describe: async (call, chatId, c) =>
        (await this.#signIns.describe(call, chatId, c)) ??
        (await this.#pays.describe(call, chatId, c)),
      // A card's security code, typed by whoever said the card may be used.
      onTyped: (binding, typed) => this.#pays.hold(binding, typed),
      // Signing in is something only an agent whose workspace keeps logins can do.
      has: async (ability) => ability !== SIGN_IN_ABILITY || (await this.#vault()) !== undefined,
      onRequest: (request) => {
        this.#asked(
          "Needs your OK",
          request.detail === "" ? request.title : `${request.title}: ${request.detail}`,
          // A thread in Slack is answered for in the app, on the thread's own page.
          request.chatKind === "chat" || request.chatKind === "slack" ? request.chatId : null,
        )
        void this.#askedThroughMain(
          request.chatId,
          `leave to ${request.title.charAt(0).toLowerCase()}${request.title.slice(1)}`,
          request.detail === "" ? null : request.detail,
          `approval:${request.id}`,
        )
      },
      onSettled: () => this.#tell(),
    })
    this.#journal = new Journal({
      review: options.review,
      now: () => host.now(),
      context,
      onError: (error) => options.onReport?.(error),
    })
    this.#history = new HistoryIndex(host.sql, () => host.now())
    const busOptions = {
      harness: () => {
        if (this.#opened === undefined) throw new Error("The Dood is not open yet")
        return this.#opened
      },
      checkFiles: (paths: readonly string[], computer: string | undefined, c: Context) =>
        this.#checkFiles(paths, computer, c),
      onSent: (sent: { chatId: string; text: string; files: readonly unknown[] }) =>
        void this.#link.sent({ chatId: sent.chatId, text: sent.text, files: sent.files.length }),
      onError: (error: unknown) => options.onReport?.(error),
    }
    this.#bus = busExtension(busOptions)
    this.#slackBus = slackBusExtension({
      ...busOptions,
      post: async (sent, c) =>
        this.#slack === undefined ? "You are not in Slack." : this.#slack.post(sent, c),
      tellMain: (told, c) => this.#link.tellMain(told, c),
    })
    this.#limits = new RequestLimits({
      sql: host.sql,
      now: () => host.now(),
      context,
      ...(options.requestTries === undefined ? {} : { tries: options.requestTries }),
      ...(options.imageLimits === undefined ? {} : { images: options.imageLimits }),
      onReport: (error) => options.onReport?.(error),
    })
    this.#idle = new IdleCompaction({
      sql: host.sql,
      now: () => host.now(),
      context,
      models: options.models,
      ...(options.imageLimits === undefined ? {} : { imageLimits: options.imageLimits }),
      ...(options.typing === undefined
        ? {}
        : { typing: (chatId: string) => options.typing!(host.name, chatId) }),
      ...(options.idleCompactionMs === undefined ? {} : { afterMs: options.idleCompactionMs }),
      armed: () => void this.#rearm().catch((error) => options.onReport?.(error)),
      onReport: (error) => options.onReport?.(error),
    })
    this.#keepGoing = new KeepGoing({
      judge: options.judge,
      chat: (chatId) => this.#chatState(chatId),
      waiting: (chatId) => this.#jobs.waiting(chatId, context),
      context,
      onError: (error) => options.onReport?.(error),
    })
    this.#scheduler = new Scheduler({
      now: () => host.now(),
      context,
      checks: {
        where: async (name, c) => {
          const target = await this.#computers.resolve(name, c)
          return typeof target === "string" ? target : { name: target.computer.name }
        },
        run: (check, c) => this.#runCheck(check, c),
      },
      onReport: (report) => {
        // Its other chats are told what the latest run of each schedule came to.
        void this.#journal
          .record({
            chatId: report.runChatId,
            title: report.title,
            outcome: report.text,
            schedule: report.scheduleId,
          })
          .catch((error) => options.onReport?.(error))
        // Nobody is told of it here: it went to the main chat, which tells people what it
        // sends, if anything.
      },
      onError: (error) => options.onReport?.(error),
    })
    this.#subagents = new Subagents({
      now: () => host.now(),
      context,
      chat: (chatId) => this.#chatState(chatId),
      // Leave for something, or, through the main chat, a secret, a login or a
      // computer: until someone answers, it waits, and its report is what it says then.
      waiting: async (chatId, c) =>
        (await this.#approvals.pending(c)).some((request) => request.chatId === chatId) ||
        (await this.#secrets.waitingIn(chatId, c)) ||
        (await this.#computers.waitingIn(chatId, c)),
      running: (chatId, c) => this.#jobs.waiting(chatId, c),
      // Nobody answered what it asked for in time: it is taken back, everywhere it was asked.
      withdraw: async (chatId, c) => {
        await this.#approvals.withdraw(chatId, c)
        await this.#secrets.withdraw(chatId, c)
        await this.#computers.withdrawFor(chatId, c)
      },
      ...(options.subagentAskTtlMs === undefined ? {} : { askTtlMs: options.subagentAskTtlMs }),
      onStopped: async (chatId, c) => {
        await this.#approvals.withdraw(chatId, c)
        await this.#secrets.withdraw(chatId, c)
        await this.#computers.withdrawFor(chatId, c)
        // What a stopped sub-agent left running would only set it going again.
        await this.#jobs.stopFor(chatId, c)
      },
      // The agent is at work for as long as a sub-agent of its is.
      onChanged: () => this.#tell(),
      onError: (error) => options.onReport?.(error),
    })
    this.#peers =
      options.agentDirectory === undefined
        ? undefined
        : new Peers({
            agentId: host.name,
            directory: options.agentDirectory,
            now: () => host.now(),
            context,
            chat: (chatId) => this.#chatState(chatId),
            waiting: async (chatId, c) =>
              (await this.#approvals.pending(c)).some((request) => request.chatId === chatId),
            running: (chatId, c) => this.#jobs.waiting(chatId, c),
            onStopped: (chatId, c) => this.#approvals.withdraw(chatId, c),
            onError: (error) => options.onReport?.(error),
          })
    this.#slack =
      options.slackDirectory === undefined
        ? undefined
        : new SlackChats({
            agentId: host.name,
            directory: options.slackDirectory,
            ...(options.slackRetryMs === undefined ? {} : { retryMs: options.slackRetryMs }),
            now: () => host.now(),
            context,
            chat: (chatId) => this.#chatState(chatId),
            waiting: async (chatId, c) =>
              (await this.#approvals.pending(c)).some((request) => request.chatId === chatId),
            running: (chatId, c) => this.#jobs.waiting(chatId, c),
            onStopped: (chatId, c) => this.#approvals.withdraw(chatId, c),
            // Set up for the bus, where it is not yet, before a message is given to it.
            prepare: async (chatId) => this.#syncBus(await this.#open(), chatId),
            keep: (file) => this.#library.keep(file),
            contents: (file) => this.#library.contents(file),
            libraryFile: (name) => this.#library.named(name),
            sees: (model) => this.#sees(model),
            onError: (error) => options.onReport?.(error),
          })
  }

  /**
   * Where the agent's workspace keeps its saved logins, or undefined where it has none to use.
   * Not knowing is taken as having none.
   */
  async #vault(): Promise<ActorStub | undefined> {
    try {
      return await this.#options.savedLogins?.(this.#host.name)
    } catch (error) {
      this.#options.onReport?.(error)
      return undefined
    }
  }

  /** Where the agent's workspace keeps its saved cards, or undefined where it has none to use. */
  async #cards(): Promise<ActorStub | undefined> {
    try {
      return await this.#options.savedCards?.(this.#host.name)
    } catch (error) {
      this.#options.onReport?.(error)
      return undefined
    }
  }

  /** Run an automation's check where it says to, as a command of the agent's own. */
  async #runCheck(check: ScheduleCheck, c: Context): Promise<CheckResult> {
    const target = await this.#computers.resolve(check.computer, c)
    if (typeof target === "string") return { ok: false, error: target }
    // It was allowed when the check was made, and may have been switched off since.
    for (const subject of ["tool:bash", "tool:files", `computer:${target.id}`]) {
      if ((await this.#approvals.ruleFor(subject, c)) === "deny") {
        return {
          ok: false,
          error: `The user has switched off running commands on ${target.computer.name}, in your Permissions, so the check was not run.`,
        }
      }
    }
    if (target.computer.readOnly) {
      return {
        ok: false,
        error: `${target.computer.name} is read-only: commands cannot be run there.`,
      }
    }
    const outcome = await target.sandbox.exec(check.command, {
      cwd: target.cwd,
      timeoutMs: CHECK_TIMEOUT_MS,
    })
    await target.sandbox.flush()
    const said = outcome.output.trim()
    if (outcome.timedOut === true) {
      return {
        ok: false,
        error: [`It was stopped after ${CHECK_TIMEOUT_MS / 1000} seconds.`, said]
          .filter(Boolean)
          .join("\n"),
      }
    }
    if (outcome.exitCode !== 0) {
      return {
        ok: false,
        error: [`It ended with exit code ${outcome.exitCode}.`, said].filter(Boolean).join("\n"),
      }
    }
    return { ok: true, output: outcome.output }
  }

  /** A chat as a client would see it, or undefined if there is no such chat or nothing is open. */
  async #chatState(chatId: string): Promise<ChatState | undefined> {
    const harness = await this.#harness
    const conversation = await harness?.conversation(Number(chatId) as ConversationId, context)
    if (conversation === undefined) return undefined
    const view = await conversation.viewState(context)
    try {
      return projectChat(view.value)
    } finally {
      view.dispose()
    }
  }

  /** The address people reach the app at, where that is known. */
  #appUrl(): string | undefined {
    return (this.#options.appUrl ?? this.#origin)?.replace(/\/+$/, "")
  }

  /** Where a service sends someone back after they sign in to a connector. */
  #connectorRedirect(): string | undefined {
    const app = this.#appUrl()
    return app === undefined ? undefined : `${app}${CONNECTOR_CALLBACK_PATH}`
  }

  #offers(kind: string): boolean {
    return this.#choices.kinds.some((offered) => offered.id === kind)
  }

  /** Whether the agent's host says which machines there are, and so the agent has none to itself. */
  get #hosted(): boolean {
    return this.#options.computerDirectory?.machines !== undefined
  }

  /** The library of the agent's workspace, where its host keeps one. */
  async #libraryStub(): Promise<ActorStub | undefined> {
    return this.#options.library?.(this.#host.name)
  }

  async #sharedLibrary(): Promise<RemoteLibrary | undefined> {
    const stub = await this.#libraryStub()
    return stub === undefined ? undefined : remoteLibrary(stub)
  }

  /** A machine the agent has to itself, where nobody says which machines there are. */
  #ownMachine(kind: string): (AgentComputer & { id: string }) | undefined {
    const sandbox = this.#choices.create(kind, this.#host.name, this.#host)
    if (sandbox === undefined) return undefined
    return {
      // Named for the agent too: a library that several agents share tells machines apart by id.
      id: `own:${this.#host.name}:${kind}`,
      name: "computer",
      kind,
      machineKey: this.#host.name,
      platform: "linux",
      hostname: "",
      home: sandbox.home,
      folder: sandbox.home,
      readOnly: false,
      pairedAt: this.#host.now(),
    }
  }

  /**
   * An agent from before computers belonged to a workspace had a machine of its own, and one
   * left behind for each kind it was moved away from. They are handed to its host, which says
   * which of them the agent goes on using. That happens once.
   */
  async #adopt(harness: Harness): Promise<void> {
    const identity = await harness.snapshot(IdentityDoc, context)
    if (identity === undefined || identity.ownerId === "" || identity.adopted === true) return
    const chosen = identity.computer
    // A kind that is no longer offered cannot be reached, and is left where it is.
    const current = chosen !== undefined && this.#offers(chosen) ? chosen : this.#choices.default
    const kinds = [...new Set([current, ...(identity.computers ?? [])])].filter(
      (kind) => kind === current || this.#offers(kind),
    )
    const machines = kinds.flatMap((kind) => {
      const own = this.#ownMachine(kind)
      return own === undefined ? [] : [{ ...own, current: kind === current }]
    })
    const directory = this.#options.computerDirectory
    const mine =
      directory?.adopt === undefined || !this.#hosted
        ? machines.filter((machine) => machine.current).map(({ current: _current, ...own }) => own)
        : await directory.adopt(
            this.#host.name,
            machines.map(({ kind, home, current }) => ({ kind: kind!, home, current })),
            identity.name,
          )
    // Its memory was mirrored as files in the home directory of each machine it had to itself,
    // and they are still there.
    await this.#computers.setMachines(
      mine.map((machine) => ({ ...machine, mirrored: machine.machineKey === this.#host.name })),
      context,
    )
    // What each machine's library folder held was kept under the kind, and is now under the machine.
    for (const machine of mine) {
      const legacy = machine.kind === "" ? "default" : machine.kind
      const base = legacy === undefined ? undefined : await this.#ownLibrary.base(legacy)
      if (base === undefined) continue
      await this.#ownLibrary.takeBase(machine.id, base)
      await this.#ownLibrary.dropBase(legacy!)
    }
    await harness.commit(async (tx) => {
      const doc = await tx.doc(IdentityDoc)
      doc.adopted = true
      // Kept for an agent with machines to itself, which deletes them when it is deleted.
      if (kinds.length > 0 && this.#choices.kinds.length > 0) doc.computers = kinds
    }, context)
  }

  /**
   * An agent that kept a library for itself, in a workspace that now keeps one for all its
   * agents: its files move there, with their history, and its own is left empty. Running it
   * again after it was cut short moves what is left.
   */
  async #moveLibrary(): Promise<void> {
    if (this.#options.library === undefined || this.#opened === undefined) return
    const { files, deleted } = await this.#ownLibrary.everything()
    if (files.length === 0 && deleted.length === 0) return
    const shared = await this.#sharedLibrary()
    if (shared === undefined) return
    const identity = await this.#opened.snapshot(IdentityDoc, context)
    for (const [id, entry] of [...files, ...deleted]) {
      const revs = [entry.rev ?? 0, ...(entry.versions ?? []).map((version) => version.rev)]
      for (const rev of revs) {
        const bytes = await this.#ownLibrary.bytes({ id, rev })
        if (bytes !== undefined) await shared.takeBytes(id, rev, bytes, entry.contentType)
      }
      await shared.take(id, entry, {
        // Where another agent's file is in its place, it goes under a folder named for this one.
        folder: identity?.name ?? "agent",
        agentId: this.#host.name,
      })
    }
    for (const computer of await this.#computers.list(context)) {
      const base = await this.#ownLibrary.base(computer.id)
      if (base === undefined) continue
      await shared.takeBase(computer.id, base)
      await this.#ownLibrary.dropBase(computer.id)
    }
    await this.#ownLibrary.empty()
  }

  #open(): Promise<Harness> {
    const opening: Promise<Harness> = (this.#harness ??= (async () => {
      const registry = createRegistry()
      // For tools that read the harness they are installed in, once it exists.
      let opened: Harness | undefined
      registry.install(persona(this.#link))
      // First among the tool hooks: a call that is not allowed should cause nothing at all.
      registry.install(this.#approvals.extension)
      // The file and shell tools, which run on whichever computer a call is for.
      // pi-durable's coding tools, with a `bash` that can leave a command running.
      registry.install(
        defineExtension({
          name: "coding-tools",
          tools: [createReadTool(), createWriteTool(), createEditTool(), this.#jobs.bashTool],
        }),
      )
      registry.install(this.#computers.extension)
      // Its tools take a computer too, as the wraps above say.
      registry.install(this.#library.extension)
      // A page drawn into the chat, and one given a link, are both kept in the library.
      const backend = async () => (await this.#sharedLibrary()) ?? this.#ownLibrary
      registry.install(
        visuals({
          backend,
          ...(this.#options.library === undefined ? {} : { agentId: this.#host.name }),
          ...(this.#options.pagePreviewer === undefined
            ? {}
            : { previewer: this.#options.pagePreviewer }),
          // The built-in echo is shown the picture too: it is how the tool is tried.
          sees: async () => {
            const { model } = await this.#identity(await this.#open())
            return model === ECHO_MODEL || this.#sees(model)
          },
          appUrl: () => this.#appUrl(),
          // Where a person's browser is sent for a file of the library, and so the server's.
          viewRoot: async () => {
            const app = this.#appUrl()
            if (app === undefined) return undefined
            const view = await (await backend()).viewToken()
            return `${app}/d/${encodeURIComponent(this.#host.name)}/${view}/`
          },
          color: async () =>
            avatarLook((await this.#identity(await this.#open())).avatar, this.#host.name).color,
        }),
      )
      if (this.#options.sites !== undefined) {
        registry.install(
          sites({
            agentId: this.#host.name,
            directory: this.#options.sites,
            backend,
            appUrl: () => this.#appUrl(),
          }),
        )
      }
      registry.install(this.#pins.extension)
      registry.install(this.#scheduler.extension)
      registry.install(this.#subagents.extension)
      registry.install(this.#jobs.extension)
      registry.install(this.#uses.extension)
      if (this.#peers !== undefined) registry.install(this.#peers.extension)
      if (this.#slack !== undefined) registry.install(this.#slack.extension)
      registry.install(this.#skills.extension)
      registry.install(this.#secrets.extension)
      // Signing in with a saved login, where the agent's workspace has any to use. It is
      // looked up as the agent is opened: one that gains or loses them is told the next time.
      if ((await this.#vault()) !== undefined) registry.install(this.#signIns.extension)
      if ((await this.#cards()) !== undefined) registry.install(this.#pays.extension)
      registry.install(
        settingsExtension({
          models: () => this.#modelOptions(),
          state: async () => {
            const identity = await this.#identity(await this.#open())
            return {
              model: identity.model,
              thinking: identity.thinking ?? DEFAULT_THINKING,
              timezone: identity.timezone ?? null,
            }
          },
          update: async (change: SettingsChange) => {
            try {
              await this.#apply(await this.#open(), change as Record<string, unknown>)
            } catch (error) {
              if (error instanceof HttpError) throw new SettingsError(error.message)
              throw error
            }
          },
          usage: async () => this.#usage(await this.#open()),
        }),
      )
      registry.install(appGuide({ agentId: this.#host.name, appUrl: () => this.#appUrl() }))
      registry.install(logExtension(() => this.#host.now()))
      registry.install(this.#keepGoing.extension)
      if (this.#options.webSearch !== undefined) {
        registry.install(webSearchExtension(this.#options.webSearch))
      }
      // What its other chats have been about, then the tool that reads them.
      registry.install(this.#journal.extension)
      registry.install(this.#idle.extension)
      registry.install(
        historyExtension(() => {
          if (opened === undefined) throw new Error("The Dood is not open yet")
          return opened
        }, this.#history),
      )
      // Finds the tools that are not offered until asked for, which a connector's are.
      registry.install(createToolSearchExtension())
      for (const extension of this.#options.extensions ?? []) registry.install(extension)
      // After the others, so that what they add to a request is counted with the rest. Its hook is
      // the one place a request is changed (`shapeRequest`), which the idle compaction's summary
      // request repeats so as to be read from the cache: another `beforeRequest` hook, such as
      // one in `extensions`, would make the two differ. The bus, installed after it, has none:
      // it adds a section and a tool, which a main chat with it on has in both.
      registry.install(this.#limits.extension)
      // Selected by a main chat, and the other by a thread in Slack, and by no other chat: see
      // `settings` below.
      registry.install(this.#bus)
      registry.install(this.#slackBus)
      const harness = await Harness.open(
        await SqliteStorage.open(keptOpen(this.#host.sql)),
        {
          models: this.#options.models,
          registry,
          now: () => this.#host.now(),
          onReport: (error) => this.#options.onReport?.(error),
          settings: {
            // Every extension but the bus's, which only a main chat or a thread in Slack adds to
            // its own. Read each time, since connectors install theirs while the
            // agent runs.
            get extensions() {
              return registry
                .snapshot()
                .installed()
                .filter((extension) => !BUS_EXTENSIONS.has(extension.name))
            },
            toolExecution: "parallel",
            // What waits for the agent to finish is taken up together when it does, in one run:
            // several events that arrive while it works are one more turn, not one turn each.
            followUpMode: "all",
            // The longest cache a provider keeps: an hour on Claude where five minutes is usual.
            // It costs more to write and the same to read. A chat picked up again within the
            // hour then reads its prompt from the cache.
            stream: { cacheRetention: CACHE_RETENTION },
            ...(this.#options.compaction === undefined
              ? {}
              : { compaction: this.#options.compaction }),
            ...(this.#options.contextRetentionMs === undefined
              ? {}
              : { contextRetentionMs: this.#options.contextRetentionMs }),
            ...(this.#options.documentRetentionMs === undefined
              ? {}
              : { documentRetentionMs: this.#options.documentRetentionMs }),
          },
        },
        context,
      )
      opened = harness
      this.#opened = harness
      // A storage error ends a harness for good: it closes itself, and every call after is
      // refused. The agent is then put away as `close()` does, and woken to pick up from
      // what is stored, which is whole, since nothing is stored by halves.
      void harness.closed.then(async (end) => {
        if (end.reason !== "failed" || this.#harness !== opening) return
        try {
          await this.#putAway()
          await this.#host.setAlarm(this.#host.now() + REOPEN_MS)
        } catch (error) {
          this.#options.onReport?.(error)
        }
      })
      this.#approvals.attach(harness)
      this.#keepGoing.attach(harness)
      this.#limits.attach(harness)
      this.#journal.attach(harness)
      this.#idle.attach(harness)
      this.#computers.attach(harness)
      this.#scheduler.attach(harness)
      this.#subagents.attach(harness)
      this.#jobs.attach(harness)
      this.#peers?.attach(harness)
      this.#slack?.attach(harness)
      this.#skills.attach(harness)
      this.#secrets.attach(harness)
      await this.#ownLibrary.upgrade()
      // Neither stops the agent opening: what could not be done now is tried the next time.
      await this.#adopt(harness).catch((error) => this.#options.onReport?.(error))
      await this.#moveLibrary().catch((error) => this.#options.onReport?.(error))
      // Every main chat and thread in Slack is a bus. One from before that is set up for it here,
      // so that what reaches it first, a person or an event, finds it so.
      await this.#syncBus(harness).catch((error) => this.#options.onReport?.(error))
      // Connector tools come and go while the agent runs, so they are installed after opening.
      this.#connectors = new Connectors({
        sql: this.#host.sql,
        now: () => this.#host.now(),
        install: (extension) => registry.install(extension),
        fetch: this.#options.connectorFetch,
        allowPrivateHosts: this.#options.allowPrivateHosts,
        resolveHost: this.#options.resolveHost,
        blobs: this.#host.blobs,
        redirectUrl: () => this.#connectorRedirect(),
        appsUrl: this.#options.appsUrl,
        // It can send mail as someone, so it starts out asking before it does anything.
        appsAdded: async (id, c) => {
          await this.#approvals.setRules({ [`connector:${id}`]: "ask" }, c)
        },
        askToken: (input, c) =>
          this.#secrets.ask(
            {
              chatId: input.chatId,
              purpose: `The access token for the connector "${input.name}", so that I can use it.`,
              fields: [
                {
                  name: "ACCESS_TOKEN",
                  description: `The access token that ${new URL(input.url).host} issued you`,
                },
              ],
              destination: { kind: "connector", name: input.name, url: input.url },
            },
            c,
          ),
      })
      await this.#connectors.attach(harness, context)
      // An agent that is still to be set up gets its skills then.
      if (((await harness.snapshot(IdentityDoc, context))?.ownerId ?? "") !== "") {
        await this.#skills.seed(context)
      }
      // Made up front, so that they can be watched before they have anything in them.
      const unmade: SessionDocToken<JsonObject>[] = []
      for (const [, doc, made] of TOLD) {
        if (made === "here" && (await harness.snapshot(doc, context)) === undefined)
          unmade.push(doc)
      }
      if (unmade.length > 0) {
        await harness.commit(async (tx) => {
          for (const doc of unmade) await tx.doc(doc)
        }, context)
      }
      // A schedule the agent creates or changes moves the next wake-up.
      const schedules = await harness.watchDoc(SchedulesDoc, context)
      schedules?.start(async () => {
        await this.#rearm().catch((error) => this.#options.onReport?.(error))
      })
      // Before anything goes on: sockets that stayed while the agent was put away are told
      // where things stand now, and of everything from here. An agent opens without them.
      await this.#followers.attach(harness).catch((error) => this.#options.onReport?.(error))
      // Pick up whatever a previous process left unfinished.
      harness.resume()
      return harness
    })())
    opening.catch(() => {
      if (this.#harness === opening) this.#harness = undefined
    })
    return opening
  }

  /**
   * Set the one wake-up to the sooner of two needs: keeping live work going, and the next
   * schedule. Clear it when there is neither.
   */
  async #rearm(): Promise<void> {
    if (this.#harness === undefined) return
    const harness = await this.#harness
    const seen = this.#host.now()
    const inspection = await harness.inspect(context)
    // A request that came to no answer is counted until its task ends, however it ends.
    await this.#limits.starts
      .prune(new Set(inspection.tasks.map((task) => String(task.record.id))), seen)
      .catch((error) => this.#options.onReport?.(error))
    // Work that nothing this deployment has can run is not woken for, and is not the agent at
    // work: only another deployment gets it further, and it is found again when the agent is
    // next opened.
    const work = liveWork(inspection)
    if (work.live) {
      this.#found(harness)
    } else {
      // Where the watch gave up before the work was over, its end is found here.
      this.#rested()
    }
    for (const task of work.blocked) {
      const id = String(task.record.id)
      if (this.#blockedTold.has(id) || task.state.kind !== "blocked") continue
      this.#blockedTold.add(id)
      this.#options.onReport?.(
        new Error(
          `Task ${id} (${task.record.kind} v${task.record.version}) of agent ${this.#host.name} cannot run in this deployment: ${task.state.reason}`,
        ),
      )
    }
    // A sub-agent that has finished and not yet reported has nothing live, and still needs a
    // look. So does a conversation with another agent whose answer is still to be handed back,
    // and a thread in Slack whose answer is still to be posted.
    const live =
      work.live ||
      (await this.#subagents.working(context)) ||
      (await this.#jobs.working(context)) ||
      (await this.#scheduler.working(context)) ||
      ((await this.#peers?.working(context)) ?? false) ||
      ((await this.#slack?.working(context)) ?? false)
    // A wake-up that is still to come is left where it is. Every request comes through here,
    // and one that put it off each time would keep what is looked at on waking from being
    // looked at for as long as requests kept coming.
    const now = this.#host.now()
    const keepAlive = !live
      ? null
      : this.#wake !== undefined && this.#wake > now
        ? this.#wake
        : now + (this.#options.keepAliveMs ?? KEEPALIVE_MS)
    this.#wake = keepAlive ?? undefined
    const tasks = await this.#scheduler.nextWake(context)
    const calls = await this.#calls.nextWake()
    const idle = await this.#idle.nextWake()
    // A sub-agent waiting too long for an answer has what it asked for taken back.
    const unanswered = await this.#subagents.nextWake(context)
    const scheduled = [tasks, calls, idle, unanswered].reduce<number | null>(
      (soonest, at) => (at === null ? soonest : soonest === null ? at : Math.min(soonest, at)),
      null,
    )
    const wake =
      keepAlive === null
        ? scheduled
        : scheduled === null
          ? keepAlive
          : Math.min(keepAlive, scheduled)
    if (wake !== null) await this.#host.setAlarm(wake)
    else if ((await this.#host.getAlarm()) !== null) await this.#host.setAlarm(null)
  }

  /**
   * A run of the agent's was found going or waiting its turn. `onActivity` is told where that
   * is news, whatever set the run going: a person, a schedule, a wake-up, a sub-agent, or a
   * command that ended. Its end is watched for from here, so that it is told of too.
   */
  #found(harness: Harness): void {
    if (this.#options.onActivity === undefined) return
    if (!this.#atWork) {
      this.#atWork = true
      this.#tell()
    }
    this.#tellWhenRested(harness)
  }

  /**
   * `onActivity` is told when the work in hand is over. Nothing else says so of a run that ended
   * without an answer, or of one that no request was waiting on. One watch at a time: work that
   * begins before this one is over is the same spell of work.
   */
  #tellWhenRested(harness: Harness): void {
    if (this.#resting !== undefined) return
    this.#resting = (async () => {
      try {
        await harness.waitForIdle(context)
        // Told only where nothing is left: work that is still to start, or that began meanwhile,
        // is found by the request or the wake-up that comes next.
        if (!liveWork(await harness.inspect(context)).live) this.#rested()
      } catch (error) {
        // An agent that was closed meanwhile is found at work, or at rest, when it next opens.
        if (this.#opened === harness) this.#options.onReport?.(error)
      } finally {
        this.#resting = undefined
      }
    })()
  }

  /** The work that was in hand is over, which is told once. */
  #rested(): void {
    if (!this.#atWork) return
    this.#atWork = false
    this.#tell()
  }

  async alarm(): Promise<void> {
    await this.#keepRunnable(await this.#open())
    await this.#scheduler.tick(context)
    await this.#calls.tick()
    await this.#subagents.tick()
    await this.#jobs.tick()
    await this.#peers?.tick()
    await this.#slack?.tick()
    await this.#idle.tick()
    await this.#rearm()
    // One woken after its process was lost has told nobody how it stands, and what it said
    // before may not be so any more: work it had in hand can have ended with nobody told.
    this.#tell()
  }

  /**
   * Someone following the agent connected. Everything they follow comes over this one socket:
   * the agent's documents from the start, and each chat they ask for.
   */
  async socketOpen(socket: ActorSocket): Promise<void> {
    await this.#open()
    await this.#followers.open(socket)
  }

  async socketMessage(socket: ActorSocket, data: string): Promise<void> {
    // Opening the agent attaches its sockets again, where it had been put away.
    await this.#open()
    await this.#followers.message(socket, data)
  }

  async socketClose(socket: ActorSocket): Promise<void> {
    // An agent that is not open is watching nothing, and is not opened to hear that.
    if (this.#harness === undefined) return
    await this.#followers.close(socket)
  }

  /** Unfinished runs stay pending in the store; the next process resumes them. */
  async close(): Promise<void> {
    try {
      await this.#putAway()
    } finally {
      await this.#host.sql.close()
    }
  }

  /** Stop work and let go of the harness. The database stays open, for whatever opens next. */
  async #putAway(): Promise<void> {
    const harness = this.#harness
    this.#harness = undefined
    this.#opened = undefined
    this.#followers.stop()
    this.#jobs.close()
    await this.#connectors?.close()
    await (await harness)?.close(context)
  }

  /**
   * Delete the agent and everything it has stored. For the gateway, after the owner asked for
   * it. The machines of a workspace are not the agent's to delete. One that has machines to
   * itself, because nobody says which there are, deletes those first.
   */
  async #destroy(harness: Harness): Promise<Response> {
    // What it left running on machines it shares would otherwise run on with nobody to stop it.
    await this.#jobs.stopAll(context)
    if (!this.#hosted) {
      // An agent that was moved left a machine behind each time, and those go too.
      const had = new Set([
        ...((await harness.snapshot(IdentityDoc, context))?.computers ?? []),
        ...(await this.#computers.list(context)).flatMap((computer) =>
          computer.id.startsWith("own:") && computer.kind !== undefined ? [computer.kind] : [],
        ),
      ])
      // The machines first, while nothing else is lost yet. If a provider cannot be reached the
      // agent is left whole, so the owner can try again instead of paying for a machine nobody
      // can find.
      try {
        for (const kind of had) {
          if (kind === "" || this.#offers(kind)) {
            await this.#choices.create(kind, this.#host.name, this.#host)?.destroy?.()
          } else {
            // Nothing here can reach it any more. Deleting the rest is still what was asked for.
            this.#options.onReport?.(
              new Error(
                `An agent that was deleted had a computer of kind "${kind}", which this server no longer offers, so that computer was left where it is.`,
              ),
            )
          }
        }
      } catch (error) {
        throw new HttpError(
          502,
          `The Dood's computer could not be deleted, so nothing was: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
    // Stop every run and release the database before the host removes it.
    await this.close()
    await this.#host.destroy()
    return json({ ok: true })
  }

  async fetch(request: Request): Promise<Response> {
    try {
      return await this.#route(request)
    } catch (error) {
      if (error instanceof HttpError || error instanceof CallError) {
        return json({ error: error.message, code: error.code }, error.status)
      }
      if (
        error instanceof ScheduleError ||
        error instanceof SubagentError ||
        error instanceof JobError ||
        error instanceof UseError ||
        error instanceof PeerError ||
        error instanceof SlackError ||
        error instanceof SkillError ||
        error instanceof LibraryError ||
        error instanceof PinError ||
        error instanceof HistoryError ||
        error instanceof ApprovalError ||
        error instanceof ConnectorError ||
        error instanceof SecretError
      ) {
        return json({ error: error.message }, 400)
      }
      this.#options.onReport?.(error)
      return json({ error: error instanceof Error ? error.message : String(error) }, 500)
    } finally {
      try {
        await this.#rearm()
      } catch (error) {
        this.#options.onReport?.(error)
      }
    }
  }

  async #route(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const segments = url.pathname.split("/").filter(Boolean)
    // Segments become ids and names. One that every object inherits is never either of those.
    if (segments.some(isInherited)) throw new HttpError(404, "Not found")
    const method = request.method
    const origin = request.headers.get(APP_ORIGIN_HEADER)
    if (origin !== null && /^https?:\/\/[^\s/]+$/.test(origin)) this.#origin = origin
    const harness = await this.#open()

    if (segments[0] === "init" && method === "POST") {
      return this.#init(
        harness,
        await body<{ ownerId: string; team?: string | null; model?: string }>(request),
      )
    }
    // Which team shares it, from the gateway, which is what knows.
    if (segments[0] === "team" && method === "PUT") {
      const { team } = await body<{ team?: string | null }>(request)
      await harness.commit(async (tx) => {
        ;(await tx.doc(IdentityDoc)).team = typeof team === "string" && team !== "" ? team : null
      }, context)
      return json({ ok: true })
    }
    const caller = readCaller(request)
    if (segments[0] === "destroy" && method === "POST") return this.#destroy(harness)
    await this.#keepRunnable(harness)
    const identity = await this.#identity(harness)

    if (segments.length === 0) {
      if (method === "GET") return json(await this.#state(harness, identity))
      if (method === "PATCH") {
        await this.#apply(harness, await body<Record<string, unknown>>(request))
        return json(await this.#state(harness, await this.#identity(harness)))
      }
    }
    if (segments[0] === "events" && method === "GET") return this.#agentEvents(harness)
    // What its creature was given from outside the app, from the gateway, which counted it.
    if (segments[0] === "gifts" && method === "POST") {
      return this.#gifted(harness, await body<{ treats?: unknown; item?: unknown }>(request))
    }
    if (segments[0] === "creature") {
      if (segments[1] === undefined && method === "GET") return json(await this.#creature(harness))
      if (segments[1] === "feed" && method === "POST") return this.#feed(harness)
      if (segments[1] === "open" && method === "POST") return this.#openBox(harness)
      if (segments[1] === "outfit" && method === "PUT") {
        return this.#wear(harness, await body<{ outfit?: unknown }>(request))
      }
    }
    if (segments[0] === "computers") {
      const computerId = segments[1]
      if (computerId === undefined && method === "GET") {
        return json({ computers: await this.#computers.list(context) })
      }
      // Every machine of the workspace the agent can use, from its host, which is what knows.
      if (computerId === undefined && method === "PUT") {
        const { machines } = await body<{ machines?: (AgentComputer & { id: string })[] }>(request)
        if (!Array.isArray(machines)) throw new HttpError(400, "machines is required")
        await this.#computers.setMachines(machines, context)
        this.#library.forget()
        return json({ computers: await this.#computers.list(context) })
      }
      if (computerId !== undefined && segments[2] === "answer" && method === "POST") {
        const answer = await body<ComputerAnswer>(request)
        const turn = await this.#computers.answered(computerId, answer, context)
        if (turn !== undefined && answer.chatId !== null) {
          const chatId = answer.chatId
          await harness.commit(async (tx) => {
            const chat = own((await tx.doc(ChatsDoc)).chats, chatId)
            if (chat !== undefined) chat.updatedAt = this.#host.now()
          }, context)
          // What the agent says about it is told like any other answer nobody was there for.
          void this.#notifyWhenUnseen(harness, chatId, turn, undefined)
        }
        // The answer sets a sub-agent that asked through the main chat going again.
        await this.#subagents.tick()
        return json({ ok: true })
      }
      if (computerId !== undefined && method === "PUT") {
        const computer = await body<AgentComputer>(request)
        return json(await this.#computers.put(computerId, computer, context))
      }
      if (computerId !== undefined && method === "DELETE") {
        await this.#computers.remove(computerId, context)
        return json({ ok: true })
      }
    }
    // Word from another agent in the workspace, which the host has checked is one.
    if (segments[0] === "peers" && this.#peers !== undefined && method === "POST") {
      const from = segments[1]
      if (from !== undefined && segments[2] === "message" && segments[3] === undefined) {
        const message = await body<PeerMessage>(request)
        const received = await this.#peers.receive(from, message, context)
        // What another agent wrote to it is its latest line, as what a person wrote would be.
        const name = typeof message.from === "string" ? message.from.trim() : ""
        await this.#record({
          kind: "agent",
          text: message.text,
          ...(name === "" ? {} : { from: name }),
        })
        return json(received)
      }
      if (from !== undefined && segments[2] === "reply" && segments[3] === undefined) {
        const delivered = await this.#peers.replied(from, await body<PeerReply>(request), context)
        if (delivered === undefined) throw new HttpError(404, "Chat not found")
        // What the agent says about it is told like any other answer nobody was there for.
        if (!delivered.thread) {
          void this.#notifyWhenUnseen(harness, delivered.chatId, delivered.turn, undefined)
        }
        return json({ ok: true })
      }
    }
    // Something said to the agent in Slack, which the host has checked came from Slack.
    if (
      segments[0] === "slack" &&
      segments[1] === "message" &&
      segments[2] === undefined &&
      this.#slack !== undefined &&
      method === "POST"
    ) {
      return json(await this.#slack.receive(await body<SlackMessage>(request), context))
    }
    if (segments[0] === "connectors" && this.#connectors !== undefined) {
      const connectors = this.#connectors
      const connectorId = segments[1]
      const action = segments[2]
      // Where a sign-in returns to. Only the gateway can say, so only it can add or reconnect.
      const redirect = () => {
        const url = request.headers.get(CONNECTOR_REDIRECT_HEADER)
        if (url === null)
          throw new HttpError(400, "A connector can only be connected from the app.")
        return url
      }
      // The gateway also needs the value that will identify the returning user.
      const withState = async (result: Awaited<ReturnType<Connectors["connect"]>>) =>
        json({ ...result, state: await connectors.pendingState(result.connector.id) })
      if (connectorId === undefined && method === "GET") {
        return json({ connectors: await connectors.list(context) })
      }
      if (connectorId === undefined && method === "POST") {
        const input = await body<AddConnectorRequest>(request)
        return withState(await connectors.add(input, redirect(), context))
      }
      if (connectorId !== undefined && action === "connect" && method === "POST") {
        return withState(await connectors.connect(connectorId, redirect(), context))
      }
      if (connectorId !== undefined && action === "authorize" && method === "POST") {
        const { code, iss } = await body<{ code?: string; iss?: string }>(request)
        if (typeof code !== "string" || code === "") throw new HttpError(400, "code is required")
        const { turn, ...result } = await connectors.authorize(
          connectorId,
          { code, ...(typeof iss === "string" && iss !== "" ? { iss } : {}) },
          context,
          caller,
        )
        // What the agent says about it is told like any other answer nobody was there for.
        if (turn !== undefined && result.chatId !== undefined) {
          await this.#touch(harness, result.chatId)
          void this.#notifyWhenUnseen(harness, result.chatId, turn, undefined)
        }
        return json(result)
      }
      // Someone chose not to sign in to a connector the agent added.
      if (connectorId !== undefined && action === "dismiss" && method === "POST") {
        await connectors.dismiss(connectorId, context, caller)
        return json({ ok: true })
      }
      // A page one of this connector's tools was shown with asks its server for something.
      if (connectorId !== undefined && action === "app-call" && method === "POST") {
        const asked = await body<{ tool?: unknown; arguments?: unknown; confirmed?: unknown }>(
          request,
        )
        if (typeof asked.tool !== "string" || asked.tool === "") {
          throw new HttpError(400, "tool is required")
        }
        const given = asked.arguments ?? {}
        if (typeof given !== "object" || given === null || Array.isArray(given)) {
          throw new HttpError(400, "arguments must be an object")
        }
        // A connector the agent itself asks before using is asked about for a page too.
        const rule = await this.#approvals.ruleFor(`connector:${connectorId}`, context)
        try {
          return json(
            await connectors.appCall(
              connectorId,
              {
                tool: asked.tool,
                arguments: given as Record<string, unknown>,
                confirmed: asked.confirmed === true,
                ask: rule === "ask",
              },
              context,
            ),
          )
        } catch (error) {
          if (!(error instanceof AppNeedsConsent)) throw error
          // Not an error to the page's client: it asks the person, and asks again with a yes.
          return json({ needsConsent: { tool: error.tool, description: error.description } })
        }
      }
      if (connectorId !== undefined && action === "app-read" && method === "POST") {
        const { uri } = await body<{ uri?: unknown }>(request)
        if (typeof uri !== "string" || uri === "" || uri.length > 2000) {
          throw new HttpError(400, "uri is required")
        }
        return json(await connectors.appRead(connectorId, uri, context))
      }
      if (connectorId !== undefined && action === undefined && method === "PATCH") {
        const { enabled } = await body<{ enabled?: boolean }>(request)
        if (typeof enabled !== "boolean") throw new HttpError(400, "enabled must be true or false")
        return json(await connectors.setEnabled(connectorId, enabled, context))
      }
      if (connectorId !== undefined && action === undefined && method === "DELETE") {
        await connectors.remove(connectorId, context)
        return json({ ok: true })
      }
    }
    // A page a connector's server gave for one of its tools, as it was kept when the tool was
    // used. It is somebody else's page: it is served to be shown in a frame whose origin is
    // nobody's, under a policy that lets it load only what its server said it needs.
    if (segments[0] === "apps" && segments[2] === undefined && method === "GET") {
      const page = await this.#connectors?.appPage(segments[1] ?? "")
      if (page === undefined) throw new HttpError(404, "No such page")
      return new Response(page.html.slice().buffer, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": mcpAppContentSecurityPolicy(page.csp),
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          // Kept under a name made from what is in it, so it never changes.
          "cache-control": "private, max-age=31536000, immutable",
        },
      })
    }
    if (segments[0] === "view" || segments[0] === "library") {
      // A workspace's library answers for itself. The agent's own is answered for here.
      const shared = await this.#libraryStub()
      if (shared !== undefined) {
        const forwarded = new Request(`http://library${url.pathname}${url.search}`, request)
        forwarded.headers.set(LIBRARY_AGENT_HEADER, this.#host.name)
        return shared.fetch(forwarded)
      }
      if (segments[0] === "view") {
        // The page's own path is taken apart there, as it was sent.
        return routeLibraryView(
          this.#ownLibrary,
          request,
          url.pathname.split("/").filter(Boolean).slice(1),
        )
      }
      const response = await routeLibrary(this.#ownLibrary, request, segments.slice(1))
      if (response !== undefined) return response
    }
    if (segments[0] === "pins") {
      // What is pinned to the agent, and a person pinning a file of the library or taking a pin off.
      const fileId = segments[1]
      if (fileId === undefined && method === "GET") return json({ pins: await this.#pins.list() })
      if (fileId !== undefined && segments[2] === undefined && method === "PUT") {
        const backend = (await this.#sharedLibrary()) ?? this.#ownLibrary
        const file = (await backend.list()).find((entry) => entry.id === fileId)
        if (file === undefined) throw new HttpError(404, "That file is not in the library")
        // A title comes with a pin that is put back as it was. Pinning a file sends nothing.
        const { title } = await request
          .json()
          .then((sent) => (sent ?? {}) as { title?: unknown })
          .catch(() => ({ title: undefined }))
        await this.#pins.pin(file, "user", typeof title === "string" ? title : undefined)
        return json({ pins: await this.#pins.list() })
      }
      if (fileId !== undefined && segments[2] === undefined && method === "DELETE") {
        await this.#pins.unpin({ id: fileId })
        return json({ pins: await this.#pins.list() })
      }
    }
    if (segments[0] === "skills") {
      const name = segments[1]
      if (name === undefined && method === "GET") {
        return json({ skills: await this.#skills.list(context) })
      }
      if (name === "install" && method === "POST") {
        const { url } = await body<{ url?: string }>(request)
        if (typeof url !== "string" || url.trim() === "")
          throw new HttpError(400, "url is required")
        return json(await this.#skills.install(url, context), 201)
      }
      if (name !== undefined && segments[2] === undefined) {
        if (method === "GET") return json(await this.#skills.get(name, context))
        if (method === "PATCH") {
          const { enabled } = await body<{ enabled?: boolean }>(request)
          if (typeof enabled !== "boolean")
            throw new HttpError(400, "enabled must be true or false")
          return json(await this.#skills.setEnabled(name, enabled, context))
        }
        if (method === "DELETE") {
          await this.#skills.remove(name, context)
          return json({ ok: true })
        }
      }
    }
    if (segments[0] === "approvals") {
      const requestId = segments[1]
      if (requestId === undefined && method === "GET") {
        return json(await this.#approvals.state(context))
      }
      if (requestId === "rules" && method === "PATCH") {
        return json(
          await this.#approvals.setRules(await body<Record<string, unknown>>(request), context),
        )
      }
      if (requestId !== undefined && segments[2] === undefined && method === "POST") {
        const { decision, typed } = await body<{ decision: ApprovalDecision; typed?: unknown }>(
          request,
        )
        const told = await this.#approvals.resolve(
          requestId,
          decision,
          context,
          identity.team ? caller : undefined,
          typed,
        )
        // What the agent says once it has its answer is its latest line, and nothing more
        // follows from it.
        if (told !== undefined) {
          void this.#notifyWhenUnseen(harness, told.chatId, told.turn, undefined, true)
        }
        // The answer sets a sub-agent that was waiting for it going again, and a conversation
        // with another agent or a thread in Slack likewise.
        await this.#subagents.tick()
        await this.#peers?.tick()
        await this.#slack?.tick()
        return json({ ok: true })
      }
    }
    if (segments[0] === "secrets") {
      const requestId = segments[1]
      if (requestId === undefined && method === "GET") {
        return json({ requests: await this.#secrets.pending(context) })
      }
      if (requestId !== undefined && method === "POST") {
        const decline = segments[2] === "decline"
        if (segments[2] !== undefined && !decline) throw new HttpError(404, "Not found")
        // What was typed is read here and handed straight on. It is kept nowhere on the way.
        const told = decline
          ? await this.#secrets.decline(requestId, context, caller)
          : await (async () => {
              const { values, sites } = await body<{ values?: unknown; sites?: unknown }>(request)
              return this.#secrets.answer(requestId, values, context, caller, sites)
            })()
        // What the agent says about it is told like any other answer nobody was there for.
        if (told !== undefined) {
          await this.#touch(harness, told.chatId)
          void this.#notifyWhenUnseen(harness, told.chatId, told.turn, undefined)
        }
        // The answer sets a sub-agent that asked through the main chat going again.
        await this.#subagents.tick()
        return json({ ok: true })
      }
    }
    if (segments[0] === "search" && segments[1] === undefined && method === "GET") {
      const limit = url.searchParams.get("limit")
      return json(
        await searchHistory(
          harness,
          this.#history,
          url.searchParams.get("q") ?? "",
          { limit: limit === null ? undefined : Number(limit) },
          context,
        ),
      )
    }
    if (segments[0] === "usage" && segments[1] === undefined && method === "GET") {
      return json(await this.#usage(harness))
    }
    if (segments[0] === "schedules") {
      const scheduleId = segments[1]
      if (scheduleId === undefined && method === "GET") {
        return json({ schedules: await this.#scheduler.list(context) })
      }
      if (scheduleId !== undefined && segments[2] === undefined && method === "PATCH") {
        const change = await body<UpdateScheduleRequest>(request)
        return json(await this.#scheduler.update(scheduleId, change, context))
      }
      if (scheduleId !== undefined && segments[2] === undefined && method === "DELETE") {
        await this.#scheduler.remove(scheduleId, context)
        return json({ ok: true })
      }
      if (scheduleId !== undefined && segments[2] === "run" && method === "POST") {
        await this.#scheduler.runNow(scheduleId, context)
        return json({ ok: true }, 202)
      }
    }
    if (segments[0] === "shots" && segments[1] !== undefined && method === "GET") {
      const shot = await this.#uses.shot(segments[1])
      if (shot === undefined) throw new HttpError(404, "There is no such picture")
      // A picture never changes once it is kept, and is the owner's screen: theirs to cache.
      return new Response(shot.bytes.slice().buffer, {
        headers: {
          "content-type": shot.contentType,
          "cache-control": "private, max-age=31536000, immutable",
        },
      })
    }
    if (segments[0] === "use") {
      const what = url.searchParams.get("what") === "browser" ? "browser" : "screen"
      const computer = url.searchParams.get("computer") ?? ""
      if (segments[1] === "view" && method === "GET") {
        const after = Number(url.searchParams.get("after") ?? "0")
        return json(
          await this.#uses.view(computer, what, Number.isFinite(after) ? after : 0, context),
        )
      }
      if (segments[1] === "hold" && method === "POST") {
        const { held } = await body<{ held?: boolean }>(request)
        await this.#uses.hold(computer, what, held === true, context)
        return json({ ok: true })
      }
    }
    if (segments[0] === "jobs") {
      const jobId = segments[1]
      if (jobId === undefined && method === "GET") {
        return json({ jobs: await this.#jobs.list(context) })
      }
      if (jobId !== undefined && segments[2] === "output" && method === "GET") {
        const from = Number(url.searchParams.get("from") ?? "")
        return json(
          await this.#jobs.read(
            jobId,
            Number.isInteger(from) && from >= 0 ? from : undefined,
            context,
          ),
        )
      }
      if (jobId !== undefined && segments[2] === "stop" && method === "POST") {
        await this.#jobs.stop(jobId, "user", context)
        return json({ ok: true })
      }
    }
    if (segments[0] === "calls") {
      const callId = segments[1]
      if (callId === undefined && method === "GET") {
        return json(await this.#calls.state(caller, identity.voice))
      }
      if (callId === undefined && method === "POST") {
        const input = await body<StartCallRequest>(request)
        if (typeof input.chatId !== "string") throw new HttpError(400, "chatId is required")
        // A call is held where a person talks to the agent, the main chat, and its record is
        // left there.
        if ((await harness.snapshot(ChatsDoc, context))?.main !== input.chatId) {
          throw new HttpError(409, "A call is held in the main chat.")
        }
        const view = await (await this.#chat(harness, input.chatId)).viewState(context)
        let messages: ChatMessage[]
        try {
          messages = projectChat(view.value).messages
        } finally {
          view.dispose()
        }
        const call = await this.#calls.start(
          { chatId: input.chatId, sdp: input.sdp },
          caller,
          {
            name: identity.name ?? "your Dood",
            soul: identity.soul,
            user: identity.user,
            memory: identity.memory,
            voice: identity.voice,
          },
          messages,
        )
        // A call nobody ends is over at its time: the agent is woken then to write it up.
        await this.#rearm()
        return json({ call } satisfies StartCallResponse, 201)
      }
      if (callId !== undefined && segments[2] === "lines" && method === "POST") {
        await this.#calls.said(callId, (await body<CallLinesRequest>(request)).lines, caller)
        return json({ ok: true })
      }
      if (callId !== undefined && segments[2] === "work" && method === "POST") {
        const input = await body<CallWorkRequest>(request)
        return this.#callWork(harness, callId, input, caller)
      }
      if (callId !== undefined && segments[2] === "end" && method === "POST") {
        await this.#calls.end(callId, (await body<EndCallRequest>(request)).lines, caller)
        return json({ ok: true })
      }
    }
    if (segments[0] === "chats") {
      // A Dood is talked to in its main chat alone. Side chats from before are kept, to read.
      if (segments.length === 1 && method === "POST") {
        throw new HttpError(
          410,
          "A Dood is talked to in its main chat. Side chats are no longer made.",
          "side_chat",
        )
      }
      if (segments[1] === "main" && segments.length === 2 && method === "POST") {
        return this.#mainChat(harness, identity, caller)
      }
      if (
        segments[1] === "old" &&
        segments.length === 2 &&
        method === "POST" &&
        this.#options.testOldSideChats === true
      ) {
        return this.#oldSideChat(harness, identity, await body<SendMessageRequest>(request), caller)
      }
      const chatId = segments[1]
      if (chatId !== undefined) {
        const conversation = await this.#chat(harness, chatId)
        const rest = segments[2]
        if (rest === undefined && method === "GET") {
          const view = await conversation.viewState(context)
          try {
            return json(projectChat(view.value))
          } finally {
            view.dispose()
          }
        }
        if (rest === undefined && method === "PATCH") {
          return this.#updateChat(harness, chatId, await body<UpdateChatRequest>(request))
        }
        if (rest === "history" && method === "GET") {
          const limit = url.searchParams.get("limit")
          return json(
            await readHistory(
              harness,
              chatId,
              {
                before: url.searchParams.get("before") ?? undefined,
                limit: limit === null ? undefined : Number(limit),
              },
              context,
            ),
          )
        }
        if (rest === "events" && method === "GET") return this.#chatEvents(conversation)
        // A sub-agent's chat is its agent's to write in. The user reads it, and can stop it.
        const kind = own((await harness.snapshot(ChatsDoc, context))?.chats, chatId)?.kind
        const subagent = kind === "subagent"
        if (subagent && (rest === "messages" || rest === "reset") && method === "POST") {
          throw new HttpError(409, "Only the Dood talks to its sub-agents.", "subagent")
        }
        // A conversation with another agent is the two agents' to write in, in the same way.
        const thread = kind === "agent"
        if (thread && (rest === "messages" || rest === "reset") && method === "POST") {
          throw new HttpError(409, "Only the two Doods write in this conversation.", "agent")
        }
        // A thread in Slack is written in from Slack, and read here.
        const slack = kind === "slack"
        if (slack && (rest === "messages" || rest === "reset") && method === "POST") {
          throw new HttpError(409, "This conversation is written in from Slack.", "slack")
        }
        // A side chat from before a Dood was talked to in its main chat alone is kept, to read.
        const main = (await harness.snapshot(ChatsDoc, context))?.main
        const side = kind === "chat" && main !== undefined && main !== chatId
        if (side && (rest === "messages" || rest === "reset") && method === "POST") {
          throw new HttpError(
            409,
            "This side chat is archived, to read. Talk in the main chat.",
            "side_chat",
          )
        }
        if (rest === "messages" && method === "POST") {
          return this.#send(harness, conversation, await body<SendMessageRequest>(request), caller)
        }
        if (rest === "abort" && method === "POST") {
          if (subagent) await this.#subagents.stop(chatId, "user", context)
          else if (thread && this.#peers !== undefined) await this.#peers.stop(chatId, context)
          else if (slack && this.#slack !== undefined) await this.#slack.stop(chatId, context)
          else await conversation.abort(context)
          return json({ ok: true })
        }
        if (rest === "reset" && method === "POST") {
          // Starts the chat's context over. What was said stays readable as earlier messages,
          // and what the agent remembers is unaffected. Where the chat stood is noted for its
          // other chats first, from what is stored: the note does not hold the reset up.
          void this.#journal.review(chatId)
          await conversation.reset(undefined, context)
          return json({ ok: true })
        }
      }
    }
    throw new HttpError(404, "Not found")
  }

  async #identity(harness: Harness): Promise<Readonly<IdentityState>> {
    const identity = await harness.snapshot(IdentityDoc, context)
    if (identity === undefined || identity.ownerId === "") {
      throw new HttpError(409, "Dood is not initialized", "not_initialized")
    }
    return identity
  }

  async #init(
    harness: Harness,
    input: { ownerId: string; team?: string | null; model?: string },
  ): Promise<Response> {
    if (typeof input.ownerId !== "string" || input.ownerId === "") {
      throw new HttpError(400, "ownerId is required")
    }
    const model = input.model ?? (await this.#deployment()).defaultModel
    await this.#requireModel(model)
    // Where nobody says which machines there are, the agent gets one to itself.
    const machine = this.#hosted ? undefined : this.#ownMachine(this.#choices.default)
    const outcome = await harness.commit(async (tx) => {
      const identity = await tx.doc(IdentityDoc)
      if (identity.ownerId !== "" && identity.ownerId !== input.ownerId) return "taken"
      // Create the chat index too, so it can be watched before the first chat exists.
      await tx.doc(ChatsDoc)
      if (identity.ownerId !== "") return "ok"
      identity.ownerId = input.ownerId
      if (typeof input.team === "string" && input.team !== "") identity.team = input.team
      identity.model = model
      identity.createdAt = this.#host.now()
      // There is nothing from before for its host to take over.
      identity.adopted = true
      if (machine !== undefined && this.#choices.kinds.length > 0) {
        identity.computers = [this.#choices.default]
      }
      return "new"
    }, context)
    if (outcome === "taken") throw new HttpError(409, "Dood belongs to another account")
    if (outcome === "new" && machine !== undefined) {
      await this.#computers.setMachines([machine], context)
    }
    await this.#skills.seed(context)
    return json(await this.#state(harness, await this.#identity(harness)))
  }

  /** What the deployment offers everyone, and the model it starts new agents on. */
  async #deployment(): Promise<DeploymentModels> {
    return (
      (await this.#options.deploymentModels?.()) ?? {
        defaultModel: this.#options.defaultModel,
        options: this.#options.modelOptions,
      }
    )
  }

  /** Every model the agent can be set to: the deployment's, then its workspace's. */
  async #modelOptions(): Promise<ModelOption[]> {
    const workspace = (await this.#options.workspaceModels?.()) ?? []
    return offeredModels((await this.#deployment()).options, workspace)
  }

  async #requireModel(model: string): Promise<void> {
    const offered = (await this.#modelOptions()).some((option) => option.id === model)
    if (!offered) throw new HttpError(400, `Unknown model "${model}"`)
    const ref = parseModel(model)
    if (this.#options.models.getModel(ref.provider, ref.modelId) === undefined) {
      throw new HttpError(400, `Model "${model}" is not available`)
    }
  }

  /** Whether there is anything to call a model with: a key or a sign-in for its provider. */
  async #runs(model: string): Promise<boolean> {
    const { provider, modelId } = parseModel(model)
    const found = this.#options.models.getModel(provider, modelId)
    return found !== undefined && (await this.#options.models.getAuth(found)) !== undefined
  }

  /**
   * Move the agent off a model the deployment has stopped offering, on to the one new agents
   * start on. A deployment can come to name the models it pays for, and an agent left on
   * another of its provider's would fail at every message, saying its workspace is not signed
   * in to a provider nobody there ever signed in to. That is told by the deployment still
   * having that provider to call while the agent's model has nothing to be called with. A
   * model whose provider the deployment does not have is left alone: its workspace signed out
   * of it, which the chat says, with the ways back.
   *
   * Looked at when the agent is first used and about once a minute while it is in use. Where it
   * cannot be told whether the model still runs, the agent is left as it is.
   */
  async #keepRunnable(harness: Harness): Promise<void> {
    const now = this.#host.now()
    if (now - this.#modelSeenAt < MODEL_CHECK_MS) return
    this.#modelSeenAt = now
    try {
      const identity = await harness.snapshot(IdentityDoc, context)
      if (identity === undefined || identity.ownerId === "") return
      const { models } = this.#options
      if (!identity.model.includes("/") || (await this.#runs(identity.model))) return
      if ((await models.getAuth(parseModel(identity.model).provider)) === undefined) return
      const { defaultModel } = await this.#deployment()
      if (defaultModel === identity.model || !(await this.#runs(defaultModel))) return
      await this.#setModel(harness, defaultModel)
    } catch {
      // Asked again the next time: a sign-in that could not be read is not one that is gone.
      this.#modelSeenAt = Number.NEGATIVE_INFINITY
    }
  }

  /** Set the agent to a model. Its chats pick it up from their next request. */
  async #setModel(harness: Harness, model: string): Promise<void> {
    const chats = await harness.commit(async (tx) => {
      const identity = await tx.doc(IdentityDoc)
      if (model === identity.model) return []
      identity.model = model
      return Object.keys((await tx.doc(ChatsDoc)).chats)
    }, context)
    for (const id of chats) {
      const conversation = await harness.conversation(Number(id) as ConversationId, context)
      await conversation?.configure({ model: parseModel(model) }, context)
    }
  }

  /**
   * Whether a model takes pictures: as the deployment says of one it offers, and as the model
   * itself says of one the agent's workspace is signed in to.
   */
  #sees(model: string): boolean {
    const offered = this.#options.modelOptions.find((option) => option.id === model)
    if (offered !== undefined) return offered.images === true
    const slash = model.indexOf("/")
    if (slash === -1) return false
    return (
      this.#options.models
        .getModel(model.slice(0, slash), model.slice(slash + 1))
        ?.input.includes("image") === true
    )
  }

  /** What the agent has spent, summed from the ledger pi-durable keeps for each conversation. */
  async #usage(harness: Harness): Promise<AgentUsage> {
    const chats = (await harness.snapshot(ChatsDoc, context))?.chats ?? {}
    const zero = (): ChatUsage => ({ inputTokens: 0, outputTokens: 0, cost: 0 })
    const usage: AgentUsage = { total: zero(), models: [], scheduled: zero(), chats: 0 }
    const models = new Map<string, ChatUsage>()
    for (const [chatId, chat] of Object.entries(chats)) {
      const ledger = await harness.snapshot(UsageDoc, Number(chatId) as ConversationId, context)
      usage.chats++
      if (ledger === undefined) continue
      const count = (spent: Usage, model?: string) => {
        addUsage(usage.total, spent)
        if (chat.kind === "schedule") addUsage(usage.scheduled, spent)
        if (model === undefined) return
        if (!models.has(model)) models.set(model, zero())
        addUsage(models.get(model)!, spent)
      }
      for (const [model, spent] of Object.entries(ledger.models)) count(spent as Usage, model)
      // A tool that calls a model of its own reports what that cost, without naming the model.
      for (const spent of Object.values(ledger.tools)) count(spent as Usage)
    }
    // What small models did for it is its cost too, though it made none of those calls.
    const judge = this.#options.judge?.model
    for (const chatId of Object.keys(chats)) {
      const spent = await this.#keepGoing.spent(chatId, context)
      if (spent === undefined) continue
      // Summaries a small model once wrote of each run are under no model: none is set for
      // that now.
      const small: [string | undefined, ChatUsage | undefined][] = [
        [undefined, spent.summaries],
        [judge === undefined ? undefined : `openrouter/${judge}`, spent.judged],
      ]
      for (const [key, used] of small) {
        if (used === undefined || used.inputTokens + used.outputTokens === 0) continue
        if (key !== undefined && !models.has(key)) models.set(key, zero())
        for (const total of key === undefined ? [usage.total] : [usage.total, models.get(key)!]) {
          total.inputTokens += used.inputTokens
          total.outputTokens += used.outputTokens
          total.cost += used.cost
        }
      }
    }
    // So is what keeping its chats' notes cost.
    const noted = await this.#journal.spent(context)
    if (noted !== undefined && noted.spent.inputTokens + noted.spent.outputTokens > 0) {
      const key = `openrouter/${noted.model}`
      if (!models.has(key)) models.set(key, zero())
      for (const total of [usage.total, models.get(key)!]) {
        total.inputTokens += noted.spent.inputTokens
        total.outputTokens += noted.spent.outputTokens
        total.cost += noted.spent.cost
      }
    }
    const compactions = await this.#idle.records(context)
    if (compactions.length > 0) usage.compactions = compactions
    usage.models = [...models]
      .map(([model, total]) => ({ model, ...total }))
      .sort(
        (a, b) =>
          b.cost - a.cost || b.inputTokens + b.outputTokens - a.inputTokens - a.outputTokens,
      )
    return usage
  }

  async #state(harness: Harness, identity: Readonly<IdentityState>) {
    const { chats, main } = (await harness.snapshot(ChatsDoc, context)) ?? { chats: {} }
    const creature = await this.#creature(harness)
    const agent: AgentSummary = {
      id: this.#host.name,
      name: identity.name,
      avatar: identity.avatar,
      tagline: identity.tagline,
      createdAt: identity.createdAt,
      model: identity.model,
      thinking: identity.thinking ?? DEFAULT_THINKING,
      // An agent from before there were eggs has a name, and is not sent back into one.
      hatched: identity.hatchedAt !== undefined || identity.name !== null,
      outfit: creature.outfit,
      ...(await this.#activity(harness)),
    }
    return {
      agent,
      timezone: identity.timezone ?? null,
      ownerId: identity.ownerId,
      // The team that shares it, by name, or null for one person's.
      team: identity.team ?? null,
      soul: identity.soul,
      user: identity.user,
      memory: identity.memory,
      limits: { memory: MEMORY_LIMIT, user: USER_LIMIT },
      chats: Object.entries(chats)
        .map(([id, record]) => summarize(id, record, main))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }
  }

  /** What a list of agents says of this one besides who it is, as it stands right now. */
  async #activity(harness: Harness): Promise<AgentActivity> {
    // The document is made when a line is first kept: an agent from before there was one, or
    // that nothing has been said to yet, has neither.
    const latest = (await harness.snapshot(LatestDoc, context))?.latest ?? undefined
    return {
      ...(latest === undefined ? {} : { latest }),
      working: await this.#working(harness),
      asking: await this.#asking(),
    }
  }

  /**
   * Whether the agent is at work: a run is going or waiting its turn in one of its chats, or a
   * sub-agent of its has a report still to come. A command left running in the background is
   * not the agent at work: its turn is over, and it is given another when the command ends.
   */
  async #working(harness: Harness): Promise<boolean> {
    if (liveWork(await harness.inspect(context)).live) {
      // Whoever reads that it is at work may be the first to find it so.
      this.#found(harness)
      return true
    }
    return this.#subagents.working(context)
  }

  /** Whether it has asked a person for their OK, or for something to be typed in, and not been answered. */
  async #asking(): Promise<boolean> {
    return (await this.#approvals.asking(context)) || (await this.#secrets.asking(context))
  }

  /** What its creature has been given and has on. One from before there was any of it has a box waiting. */
  async #creature(harness: Harness): Promise<CreatureState> {
    await this.#boxDue(harness)
    const creature = (await harness.snapshot(CreatureDoc, context)) ?? NEW_CREATURE
    const shared = Math.min(creature.shared ?? 0, creature.boxes)
    // Named one by one: what is kept may hold more, from when its treats were earned and counted.
    return {
      fed: creature.fed,
      joy: creature.joy,
      boxes: creature.boxes,
      shared,
      // While a box of its own waits there is no next one to wait for.
      ...(creature.boxes > shared || creature.nextBoxAt === undefined
        ? {}
        : { nextBoxAt: creature.nextBoxAt }),
      owned: [...creature.owned],
      outfit: { ...creature.outfit },
    }
  }

  /**
   * A box turns up beside its creature six hours after its last was opened, whatever the
   * agent was or was not doing, and it has one of its own waiting at most: the wait for the next
   * starts when that one is opened. The boxes other people's treats made are besides. Nothing
   * wakes for a box: one that has come due is counted when the creature is next looked at. One
   * from before this with no box has its wait start at the first look, and a wait longer than
   * the whole of one, left from when boxes were further apart, is cut to it.
   */
  async #boxDue(harness: Harness): Promise<void> {
    const now = this.#host.now()
    const every = Math.max(1, this.#options.boxEveryMs ?? BOX_EVERY_MS)
    const waits = (creature: CreatureState) =>
      // Once everything is found there is nothing for another box to hold.
      creature.boxes > (creature.shared ?? 0) || hasEverything(creature.owned)
    const kept = (await harness.snapshot(CreatureDoc, context)) ?? NEW_CREATURE
    const long = (creature: CreatureState) =>
      creature.nextBoxAt === undefined || creature.nextBoxAt > now + every
    if (waits(kept) || (!long(kept) && now < kept.nextBoxAt!)) return
    await harness.commit(async (tx) => {
      const creature = await tx.doc(CreatureDoc)
      if (waits(creature)) return
      if (long(creature)) creature.nextBoxAt = now + every
      else if (now >= creature.nextBoxAt!) creature.boxes++
    }, context)
  }

  /** Give its creature a treat. There is always one to give, and it comes to nothing but the count. */
  async #feed(harness: Harness): Promise<Response> {
    await harness.commit(async (tx) => {
      ;(await tx.doc(CreatureDoc)).fed++
    }, context)
    return json(await this.#creature(harness))
  }

  /**
   * Its creature is given something by someone who is not its owner, on its own page: treats it
   * eats there and then, every few of which are a box for it, and a thing to wear, which it puts on.
   */
  async #gifted(harness: Harness, input: { treats?: unknown; item?: unknown }): Promise<Response> {
    const treats =
      typeof input.treats === "number" && Number.isInteger(input.treats)
        ? Math.max(0, Math.min(MAX_GIFTED_TREATS, input.treats))
        : 0
    const item = typeof input.item === "string" ? wearItem(input.item) : undefined
    await harness.commit(async (tx) => {
      const creature = await tx.doc(CreatureDoc)
      for (let given = 0; given < treats; given++) {
        creature.fed++
        if (!hasEverything(creature.owned) && ++creature.joy >= TREATS_PER_BOX) {
          creature.joy = 0
          creature.boxes++
          creature.shared = (creature.shared ?? 0) + 1
        }
      }
      if (item !== undefined) {
        if (!creature.owned.includes(item.id)) creature.owned.push(item.id)
        creature.outfit = { ...creature.outfit, [item.slot]: item.id }
      }
    }, context)
    return json(await this.#creature(harness))
  }

  /**
   * Open one of its boxes: something to wear that it does not have yet, picked by chance. Its own
   * box is opened before any that other people's treats made, and the wait for its next starts then.
   */
  async #openBox(harness: Harness): Promise<Response> {
    await this.#boxDue(harness)
    const now = this.#host.now()
    const every = Math.max(1, this.#options.boxEveryMs ?? BOX_EVERY_MS)
    // Drawn before the transaction, which may be run more than once and must come out the same.
    const random = this.#options.random ?? Math.random
    const dealt = [random(), random()]
    const found = await harness.commit(async (tx) => {
      const creature = await tx.doc(CreatureDoc)
      if (creature.boxes <= 0) return undefined
      let at = 0
      const item = rollItem(creature.owned, () => dealt[at++ % dealt.length]!)
      if (item === undefined) {
        creature.boxes = 0
        creature.shared = 0
        return undefined
      }
      const shared = Math.min(creature.shared ?? 0, creature.boxes)
      creature.boxes--
      if (creature.boxes < shared) creature.shared = creature.boxes
      else if (creature.boxes === shared) creature.nextBoxAt = now + every
      creature.owned.push(item.id)
      return item.id
    }, context)
    if (found === undefined) throw new HttpError(409, "It has no box to open", "no_box")
    return json({ item: found, creature: await this.#creature(harness) })
  }

  /** Dress its creature, in things it has. */
  async #wear(harness: Harness, input: { outfit?: unknown }): Promise<Response> {
    const problem = await harness.commit(async (tx) => {
      const creature = await tx.doc(CreatureDoc)
      const parsed = parseOutfit(input.outfit, creature.owned)
      if ("error" in parsed) return parsed.error
      creature.outfit = parsed.outfit
      return undefined
    }, context)
    if (problem !== undefined) throw new HttpError(400, problem)
    return json(await this.#creature(harness))
  }

  /** Mark a chat as having something new in it. */
  async #touch(harness: Harness, chatId: string): Promise<void> {
    await harness.commit(async (tx) => {
      const chat = own((await tx.doc(ChatsDoc)).chats, chatId)
      if (chat !== undefined) chat.updatedAt = this.#host.now()
    }, context)
  }

  /** Change what can be changed about the agent, each thing checked. Rejects with why not. */
  /**
   * A call is over: its record goes into the chat it was held in, for people, and is an event
   * there for the agent, which it reads with whatever it does next.
   */
  async #recordCall(chatId: string, entry: CallEntry, note: string): Promise<void> {
    const harness = await this.#open()
    const now = this.#host.now()
    const conversation = await harness.conversation(Number(chatId) as ConversationId, context)
    // The chat was deleted while the call went on: there is nowhere to leave it.
    if (conversation === undefined) return
    await conversation.submit(
      {
        type: "write",
        requestId: `call:${entry.id}`,
        entry: {
          kind: CALL_ENTRY,
          model: [{ role: "user", content: note, timestamp: now }],
          data: entry,
        },
      },
      context,
    )
    await harness.commit(async (tx) => {
      const chat = own((await tx.doc(ChatsDoc)).chats, chatId)
      if (chat !== undefined) chat.updatedAt = now
    }, context)
    // What was said out loud is taken into the chat's note for the agent's other chats, and
    // into what the agent remembers, as what is typed is. Nothing waits for it.
    void this.#journal.review(chatId)
  }

  async #apply(harness: Harness, input: Record<string, unknown>): Promise<void> {
    const text = (key: string, limit: number): string | undefined => {
      const value = input[key]
      if (value === undefined) return undefined
      if (typeof value !== "string") throw new HttpError(400, `${key} must be a string`)
      if (value.length > limit) {
        throw new HttpError(400, `${key} is ${value.length} characters; the limit is ${limit}`)
      }
      return value
    }
    const name = text("name", 40)?.trim()
    if (name === "") throw new HttpError(400, "name cannot be empty")
    const tagline = text("tagline", 120)
    const soul = text("soul", 4000)
    const user = text("user", USER_LIMIT)
    const memory = text("memory", MEMORY_LIMIT)
    const model = text("model", 200)
    if (model !== undefined) await this.#requireModel(model)
    const thinking = text("thinking", 20)
    if (thinking !== undefined && !isThinkingLevel(thinking)) {
      throw new HttpError(400, `thinking must be one of ${THINKING_LEVELS.join(", ")}`)
    }
    const timezone = text("timezone", 64)
    if (timezone !== undefined && !isValidTimezone(timezone)) {
      throw new HttpError(400, `"${timezone}" is not an IANA timezone`)
    }
    // The voice it has on a call. Which voices there are depends on what places the call, so
    // any short name is kept, and one that call cannot speak in is passed over when it is made.
    const voice = input.voice === null ? null : text("voice", 40)?.trim().toLowerCase()
    if (typeof voice === "string" && !/^[a-z]{2,40}$/.test(voice)) {
      throw new HttpError(400, "voice must be the name of a voice")
    }
    const now = this.#host.now()
    let avatar: IdentityState["avatar"] | undefined
    if (input.avatar !== undefined) {
      const parsed = parseAvatar(input.avatar as { color?: unknown; seed?: unknown })
      if ("error" in parsed) throw new HttpError(400, parsed.error)
      avatar = parsed.avatar
    }

    await harness.commit(async (tx) => {
      const identity = await tx.doc(IdentityDoc)
      if (name !== undefined) {
        // Named by its owner and not in conversation: it still has itself to work out with them.
        if (identity.name === null) identity.namedByOwner = true
        identity.name = name
      }
      if (tagline !== undefined) identity.tagline = tagline.trim() || null
      if (soul !== undefined) identity.soul = soul
      if (user !== undefined) identity.user = user
      if (memory !== undefined) identity.memory = memory
      if (avatar !== undefined) identity.avatar = avatar
      // Hatching happens once. There is no putting it back in the egg.
      if (input.hatched === true) identity.hatchedAt ??= now
      if (timezone !== undefined) identity.timezone = timezone
      if (voice === null) delete identity.voice
      else if (voice !== undefined) identity.voice = voice
      // Chats pick this up on their next message.
      if (thinking !== undefined) identity.thinking = thinking
    }, context)
    // A model change applies to existing chats from their next request.
    if (model !== undefined) await this.#setModel(harness, model)
  }

  async #chat(harness: Harness, chatId: string): Promise<Conversation> {
    const chats = (await harness.snapshot(ChatsDoc, context))?.chats ?? {}
    // Only conversations in the index are chats; subagent conversations are not addressable.
    if (!Object.hasOwn(chats, chatId)) throw new HttpError(404, "Chat not found")
    const conversation = await harness.conversation(Number(chatId) as ConversationId, context)
    if (conversation === undefined) throw new HttpError(404, "Chat not found")
    return conversation
  }

  /** A new main chat, for an agent that has none yet. */
  async #newChat(
    harness: Harness,
    identity: Readonly<IdentityState>,
    caller: Caller | undefined,
  ): Promise<ChatSummary> {
    const now = this.#host.now()
    const record: ChatRecord = {
      title: DEFAULT_CHAT_TITLE,
      kind: "chat",
      createdAt: now,
      updatedAt: now,
      archived: false,
      ...(caller === undefined ? {} : { createdBy: caller.id }),
    }
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: parseModel(identity.model),
          thinkingLevel: identity.thinking ?? DEFAULT_THINKING,
        },
        init: async (tx, id) => {
          const doc = await tx.doc(ChatsDoc)
          doc.chats[String(id)] = record
          doc.main = String(id)
        },
      },
      context,
    )
    const id = String(conversation.id)
    return summarize(id, record, id)
  }

  /**
   * An old side chat, for a test (`testOldSideChats`): archived, as every side chat is now, with
   * what it is given, if anything, said in it, as it was said in one before.
   */
  async #oldSideChat(
    harness: Harness,
    identity: Readonly<IdentityState>,
    input: SendMessageRequest,
    caller: Caller | undefined,
  ): Promise<Response> {
    const now = this.#host.now()
    const record: ChatRecord = {
      title: titleFrom(String(input.text ?? "")) || DEFAULT_CHAT_TITLE,
      kind: "chat",
      createdAt: now,
      updatedAt: now,
      archived: true,
      // As the switch-over to the bus archived every side chat from before.
      archivedBy: "bus",
      ...(caller === undefined ? {} : { createdBy: caller.id }),
    }
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: parseModel(identity.model),
          thinkingLevel: identity.thinking ?? DEFAULT_THINKING,
        },
        init: async (tx, id) => {
          ;(await tx.doc(ChatsDoc)).chats[String(id)] = record
        },
      },
      context,
    )
    if (typeof input.text === "string" && input.text !== "") {
      await this.#say(harness, conversation, input, caller)
    }
    const { main } = (await harness.snapshot(ChatsDoc, context)) ?? { chats: {} }
    return json(summarize(String(conversation.id), record, main), 201)
  }

  /**
   * The agent's main chat, settled on if it has none. An agent from before there was such a
   * thing gets the chat it was last talked to in, and its other chats are old side chats from
   * then on. One that has never been talked to gets a new chat.
   */
  async #mainChat(
    harness: Harness,
    identity: Readonly<IdentityState>,
    caller: Caller | undefined,
  ): Promise<Response> {
    const found = await harness.commit(async (tx) => {
      const doc = await tx.doc(ChatsDoc)
      const kept = doc.main === undefined ? undefined : own(doc.chats, doc.main)
      if (doc.main !== undefined && kept !== undefined) return summarize(doc.main, kept, doc.main)
      const latest = Object.entries(doc.chats)
        .filter(([, chat]) => chat.kind === "chat" && !chat.archived)
        .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)[0]
      if (latest === undefined) return undefined
      doc.main = latest[0]
      return summarize(latest[0], latest[1], latest[0])
    }, context)
    const main = found ?? (await this.#newChat(harness, identity, caller))
    // Not being able to set it up now costs nobody their chat: it is tried again with the next message.
    await this.#syncBus(harness).catch((error) => this.#options.onReport?.(error))
    return json(main)
  }

  /**
   * Set the agent's chats up as a bus (`bus.ts`): its main chat selects the bus's extension, with
   * a mark that says where the bus begins, and its side chats from before, which nobody writes in
   * any more, are archived. A chat already set up is left alone, so this is called wherever one
   * could not be yet: as the agent opens, when the main chat is settled on, and before a message
   * is given to it. `thread` is a thread in Slack about to be given a message, which is set up the
   * same way then and not before: most are long over.
   */
  #syncBus(harness: Harness, thread?: string): Promise<void> {
    const run = async () => {
      const { chats, main } = (await harness.snapshot(ChatsDoc, context)) ?? { chats: {} }
      for (const [id, record] of Object.entries(chats)) {
        if (record.bus !== true && (id === main || id === thread)) {
          await this.#switchBus(harness, id, record)
        }
      }
      // Only the main chat is talked in now. The others are kept, as they were, to be read, and
      // a sub-agent one of them started is the main chat's from now on: it reports there, takes
      // more from there, and asks a person through it. What is changed here says so, and what it
      // was, so that it can be undone exactly: a side chat archived here is marked as archived by
      // the bus, apart from those people archived themselves, and a sub-agent keeps its parent.
      if (main === undefined) return
      const isSide = (id: string) => own(chats, id)?.kind === "chat" && id !== main
      const side = Object.entries(chats).filter(([id, record]) => isSide(id) && !record.archived)
      const orphans = Object.values(chats).filter(
        (record) => record.subagent !== undefined && isSide(record.subagent.parentId),
      )
      if (side.length === 0 && orphans.length === 0) return
      await harness.commit(async (tx) => {
        const doc = await tx.doc(ChatsDoc)
        for (const [id, record] of Object.entries(doc.chats)) {
          if (record.kind === "chat" && id !== main && !record.archived) {
            record.archived = true
            record.archivedBy = "bus"
          }
          if (record.subagent !== undefined && isSide(record.subagent.parentId)) {
            record.subagent.parentBefore ??= record.subagent.parentId
            record.subagent.parentId = main
          }
        }
      }, context)
    }
    this.#busing = this.#busing.then(run, run)
    return this.#busing
  }

  /**
   * Switch the bus on in one chat. A mark says where, for drawing it; a note tells the model, at
   * its next step, what changed. Then the chat selects the bus's extension.
   */
  async #switchBus(harness: Harness, chatId: string, record: ChatRecord) {
    const conversation = await harness.conversation(Number(chatId) as ConversationId, context)
    if (conversation === undefined) return
    const slack = record.kind === "slack"
    // A chat that nothing has been said in yet has nothing to be told about what changed: its
    // first message says how it works. A thread in Slack is set up before its first message. A
    // mark written before a crash, with the record not yet saying so, is not something said.
    const fresh = slack
      ? record.slack?.woken === undefined
      : (await conversation.context(context)).entries.every((entry) => entry.kind === BUS_ENTRY)
    const n = record.busMarks?.length ?? 0
    // The mark first, and at once: a chat set up for the bus with nothing to say where it began
    // would be drawn as if it had always had it.
    const marked = await conversation.submit(
      {
        type: "write",
        requestId: `bus:${chatId}:${n}`,
        entry: { kind: BUS_ENTRY, data: { on: true } },
      },
      context,
    )
    const placed = await marked.wait(context)
    // Placed where the model next looks, which while it works is after the step under way.
    if (!fresh) {
      await conversation.submit(
        {
          type: "write",
          requestId: `bus-note:${chatId}:${n}`,
          entry: {
            kind: BUS_NOTE_ENTRY,
            model: [{ role: "user", content: busNote(slack), timestamp: this.#host.now() }],
          },
        },
        context,
      )
    }
    const bus = slack ? this.#slackBus : this.#bus
    await conversation.configure({ extensions: { add: [bus] } }, context)
    await harness.commit(async (tx) => {
      const chat = own((await tx.doc(ChatsDoc)).chats, chatId)
      if (chat === undefined) return
      chat.bus = true
      if (placed.entry !== undefined) {
        chat.busMarks = [...(chat.busMarks ?? []), { at: Number(placed.entry), on: true }]
      }
    }, context)
  }

  /**
   * Whether every file a send names can be sent, before any is: each is a file, and small enough
   * for the library. Why not, where one cannot.
   */
  async #checkFiles(
    paths: readonly string[],
    computer: string | undefined,
    c: Context,
  ): Promise<string | undefined> {
    const target = await this.#computers.resolve(computer, c)
    if (typeof target === "string") return target
    const env = target.machine ? new MachineEnv(target) : new ComputerEnv(target)
    for (const path of paths) {
      const absolute = await env.absolutePath(path)
      if (!absolute.ok) return `${path} is not a path there: ${absolute.error.message}`
      const info = await env.fileInfo(absolute.value)
      if (!info.ok) return `could not find ${path}: ${info.error.message}`
      if (info.value.kind !== "file") return `${path} is not a file.`
      if (info.value.size > MAX_LIBRARY_FILE_BYTES) {
        return `${path} is ${Math.round(info.value.size / (1024 * 1024))} MB; files up to ${MAX_LIBRARY_FILE_BYTES / (1024 * 1024)} MB can be sent.`
      }
    }
    return undefined
  }

  /**
   * The agent sent something to the people in a main chat or a thread in Slack. It is its latest line,
   * and they are told of it where nobody has the chat open. A run there that ends tells nobody
   * anything: only what is sent does (`#notifyWhenUnseen`).
   */
  async #sent(chatId: string, text: string, files: number): Promise<void> {
    try {
      const said = text !== "" ? text : files === 1 ? "Sent a file" : `Sent ${files} files`
      const seen = (this.#watchers.get(chatId) ?? 0) > 0 || this.#followers.following(chatId)
      const harness = await this.#open()
      const chat = own((await harness.snapshot(ChatsDoc, context))?.chats, chatId)
      // Said in Slack, where it was posted as it was sent: it is the agent's latest line, as an
      // answer posted at rest is, and nobody in the app is told of it.
      if (chat?.kind === "slack") {
        const from = chat.slack?.channelName ?? null
        await this.#record({
          kind: "slack",
          text: said,
          chatId,
          ...(from === null ? {} : { from }),
        })
        return
      }
      // Which of a team's people a send answers is not known: whoever spoke last may not be the
      // one it is for. So in a team everyone is told, until sends say whom they are for.
      const team = (await harness.snapshot(IdentityDoc, context))?.team
      const userId = team ? undefined : chat?.lastBy
      await this.#record({ kind: "reply", text: said, chatId })
      if (!seen) {
        await this.#notify({
          kind: "reply",
          text: said,
          chatId,
          ...(userId === undefined ? {} : { userId }),
        })
      }
    } catch (error) {
      this.#options.onReport?.(error)
    }
  }

  /**
   * A sub-agent asked a person for something through the main chat, where the agent has the bus
   * on: the request is shown there under its name, and the main chat is told of it, as an event
   * it needs to do nothing about. A write, which gives it no turn of its own: the answer goes to
   * the sub-agent, and the main chat reads of it with whatever it does next. Keyed by the
   * request. Nothing for any other chat.
   */
  async #askedThroughMain(
    chatId: string,
    what: string,
    why: string | null,
    key: string,
  ): Promise<void> {
    try {
      const harness = await this.#open()
      const through = askingThrough((await harness.snapshot(ChatsDoc, context))?.chats, chatId)
      if (through === undefined) return
      const main = await harness.conversation(Number(through.parentId) as ConversationId, context)
      if (main === undefined) return
      await main.submit(
        {
          type: "write",
          requestId: `asked:${key}`,
          entry: {
            kind: ASKED_ENTRY,
            model: [
              {
                role: "user",
                content: eventText(
                  "subagent-asked",
                  { id: chatId, title: through.title },
                  `It asked for ${what}${why === null ? "" : ` (${why})`}. The request is shown to the people here under its name, and their answer goes back to it: you do not need to pass it on or do anything about it.`,
                ),
                timestamp: this.#host.now(),
              },
            ],
            data: { chatId, title: through.title, what },
          },
        },
        context,
      )
    } catch (error) {
      this.#options.onReport?.(error)
    }
  }

  /**
   * A thread in Slack tells the main chat something, with `tell_main`, where the agent has the bus
   * on: an event, keyed by the call, which the main chat takes up when it is free and decides
   * whether to pass on. Why not, where it could not be told.
   */
  async #tellMain(
    told: { chatId: string; callId: string; text: string },
    c: Context,
  ): Promise<string | undefined> {
    const harness = await this.#open()
    const { chats, main } = (await harness.snapshot(ChatsDoc, c)) ?? { chats: {} }
    const thread = own(chats, told.chatId)
    if (thread?.slack === undefined) return "Only a thread in Slack tells the main conversation."
    if (main === undefined) return "There is no main conversation to tell."
    const conversation = await harness.conversation(Number(main) as ConversationId, c)
    if (conversation === undefined) return "There is no main conversation to tell."
    // Once for each message from Slack: anyone there can ask a thread to, and each time is a
    // turn of the main chat's. The same call, made again after a restart, is the same telling.
    const woken = thread.slack.woken ?? 0
    const allowed = await harness.commit(async (tx) => {
      const slack = own((await tx.doc(ChatsDoc)).chats, told.chatId)?.slack
      if (slack === undefined) return false
      const last = slack.toldMain
      if (last !== undefined && last.woken === woken && last.callId !== told.callId) return false
      slack.toldMain = { woken, callId: told.callId }
      return true
    }, c)
    if (!allowed) {
      return "You have already told your main conversation something since this message came, or tried to and it failed, which uses the one telling too. Wait for the next message from Slack."
    }
    const where = thread.slack.direct
      ? "a direct message"
      : thread.slack.channelName === null
        ? "a channel"
        : `#${thread.slack.channelName}`
    try {
      await conversation.submit(
        {
          type: "input",
          requestId: `slack-note:${told.chatId}:${told.callId}`,
          content: [
            {
              type: "text",
              text: eventText(
                "slack-thread",
                { thread: told.chatId, where, title: thread.title, from: "slack" },
                told.text,
              ),
            },
          ],
          entry: {
            kind: SLACK_NOTE_ENTRY,
            data: { chatId: told.chatId, where, title: thread.title, text: told.text },
          },
          whenBusy: "followUp",
        },
        c,
      )
    } catch (error) {
      this.#options.onReport?.(error)
      // The one telling for this message is spent all the same: erring that way keeps a Slack
      // thread from waking the main chat more than once a message.
      return "Telling your main conversation failed, and that used the one telling for this message. Wait for the next message from Slack."
    }
    return undefined
  }

  async #updateChat(harness: Harness, chatId: string, input: UpdateChatRequest): Promise<Response> {
    const summary = await harness.commit(async (tx) => {
      const doc = await tx.doc(ChatsDoc)
      const chat = own(doc.chats, chatId)!
      // The main chat is where the agent is talked to, so it is always there. Starting it fresh
      // is how it is cleared.
      if (input.archived === true && chatId === doc.main) return undefined
      if (typeof input.title === "string" && input.title.trim() !== "") {
        chat.title = input.title.trim().slice(0, MAX_TITLE_CHARS)
      }
      if (typeof input.archived === "boolean" && input.archived !== chat.archived) {
        chat.archived = input.archived
        // Archived or brought back by a person: it is theirs, and undoing the switch-over to the
        // bus leaves it as they left it.
        delete chat.archivedBy
      }
      return summarize(chatId, chat, doc.main)
    }, context)
    if (summary === undefined) {
      throw new HttpError(409, "The main chat cannot be archived.", "main_chat")
    }
    return json(summary)
  }

  async #send(
    harness: Harness,
    conversation: Conversation,
    input: SendMessageRequest,
    caller: Caller | undefined,
  ): Promise<Response> {
    return json(await this.#say(harness, conversation, input, caller), 202)
  }

  /**
   * Something the voice of a call hands on to the agent. It goes to the main chat, where the call
   * is held, as a message marked as said out loud: the agent answers it with `send`, which the
   * voice reads out, and hands what takes longer to a sub-agent, as it does any work.
   */
  async #callWork(
    harness: Harness,
    callId: string,
    input: CallWorkRequest,
    caller: Caller | undefined,
  ): Promise<Response> {
    if (typeof input.text !== "string" || input.text.trim() === "") {
      throw new HttpError(400, "text is required")
    }
    const chatId = await this.#calls.where(callId, caller)
    const sent = await this.#say(harness, await this.#chat(harness, chatId), input, caller, callId)
    return json({ chatId, ...sent } satisfies CallWorkResponse, 202)
  }

  /** Give a chat something a person said. `callId` is the call it was said on, out loud. */
  async #say(
    harness: Harness,
    conversation: Conversation,
    input: SendMessageRequest,
    caller: Caller | undefined,
    callId?: string,
  ): Promise<SendMessageResponse> {
    if (typeof input.text !== "string" || input.text.trim() === "") {
      throw new HttpError(400, "text is required")
    }
    if (input.text.length > MAX_MESSAGE_CHARS) {
      throw new HttpError(413, `A message can be at most ${MAX_MESSAGE_CHARS} characters`)
    }
    if (
      typeof input.requestId !== "string" ||
      input.requestId === "" ||
      input.requestId.length > 100
    ) {
      throw new HttpError(400, "requestId is required")
    }
    // The send time travels with the message, where it stays put; a clock in the system prompt
    // would change on every request and defeat the provider's prompt cache.
    const timezone =
      typeof input.timezone === "string" && isValidTimezone(input.timezone) ? input.timezone : null
    const identity = await this.#identity(harness)
    // A chat from before agents thought, or from when this one thought differently, catches up here.
    const thinking = identity.thinking ?? DEFAULT_THINKING
    if ((await conversation.agent(context)).thinkingLevel !== thinking) {
      await conversation.configure({ thinkingLevel: thinking }, context)
    }
    const zone = timezone ?? identity.timezone
    // Where it was written, where the sender's app said. A machine of the workspace is nobody's
    // desk, so the computer is only ever one that somebody paired.
    const where = sentFrom(
      input.from,
      typeof input.from?.computerId === "string"
        ? (await this.#computers.list(context)).filter(isPaired)
        : [],
    )
    // Where a team shares the agent, it is also told who is speaking.
    const meta = sentMeta(
      formatTime(this.#host.now(), zone),
      identity.team ? caller : undefined,
      where,
    )
    // Pictures go to the model with the words, where the agent's model can take them.
    const images = this.#images(input.images, identity.model)
    // The main chat is set up for the bus, or back from it, before the message is in it.
    if ((await harness.snapshot(ChatsDoc, context))?.main === String(conversation.id)) {
      // Not being able to must not cost the person their message: it is tried with the next.
      await this.#syncBus(harness).catch((error) => this.#options.onReport?.(error))
    }
    // Said out loud, on a call: the agent is told so, and what was said there since it last heard.
    const spoken =
      callId === undefined
        ? undefined
        : await this.#calls.handOn(callId, input.requestId, caller, identity.name ?? "your voice")
    const submission = await conversation.submit(
      {
        type: "input",
        content: [
          { type: "text", text: input.text },
          ...images.map((image) => ({ type: "image" as const, ...image })),
          { type: "text", text: meta },
          ...(spoken === undefined ? [] : [{ type: "text" as const, text: spoken }]),
        ],
        requestId: input.requestId,
        // A message that arrives while the agent is working always joins what it is doing.
        whenBusy: "steer",
      },
      context,
    )
    const chatId = String(conversation.id)
    // Kept before the run is waited on, so that the agent's answer cannot come before it.
    await this.#record({
      kind: "said",
      text: latestOfSent(input.text),
      chatId,
      ...(caller === undefined ? {} : { by: caller.id }),
    })
    void this.#notifyWhenUnseen(harness, chatId, submission, caller)
    await harness.commit(async (tx) => {
      const chat = own((await tx.doc(ChatsDoc)).chats, chatId)
      if (chat === undefined) return
      chat.updatedAt = this.#host.now()
      // Who the agent is answering, for what it does in their name.
      if (caller !== undefined) chat.lastBy = caller.id
      if (chat.title === DEFAULT_CHAT_TITLE)
        chat.title = titleFrom(input.text) || DEFAULT_CHAT_TITLE
      if (timezone !== null && timezone !== identity.timezone) {
        ;(await tx.doc(IdentityDoc)).timezone = timezone
      }
    }, context)
    return { submissionId: String(submission.id) }
  }

  /**
   * The pictures of a message that can be shown to the model: none if the agent's model does not
   * take pictures. What is sent must be a few small pictures of a kind a model reads.
   */
  #images(sent: unknown, model: string): MessageImage[] {
    if (sent === undefined) return []
    if (!Array.isArray(sent) || sent.length > MAX_MESSAGE_IMAGES) {
      throw new HttpError(400, `A message can carry up to ${MAX_MESSAGE_IMAGES} pictures`)
    }
    let total = 0
    const images = sent.map((image: Partial<MessageImage> | null): MessageImage => {
      const { mimeType, data } = image ?? {}
      if (
        typeof mimeType !== "string" ||
        !(MESSAGE_IMAGE_TYPES as readonly string[]).includes(mimeType) ||
        typeof data !== "string" ||
        data === "" ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
      ) {
        throw new HttpError(400, "A picture must be a PNG, JPEG, WebP or GIF, as base64")
      }
      total += data.length
      return { mimeType, data }
    })
    if (total > MAX_MESSAGE_IMAGE_CHARS) {
      throw new HttpError(413, "Those pictures are too large to send with a message")
    }
    return this.#sees(model) ? images : []
  }

  /**
   * What follows a run that ends with an answer: the answer becomes the agent's latest line where
   * it was given in a chat of theirs, and the host is told where no client is following the chat.
   * `quiet` is for a run that was followed by no word to the host before the latest line was
   * kept: its answer is kept, and that is all.
   */
  async #notifyWhenUnseen(
    harness: Harness,
    chatId: string,
    submission: Awaited<ReturnType<Conversation["submit"]>>,
    caller: Caller | undefined,
    quiet = false,
  ): Promise<void> {
    try {
      const settled = await submission.wait(context)
      if (settled.status !== "done" || settled.type !== "input") return
      // The same answer, to more than one input that the run took up together, is told once to
      // each person it answers: two people of a team who wrote in the same run are each told.
      // A call that only keeps the line claims nothing, so a later one that tells still can.
      const answerKey = `${chatId}:${settled.answer}:${caller?.id ?? "*"}`
      if (this.#toldAnswers.has(answerKey)) return
      if (!quiet) {
        this.#toldAnswers.add(answerKey)
        if (this.#toldAnswers.size > MAX_TOLD_ANSWERS) {
          this.#toldAnswers.delete(this.#toldAnswers.values().next().value!)
        }
      }
      // With the bus on, what a run ends with is nobody's to read: a send is told of as it is made.
      if (await busOn(harness, chatId, context)) return
      // Whether anyone saw it is asked now, at the moment it ended, and not after what follows.
      const seen = (this.#watchers.get(chatId) ?? 0) > 0 || this.#followers.following(chatId)
      const kind = own((await harness.snapshot(ChatsDoc, context))?.chats, chatId)?.kind
      // An answer in Slack is kept when it is posted there, and one to another agent is not to
      // a person at all.
      const kept = kind === "chat"
      const told = !quiet && !seen && this.#options.onNotify !== undefined
      if (!kept && !told) return
      const answer = await harness.commit((tx) => tx.entry(AssistantEntry, settled.answer), context)
      const message = answer?.model?.[0]
      const text =
        message?.role === "assistant"
          ? message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")
          : ""
      if (kept) await this.#record({ kind: "reply", text, chatId })
      if (told && text.trim() !== "") {
        await this.#notify({
          kind: "reply",
          text: text.trim(),
          chatId,
          ...(caller === undefined ? {} : { userId: caller.id }),
        })
      }
    } catch (error) {
      this.#options.onReport?.(error)
    }
  }

  /** The agent stopped to ask a person for something: they are told, and its latest line says so. */
  #asked(heading: string, text: string, chatId: string | null): void {
    void this.#notify({ kind: "approval", heading, text, chatId })
    void this.#record({ kind: "asked", text, ...(chatId === null ? {} : { chatId }) })
  }

  /**
   * Keep the latest thing said to the agent or by it, as one line. A courtesy, as a notification
   * is: failing to keep it must never fail the work it tells of.
   */
  async #record(said: Omit<AgentLatest, "at">): Promise<void> {
    if (this.#harness === undefined) return
    try {
      const text = preview(said.text)
      if (text === "") return
      const latest = { ...said, text, at: this.#host.now() }
      const harness = await this.#harness
      // The answer that ends the turn it asked in does not take the line from what it asked:
      // until someone answers, that is what there is to know of it.
      const held = said.kind === "reply" && (await this.#asking())
      await harness.commit(async (tx) => {
        const doc = await tx.doc(LatestDoc)
        if (!held || doc.latest?.kind !== "asked") doc.latest = latest
      }, context)
    } catch (error) {
      this.#options.onReport?.(error)
    } finally {
      // Told even where the line was held or there were no words to keep: what was said may
      // have set it to work, or been it asking for something.
      this.#tell()
    }
  }

  /**
   * Tell `onActivity` how the agent stands, where that is not what it was last told. Called at
   * each moment its latest line, its being at work or its asking can change. It is read once the
   * change is made, by one reader at a time, and a call that comes while it is being read has it
   * read again: so what is told last is how the agent stood after the latest change, and nothing
   * older is told after something newer. A courtesy, as a notification is: nothing waits on it,
   * and failing to tell must never fail the work it tells of.
   */
  #tell(): void {
    const tell = this.#options.onActivity
    if (tell === undefined || this.#harness === undefined) return
    this.#untold = true
    if (this.#telling) return
    this.#telling = true
    void (async () => {
      try {
        while (this.#untold && this.#harness !== undefined) {
          this.#untold = false
          let harness: Harness | undefined
          try {
            harness = await this.#harness
            const change = { agentId: this.#host.name, ...(await this.#activity(harness)) }
            const told = JSON.stringify(change)
            if (told === this.#told) continue
            tell(change)
            this.#told = told
          } catch (error) {
            // An agent that was closed meanwhile says how it stands when it is next opened.
            if (harness !== undefined && this.#opened === harness) {
              this.#options.onReport?.(error)
            }
          }
        }
      } finally {
        this.#telling = false
      }
    })()
  }

  async #notify(notification: Omit<AgentNotification, "agentId" | "agentName">): Promise<void> {
    const notify = this.#options.onNotify
    if (notify === undefined || this.#harness === undefined) return
    try {
      const identity = await (await this.#harness).snapshot(IdentityDoc, context)
      notify({ agentId: this.#host.name, agentName: identity?.name ?? null, ...notification })
    } catch (error) {
      this.#options.onReport?.(error)
    }
  }

  #chatEvents(conversation: Conversation): Response {
    const chatId = String(conversation.id)
    return eventStream(async (emit, close) => {
      this.#watchers.set(chatId, (this.#watchers.get(chatId) ?? 0) + 1)
      const watch = await conversation.watch(context)
      let state = projectChat(watch.value)
      await emit({ type: "snapshot", state })
      watch.start(async (value) => {
        const next = projectChat(value)
        const events = diffChat(state, next)
        state = next
        for (const event of events) await emit(event)
      })
      void watch.closed.then(close)
      return () => {
        this.#watchers.set(chatId, Math.max(0, (this.#watchers.get(chatId) ?? 1) - 1))
        void watch.stop()
      }
    })
  }

  #agentEvents(harness: Harness): Response {
    return eventStream(async (emit, close) => {
      const changed = (what: Told) => async () => {
        await emit({ type: "changed", what } satisfies AgentEvent)
      }
      const watches: { what: Told; watch: DocumentWatch<JsonObject> }[] = []
      for (const [what, doc] of TOLD) {
        const watch = await harness.watchDoc(doc, context)
        if (watch !== undefined) watches.push({ what, watch })
      }
      // A library the workspace shares changes without the agent having a hand in it.
      const shared = await this.#sharedLibrary().catch(() => undefined)
      const unwatch = shared?.watch(() => void changed("library")())
      // Said once everything is being watched. What changed before this is not told here, so a
      // client that hears it asks again for whatever it already has.
      await emit({ type: "ready" } satisfies AgentEvent)
      for (const { what, watch } of watches) watch.start(changed(what))
      void watches[0]?.watch.closed.then(close)
      return () => {
        for (const { watch } of watches) void watch.stop()
        unwatch?.()
      }
    })
  }
}

export function createAgentActor(host: ActorHost, options: AgentActorOptions): Actor {
  return new AgentActor(host, options)
}

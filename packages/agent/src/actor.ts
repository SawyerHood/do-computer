import {
  type AddConnectorRequest,
  type AgentEvent,
  type AgentSummary,
  type AgentUsage,
  type ApprovalDecision,
  type ChatState,
  type ChatSummary,
  type ChatUsage,
  type ComputerKind,
  type CreateChatRequest,
  type CreatureState,
  diffChat,
  DEFAULT_THINKING,
  encodeSse,
  hasEverything,
  isThinkingLevel,
  MAX_MESSAGE_IMAGE_CHARS,
  MAX_MESSAGE_IMAGES,
  MESSAGE_IMAGE_TYPES,
  type MessageImage,
  type ModelOption,
  NEW_CREATURE,
  parseAvatar,
  parseOutfit,
  rollItem,
  type SendMessageRequest,
  SSE_HEADERS,
  SSE_HEARTBEAT,
  THINKING_LEVELS,
  TREATS_PER_BOX,
  type UpdateChatRequest,
  type ScheduleCheck,
  type UpdateScheduleRequest,
} from "@durable-computer/protocol"
import type { Actor, ActorHost, ActorNamespace, ActorStub } from "@durable-computer/runtime"
import type { Sandbox } from "@durable-computer/sandbox"
import type { Context } from "@earendil-works/chord"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Usage } from "@earendil-works/pi-ai"
import type { Models } from "@earendil-works/pi-ai/models"
import {
  AssistantEntry,
  type Conversation,
  type ConversationId,
  createRegistry,
  defineExtension,
  type Extension,
  Harness,
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
  SchedulesDoc,
} from "./docs.ts"
import { createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools"
import { ApprovalError, Approvals, ApprovalsDoc } from "./approvals.ts"
import { appGuide } from "./app-guide.ts"
import { type Caller, readCaller, sentMeta } from "./caller.ts"
import { ConnectorError, Connectors, ConnectorsDoc } from "./connectors.ts"
import { guardedFetch } from "./guarded-fetch.ts"
import { HistoryError, historyExtension, readHistory, searchHistory } from "./history.ts"
import { type JudgeOptions, KeepGoing } from "./keep-going.ts"
import { Log } from "./log.ts"
import {
  type AgentComputer,
  type ComputerAnswer,
  type ComputerDirectory,
  Computers,
  ComputersDoc,
  isPaired,
} from "./computers.ts"
import { harnessDocs, Library, LibraryDoc, LibraryError, LibraryStore } from "./library.ts"
import { LIBRARY_AGENT_HEADER } from "./library-actor.ts"
import { type RemoteLibrary, remoteLibrary } from "./library-remote.ts"
import { routeLibrary, routeLibraryView } from "./library-routes.ts"
import { parseModel } from "./models.ts"
import { type AgentDirectory, PeerError, type PeerMessage, type PeerReply, Peers } from "./peers.ts"
import { formatTime, isValidTimezone } from "./schedule.ts"
import { type CheckResult, ScheduleError, Scheduler } from "./schedules.ts"
import { SecretError, Secrets, SecretsDoc } from "./secrets.ts"
import { type SettingsChange, SettingsError, settingsExtension } from "./settings.ts"
import { SkillError, Skills, SkillsDoc } from "./skills.ts"
import { SlackChats, type SlackDirectory, SlackError, type SlackMessage } from "./slack.ts"
import { MEMORY_LIMIT, Persona, USER_LIMIT } from "./persona.ts"
import { addUsage, projectChat } from "./project.ts"
import { JobError, Jobs } from "./jobs.ts"
import { SubagentError, Subagents } from "./subagents.ts"
import { webSearchExtension, type WebSearchOptions } from "./web-search.ts"
import { isInherited, own } from "./own.ts"

const context = BACKGROUND_CONTEXT

/**
 * While work is live the actor wakes itself this often. On Cloudflare the wake-up keeps the
 * Durable Object from being evicted mid-run, and if it was evicted or crashed anyway, the next one
 * reopens the store and resumes the run from its last checkpoint.
 */
const KEEPALIVE_MS = 20_000
/** How long an automation's check may run before it is stopped and counted as broken. */
const CHECK_TIMEOUT_MS = 60_000
const SSE_HEARTBEAT_MS = 15_000
const MAX_MESSAGE_CHARS = 200_000
const MAX_TITLE_CHARS = 80

export type AgentActorOptions = {
  readonly models: Models
  /** `provider/modelId` for agents that have not chosen a model. */
  readonly defaultModel: string
  readonly modelOptions: readonly ModelOption[]
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
  /** How often the actor wakes itself while work is live. */
  readonly keepAliveMs?: number
  /** How long a command is waited for before it is left to run in the background. */
  readonly foregroundMs?: number
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
   * Who the other agents of the agent's workspace are, and how a message reaches one. Without
   * it, the agent knows of no other agent.
   */
  readonly agentDirectory?: AgentDirectory
  /**
   * How the agent reaches Slack, where it has been put there as a bot. Without it, nothing said
   * in Slack arrives.
   */
  readonly slackDirectory?: SlackDirectory
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
   * Has a small model judge, when a run ends on what could be a progress update, whether the
   * agent meant to go on, and sets it going again if so. Absent: a run ends where the agent stops.
   */
  readonly judge?: JudgeOptions
  /** Used to fetch skills the user installs from a URL. Default: the global `fetch`. */
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>
  /**
   * Called when the agent has something for a user who may not be looking: a scheduled task
   * reported, or it finished answering in a chat nobody has open. For sending a push
   * notification. Best effort: a reply that finishes after a restart is not announced.
   */
  readonly onNotify?: (notification: AgentNotification) => void
  /**
   * The address people reach the app at, such as `https://example.com`. With it the agent can
   * hand a person a link to a screen, and can add a connector that has people sign in. Where it
   * is not set, the address its gateway was last reached at stands in.
   */
  readonly appUrl?: string
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

/** Where a service sends someone back after they sign in to a connector, under the app's address. */
export const CONNECTOR_CALLBACK_PATH = "/api/connectors/callback"

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

/** What a message does that arrives while the agent is working, where the sender did not say. */
const whenBusyOf = (identity: Readonly<IdentityState>): "steer" | "queue" =>
  identity.whenBusy ?? "steer"

function summarize(id: string, record: ChatRecord, main: string | undefined): ChatSummary {
  const { subagent, peer, slack, ...chat } = record
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
  /** The library the agent keeps for itself, where its workspace has none for it to share. */
  readonly #ownLibrary: LibraryStore
  /** The harness, once it is open, for what is built before it and needs it later. */
  #opened: Harness | undefined
  #connectors: Connectors | undefined
  /** How many clients are following each chat right now. */
  readonly #watchers = new Map<string, number>()
  readonly #scheduler: Scheduler
  readonly #subagents: Subagents
  readonly #jobs: Jobs
  readonly #peers: Peers | undefined
  readonly #slack: SlackChats | undefined
  readonly #skills: Skills
  readonly #approvals: Approvals
  readonly #secrets: Secrets
  readonly #keepGoing: KeepGoing
  #harness: Promise<Harness> | undefined
  /** When the agent next wakes itself to keep live work going, while that is still to come. */
  #wake: number | undefined
  /** The address the app was last reached at, as its gateway said. */
  #origin: string | undefined

  constructor(host: ActorHost, options: AgentActorOptions) {
    this.#host = host
    this.#options = options
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
    this.#ownLibrary = new LibraryStore({
      docs: harnessDocs(() => {
        if (this.#opened === undefined) throw new Error("The agent is not open yet")
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
        void this.#harness.then((harness) =>
          this.#notifyWhenUnseen(harness, report.chatId, report.turn!, undefined),
        )
      },
      onError: (error) => options.onReport?.(error),
    })
    this.#computers = new Computers({
      links: options.computerLinks,
      machine: (kind, key) => this.#choices.create(kind, key, host),
      extraTools: [this.#library.sendFileTool, this.#library.libraryTool],
      // Loading a skill copies its files to where the agent is working, if it is anywhere.
      optionalTools: [this.#skills.tool],
      ...(options.computerDirectory === undefined
        ? {}
        : { directory: { agentId: host.name, lookup: options.computerDirectory } }),
      around: this.#library.around,
      onProblem: report("A machine could not be made ready for the agent"),
      appUrl: () => this.#appUrl(),
    })
    this.#secrets = new Secrets({
      now: () => host.now(),
      computer: (name, c) => this.#computers.resolve(name, c),
      addConnector: async (input, c) => {
        if (this.#connectors === undefined) throw new Error("The agent is not open yet")
        // A token is sent with every request, so nobody signs in and nothing returns anywhere.
        return this.#connectors.add(input, this.#connectorRedirect() ?? "", c)
      },
      onRequest: (request) =>
        void this.#notify({
          kind: "approval",
          heading: "Needs something from you",
          text:
            request.purpose ?? `Asks for ${request.fields.map((field) => field.name).join(", ")}`,
          chatId: request.chatId,
        }),
    })
    this.#approvals = new Approvals({
      now: () => host.now(),
      computerOf: (name, c) => this.#computers.peek(name, c),
      connectorOf: async (tool, c) => this.#connectors?.connectorOf(tool, c),
      connectors: async (c) => (await this.#connectors?.list(c)) ?? [],
      onRequest: (request) =>
        void this.#notify({
          kind: "approval",
          heading: "Needs your OK",
          text: request.detail === "" ? request.title : `${request.title}: ${request.detail}`,
          // A thread in Slack is answered for in the app, on the thread's own page.
          chatId:
            request.chatKind === "chat" || request.chatKind === "slack" ? request.chatId : null,
        }),
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
        // A scheduled run that came to something is work done for someone, as an answer is.
        void this.#earnTreat()
        void this.#notify({
          kind: "scheduled",
          heading: report.title,
          text: report.text,
          chatId: report.chatId,
        })
      },
      onError: (error) => options.onReport?.(error),
    })
    this.#subagents = new Subagents({
      now: () => host.now(),
      context,
      chat: (chatId) => this.#chatState(chatId),
      waiting: async (chatId, c) =>
        (await this.#approvals.pending(c)).some((request) => request.chatId === chatId),
      running: (chatId, c) => this.#jobs.waiting(chatId, c),
      onStopped: async (chatId, c) => {
        await this.#approvals.withdraw(chatId, c)
        // What a stopped sub-agent left running would only set it going again.
        await this.#jobs.stopFor(chatId, c)
      },
      // What the agent says about a report is told like any other answer nobody was there for.
      onReport: (report) => {
        if (report.turn === undefined || this.#harness === undefined) return
        void this.#harness.then((harness) =>
          // Nobody in particular asked for it, so it is for everyone the agent works for.
          this.#notifyWhenUnseen(harness, report.parentId, report.turn!, undefined),
        )
      },
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
            now: () => host.now(),
            context,
            chat: (chatId) => this.#chatState(chatId),
            waiting: async (chatId, c) =>
              (await this.#approvals.pending(c)).some((request) => request.chatId === chatId),
            running: (chatId, c) => this.#jobs.waiting(chatId, c),
            onStopped: (chatId, c) => this.#approvals.withdraw(chatId, c),
            keep: (file) => this.#library.keep(file),
            contents: (file) => this.#library.contents(file),
            libraryFile: (name) => this.#library.named(name),
            sees: (model) =>
              options.modelOptions.find((option) => option.id === model)?.images === true,
            onError: (error) => options.onReport?.(error),
          })
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
    this.#harness ??= (async () => {
      const registry = createRegistry()
      // For tools that read the harness they are installed in, once it exists.
      let opened: Harness | undefined
      registry.install(Persona)
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
      registry.install(this.#scheduler.extension)
      registry.install(this.#subagents.extension)
      registry.install(this.#jobs.extension)
      if (this.#peers !== undefined) registry.install(this.#peers.extension)
      if (this.#slack !== undefined) registry.install(this.#slack.extension)
      registry.install(this.#skills.extension)
      registry.install(this.#secrets.extension)
      registry.install(
        settingsExtension({
          models: this.#options.modelOptions,
          state: async () => {
            const identity = await this.#identity(await this.#open())
            return {
              model: identity.model,
              thinking: identity.thinking ?? DEFAULT_THINKING,
              whenBusy: whenBusyOf(identity),
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
      registry.install(Log)
      registry.install(this.#keepGoing.extension)
      if (this.#options.webSearch !== undefined) {
        registry.install(webSearchExtension(this.#options.webSearch))
      }
      registry.install(
        historyExtension(() => {
          if (opened === undefined) throw new Error("The agent is not open yet")
          return opened
        }),
      )
      for (const extension of this.#options.extensions ?? []) registry.install(extension)
      const harness = await Harness.open(
        await SqliteStorage.open(this.#host.sql),
        {
          models: this.#options.models,
          registry,
          now: () => this.#host.now(),
          onReport: (error) => this.#options.onReport?.(error),
          settings: { toolExecution: "parallel" },
        },
        context,
      )
      opened = harness
      this.#opened = harness
      this.#approvals.attach(harness)
      this.#keepGoing.attach(harness)
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
      // Connector tools come and go while the agent runs, so they are installed after opening.
      this.#connectors = new Connectors({
        sql: this.#host.sql,
        now: () => this.#host.now(),
        install: (extension) => registry.install(extension),
        fetch: this.#options.connectorFetch,
        allowPrivateHosts: this.#options.allowPrivateHosts,
        resolveHost: this.#options.resolveHost,
        redirectUrl: () => this.#connectorRedirect(),
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
      // A schedule the agent creates or changes moves the next wake-up.
      if (
        (await harness.snapshot(SchedulesDoc, context)) === undefined ||
        (await harness.snapshot(ComputersDoc, context)) === undefined ||
        (await harness.snapshot(LibraryDoc, context)) === undefined ||
        (await harness.snapshot(ConnectorsDoc, context)) === undefined ||
        (await harness.snapshot(ApprovalsDoc, context)) === undefined ||
        (await harness.snapshot(SecretsDoc, context)) === undefined ||
        (await harness.snapshot(CreatureDoc, context)) === undefined
      ) {
        // Created up front so they can be watched before they have any content.
        await harness.commit(async (tx) => {
          await tx.doc(SchedulesDoc)
          await tx.doc(ComputersDoc)
          await tx.doc(LibraryDoc)
          await tx.doc(ConnectorsDoc)
          await tx.doc(ApprovalsDoc)
          await tx.doc(SecretsDoc)
          await tx.doc(CreatureDoc)
        }, context)
      }
      const schedules = await harness.watchDoc(SchedulesDoc, context)
      schedules?.start(async () => {
        await this.#rearm().catch((error) => this.#options.onReport?.(error))
      })
      // Pick up whatever a previous process left unfinished.
      harness.resume()
      return harness
    })()
    this.#harness.catch(() => {
      this.#harness = undefined
    })
    return this.#harness
  }

  /**
   * Set the one wake-up to the sooner of two needs: keeping live work going, and the next
   * schedule. Clear it when there is neither.
   */
  async #rearm(): Promise<void> {
    if (this.#harness === undefined) return
    const harness = await this.#harness
    const inspection = await harness.inspect(context)
    // A sub-agent that has finished and not yet reported has nothing live, and still needs a
    // look. So does a conversation with another agent whose answer is still to be handed back,
    // and a thread in Slack whose answer is still to be posted.
    const live =
      inspection.tasks.length > 0 ||
      inspection.submissions.length > 0 ||
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
    const scheduled = await this.#scheduler.nextWake(context)
    const wake =
      keepAlive === null
        ? scheduled
        : scheduled === null
          ? keepAlive
          : Math.min(keepAlive, scheduled)
    if (wake !== null) await this.#host.setAlarm(wake)
    else if ((await this.#host.getAlarm()) !== null) await this.#host.setAlarm(null)
  }

  async alarm(): Promise<void> {
    await this.#open()
    await this.#scheduler.tick(context)
    await this.#subagents.tick()
    await this.#jobs.tick()
    await this.#peers?.tick()
    await this.#slack?.tick()
    await this.#rearm()
  }

  /** Unfinished runs stay pending in the store; the next process resumes them. */
  async close(): Promise<void> {
    const harness = this.#harness
    this.#harness = undefined
    this.#opened = undefined
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
          `The agent's computer could not be deleted, so nothing was: ${
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
      if (error instanceof HttpError) {
        return json({ error: error.message, code: error.code }, error.status)
      }
      if (
        error instanceof ScheduleError ||
        error instanceof SubagentError ||
        error instanceof JobError ||
        error instanceof PeerError ||
        error instanceof SlackError ||
        error instanceof SkillError ||
        error instanceof LibraryError ||
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
    const identity = await this.#identity(harness)

    if (segments.length === 0) {
      if (method === "GET") return json(await this.#state(harness, identity))
      if (method === "PATCH") {
        await this.#apply(harness, await body<Record<string, unknown>>(request))
        return json(await this.#state(harness, await this.#identity(harness)))
      }
    }
    if (segments[0] === "events" && method === "GET") return this.#agentEvents(harness)
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
        return json(await this.#peers.receive(from, await body<PeerMessage>(request), context))
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
        const { code } = await body<{ code?: string }>(request)
        if (typeof code !== "string" || code === "") throw new HttpError(400, "code is required")
        const { turn, ...result } = await connectors.authorize(connectorId, code, context, caller)
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
        const { decision } = await body<{ decision: ApprovalDecision }>(request)
        await this.#approvals.resolve(
          requestId,
          decision,
          context,
          identity.team ? caller : undefined,
        )
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
          : await this.#secrets.answer(
              requestId,
              (await body<{ values?: unknown }>(request)).values,
              context,
              caller,
            )
        // What the agent says about it is told like any other answer nobody was there for.
        if (told !== undefined) {
          await this.#touch(harness, told.chatId)
          void this.#notifyWhenUnseen(harness, told.chatId, told.turn, undefined)
        }
        return json({ ok: true })
      }
    }
    if (segments[0] === "search" && segments[1] === undefined && method === "GET") {
      const limit = url.searchParams.get("limit")
      return json(
        await searchHistory(
          harness,
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
    if (segments[0] === "chats") {
      if (segments.length === 1 && method === "POST") {
        return this.#createChat(harness, identity, await body<CreateChatRequest>(request), caller)
      }
      if (segments[1] === "main" && segments.length === 2 && method === "POST") {
        return this.#mainChat(harness, identity, caller)
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
          throw new HttpError(409, "Only the agent talks to its sub-agents.", "subagent")
        }
        // A conversation with another agent is the two agents' to write in, in the same way.
        const thread = kind === "agent"
        if (thread && (rest === "messages" || rest === "reset") && method === "POST") {
          throw new HttpError(409, "Only the two agents write in this conversation.", "agent")
        }
        // A thread in Slack is written in from Slack, and read here.
        const slack = kind === "slack"
        if (slack && (rest === "messages" || rest === "reset") && method === "POST") {
          throw new HttpError(409, "This conversation is written in from Slack.", "slack")
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
          // and what the agent remembers is unaffected.
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
      throw new HttpError(409, "Agent is not initialized", "not_initialized")
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
    const model = input.model ?? this.#options.defaultModel
    this.#requireModel(model)
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
    if (outcome === "taken") throw new HttpError(409, "Agent belongs to another account")
    if (outcome === "new" && machine !== undefined) {
      await this.#computers.setMachines([machine], context)
    }
    await this.#skills.seed(context)
    return json(await this.#state(harness, await this.#identity(harness)))
  }

  #requireModel(model: string): void {
    if (!this.#options.modelOptions.some((option) => option.id === model)) {
      throw new HttpError(400, `Unknown model "${model}"`)
    }
    const ref = parseModel(model)
    if (this.#options.models.getModel(ref.provider, ref.modelId) === undefined) {
      throw new HttpError(400, `Model "${model}" is not available`)
    }
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
    }
    return {
      agent,
      timezone: identity.timezone ?? null,
      ownerId: identity.ownerId,
      // The team that shares it, by name, or null for one person's.
      team: identity.team ?? null,
      whenBusy: whenBusyOf(identity),
      soul: identity.soul,
      user: identity.user,
      memory: identity.memory,
      limits: { memory: MEMORY_LIMIT, user: USER_LIMIT },
      chats: Object.entries(chats)
        .map(([id, record]) => summarize(id, record, main))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }
  }

  /** What its creature has been given and has on. One from before there was any of it has a box waiting. */
  async #creature(harness: Harness): Promise<CreatureState> {
    const creature = (await harness.snapshot(CreatureDoc, context)) ?? NEW_CREATURE
    return { ...creature, owned: [...creature.owned], outfit: { ...creature.outfit } }
  }

  /** The agent answered someone, or a scheduled run of its came to something: a treat for its creature. */
  async #earnTreat(): Promise<void> {
    if (this.#harness === undefined) return
    try {
      await (
        await this.#harness
      ).commit(async (tx) => {
        ;(await tx.doc(CreatureDoc)).treats++
      }, context)
    } catch (error) {
      this.#options.onReport?.(error)
    }
  }

  /** Give its creature one of its treats. Enough of them and it finds a box. */
  async #feed(harness: Harness): Promise<Response> {
    const fed = await harness.commit(async (tx) => {
      const creature = await tx.doc(CreatureDoc)
      if (creature.treats <= 0) return false
      creature.treats--
      creature.fed++
      // Once everything is found there is nothing for another box to hold.
      if (!hasEverything(creature.owned) && ++creature.joy >= TREATS_PER_BOX) {
        creature.joy = 0
        creature.boxes++
      }
      return true
    }, context)
    if (!fed) throw new HttpError(409, "It has no treats to be given", "no_treats")
    return json(await this.#creature(harness))
  }

  /** Open one of its boxes: something to wear that it does not have yet, picked by chance. */
  async #openBox(harness: Harness): Promise<Response> {
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
        return undefined
      }
      creature.boxes--
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
    if (model !== undefined) this.#requireModel(model)
    const thinking = text("thinking", 20)
    if (thinking !== undefined && !isThinkingLevel(thinking)) {
      throw new HttpError(400, `thinking must be one of ${THINKING_LEVELS.join(", ")}`)
    }
    const timezone = text("timezone", 64)
    if (timezone !== undefined && !isValidTimezone(timezone)) {
      throw new HttpError(400, `"${timezone}" is not an IANA timezone`)
    }
    const whenBusy = text("whenBusy", 10)
    if (whenBusy !== undefined && whenBusy !== "steer" && whenBusy !== "queue") {
      throw new HttpError(400, "whenBusy must be steer or queue")
    }
    const now = this.#host.now()
    let avatar: IdentityState["avatar"] | undefined
    if (input.avatar !== undefined) {
      const parsed = parseAvatar(input.avatar as { color?: unknown; seed?: unknown })
      if ("error" in parsed) throw new HttpError(400, parsed.error)
      avatar = parsed.avatar
    }

    const chats = await harness.commit(async (tx) => {
      const identity = await tx.doc(IdentityDoc)
      if (name !== undefined) identity.name = name
      if (tagline !== undefined) identity.tagline = tagline.trim() || null
      if (soul !== undefined) identity.soul = soul
      if (user !== undefined) identity.user = user
      if (memory !== undefined) identity.memory = memory
      if (avatar !== undefined) identity.avatar = avatar
      // Hatching happens once. There is no putting it back in the egg.
      if (input.hatched === true) identity.hatchedAt ??= now
      if (timezone !== undefined) identity.timezone = timezone
      if (whenBusy !== undefined) identity.whenBusy = whenBusy
      // Chats pick this up on their next message.
      if (thinking !== undefined) identity.thinking = thinking
      if (model === undefined || model === identity.model) return []
      identity.model = model
      return Object.keys((await tx.doc(ChatsDoc)).chats)
    }, context)
    // A model change applies to existing chats from their next request.
    if (model !== undefined) {
      for (const id of chats) {
        const conversation = await harness.conversation(Number(id) as ConversationId, context)
        await conversation?.configure({ model: parseModel(model) }, context)
      }
    }
  }

  async #chat(harness: Harness, chatId: string): Promise<Conversation> {
    const chats = (await harness.snapshot(ChatsDoc, context))?.chats ?? {}
    // Only conversations in the index are chats; subagent conversations are not addressable.
    if (!Object.hasOwn(chats, chatId)) throw new HttpError(404, "Chat not found")
    const conversation = await harness.conversation(Number(chatId) as ConversationId, context)
    if (conversation === undefined) throw new HttpError(404, "Chat not found")
    return conversation
  }

  /** A chat someone talks in. As the main chat, it takes that place from whichever had it. */
  async #newChat(
    harness: Harness,
    identity: Readonly<IdentityState>,
    title: string | undefined,
    caller: Caller | undefined,
    main: boolean,
  ): Promise<ChatSummary> {
    const now = this.#host.now()
    const record: ChatRecord = {
      title: title?.trim().slice(0, MAX_TITLE_CHARS) || DEFAULT_CHAT_TITLE,
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
          if (main) doc.main = String(id)
        },
      },
      context,
    )
    const id = String(conversation.id)
    return summarize(id, record, main ? id : undefined)
  }

  /** A chat beside the main one: a side chat. */
  async #createChat(
    harness: Harness,
    identity: Readonly<IdentityState>,
    input: CreateChatRequest,
    caller: Caller | undefined,
  ): Promise<Response> {
    return json(await this.#newChat(harness, identity, input.title, caller, false), 201)
  }

  /**
   * The agent's main chat, settled on if it has none. An agent from before there was such a
   * thing gets the chat it was last talked to in, and its other chats are side chats from then
   * on. One that has never been talked to gets a new chat.
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
    return json(found ?? (await this.#newChat(harness, identity, undefined, caller, true)))
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
      if (typeof input.archived === "boolean") chat.archived = input.archived
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
    // Where a team shares the agent, it is also told who is speaking.
    const meta = sentMeta(formatTime(this.#host.now(), zone), identity.team ? caller : undefined)
    // Pictures go to the model with the words, where the agent's model can take them.
    const images = this.#images(input.images, identity.model)
    const submission = await conversation.submit(
      {
        type: "input",
        content: [
          { type: "text", text: input.text },
          ...images.map((image) => ({ type: "image" as const, ...image })),
          { type: "text", text: meta },
        ],
        requestId: input.requestId,
        // What the sender asked for, else what the agent is set to do with a message that
        // arrives while it is working.
        whenBusy:
          input.whenBusy === "followUp" ||
          (input.whenBusy === undefined && whenBusyOf(identity) === "queue")
            ? "followUp"
            : "steer",
      },
      context,
    )
    const chatId = String(conversation.id)
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
    return json({ submissionId: String(submission.id) }, 202)
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
    const sees = this.#options.modelOptions.find((option) => option.id === model)?.images === true
    return sees ? images : []
  }

  /**
   * What follows a run that ends with an answer: the creature earns a treat where the answer was
   * to a person, and the host is told where no client is following the chat.
   */
  async #notifyWhenUnseen(
    harness: Harness,
    chatId: string,
    submission: Awaited<ReturnType<Conversation["submit"]>>,
    caller: Caller | undefined,
  ): Promise<void> {
    try {
      const settled = await submission.wait(context)
      if (settled.status !== "done" || settled.type !== "input") return
      // Whether anyone saw it is asked now, at the moment it ended, and not after what follows.
      const seen = (this.#watchers.get(chatId) ?? 0) > 0
      // What it says to another agent, or as a sub-agent of itself, is not an answer to anyone.
      const kind = own((await harness.snapshot(ChatsDoc, context))?.chats, chatId)?.kind
      if (kind === "chat" || kind === "slack") await this.#earnTreat()
      if (seen || this.#options.onNotify === undefined) return
      const answer = await harness.commit((tx) => tx.entry(AssistantEntry, settled.answer), context)
      const message = answer?.model?.[0]
      const text =
        message?.role === "assistant"
          ? message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")
          : ""
      if (text.trim() !== "") {
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
      const identity = await harness.watchDoc(IdentityDoc, context)
      const chats = await harness.watchDoc(ChatsDoc, context)
      const schedules = await harness.watchDoc(SchedulesDoc, context)
      const skills = await harness.watchDoc(SkillsDoc, context)
      const computers = await harness.watchDoc(ComputersDoc, context)
      const library = await harness.watchDoc(LibraryDoc, context)
      const connectors = await harness.watchDoc(ConnectorsDoc, context)
      const approvals = await harness.watchDoc(ApprovalsDoc, context)
      const secrets = await harness.watchDoc(SecretsDoc, context)
      const creature = await harness.watchDoc(CreatureDoc, context)
      const changed = (what: Extract<AgentEvent, { type: "changed" }>["what"]) => async () => {
        await emit({ type: "changed", what } satisfies AgentEvent)
      }
      // A library the workspace shares changes without the agent having a hand in it.
      const shared = await this.#sharedLibrary().catch(() => undefined)
      const unwatch = shared?.watch(() => void changed("library")())
      await emit({ type: "ready" } satisfies AgentEvent)
      identity?.start(changed("identity"))
      chats?.start(changed("chats"))
      schedules?.start(changed("schedules"))
      skills?.start(changed("skills"))
      computers?.start(changed("computers"))
      library?.start(changed("library"))
      connectors?.start(changed("connectors"))
      approvals?.start(changed("approvals"))
      secrets?.start(changed("secrets"))
      creature?.start(changed("creature"))
      void (identity ?? chats)?.closed.then(close)
      return () => {
        void identity?.stop()
        void chats?.stop()
        void schedules?.stop()
        void skills?.stop()
        void computers?.stop()
        void library?.stop()
        void connectors?.stop()
        void approvals?.stop()
        void secrets?.stop()
        void creature?.stop()
        unwatch?.()
      }
    })
  }
}

export function createAgentActor(host: ActorHost, options: AgentActorOptions): Actor {
  return new AgentActor(host, options)
}

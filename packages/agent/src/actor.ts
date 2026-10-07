import {
  type AddConnectorRequest,
  type AgentEvent,
  type AgentSummary,
  type AgentUsage,
  type ApprovalDecision,
  type ChatState,
  type ChatSummary,
  BodyTooLarge,
  type ChatUsage,
  type ComputerKind,
  declaredTooLarge,
  readLimited,
  type CreateChatRequest,
  diffChat,
  DEFAULT_THINKING,
  encodeSse,
  isThinkingLevel,
  MAX_MESSAGE_IMAGE_CHARS,
  MAX_MESSAGE_IMAGES,
  MESSAGE_IMAGE_TYPES,
  type MessageImage,
  type ModelOption,
  parseAvatar,
  type SendMessageRequest,
  SSE_HEADERS,
  SSE_HEARTBEAT,
  THINKING_LEVELS,
  type UpdateChatRequest,
  type UpdateScheduleRequest,
} from "@durable-computer/protocol"
import type { Actor, ActorHost, ActorNamespace } from "@durable-computer/runtime"
import type { Sandbox } from "@durable-computer/sandbox"
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
  IdentityDoc,
  type IdentityState,
  SchedulesDoc,
} from "./docs.ts"
import { CodingTools } from "@earendil-works/pi-durable/tools"
import { ApprovalError, Approvals, ApprovalsDoc, MEMORY_SUBJECT } from "./approvals.ts"
import { type Caller, readCaller, sentMeta } from "./caller.ts"
import { Computer, COMPUTER_EXTENSION, WithoutComputer } from "./computer.ts"
import { ConnectorError, Connectors, ConnectorsDoc } from "./connectors.ts"
import { guardedFetch } from "./guarded-fetch.ts"
import { HistoryError, historyExtension, readHistory, searchHistory } from "./history.ts"
import { type JudgeOptions, KeepGoing } from "./keep-going.ts"
import { Log } from "./log.ts"
import {
  cleanLibraryPath,
  Library,
  LibraryConflict,
  LibraryDoc,
  LibraryError,
  MAX_LIBRARY_FILE_BYTES,
} from "./library.ts"
import {
  type ComputerAnswer,
  type ComputerDirectory,
  ComputersDoc,
  type PairedComputer,
  PairedComputers,
} from "./paired.ts"
import { parseModel } from "./models.ts"
import { formatTime, isValidTimezone } from "./schedule.ts"
import { ScheduleError, Scheduler } from "./schedules.ts"
import { SkillError, Skills, SkillsDoc } from "./skills.ts"
import { MEMORY_LIMIT, Persona, USER_LIMIT } from "./persona.ts"
import { addUsage, projectChat } from "./project.ts"
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
   * The agent's computer, where every agent gets the same kind. Should be cheap to call and start
   * nothing until used, as `lazySandbox` does: it is built whenever the actor loads.
   */
  readonly sandbox?: (host: ActorHost) => Sandbox
  /** The kinds of computer an agent can be given and moved between. Takes the place of `sandbox`. */
  readonly computers?: ComputerChoices
  /** Receives failures that did not fail a request. */
  readonly onReport?: (error: unknown) => void
  /** How often the actor wakes itself while work is live. */
  readonly keepAliveMs?: number
  /** Where the links to the user's own paired computers live. Without it, none can be used. */
  readonly computerLinks?: ActorNamespace
  /**
   * Which computers the agent could be connected to besides the ones it has, and how it asks for
   * one. Without it, the agent has only the computers it was given. Needs `computerLinks`.
   */
  readonly computerDirectory?: ComputerDirectory
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
}

export type ComputerChoices = {
  /** What can be chosen, in the order to offer it. */
  readonly kinds: readonly ComputerKind[]
  /** The kind an agent gets when none is asked for. One of `kinds`. */
  readonly default: string
  /**
   * The computer of one kind for the agent behind `host`, or undefined for a kind that means
   * having none. Should be cheap and start nothing until used, as for `sandbox`. The same kind
   * and host must always lead to the same machine: that is how an agent finds its files again.
   */
  readonly create: (kind: string, host: ActorHost) => Sandbox | undefined
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

/** Holds an extension's place in the registry while there is nothing to put there. */
const absent = (name: string) => defineExtension({ name })

/** What a message does that arrives while the agent is working, where the sender did not say. */
const whenBusyOf = (identity: Readonly<IdentityState>): "steer" | "queue" =>
  identity.whenBusy ?? (identity.team ? "queue" : "steer")

function summarize(id: string, record: ChatRecord): ChatSummary {
  const { subagent, ...chat } = record
  return {
    id,
    ...chat,
    ...(subagent === undefined ? {} : { parentId: subagent.parentId, status: subagent.status }),
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
  /** The agent's computer and its kind. Settled when the store opens; the owner can change it. */
  #computer: Computer | undefined
  #kind = ""
  #registry: ReturnType<typeof createRegistry> | undefined
  readonly #paired: PairedComputers | undefined
  readonly #library: Library
  #connectors: Connectors | undefined
  /** How many clients are following each chat right now. */
  readonly #watchers = new Map<string, number>()
  readonly #scheduler: Scheduler
  readonly #subagents: Subagents
  readonly #skills: Skills
  readonly #approvals: Approvals
  readonly #keepGoing: KeepGoing
  #harness: Promise<Harness> | undefined

  constructor(host: ActorHost, options: AgentActorOptions) {
    this.#host = host
    this.#options = options
    // One kind without a name, when the deployment gives no choice.
    this.#choices = options.computers ?? {
      kinds: [],
      default: "",
      create: (_kind, host) => options.sandbox?.(host),
    }
    this.#library = new Library({
      blobs: host.blobs,
      now: () => host.now(),
      computer: () =>
        this.#computer === undefined
          ? undefined
          : { sandbox: this.#computer.sandbox, key: this.#kind === "" ? "default" : this.#kind },
      onProblem: (error) =>
        options.onReport?.(
          new Error(
            `The agent's library folder could not be brought into step with its library: ${
              error instanceof Error ? error.message : String(error)
            }`,
            { cause: error },
          ),
        ),
    })
    this.#paired =
      options.computerLinks === undefined
        ? undefined
        : new PairedComputers(
            options.computerLinks,
            [this.#library.sendFileTool, this.#library.libraryTool],
            options.computerDirectory === undefined
              ? undefined
              : { agentId: host.name, lookup: options.computerDirectory },
          )
    const skillFetch = guardedFetch(
      (input, init) => (options.fetch ?? fetch)(String(input), init),
      options.allowPrivateHosts === true,
      { resolve: options.resolveHost },
    )
    this.#skills = new Skills({
      now: () => host.now(),
      sandbox: () => this.#computer?.sandbox,
      // The agent can be talked into installing from any address, so this one is checked too.
      fetch: (url, init) => skillFetch(url, init),
    })
    this.#approvals = new Approvals({
      now: () => host.now(),
      connectorOf: async (tool, c) => this.#connectors?.connectorOf(tool, c),
      connectors: async (c) => (await this.#connectors?.list(c)) ?? [],
      onRequest: (request) =>
        void this.#notify({
          kind: "approval",
          heading: "Needs your OK",
          text: request.detail === "" ? request.title : `${request.title}: ${request.detail}`,
          chatId: request.chatKind === "chat" ? request.chatId : null,
        }),
    })
    this.#keepGoing = new KeepGoing({
      judge: options.judge,
      chat: (chatId) => this.#chatState(chatId),
      context,
      onError: (error) => options.onReport?.(error),
    })
    this.#scheduler = new Scheduler({
      now: () => host.now(),
      onReport: (report) =>
        void this.#notify({
          kind: "scheduled",
          heading: report.title,
          text: report.text,
          chatId: report.chatId,
        }),
      onError: (error) => options.onReport?.(error),
    })
    this.#subagents = new Subagents({
      now: () => host.now(),
      context,
      chat: (chatId) => this.#chatState(chatId),
      waiting: async (chatId, c) =>
        (await this.#approvals.pending(c)).some((request) => request.chatId === chatId),
      onStopped: (chatId, c) => this.#approvals.withdraw(chatId, c),
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

  #offers(kind: string): boolean {
    return this.#choices.kinds.some((offered) => offered.id === kind)
  }

  /**
   * Put the agent on its computer of one kind. Nothing is started by this: a machine is created or
   * woken the first time the agent uses it.
   */
  #useComputer(harness: Harness, kind: string, movedAt: number | undefined): void {
    const sandbox = this.#choices.create(kind, this.#host)
    let computer: Computer | undefined
    if (sandbox !== undefined) {
      computer = new Computer(sandbox)
      computer.movedAt = movedAt
      computer.onProblem = (error) =>
        this.#options.onReport?.(
          new Error(
            `The agent's identity files could not be kept in step with its computer: ${
              error instanceof Error ? error.message : String(error)
            }`,
            { cause: error },
          ),
        )
      computer.identityEditable = async (c) =>
        (await this.#approvals.ruleFor(MEMORY_SUBJECT, c)) === "allow"
      computer.attach(harness)
    }
    this.#computer = computer
    this.#kind = kind
    this.#library.computerChanged()
    // Installing under a name that is taken replaces what is there, where it stands.
    // The file and shell tools are needed for paired computers even without one of its own.
    this.#registry?.install(
      computer !== undefined || this.#paired !== undefined ? CodingTools : absent(CodingTools.name),
    )
    this.#registry?.install(
      computer?.extension ??
        (this.#paired === undefined ? absent(COMPUTER_EXTENSION) : WithoutComputer),
    )
  }

  /** Settle which computer the agent is on, from what is stored and what is offered now. */
  async #settleComputer(harness: Harness): Promise<void> {
    const identity = await harness.snapshot(IdentityDoc, context)
    const chosen = identity?.computer
    // A kind that is no longer offered cannot be built. The choice is kept for when it is again.
    const kind = chosen !== undefined && this.#offers(chosen) ? chosen : this.#choices.default
    this.#useComputer(harness, kind, identity?.computerChangedAt)
    if (identity === undefined || identity.ownerId === "" || this.#choices.kinds.length === 0) {
      return
    }
    if (chosen !== undefined && identity.computers?.includes(kind) === true) return
    // An agent from before there was a choice stays on what it has, whatever the default becomes.
    await harness.commit(async (tx) => {
      const doc = await tx.doc(IdentityDoc)
      doc.computer ??= kind
      if (doc.computers?.includes(kind) !== true) doc.computers = [...(doc.computers ?? []), kind]
    }, context)
  }

  #open(): Promise<Harness> {
    this.#harness ??= (async () => {
      const registry = createRegistry()
      this.#registry = registry
      // For tools that read the harness they are installed in, once it exists.
      let opened: Harness | undefined
      registry.install(Persona)
      // First among the tool hooks: a call that is not allowed should cause nothing at all.
      registry.install(this.#approvals.extension)
      // The agent's computer goes here. Which one is known once the store is open.
      registry.install(absent(CodingTools.name))
      registry.install(absent(COMPUTER_EXTENSION))
      if (this.#paired !== undefined) registry.install(this.#paired.extension)
      // Before the paired-computer wraps, which also apply to sending a file.
      registry.install(this.#library.extension)
      registry.install(this.#scheduler.extension)
      registry.install(this.#subagents.extension)
      registry.install(this.#skills.extension)
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
          env: ({ cwd }) => this.#computer?.env(cwd),
          now: () => this.#host.now(),
          onReport: (error) => this.#options.onReport?.(error),
          settings: { toolExecution: "parallel" },
        },
        context,
      )
      opened = harness
      this.#approvals.attach(harness)
      this.#keepGoing.attach(harness)
      await this.#settleComputer(harness)
      this.#scheduler.attach(harness)
      this.#subagents.attach(harness)
      this.#skills.attach(harness)
      this.#paired?.attach(harness)
      this.#library.attach(harness)
      await this.#library.upgrade(context)
      // Connector tools come and go while the agent runs, so they are installed after opening.
      this.#connectors = new Connectors({
        sql: this.#host.sql,
        now: () => this.#host.now(),
        install: (extension) => registry.install(extension),
        fetch: this.#options.connectorFetch,
        allowPrivateHosts: this.#options.allowPrivateHosts,
        resolveHost: this.#options.resolveHost,
      })
      await this.#connectors.attach(harness, context)
      // An agent that is still to be set up gets its skills then, once its computer is known.
      if (((await harness.snapshot(IdentityDoc, context))?.ownerId ?? "") !== "") {
        await this.#skills.seed(context)
      }
      // A schedule the agent creates or changes moves the next wake-up.
      if (
        (await harness.snapshot(SchedulesDoc, context)) === undefined ||
        (await harness.snapshot(ComputersDoc, context)) === undefined ||
        (await harness.snapshot(LibraryDoc, context)) === undefined ||
        (await harness.snapshot(ConnectorsDoc, context)) === undefined ||
        (await harness.snapshot(ApprovalsDoc, context)) === undefined
      ) {
        // Created up front so they can be watched before they have any content.
        await harness.commit(async (tx) => {
          await tx.doc(SchedulesDoc)
          await tx.doc(ComputersDoc)
          await tx.doc(LibraryDoc)
          await tx.doc(ConnectorsDoc)
          await tx.doc(ApprovalsDoc)
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
    // A sub-agent that has finished and not yet reported has nothing live, and still needs a look.
    const live =
      inspection.tasks.length > 0 ||
      inspection.submissions.length > 0 ||
      (await this.#subagents.working(context))
    const keepAlive = live ? this.#host.now() + (this.#options.keepAliveMs ?? KEEPALIVE_MS) : null
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
    await this.#rearm()
  }

  /** Unfinished runs stay pending in the store; the next process resumes them. */
  async close(): Promise<void> {
    const harness = this.#harness
    this.#harness = undefined
    await this.#connectors?.close()
    await (await harness)?.close(context)
  }

  /**
   * Delete the agent: its computers, then everything it has stored. For the gateway, after the
   * owner asked for it.
   */
  async #destroy(harness: Harness): Promise<Response> {
    // An agent that was moved left a computer behind each time, and those go too.
    const had = (await harness.snapshot(IdentityDoc, context))?.computers ?? []
    // The computers first, while nothing else is lost yet. If a provider cannot be reached the
    // agent is left whole, so the owner can try again instead of paying for a machine nobody
    // can find.
    try {
      await this.#computer?.sandbox.destroy?.()
      for (const kind of had) {
        if (kind === this.#kind) continue
        if (this.#offers(kind)) await this.#choices.create(kind, this.#host)?.destroy?.()
        else {
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
        error instanceof SkillError ||
        error instanceof LibraryError ||
        error instanceof HistoryError ||
        error instanceof ApprovalError ||
        error instanceof ConnectorError
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
    const harness = await this.#open()

    if (segments[0] === "init" && method === "POST") {
      return this.#init(
        harness,
        await body<{ ownerId: string; team?: string | null; model?: string; computer?: string }>(
          request,
        ),
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
        return this.#update(harness, await body<Record<string, unknown>>(request))
      }
    }
    if (segments[0] === "events" && method === "GET") return this.#agentEvents(harness)
    if (segments[0] === "computers" && this.#paired !== undefined) {
      const computerId = segments[1]
      if (computerId === undefined && method === "GET") {
        return json({ computers: await this.#paired.list(context) })
      }
      if (computerId !== undefined && segments[2] === "answer" && method === "POST") {
        const answer = await body<ComputerAnswer>(request)
        const turn = await this.#paired.answered(computerId, answer, context)
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
        const computer = await body<PairedComputer>(request)
        return json(await this.#paired.put(computerId, computer, context))
      }
      if (computerId !== undefined && method === "DELETE") {
        await this.#paired.remove(computerId, context)
        return json({ ok: true })
      }
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
        return json(await connectors.authorize(connectorId, code, context))
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
    if (segments[0] === "view" && segments[1] !== undefined && method === "GET") {
      let path: string
      try {
        path = segments.slice(2).map(decodeURIComponent).join("/")
      } catch {
        throw new HttpError(404, "Not found")
      }
      const response = await this.#library.view(segments[1], path, request, context)
      if (response === undefined) throw new HttpError(404, "Not found")
      return response
    }
    if (segments[0] === "library") {
      const library = this.#library
      const fileId = segments[1]
      const action = segments[2]
      const missing = () => new HttpError(404, "File not found")
      /** The request's body as a file's content, read only up to the size a file may be. */
      const content = async () => {
        const tooLarge = () => new HttpError(413, "That file is too large.")
        if (declaredTooLarge(request.headers, MAX_LIBRARY_FILE_BYTES)) throw tooLarge()
        // Counted as it arrives: the declared length is only what the sender says.
        return readLimited(request.body, MAX_LIBRARY_FILE_BYTES).catch((error) => {
          throw error instanceof BodyTooLarge ? tooLarge() : error
        })
      }
      if (fileId === undefined && method === "GET") return json(await library.listing(context))
      if (fileId === undefined && method === "POST") {
        // The body is the file. Its name, and where it goes, are in the query: a `path` for a new
        // document at exactly that place, or a `name` to go into `dir` or with the uploads.
        const name = url.searchParams.get("name")
        const path = url.searchParams.get("path")
        if ((name === null || name === "") && (path === null || path === "")) {
          throw new HttpError(400, "name is required")
        }
        const file = await library.add(
          {
            ...(path !== null && path !== ""
              ? { path: cleanLibraryPath(path) ?? "" }
              : { name: name!, dir: url.searchParams.get("dir") ?? undefined }),
            bytes: await content(),
            source: "user",
            chatId: url.searchParams.get("chat"),
            contentType: request.headers.get("content-type") ?? undefined,
          },
          context,
        )
        return json(file, 201)
      }
      if (fileId === "deleted" && action !== undefined) {
        if (segments[3] === "restore" && method === "POST") {
          const file = await library.restore(action, context)
          if (file === undefined) throw missing()
          return json(file)
        }
        if (segments[3] === undefined && method === "DELETE") {
          if (!(await library.forget(action, context))) throw missing()
          return json({ ok: true })
        }
      }
      if (fileId !== undefined && action === undefined) {
        if (method === "GET") {
          const response = await library.serve(fileId, request, context)
          if (response === undefined) throw missing()
          return response
        }
        if (method === "PUT") {
          // New content for the file. With `rev`, only if it is still at that revision.
          const rev = url.searchParams.get("rev")
          try {
            return json(
              await library.write(fileId, await content(), "user", context, {
                ifRev: rev === null ? undefined : Number(rev),
              }),
            )
          } catch (error) {
            if (error instanceof LibraryConflict)
              throw new HttpError(409, error.message, "conflict")
            throw error
          }
        }
        if (method === "PATCH") {
          const { path } = await body<{ path?: string }>(request)
          if (typeof path !== "string") throw new HttpError(400, "path is required")
          return json(await library.move(fileId, path, context))
        }
        if (method === "DELETE") {
          if (!(await library.remove(fileId, "user", context))) throw missing()
          return json({ ok: true })
        }
      }
      if (fileId !== undefined && action === "versions" && method === "GET") {
        const versions = await library.versions(fileId, context)
        if (versions === undefined) throw missing()
        return json({ versions })
      }
      if (fileId !== undefined && action === "revert" && method === "POST") {
        const { rev } = await body<{ rev?: number }>(request)
        if (typeof rev !== "number") throw new HttpError(400, "rev is required")
        return json(await library.revert(fileId, rev, "user", context))
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
        const { decision } = await body<{ decision: ApprovalDecision }>(request)
        await this.#approvals.resolve(
          requestId,
          decision,
          context,
          identity.team ? caller : undefined,
        )
        // The answer sets a sub-agent that was waiting for it going again.
        await this.#subagents.tick()
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
    if (segments[0] === "chats") {
      if (segments.length === 1 && method === "POST") {
        return this.#createChat(harness, identity, await body<CreateChatRequest>(request), caller)
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
        const subagent =
          own((await harness.snapshot(ChatsDoc, context))?.chats, chatId)?.kind === "subagent"
        if (subagent && (rest === "messages" || rest === "reset") && method === "POST") {
          throw new HttpError(409, "Only the agent talks to its sub-agents.", "subagent")
        }
        if (rest === "messages" && method === "POST") {
          return this.#send(harness, conversation, await body<SendMessageRequest>(request), caller)
        }
        if (rest === "abort" && method === "POST") {
          if (subagent) await this.#subagents.stop(chatId, "user", context)
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
    input: { ownerId: string; team?: string | null; model?: string; computer?: string },
  ): Promise<Response> {
    if (typeof input.ownerId !== "string" || input.ownerId === "") {
      throw new HttpError(400, "ownerId is required")
    }
    const model = input.model ?? this.#options.defaultModel
    this.#requireModel(model)
    if (input.computer !== undefined) this.#requireKind(input.computer)
    const computer = input.computer ?? this.#choices.default
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
      if (this.#choices.kinds.length > 0) {
        identity.computer = computer
        identity.computers = [computer]
      }
      return "new"
    }, context)
    if (outcome === "taken") throw new HttpError(409, "Agent belongs to another account")
    if (outcome === "new" && computer !== this.#kind)
      this.#useComputer(harness, computer, undefined)
    await this.#skills.seed(context)
    return json(await this.#state(harness, await this.#identity(harness)))
  }

  #requireKind(kind: string): void {
    if (!this.#offers(kind)) {
      throw new HttpError(400, `This server has no computer of the kind "${kind}".`)
    }
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
    const chats = (await harness.snapshot(ChatsDoc, context))?.chats ?? {}
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
    }
    return {
      agent,
      timezone: identity.timezone ?? null,
      // The kind it is on now. Null where the deployment gives no choice of one.
      computer: this.#choices.kinds.length === 0 ? null : this.#kind,
      ownerId: identity.ownerId,
      // The team that shares it, by name, or null for one person's.
      team: identity.team ?? null,
      whenBusy: whenBusyOf(identity),
      soul: identity.soul,
      user: identity.user,
      memory: identity.memory,
      limits: { memory: MEMORY_LIMIT, user: USER_LIMIT },
      chats: Object.entries(chats)
        .map(([id, record]) => summarize(id, record))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }
  }

  async #update(harness: Harness, input: Record<string, unknown>): Promise<Response> {
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
    const computer = text("computer", 40)
    if (computer !== undefined) this.#requireKind(computer)
    const moving = computer !== undefined && computer !== this.#kind
    if (moving) {
      // A command that is running would finish on one computer and report to the other.
      const { tasks, submissions } = await harness.inspect(context)
      if (tasks.length > 0 || submissions.length > 0) {
        throw new HttpError(
          409,
          "The agent is in the middle of something. Wait for it to finish, or stop it, and then change its computer.",
          "busy",
        )
      }
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
      if (computer !== undefined) identity.computer = computer
      if (moving) {
        identity.computerChangedAt = now
        if (identity.computers?.includes(computer) !== true) {
          identity.computers = [...(identity.computers ?? []), computer]
        }
      }
      // Chats pick this up on their next message.
      if (thinking !== undefined) identity.thinking = thinking
      if (model === undefined || model === identity.model) return []
      identity.model = model
      return Object.keys((await tx.doc(ChatsDoc)).chats)
    }, context)
    if (moving) {
      this.#useComputer(harness, computer, now)
      // A skill that needs real programs arrives with the first computer that has them.
      await this.#skills.seed(context)
    }
    this.#computer?.markStale()
    // A model change applies to existing chats from their next request.
    if (model !== undefined) {
      for (const id of chats) {
        const conversation = await harness.conversation(Number(id) as ConversationId, context)
        await conversation?.configure({ model: parseModel(model) }, context)
      }
    }
    return json(await this.#state(harness, await this.#identity(harness)))
  }

  async #chat(harness: Harness, chatId: string): Promise<Conversation> {
    const chats = (await harness.snapshot(ChatsDoc, context))?.chats ?? {}
    // Only conversations in the index are chats; subagent conversations are not addressable.
    if (!Object.hasOwn(chats, chatId)) throw new HttpError(404, "Chat not found")
    const conversation = await harness.conversation(Number(chatId) as ConversationId, context)
    if (conversation === undefined) throw new HttpError(404, "Chat not found")
    return conversation
  }

  async #createChat(
    harness: Harness,
    identity: Readonly<IdentityState>,
    input: CreateChatRequest,
    caller: Caller | undefined,
  ): Promise<Response> {
    const now = this.#host.now()
    const record: ChatRecord = {
      title: input.title?.trim().slice(0, MAX_TITLE_CHARS) || DEFAULT_CHAT_TITLE,
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
          ;(await tx.doc(ChatsDoc)).chats[String(id)] = record
        },
      },
      context,
    )
    return json(summarize(String(conversation.id), record), 201)
  }

  async #updateChat(harness: Harness, chatId: string, input: UpdateChatRequest): Promise<Response> {
    const record = await harness.commit(async (tx) => {
      const chat = own((await tx.doc(ChatsDoc)).chats, chatId)!
      if (typeof input.title === "string" && input.title.trim() !== "") {
        chat.title = input.title.trim().slice(0, MAX_TITLE_CHARS)
      }
      if (typeof input.archived === "boolean") chat.archived = input.archived
      return { ...chat }
    }, context)
    return json(summarize(chatId, record))
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

  /** Tell the host when a run ends with an answer and no client is following the chat. */
  async #notifyWhenUnseen(
    harness: Harness,
    chatId: string,
    submission: Awaited<ReturnType<Conversation["submit"]>>,
    caller: Caller | undefined,
  ): Promise<void> {
    if (this.#options.onNotify === undefined) return
    try {
      const settled = await submission.wait(context)
      if (settled.status !== "done" || settled.type !== "input") return
      if ((this.#watchers.get(chatId) ?? 0) > 0) return
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
      const changed = (what: Extract<AgentEvent, { type: "changed" }>["what"]) => async () => {
        await emit({ type: "changed", what } satisfies AgentEvent)
      }
      await emit({ type: "ready" } satisfies AgentEvent)
      identity?.start(changed("identity"))
      chats?.start(changed("chats"))
      schedules?.start(changed("schedules"))
      skills?.start(changed("skills"))
      computers?.start(changed("computers"))
      library?.start(changed("library"))
      connectors?.start(changed("connectors"))
      approvals?.start(changed("approvals"))
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
      }
    })
  }
}

export function createAgentActor(host: ActorHost, options: AgentActorOptions): Actor {
  return new AgentActor(host, options)
}

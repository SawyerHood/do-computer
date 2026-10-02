import {
  type AgentEvent,
  type AgentSummary,
  type ChatSummary,
  type CreateChatRequest,
  diffChat,
  encodeSse,
  type ModelOption,
  parseAvatar,
  type SendMessageRequest,
  SSE_HEADERS,
  SSE_HEARTBEAT,
  type UpdateChatRequest,
  type UpdateScheduleRequest,
} from "@durable-computer/protocol"
import type { Actor, ActorHost } from "@durable-computer/runtime"
import type { Sandbox } from "@durable-computer/sandbox"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Models } from "@earendil-works/pi-ai/models"
import {
  type Conversation,
  type ConversationId,
  createRegistry,
  type Extension,
  Harness,
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
import { Computer } from "./computer.ts"
import { parseModel } from "./models.ts"
import { formatTime, isValidTimezone } from "./schedule.ts"
import { type ScheduledReport, ScheduleError, Scheduler } from "./schedules.ts"
import { MEMORY_LIMIT, Persona, USER_LIMIT } from "./persona.ts"
import { projectChat } from "./project.ts"

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
   * The agent's computer. Should be cheap to call and start nothing until used, as `lazySandbox`
   * does: it is built whenever the actor loads.
   */
  readonly sandbox?: (host: ActorHost) => Sandbox
  /** Receives failures that did not fail a request. */
  readonly onReport?: (error: unknown) => void
  /** How often the actor wakes itself while work is live. */
  readonly keepAliveMs?: number
  /** Called when a scheduled task has a report for the user, for example to send a push. */
  readonly onScheduledReport?: (agentId: string, report: ScheduledReport) => void
}

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

function summarize(id: string, record: ChatRecord): ChatSummary {
  return { id, ...record }
}

/**
 * One agent: its identity and memory, its chats, and the pi-durable harness that runs them. The
 * actor trusts its caller; the gateway in front of it authenticates and checks ownership.
 */
export class AgentActor implements Actor {
  readonly #host: ActorHost
  readonly #options: AgentActorOptions
  readonly #computer: Computer | undefined
  readonly #scheduler: Scheduler
  #harness: Promise<Harness> | undefined

  constructor(host: ActorHost, options: AgentActorOptions) {
    this.#host = host
    this.#options = options
    this.#computer = options.sandbox === undefined ? undefined : new Computer(options.sandbox(host))
    this.#scheduler = new Scheduler({
      now: () => host.now(),
      onReport: (report) => options.onScheduledReport?.(host.name, report),
      onError: (error) => options.onReport?.(error),
    })
  }

  #open(): Promise<Harness> {
    this.#harness ??= (async () => {
      const registry = createRegistry()
      const computer = this.#computer
      registry.install(Persona)
      for (const extension of computer?.extensions ?? []) registry.install(extension)
      registry.install(this.#scheduler.extension)
      for (const extension of this.#options.extensions ?? []) registry.install(extension)
      const harness = await Harness.open(
        await SqliteStorage.open(this.#host.sql),
        {
          models: this.#options.models,
          registry,
          env: computer === undefined ? undefined : ({ cwd }) => computer.env(cwd),
          now: () => this.#host.now(),
          onReport: (error) => this.#options.onReport?.(error),
          settings: { toolExecution: "parallel" },
        },
        context,
      )
      computer?.attach(harness)
      this.#scheduler.attach(harness)
      // A schedule the agent creates or changes moves the next wake-up.
      if ((await harness.snapshot(SchedulesDoc, context)) === undefined) {
        await harness.commit(async (tx) => void (await tx.doc(SchedulesDoc)), context)
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
    const live = inspection.tasks.length > 0 || inspection.submissions.length > 0
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
    await this.#rearm()
  }

  /** Unfinished runs stay pending in the store; the next process resumes them. */
  async close(): Promise<void> {
    const harness = this.#harness
    this.#harness = undefined
    await (await harness)?.close(context)
  }

  async fetch(request: Request): Promise<Response> {
    try {
      return await this.#route(request)
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message, code: error.code }, error.status)
      }
      if (error instanceof ScheduleError) return json({ error: error.message }, 400)
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
    const method = request.method
    const harness = await this.#open()

    if (segments[0] === "init" && method === "POST") {
      return this.#init(harness, await body<{ ownerId: string; model?: string }>(request))
    }
    const identity = await this.#identity(harness)

    if (segments.length === 0) {
      if (method === "GET") return json(await this.#state(harness, identity))
      if (method === "PATCH") {
        return this.#update(harness, await body<Record<string, unknown>>(request))
      }
    }
    if (segments[0] === "events" && method === "GET") return this.#agentEvents(harness)
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
        return this.#createChat(harness, identity, await body<CreateChatRequest>(request))
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
        if (rest === "events" && method === "GET") return this.#chatEvents(conversation)
        if (rest === "messages" && method === "POST") {
          return this.#send(harness, conversation, await body<SendMessageRequest>(request))
        }
        if (rest === "abort" && method === "POST") {
          await conversation.abort(context)
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

  async #init(harness: Harness, input: { ownerId: string; model?: string }): Promise<Response> {
    if (typeof input.ownerId !== "string" || input.ownerId === "") {
      throw new HttpError(400, "ownerId is required")
    }
    const model = input.model ?? this.#options.defaultModel
    this.#requireModel(model)
    const outcome = await harness.commit(async (tx) => {
      const identity = await tx.doc(IdentityDoc)
      if (identity.ownerId !== "" && identity.ownerId !== input.ownerId) return "taken"
      if (identity.ownerId === "") {
        identity.ownerId = input.ownerId
        identity.model = model
        identity.createdAt = this.#host.now()
      }
      // Create the chat index too, so it can be watched before the first chat exists.
      await tx.doc(ChatsDoc)
      return "ok"
    }, context)
    if (outcome === "taken") throw new HttpError(409, "Agent belongs to another account")
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

  async #state(harness: Harness, identity: Readonly<IdentityState>) {
    const chats = (await harness.snapshot(ChatsDoc, context))?.chats ?? {}
    const agent: AgentSummary = {
      id: this.#host.name,
      name: identity.name,
      avatar: identity.avatar,
      tagline: identity.tagline,
      createdAt: identity.createdAt,
      model: identity.model,
    }
    return {
      agent,
      timezone: identity.timezone ?? null,
      ownerId: identity.ownerId,
      soul: identity.soul,
      user: identity.user,
      memory: identity.memory,
      limits: { memory: MEMORY_LIMIT, user: USER_LIMIT },
      chats: Object.entries(chats)
        .map(([id, record]) => summarize(id, record))
        .sort((a, b) => b.updatedAt - a.updatedAt),
      models: this.#options.modelOptions,
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
    const timezone = text("timezone", 64)
    if (timezone !== undefined && !isValidTimezone(timezone)) {
      throw new HttpError(400, `"${timezone}" is not an IANA timezone`)
    }
    let avatar: IdentityState["avatar"] | undefined
    if (input.avatar !== undefined) {
      const parsed = parseAvatar(input.avatar as { character: string; color: string })
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
      if (timezone !== undefined) identity.timezone = timezone
      if (model === undefined || model === identity.model) return []
      identity.model = model
      return Object.keys((await tx.doc(ChatsDoc)).chats)
    }, context)
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
  ): Promise<Response> {
    const now = this.#host.now()
    const record: ChatRecord = {
      title: input.title?.trim().slice(0, MAX_TITLE_CHARS) || DEFAULT_CHAT_TITLE,
      kind: "chat",
      createdAt: now,
      updatedAt: now,
      archived: false,
    }
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: parseModel(identity.model) },
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
      const chat = (await tx.doc(ChatsDoc)).chats[chatId]!
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
    const zone = timezone ?? identity.timezone
    const meta = `<meta sent_at="${formatTime(this.#host.now(), zone)}"/>`
    const submission = await conversation.submit(
      {
        type: "input",
        content: [
          { type: "text", text: input.text },
          { type: "text", text: meta },
        ],
        requestId: input.requestId,
        whenBusy: input.whenBusy === "followUp" ? "followUp" : "steer",
      },
      context,
    )
    const chatId = String(conversation.id)
    await harness.commit(async (tx) => {
      const chat = (await tx.doc(ChatsDoc)).chats[chatId]
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

  #chatEvents(conversation: Conversation): Response {
    return eventStream(async (emit, close) => {
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
      return () => void watch.stop()
    })
  }

  #agentEvents(harness: Harness): Response {
    return eventStream(async (emit, close) => {
      const identity = await harness.watchDoc(IdentityDoc, context)
      const chats = await harness.watchDoc(ChatsDoc, context)
      const schedules = await harness.watchDoc(SchedulesDoc, context)
      const changed = (what: Extract<AgentEvent, { type: "changed" }>["what"]) => async () => {
        await emit({ type: "changed", what } satisfies AgentEvent)
      }
      await emit({ type: "ready" } satisfies AgentEvent)
      identity?.start(changed("identity"))
      chats?.start(changed("chats"))
      schedules?.start(changed("schedules"))
      void (identity ?? chats)?.closed.then(close)
      return () => {
        void identity?.stop()
        void chats?.stop()
        void schedules?.stop()
      }
    })
  }
}

export function createAgentActor(host: ActorHost, options: AgentActorOptions): Actor {
  return new AgentActor(host, options)
}

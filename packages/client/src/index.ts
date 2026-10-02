import {
  type AgentEvent,
  type AgentSummary,
  type ApiError as ApiErrorBody,
  type Avatar,
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  type ComputerSummary,
  type CreateChatRequest,
  EMPTY_CHAT,
  type ModelOption,
  readSse,
  reduceChat,
  type ScheduleSummary,
  type SendMessageRequest,
  type SendMessageResponse,
  type SkillDetail,
  type SkillSummary,
  type UpdateChatRequest,
  type UpdateScheduleRequest,
} from "@durable-computer/protocol"

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

export type ClientOptions = {
  /** Origin of the deployment, or "" for same-origin requests from the web app. */
  readonly baseUrl: string
  /** `fetch` to use. Pass `expo/fetch` on React Native, whose global fetch cannot stream. */
  readonly fetch?: typeof fetch
  /** Extra headers per request, for example a session cookie on platforms without a cookie jar. */
  readonly headers?: () => Record<string, string> | Promise<Record<string, string>>
}

export type Me = {
  user: { id: string; email: string; name: string }
  google: boolean
  github: boolean
  signup: "open" | "invite"
}

/** Everything about one agent that is not a chat transcript. */
export type AgentState = {
  agent: AgentSummary
  /** The user's IANA timezone as the agent knows it. */
  timezone: string | null
  soul: string
  user: string
  memory: string
  limits: { memory: number; user: number }
  chats: ChatSummary[]
  models: ModelOption[]
}

export type AgentPatch = {
  name?: string
  tagline?: string
  avatar?: Avatar
  soul?: string
  user?: string
  memory?: string
  model?: string
  timezone?: string
}

/** A computer waiting to be paired, as shown to the user before they agree. */
export type PairingRequest = {
  code: string
  name: string
  platform: string
  hostname: string
  home: string
  readOnly: boolean
}

export type StreamStatus = "connecting" | "open" | "reconnecting" | "closed"

export type Subscription = { close(): void }

const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000]

export function createClient(options: ClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)

  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    for (const [name, value] of Object.entries((await options.headers?.()) ?? {})) {
      headers.set(name, value)
    }
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json")
    }
    return doFetch(`${options.baseUrl}${path}`, { credentials: "include", ...init, headers })
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await send(path, init)
    if (!response.ok) {
      let body: Partial<ApiErrorBody> & { message?: string } = {}
      try {
        body = await response.json()
      } catch {
        // Not every failure has a JSON body.
      }
      throw new ApiError(
        response.status,
        body.error ?? body.message ?? `Request failed (${response.status})`,
        body.code,
      )
    }
    return (await response.json()) as T
  }

  const post = <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) })
  const patch = <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) })

  /**
   * Follow a server-sent event stream until closed, reconnecting with backoff. Every connection
   * starts from the server's current state, so nothing is lost across a reconnect.
   */
  function stream<T>(
    path: string,
    onEvent: (event: T) => void,
    onStatus?: (status: StreamStatus) => void,
  ): Subscription {
    const controller = new AbortController()
    let attempt = 0
    const run = async () => {
      onStatus?.("connecting")
      while (!controller.signal.aborted) {
        try {
          const response = await send(path, {
            headers: { accept: "text/event-stream" },
            signal: controller.signal,
          })
          // A refused stream will be refused again; only transport failures are retried.
          if (response.status >= 400 && response.status < 500) {
            onStatus?.("closed")
            return
          }
          if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`)
          attempt = 0
          onStatus?.("open")
          for await (const event of readSse<T>(response.body)) onEvent(event)
        } catch {
          // Fall through to reconnect.
        }
        if (controller.signal.aborted) break
        onStatus?.("reconnecting")
        const delay = RECONNECT_DELAYS_MS[Math.min(attempt++, RECONNECT_DELAYS_MS.length - 1)]!
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
      onStatus?.("closed")
    }
    void run()
    return { close: () => controller.abort() }
  }

  return {
    me: () => request<Me>("/api/me"),
    listAgents: async () => (await request<{ agents: AgentSummary[] }>("/api/agents")).agents,
    createAgent: async () => (await post<{ agent: AgentSummary }>("/api/agents")).agent,
    listComputers: async () =>
      (await request<{ computers: ComputerSummary[] }>("/api/computers")).computers,
    removeComputer: (computerId: string) =>
      request<{ ok: true }>(`/api/computers/${encodeURIComponent(computerId)}`, {
        method: "DELETE",
      }),
    pairingRequest: (code: string) =>
      request<PairingRequest>(`/api/computers/pair/request/${encodeURIComponent(code)}`),
    confirmPairing: (code: string, agentId: string) =>
      post<{ computerId: string; name: string }>("/api/computers/pair/confirm", { code, agentId }),

    agent(agentId: string) {
      const base = `/api/agents/${encodeURIComponent(agentId)}`
      return {
        state: () => request<AgentState>(base),
        update: (change: AgentPatch) => patch<AgentState>(base, change),
        createChat: (input: CreateChatRequest = {}) => post<ChatSummary>(`${base}/chats`, input),
        updateChat: (chatId: string, change: UpdateChatRequest) =>
          patch<ChatSummary>(`${base}/chats/${chatId}`, change),
        chat: (chatId: string) => request<ChatState>(`${base}/chats/${chatId}`),
        send: (chatId: string, message: SendMessageRequest) =>
          post<SendMessageResponse>(`${base}/chats/${chatId}/messages`, message),
        abort: (chatId: string) => post<{ ok: true }>(`${base}/chats/${chatId}/abort`),
        schedules: async () =>
          (await request<{ schedules: ScheduleSummary[] }>(`${base}/schedules`)).schedules,
        updateSchedule: (scheduleId: string, change: UpdateScheduleRequest) =>
          patch<ScheduleSummary>(`${base}/schedules/${scheduleId}`, change),
        removeSchedule: (scheduleId: string) =>
          request<{ ok: true }>(`${base}/schedules/${scheduleId}`, { method: "DELETE" }),
        runSchedule: (scheduleId: string) =>
          post<{ ok: true }>(`${base}/schedules/${scheduleId}/run`),
        skills: async () => (await request<{ skills: SkillSummary[] }>(`${base}/skills`)).skills,
        skill: (name: string) => request<SkillDetail>(`${base}/skills/${encodeURIComponent(name)}`),
        setSkillEnabled: (name: string, enabled: boolean) =>
          patch<SkillSummary>(`${base}/skills/${encodeURIComponent(name)}`, { enabled }),
        removeSkill: (name: string) =>
          request<{ ok: true }>(`${base}/skills/${encodeURIComponent(name)}`, { method: "DELETE" }),
        installSkill: (url: string) => post<SkillSummary>(`${base}/skills/install`, { url }),
        /** Calls `onState` with each new state of the chat, starting from its current one. */
        watchChat(
          chatId: string,
          onState: (state: ChatState) => void,
          onStatus?: (status: StreamStatus) => void,
        ): Subscription {
          let state = EMPTY_CHAT
          return stream<ChatEvent>(
            `${base}/chats/${chatId}/events`,
            (event) => {
              state = reduceChat(state, event)
              onState(state)
            },
            onStatus,
          )
        },
        /** Calls `onEvent` when something about the agent changed and should be refetched. */
        watch: (onEvent: (event: AgentEvent) => void, onStatus?: (status: StreamStatus) => void) =>
          stream<AgentEvent>(`${base}/events`, onEvent, onStatus),
      }
    },
  }
}

export type Client = ReturnType<typeof createClient>
export type AgentClient = ReturnType<Client["agent"]>

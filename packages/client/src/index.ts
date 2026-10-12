import {
  type AddComputerRequest,
  type AddConnectorRequest,
  type AgentEvent,
  type AgentSummary,
  type AgentUsage,
  type ApprovalDecision,
  type ApprovalRule,
  type ApprovalsState,
  type ChatHistoryPage,
  type HistoryHit,
  type JobStatus,
  type JobSummary,
  type LiveView,
  type UseWhat,
  type ApiError as ApiErrorBody,
  type Avatar,
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  type ComputerKinds,
  type ComputerRequest,
  type ComputerSummary,
  type Dood,
  type MadeDood,
  type NewDood,
  type ConfirmPairingRequest,
  type ConnectorResult,
  type ConnectorSummary,
  type ConnectSlackRequest,
  type CreateChatRequest,
  type CreateWorkspaceRequest,
  type CreatureState,
  EMPTY_CHAT,
  type FeedEvent,
  type Invitation,
  type InvitationPreview,
  type InviteRequest,
  type InviteResult,
  type LibraryFile,
  type LibraryListing,
  type LibraryVersion,
  type AnswerModelLoginRequest,
  type ModelLogin,
  type ModelOption,
  type ModelProvidersState,
  type StartModelLoginRequest,
  type Outfit,
  personalWorkspaceId,
  PING_FRAME,
  type PresenceEvent,
  type PresenceUpdate,
  readSse,
  SSE_HEARTBEAT_MS,
  reduceChat,
  type ScheduleSummary,
  type SecretRequest,
  type SendMessageRequest,
  type SendMessageResponse,
  sitePath,
  type SiteSummary,
  type SentInvitation,
  type SkillDetail,
  type SkillSummary,
  type SlackState,
  type ThinkingLevel,
  type UpdateChatRequest,
  type UpdateScheduleRequest,
  type UpdateWorkspaceRequest,
  type WorkspaceOptions,
  type UserSettings,
  type WorkspaceRole,
  type WorkspacesState,
  type WorkspaceSummary,
} from "@do-computer/protocol"

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

import {
  type Attention,
  attended,
  reconnectDelay,
  REST_AFTER_MS,
  type StreamStatus,
  type Subscription,
  whenUnattended,
} from "./attention.ts"
import { createFollowing, type SocketConstructor } from "./follow.ts"

export type { Attention, StreamStatus, Subscription } from "./attention.ts"
export type { SocketConstructor, SocketLike } from "./follow.ts"

export type ClientOptions = {
  /** Origin of the deployment, or "" for same-origin requests from the web app. */
  readonly baseUrl: string
  /** `fetch` to use. Pass `expo/fetch` on React Native, whose global fetch cannot stream. */
  readonly fetch?: typeof fetch
  /** Extra headers per request, for example a session cookie on platforms without a cookie jar. */
  readonly headers?: () => Record<string, string> | Promise<Record<string, string>>
  /**
   * Whether the platform's own cookie jar is used. Default `include`; pass `omit` when `headers`
   * carries the session, so it is not sent twice.
   */
  readonly credentials?: RequestCredentials
  /**
   * Whether anyone is looking, where the platform can tell: a browser's tab can be hidden. A
   * stream nobody has looked at for a while is let go of, and asked for again when someone
   * does. Without this, streams are kept for as long as they are subscribed to.
   */
  readonly attention?: Attention
  /** How long nobody has to have been looking before a stream is let go of. Default a minute. */
  readonly restAfterMs?: number
  /**
   * Follow agents over WebSockets where they can be had, and over event streams where not. A
   * socket does not keep an agent in memory on the server as a stream does. Needs a platform
   * whose WebSockets carry the session, which is a browser on the app's own address, or a
   * `webSocket` that sends it.
   */
  readonly sockets?: boolean
  /**
   * `WebSocket` to use, for following agents, for presence and for the feed. Default: the
   * platform's. A phone passes one that sends its session cookie, which its own does not.
   */
  readonly webSocket?: SocketConstructor
}

export type Me = {
  user: { id: string; email: string; name: string; image?: string | null }
  google: boolean
  github: boolean
  signup: "open" | "invite" | "waitlist"
  /** Whether they may sign the deployment itself in to model providers, for everyone's agents. */
  admin?: boolean
  /** They have an account and are on the waiting list: the app itself is not theirs to use yet. */
  waiting?: boolean
  /** The Dood they hatched or claimed, until it is their agent. */
  dood?: Dood
}

/** Someone on the waiting list, as those who run the deployment see them. */
export type WaitingPerson = {
  id: string
  name: string
  email: string
  joinedAt: number
  dood: { id: string; name: string; color: string; seed: string } | null
}

/** Everything about one agent that is not a chat transcript. */
export type AgentState = {
  agent: AgentSummary
  /** The user's IANA timezone as the agent knows it. */
  timezone: string | null
  /** The team that shares it, by name. Null: it is one person's. */
  team?: string | null
  /** What a message does that arrives while it is working: join the work, or wait for it. */
  whenBusy?: "steer" | "queue"
  soul: string
  user: string
  memory: string
  limits: { memory: number; user: number }
  chats: ChatSummary[]
}

export type AgentPatch = {
  name?: string
  tagline?: string
  avatar?: Avatar
  soul?: string
  user?: string
  memory?: string
  model?: string
  /** How hard it thinks before it answers. Applies from its next reply. */
  thinking?: ThinkingLevel
  timezone?: string
  /** What a message does that arrives while it is working. */
  whenBusy?: "steer" | "queue"
  /** Its owner has watched it hatch. There is no putting it back in its egg. */
  hatched?: true
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

/** A place in a team's presence: say where this tab is, and stop. */
export type PresenceLink = Subscription & { update(where: PresenceUpdate): void }

/** How often a presence socket is pinged, so that whatever is between it and the server keeps it. */
const PRESENCE_PING_MS = 30_000

/** How long a stream may say nothing, heartbeats included, before it is taken for lost. */
const STREAM_SILENCE_MS = 3 * SSE_HEARTBEAT_MS

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
    return doFetch(`${options.baseUrl}${path}`, {
      credentials: options.credentials ?? "include",
      ...init,
      headers,
    })
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
   * begins with an event that says where things stand, a chat's whole state or an agent's
   * `ready`, and what happened while there was no connection is not sent again: the one
   * following has to start over from that first event.
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
        // Each connection can be given up by itself, without closing the subscription.
        const lost = new AbortController()
        const give = () => lost.abort()
        controller.signal.addEventListener("abort", give)
        let silence: ReturnType<typeof setTimeout> | undefined
        // A connection can die without ending: a laptop that slept, a network that changed.
        // The server is never this quiet, so one that is has gone, and is asked for again.
        // That goes for one that was never answered too: a server that is stuck says nothing.
        const hear = () => {
          clearTimeout(silence)
          silence = setTimeout(() => lost.abort(), STREAM_SILENCE_MS)
        }
        hear()
        // A stream nobody is looking at is let go of. Whoever comes back gets where things
        // stand from the first event of the next connection, as after any other break.
        let resting = false
        const attention = options.attention
        const unrest =
          attention === undefined
            ? undefined
            : whenUnattended(attention, options.restAfterMs ?? REST_AFTER_MS, () => {
                resting = true
                lost.abort()
              })
        try {
          const response = await send(path, {
            headers: { accept: "text/event-stream" },
            signal: lost.signal,
          })
          // A refused stream will be refused again; only transport failures are retried.
          if (response.status >= 400 && response.status < 500) {
            onStatus?.("closed")
            return
          }
          if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`)
          attempt = 0
          onStatus?.("open")
          hear()
          for await (const event of readSse<T>(response.body, hear)) onEvent(event)
        } catch {
          // Fall through to reconnect.
        } finally {
          clearTimeout(silence)
          unrest?.()
          controller.signal.removeEventListener("abort", give)
        }
        if (controller.signal.aborted) break
        if (resting && options.attention !== undefined) {
          // Not a failure, so it is not said to be one, and there is nothing to back off from.
          await attended(options.attention, controller.signal)
          continue
        }
        onStatus?.("reconnecting")
        await new Promise((resolve) => setTimeout(resolve, reconnectDelay(attempt++)))
      }
      onStatus?.("closed")
    }
    void run()
    return { close: () => controller.abort() }
  }

  /** A chat by its event stream: its state as a client holds it, after every change. */
  const chatStream = (
    agentId: string,
    chatId: string,
    onState: (state: ChatState) => void,
    onStatus?: (status: StreamStatus) => void,
  ): Subscription => {
    let state = EMPTY_CHAT
    return stream<ChatEvent>(
      `/api/agents/${encodeURIComponent(agentId)}/chats/${chatId}/events`,
      (event) => {
        state = reduceChat(state, event)
        onState(state)
      },
      onStatus,
    )
  }
  const agentStream = (
    agentId: string,
    onEvent: (event: AgentEvent) => void,
    onStatus?: (status: StreamStatus) => void,
  ): Subscription =>
    stream<AgentEvent>(`/api/agents/${encodeURIComponent(agentId)}/events`, onEvent, onStatus)

  const webSocket = options.webSocket ?? (globalThis as { WebSocket?: SocketConstructor }).WebSocket
  // Presence and the feed are sockets of their own. They are opened with the same constructor,
  // so that a platform whose sockets do not carry the session can pass one that does.
  const Socket = webSocket as unknown as typeof WebSocket
  const OPEN = 1
  const following =
    options.sockets !== true || webSocket === undefined
      ? undefined
      : createFollowing({
          baseUrl: options.baseUrl,
          socket: webSocket,
          attention: options.attention,
          restAfterMs: options.restAfterMs,
          probe: async (agentId) => {
            try {
              const response = await send(`/api/agents/${encodeURIComponent(agentId)}`)
              void response.body?.cancel().catch(() => {})
              return response.status
            } catch {
              return undefined
            }
          },
          streams: { agent: agentStream, chat: chatStream },
        })

  return {
    // Both take a signal, so that a page which waits for them can stop waiting.
    me: (init?: { signal?: AbortSignal }) => request<Me>("/api/me", init),
    /** Doods: creatures hatched with no account, on pages anyone can open. */
    doods: {
      make: (dood: NewDood) => post<MadeDood>("/api/doods", dood),
      get: async (id: string) =>
        (await request<{ dood: Dood }>(`/api/doods/${encodeURIComponent(id)}`)).dood,
      pat: async (id: string, pats: number) =>
        (await post<{ dood: Dood }>(`/api/doods/${encodeURIComponent(id)}/pats`, { pats })).dood,
      /** Refused with the code `treat_given` where they have given it one today. */
      treat: async (id: string) =>
        (await post<{ dood: Dood }>(`/api/doods/${encodeURIComponent(id)}/treat`)).dood,
      claim: async (id: string, key?: string) =>
        (await post<{ dood: Dood }>(`/api/doods/${encodeURIComponent(id)}/claim`, { key })).dood,
      /** It becomes their agent. Answers with the agent's id. */
      wake: async (id: string) =>
        (await post<{ agentId: string }>(`/api/doods/${encodeURIComponent(id)}/agent`)).agentId,
    },
    /** The waiting list, for those who run the deployment. */
    waitlist: {
      list: () => request<{ people: WaitingPerson[]; total: number }>("/api/waitlist"),
      admit: (userId: string) => post<{ ok: true }>(`/api/waitlist/${encodeURIComponent(userId)}`),
    },
    listAgents: async (init?: { signal?: AbortSignal }) =>
      (await request<{ agents: AgentSummary[] }>("/api/agents", init)).agents,
    /**
     * The models to choose from, suggested ones first. For a workspace, those an agent there
     * can be set to: the deployment's and those of the providers the workspace is signed in to.
     * For none, every model the user could choose somewhere.
     */
    models: async (workspaceId?: string) =>
      (
        await request<{ models: ModelOption[] }>(
          workspaceId === undefined
            ? "/api/models"
            : `/api/models?workspaceId=${encodeURIComponent(workspaceId)}`,
        )
      ).models,
    /** The signed-in user's account settings. */
    settings: () => request<UserSettings>("/api/settings"),
    /** The kinds of computer an agent can be given here, and the one new agents get. */
    computerKinds: () => request<ComputerKinds>("/api/computer-kinds"),
    /** Change account settings. Null for either default goes back to the deployment's. */
    updateSettings: (change: { defaultModel?: string | null; defaultComputer?: string | null }) =>
      patch<UserSettings>("/api/settings", change),
    /** Make an agent in a workspace: the user's own, unless a team is named. */
    createAgent: async (workspaceId?: string) =>
      (await post<{ agent: AgentSummary }>("/api/agents", { workspaceId })).agent,
    /** Move an agent, with everything it has, to another workspace the user is in. */
    moveAgent: (agentId: string, workspaceId: string) =>
      post<{ ok: true }>(`/api/agents/${encodeURIComponent(agentId)}/move`, { workspaceId }),
    /** The user's workspaces, and the invitations waiting for them. */
    workspaces: () => request<WorkspacesState>("/api/workspaces"),
    createWorkspace: (input: CreateWorkspaceRequest) =>
      post<{ workspace: WorkspaceSummary; invited?: InviteResult }>("/api/workspaces", input),
    /** What an invitation is to, by the token in its link or by its id. */
    invitation: (key: string) =>
      request<InvitationPreview>(`/api/invitations/${encodeURIComponent(key)}`),
    acceptInvitation: (key: string) =>
      post<{ workspaceId: string }>(`/api/invitations/${encodeURIComponent(key)}/accept`),
    declineInvitation: (invitationId: string) =>
      request<{ ok: true }>(`/api/invitations/${encodeURIComponent(invitationId)}`, {
        method: "DELETE",
      }),

    workspace(workspaceId: string) {
      const base = `/api/workspaces/${encodeURIComponent(workspaceId)}`
      return {
        update: (change: UpdateWorkspaceRequest) => patch<{ ok: true }>(base, change),
        /** What the workspace has chosen for all its agents. */
        options: () => request<WorkspaceOptions>(`${base}/settings`),
        setOptions: (change: { showBrowser?: boolean }) =>
          patch<{ ok: true }>(`${base}/settings`, change),
        /** Delete the team. It has to be empty of agents. */
        remove: () => request<{ ok: true }>(base, { method: "DELETE" }),
        invitations: async () =>
          (await request<{ invitations: Invitation[] }>(`${base}/invitations`)).invitations,
        invite: (input: InviteRequest) => post<InviteResult>(`${base}/invitations`, input),
        /** Send an invitation again. It gets a new link, and the old one stops working. */
        renewInvitation: (invitationId: string) =>
          post<SentInvitation>(`${base}/invitations/${encodeURIComponent(invitationId)}`),
        withdrawInvitation: (invitationId: string) =>
          request<{ ok: true }>(`${base}/invitations/${encodeURIComponent(invitationId)}`, {
            method: "DELETE",
          }),
        /** The model providers there are, and which the workspace is signed in to. */
        modelProviders: async () =>
          (await request<ModelProvidersState>(`${base}/model-providers`)).providers,
        /** Sign the workspace out of a provider. Its agents can no longer run on its models. */
        signOutOfModelProvider: async (providerId: string) =>
          (
            await request<ModelProvidersState>(
              `${base}/model-providers/${encodeURIComponent(providerId)}`,
              { method: "DELETE" },
            )
          ).providers,
        /**
         * Start signing the workspace in to a provider, with a subscription or a key. What
         * comes back says what to show next: a question, a page to open, a code to enter.
         */
        startModelLogin: async (input: StartModelLoginRequest) =>
          (await post<{ login: ModelLogin }>(`${base}/model-logins`, input)).login,
        /**
         * How a sign-in stands. Given the `rev` last seen, it answers when there is something
         * newer, or after `waitMs` with the same.
         */
        modelLogin: async (loginId: string, since?: { rev: number; waitMs: number }) =>
          (
            await request<{ login: ModelLogin }>(
              `${base}/model-logins/${encodeURIComponent(loginId)}${
                since === undefined ? "" : `?rev=${since.rev}&wait=${since.waitMs}`
              }`,
            )
          ).login,
        answerModelLogin: async (loginId: string, input: AnswerModelLoginRequest) =>
          (
            await post<{ login: ModelLogin }>(
              `${base}/model-logins/${encodeURIComponent(loginId)}/answer`,
              input,
            )
          ).login,
        cancelModelLogin: async (loginId: string) =>
          (
            await request<{ login: ModelLogin }>(
              `${base}/model-logins/${encodeURIComponent(loginId)}`,
              { method: "DELETE" },
            )
          ).login,
        setRole: (userId: string, role: WorkspaceRole) =>
          patch<{ ok: true }>(`${base}/members/${encodeURIComponent(userId)}`, { role }),
        /** Remove someone from the team. With the user's own id, leave it. */
        removeMember: (userId: string) =>
          request<{ ok: true }>(`${base}/members/${encodeURIComponent(userId)}`, {
            method: "DELETE",
          }),
        /**
         * Join the team's presence: hear where everyone is and when the team changes, and say
         * where this tab is. Reconnects with backoff, saying again where it is each time. Needs
         * a platform with WebSockets that carry the session: a browser, or one given `webSocket`.
         */
        presence(onEvent: (event: PresenceEvent) => void): PresenceLink {
          let socket: WebSocket | undefined
          let where: PresenceUpdate | undefined
          let closed = false
          let attempt = 0
          let ping: ReturnType<typeof setInterval> | undefined
          let retry: ReturnType<typeof setTimeout> | undefined
          const origin = options.baseUrl === "" ? globalThis.location.origin : options.baseUrl
          const url = `${origin.replace(/^http/, "ws")}/api/presence/${encodeURIComponent(workspaceId)}`
          const connect = () => {
            if (closed) return
            const current = new Socket(url)
            socket = current
            current.onopen = () => {
              attempt = 0
              if (where !== undefined) current.send(JSON.stringify(where))
              ping = setInterval(() => current.send(PING_FRAME), PRESENCE_PING_MS)
            }
            current.onmessage = (message) => {
              try {
                const event = JSON.parse(String(message.data)) as PresenceEvent
                if (event.type === "presence" || event.type === "changed") onEvent(event)
              } catch {
                // Not for us.
              }
            }
            current.onclose = (event) => {
              clearInterval(ping)
              if (socket === current) socket = undefined
              // Nobody is here as far as this tab can tell, until it is back.
              onEvent({ type: "presence", here: [] })
              // Let go because they are no longer in the team: what they have of it is stale.
              if (event.code === 4403) onEvent({ type: "changed" })
              // Turned away for good: signed out, or no longer in the team.
              if (closed || event.code === 4401 || event.code === 4403) return
              retry = setTimeout(connect, reconnectDelay(attempt++))
            }
          }
          connect()
          return {
            update(next) {
              where = next
              if (socket?.readyState === OPEN) socket.send(JSON.stringify(next))
            },
            close() {
              closed = true
              clearTimeout(retry)
              clearInterval(ping)
              socket?.close()
            },
          }
        },
      }
    },
    /**
     * Hear what the user's agents are up to as it happens: the latest from each, whether it is
     * at work or waiting on someone, and that the user looked at one from somewhere else.
     * `connected` is called each time the socket is up, with `again` after a break: what was
     * said while it was down was said to nobody, so that is when to ask for the list of agents
     * again. Reconnects with backoff. Needs a platform with WebSockets that carry the session:
     * a browser, or one given `webSocket`.
     */
    feed(
      userId: string,
      on: { event: (event: FeedEvent) => void; connected: (again: boolean) => void },
    ): { close(): void } {
      let socket: WebSocket | undefined
      let closed = false
      let attempt = 0
      let again = false
      let ping: ReturnType<typeof setInterval> | undefined
      let retry: ReturnType<typeof setTimeout> | undefined
      const origin = options.baseUrl === "" ? globalThis.location.origin : options.baseUrl
      // A person's feed is at the presence address of their own workspace.
      const url = `${origin.replace(/^http/, "ws")}/api/presence/${encodeURIComponent(personalWorkspaceId(userId))}`
      const connect = () => {
        if (closed) return
        const current = new Socket(url)
        socket = current
        current.onopen = () => {
          attempt = 0
          ping = setInterval(() => current.send(PING_FRAME), PRESENCE_PING_MS)
          on.connected(again)
          again = true
        }
        current.onmessage = (message) => {
          try {
            const event = JSON.parse(String(message.data)) as FeedEvent
            if (event.type === "agent" || event.type === "seen") on.event(event)
          } catch {
            // Not for us.
          }
        }
        current.onclose = (event) => {
          clearInterval(ping)
          if (socket === current) socket = undefined
          // Turned away for good: signed out.
          if (closed || event.code === 4401) return
          retry = setTimeout(connect, reconnectDelay(attempt++))
        }
      }
      connect()
      return {
        close() {
          closed = true
          clearTimeout(retry)
          clearInterval(ping)
          socket?.close()
        },
      }
    },
    /**
     * Delete an agent for good, with its memory, chats, schedules and skills. The machines of
     * its workspace that only it can use are deleted with it unless `keepComputers` is set.
     */
    deleteAgent: (agentId: string, options: { keepComputers?: boolean } = {}) =>
      request<{ ok: true }>(
        `/api/agents/${agentId}${options.keepComputers === true ? "?computers=keep" : ""}`,
        { method: "DELETE" },
      ),
    /** Register this device for push notifications, with the token its push service issued. */
    registerPush: (token: string, platform: string) =>
      post<{ ok: true }>("/api/push/register", { token, platform }),
    /** Forget a device: by its token, or for a browser by its subscription's address. */
    unregisterPush: (token: string) => post<{ ok: true }>("/api/push/unregister", { token }),
    /** The key a browser subscribes to its push service with. */
    pushKey: () => request<{ key: string }>("/api/push/key"),
    /** Register this browser for notifications, with the subscription its push service gave it. */
    registerBrowser: (subscription: PushSubscriptionJSON) =>
      post<{ ok: true }>("/api/push/register", { subscription }),
    /** Send this browser a notification now. `ok` is whether its push service took it. */
    testPush: (endpoint: string) => post<{ ok: boolean }>("/api/push/test", { endpoint }),
    /** Turn a short recording into text. `type` is the recording's media type. */
    transcribe: async (audio: { type: string; body: BodyInit }) =>
      (
        await request<{ text: string }>("/api/transcribe", {
          method: "POST",
          body: audio.body,
          headers: { "content-type": audio.type },
        })
      ).text,
    listComputers: async () =>
      (await request<{ computers: ComputerSummary[] }>("/api/computers")).computers,
    /** Add a machine to a workspace, for its agents to work on. It is made when first used. */
    addComputer: (input: AddComputerRequest) =>
      post<{ computerId: string; name: string }>("/api/computers", input),
    /** Say who can use a machine of a workspace: every agent of it, or the ones connected to it. */
    setComputerAccess: (computerId: string, access: "open" | "chosen") =>
      patch<{ ok: true }>(`/api/computers/${encodeURIComponent(computerId)}`, { access }),
    /** Remove a computer. A machine of a workspace is deleted, with everything on it. */
    removeComputer: (computerId: string) =>
      request<{ ok: true }>(`/api/computers/${encodeURIComponent(computerId)}`, {
        method: "DELETE",
      }),
    /**
     * Bring a paired computer's daemon up to the one the server serves: `told` when it keeps
     * itself up to date and was told to look, `reinstalled` when it was replaced from here.
     */
    updateComputerDaemon: (computerId: string) =>
      post<{ ok: true; how: "current" | "told" | "reinstalled" }>(
        `/api/computers/${encodeURIComponent(computerId)}/update`,
      ),
    pairingRequest: (code: string) =>
      request<PairingRequest>(`/api/computers/pair/request/${encodeURIComponent(code)}`),
    /** Take the computer behind a code: as the user's own or a team's, for the agents named. */
    confirmPairing: (input: ConfirmPairingRequest) =>
      post<{ computerId: string; name: string }>("/api/computers/pair/confirm", input),
    /** Change whose a computer is: the user's own, or a team of theirs. */
    moveComputer: (computerId: string, workspaceId: string) =>
      patch<{ ok: true }>(`/api/computers/${encodeURIComponent(computerId)}`, { workspaceId }),
    /** Let an agent work on a computer. Resolves with the name the agent knows it by. */
    connectComputer: (computerId: string, agentId: string) =>
      request<{ name: string }>(
        `/api/computers/${encodeURIComponent(computerId)}/agents/${encodeURIComponent(agentId)}`,
        { method: "PUT" },
      ),
    disconnectComputer: (computerId: string, agentId: string) =>
      request<{ ok: true }>(
        `/api/computers/${encodeURIComponent(computerId)}/agents/${encodeURIComponent(agentId)}`,
        { method: "DELETE" },
      ),
    /** What the user's agents are waiting to hear about computers they asked to use. */
    computerRequests: async () =>
      (await request<{ requests: ComputerRequest[] }>("/api/computers/requests")).requests,
    /** Say yes or no to an agent that asked for a computer. */
    answerComputerRequest: (requestId: string, approve: boolean) =>
      post<{ ok: true }>(`/api/computers/requests/${encodeURIComponent(requestId)}`, { approve }),

    agent(agentId: string) {
      const base = `/api/agents/${encodeURIComponent(agentId)}`
      return {
        state: () => request<AgentState>(base),
        update: (change: AgentPatch) => patch<AgentState>(base, change),
        /** Say that the user is looking at the agent now, which is what its unread dot goes by. */
        seen: () => request<{ seenAt: number }>(`${base}/seen`, { method: "PUT" }),
        /** Start a side chat: a conversation of its own, beside the main one. */
        createChat: (input: CreateChatRequest = {}) => post<ChatSummary>(`${base}/chats`, input),
        /** The agent's main chat, which it is given if it has none yet. */
        mainChat: () => post<ChatSummary>(`${base}/chats/main`),
        updateChat: (chatId: string, change: UpdateChatRequest) =>
          patch<ChatSummary>(`${base}/chats/${chatId}`, change),
        chat: (chatId: string) => request<ChatState>(`${base}/chats/${chatId}`),
        send: (chatId: string, message: SendMessageRequest) =>
          post<SendMessageResponse>(`${base}/chats/${chatId}/messages`, message),
        abort: (chatId: string) => post<{ ok: true }>(`${base}/chats/${chatId}/abort`),
        /** The commands the agent left running in the background, and those lately over. */
        jobs: async () => (await request<{ jobs: JobSummary[] }>(`${base}/jobs`)).jobs,
        /**
         * What a background command has printed from `from` bytes on, or the end of it when
         * `from` is left out. `next` is where to ask from the next time.
         */
        jobOutput: (jobId: string, from?: number) =>
          request<{ output: string; next: number; status: JobStatus }>(
            `${base}/jobs/${encodeURIComponent(jobId)}/output${from === undefined ? "" : `?from=${from}`}`,
          ),
        /** The address of the picture the agent kept of how a step on a screen or in a browser ended. */
        shotUrl: (shotId: string) =>
          `${options.baseUrl}${base}/shots/${encodeURIComponent(shotId)}`,
        /**
         * How a computer's screen, or the browser on it, looks now, while the agent is using it.
         * Waits a few seconds for a picture newer than number `after`. Nothing is shown of one
         * that no agent is using: `active` is false then.
         */
        view: (computerId: string, what: UseWhat, after: number, signal?: AbortSignal) =>
          request<LiveView>(
            `${base}/use/view?computer=${encodeURIComponent(computerId)}&what=${what}&after=${after}`,
            signal === undefined ? undefined : { signal },
          ),
        /** Pause the agent on a computer's screen or browser, or let it carry on. */
        hold: (computerId: string, what: UseWhat, held: boolean) =>
          post<{ ok: true }>(
            `${base}/use/hold?computer=${encodeURIComponent(computerId)}&what=${what}`,
            { held },
          ),
        /** Stop a background command. The agent is told that someone stopped it. */
        stopJob: (jobId: string) =>
          post<{ ok: true }>(`${base}/jobs/${encodeURIComponent(jobId)}/stop`),
        /**
         * Messages of a chat from before `before`, a message id: what a summary or a fresh start
         * moved out of the live transcript.
         */
        earlier: (chatId: string, before: string) =>
          request<ChatHistoryPage>(
            `${base}/chats/${chatId}/history?before=${encodeURIComponent(before)}`,
          ),
        /** Start the chat's context over. Earlier messages stay readable; memory is unaffected. */
        resetChat: (chatId: string) => post<{ ok: true }>(`${base}/chats/${chatId}/reset`),
        /** Search everything said in the agent's chats. */
        search: (query: string) =>
          request<{ hits: HistoryHit[]; complete: boolean; partial: boolean }>(
            `${base}/search?q=${encodeURIComponent(query)}`,
          ),
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
        connectors: async () =>
          (await request<{ connectors: ConnectorSummary[] }>(`${base}/connectors`)).connectors,
        /** Add a connector. If `authorizationUrl` comes back, send the user there to sign in. */
        addConnector: (input: AddConnectorRequest) =>
          post<ConnectorResult>(`${base}/connectors`, input),
        reconnectConnector: (connectorId: string) =>
          post<ConnectorResult>(`${base}/connectors/${connectorId}/connect`),
        setConnectorEnabled: (connectorId: string, enabled: boolean) =>
          patch<ConnectorSummary>(`${base}/connectors/${connectorId}`, { enabled }),
        removeConnector: (connectorId: string) =>
          request<{ ok: true }>(`${base}/connectors/${connectorId}`, { method: "DELETE" }),
        /** Say no, for now, to signing in to a connector the agent added. The agent is told. */
        dismissConnector: (connectorId: string) =>
          post<{ ok: true }>(`${base}/connectors/${connectorId}/dismiss`),
        /** The secrets the agent has asked someone to type, and not been answered about. */
        secretRequests: async () =>
          (await request<{ requests: SecretRequest[] }>(`${base}/secrets`)).requests,
        /**
         * Give the secrets the agent asked for. They are saved where it asked and are never
         * part of a chat: the agent is told only that they were saved.
         */
        answerSecretRequest: (requestId: string, values: Record<string, string>) =>
          post<{ ok: true }>(`${base}/secrets/${encodeURIComponent(requestId)}`, { values }),
        /** Say no to a request for secrets. The agent is told. */
        declineSecretRequest: (requestId: string) =>
          post<{ ok: true }>(`${base}/secrets/${encodeURIComponent(requestId)}/decline`),
        /** The agent's place in Slack, and what is needed to put it there. */
        slack: () => request<SlackState>(`${base}/slack`),
        /** Put the agent in Slack as the app these are the credentials of. */
        connectSlack: (input: ConnectSlackRequest) =>
          request<SlackState>(`${base}/slack`, { method: "PUT", body: JSON.stringify(input) }),
        disconnectSlack: () => request<{ ok: true }>(`${base}/slack`, { method: "DELETE" }),
        /** The agent's approval rules, what a rule can be set for, and what it is waiting on. */
        approvals: () => request<ApprovalsState>(`${base}/approvals`),
        /** Set rules by subject id. `allow` removes a rule. */
        setApprovalRules: (rules: Record<string, ApprovalRule>) =>
          patch<ApprovalsState>(`${base}/approvals/rules`, rules),
        /** Answer something the agent asked to do. */
        answerApproval: (requestId: string, decision: ApprovalDecision) =>
          post<{ ok: true }>(`${base}/approvals/${requestId}`, { decision }),
        /** What the agent has spent on models so far. */
        usage: () => request<AgentUsage>(`${base}/usage`),
        /** What its creature has been given and has on: its boxes, when the next is due, and its things. */
        creature: () => request<CreatureState>(`${base}/creature`),
        /** Give its creature a treat. There is always one to give. */
        feedCreature: () => post<CreatureState>(`${base}/creature/feed`),
        /** Open one of its creature's boxes. Answers with the id of what was inside. */
        openBox: () => post<{ item: string; creature: CreatureState }>(`${base}/creature/open`),
        /** Dress its creature, in things it has. */
        wear: (outfit: Outfit) =>
          request<CreatureState>(`${base}/creature/outfit`, {
            method: "PUT",
            body: JSON.stringify({ outfit }),
          }),
        library: async () => (await request<LibraryListing>(`${base}/library`)).files,
        /** The files, the deleted ones that can be brought back, and where files are viewed. */
        libraryListing: () => request<LibraryListing>(`${base}/library`),
        /**
         * Where a library file's bytes are served from; needs the same credentials as any call.
         * With `rev`, the content it had at that revision, which never changes.
         */
        libraryFileUrl: (fileId: string, rev?: number) =>
          `${options.baseUrl}${base}/library/${fileId}${rev === undefined ? "" : `?rev=${rev}`}`,
        /**
         * Where the file at `path` is served as what it is, so that an HTML document is a page
         * and the files it links to load. `view` comes with the listing and needs no session.
         */
        libraryViewUrl: (view: string, path: string) =>
          `${options.baseUrl}/d/${agentId}/${view}/${path.split("/").map(encodeURIComponent).join("/")}`,
        /** A file's content as text, as it is now or as it was at `rev`. */
        libraryText: async (fileId: string, rev?: number) => {
          const response = await send(
            `${base}/library/${fileId}${rev === undefined ? "" : `?rev=${rev}`}`,
          )
          if (!response.ok) throw new ApiError(response.status, "The file could not be read.")
          return response.text()
        },
        removeLibraryFile: (fileId: string) =>
          request<{ ok: true }>(`${base}/library/${fileId}`, { method: "DELETE" }),
        /**
         * Put a file in the library. From a chat it goes with the uploads; `dir` names another
         * folder, and "" the top.
         */
        upload: (
          file: { name: string; type: string; body: BodyInit },
          chatId?: string,
          dir?: string,
        ) =>
          request<LibraryFile>(
            `${base}/library?name=${encodeURIComponent(file.name)}${chatId ? `&chat=${chatId}` : ""}${
              dir === undefined ? "" : `&dir=${encodeURIComponent(dir)}`
            }`,
            {
              method: "POST",
              body: file.body,
              headers: { "content-type": file.type || "application/octet-stream" },
            },
          ),
        /** Start a document at `path`. If something is there already it gets the next free name. */
        createLibraryFile: (path: string, content: string) =>
          request<LibraryFile>(`${base}/library?path=${encodeURIComponent(path)}`, {
            method: "POST",
            body: content,
            headers: { "content-type": "application/octet-stream" },
          }),
        /**
         * Give a file new content. With `rev`, fails with the code `conflict` if the file has
         * changed since that revision, and saves nothing.
         */
        writeLibraryFile: (fileId: string, content: BodyInit, rev?: number) =>
          request<LibraryFile>(
            `${base}/library/${fileId}${rev === undefined ? "" : `?rev=${rev}`}`,
            {
              method: "PUT",
              body: content,
              headers: { "content-type": "application/octet-stream" },
            },
          ),
        /** Rename a file, or move it to another folder, by giving its whole new path. */
        moveLibraryFile: (fileId: string, path: string) =>
          request<LibraryFile>(`${base}/library/${fileId}`, {
            method: "PATCH",
            body: JSON.stringify({ path }),
          }),
        libraryVersions: async (fileId: string) =>
          (await request<{ versions: LibraryVersion[] }>(`${base}/library/${fileId}/versions`))
            .versions,
        /** Make an earlier content the current one. */
        revertLibraryFile: (fileId: string, rev: number) =>
          post<LibraryFile>(`${base}/library/${fileId}/revert`, { rev }),
        restoreLibraryFile: (fileId: string) =>
          request<LibraryFile>(`${base}/library/deleted/${fileId}/restore`, { method: "POST" }),
        /** What of the library is shared as a website, newest first. */
        sites: async () => (await request<{ sites: SiteSummary[] }>(`${base}/sites`)).sites,
        /**
         * Share a page of the library, or a folder with a front page, as a website. One that is
         * shared already answers with the site it is.
         */
        shareSite: async (path: string, title?: string) =>
          (await post<{ site: SiteSummary }>(`${base}/sites`, { path, title })).site,
        /** Change a site's title, or whether anyone with its address can open it. */
        updateSite: async (siteId: string, change: { public?: boolean; title?: string }) =>
          (
            await request<{ site: SiteSummary }>(`${base}/sites/${siteId}`, {
              method: "PATCH",
              body: JSON.stringify(change),
            })
          ).site,
        /** Stop sharing a site. Its files stay in the library. */
        removeSite: (siteId: string) =>
          request<{ ok: true }>(`${base}/sites/${siteId}`, { method: "DELETE" }),
        /** A site's address, for sending to someone. */
        siteUrl: (siteId: string) => `${options.baseUrl}${sitePath(siteId)}`,
        /** Calls `onState` with each new state of the chat, starting from its current one. */
        watchChat(
          chatId: string,
          onState: (state: ChatState) => void,
          onStatus?: (status: StreamStatus) => void,
        ): Subscription {
          return following === undefined
            ? chatStream(agentId, chatId, onState, onStatus)
            : following.watchChat(agentId, chatId, onState, onStatus)
        },
        /** Calls `onEvent` when something about the agent changed and should be refetched. */
        watch: (onEvent: (event: AgentEvent) => void, onStatus?: (status: StreamStatus) => void) =>
          following === undefined
            ? agentStream(agentId, onEvent, onStatus)
            : following.watch(agentId, onEvent, onStatus),
      }
    },
  }
}

export type Client = ReturnType<typeof createClient>
export type AgentClient = ReturnType<Client["agent"]>

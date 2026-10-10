import {
  type AgentEvent,
  type AgentSocketMessage,
  type AgentSocketRequest,
  type ChatState,
  digest,
  type DocDigests,
  EMPTY_CHAT,
  type LibrarySocketMessage,
  PING_FRAME,
  PONG_FRAME,
  reduceChat,
} from "@durable-computer/protocol"
import {
  type Attention,
  attended,
  reconnectDelay,
  REST_AFTER_MS,
  type StreamStatus,
  type Subscription,
  whenUnattended,
} from "./attention.ts"

/** The part of a WebSocket the client uses. A browser's is one. */
export interface SocketLike {
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((event: never) => unknown) | null
  onmessage: ((event: { data: unknown }) => unknown) | null
  onclose: ((event: never) => unknown) | null
}
export type SocketConstructor = new (url: string) => SocketLike

type OnAgent = (event: AgentEvent) => void
type OnChat = (state: ChatState) => void
type OnStatus = ((status: StreamStatus) => void) | undefined

export type FollowingOptions = {
  readonly baseUrl: string
  readonly socket: SocketConstructor
  readonly attention?: Attention
  readonly restAfterMs?: number
  /** Ask after an agent the plain way: the status it answered with, or undefined for none. */
  readonly probe: (agentId: string) => Promise<number | undefined>
  /** The event streams, which are what is used where a socket cannot be had. */
  readonly streams: {
    agent(agentId: string, onEvent: OnAgent, onStatus: OnStatus): Subscription
    chat(agentId: string, chatId: string, onState: OnChat, onStatus: OnStatus): Subscription
  }
}

/** How often a socket is pinged, so that whatever is between it and the server keeps it. */
const PING_MS = 30_000
/** How long a socket may say nothing, answers to pings included, before it is taken for lost. */
const SILENCE_MS = 75_000
/**
 * How many times a socket is tried, where the server answers the plain way and still gives no
 * socket, before the event streams are used: some networks and some servers carry none.
 */
const SOCKET_TRIES = 2
const SECOND_TRY_MS = 300
/** How long a socket may take to connect. One that is never answered would be waited on for good. */
const CONNECT_MS = 10_000
/** How many times running the library's socket may fail to open before it is given up. */
const LIBRARY_TRIES = 3

type Link = { say(value: unknown): void; close(): void }

/**
 * Follow agents over WebSockets: one for each agent that anything is followed of, carrying its
 * events and those of every chat of it that is followed, and one for the library of its
 * workspace. A socket does not keep the agent in memory on the server as an event stream does.
 *
 * Each connection begins as a stream does, with where things stand: `ready` for the agent, and
 * a chat's whole state when it is asked for. A server that put the agent away and brought it
 * back with the socket still connected says where things stand (`resumed`), and what is held
 * here is checked against that, chat by chat and document by document.
 */
export function createFollowing(options: FollowingOptions) {
  const origin = () =>
    (options.baseUrl === "" ? globalThis.location.origin : options.baseUrl).replace(/^http/, "ws")
  /** Set once sockets turned out not to be had here. Everything is then followed by stream. */
  let streamsOnly = false

  /** A socket that is connected again when it is lost, until it is closed. */
  function link(
    path: string,
    handlers: {
      open(): void
      message(value: unknown): void
      /**
       * The connection was lost, or never made, as `opened` says. Resolves with how long to
       * wait before trying again: undefined for the usual, null to stop.
       */
      lost(opened: boolean): Promise<number | null | undefined>
    },
  ): Link {
    const stopped = new AbortController()
    let socket: SocketLike | undefined
    let attempt = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    const connect = () => {
      if (stopped.signal.aborted) return
      const current = new options.socket(`${origin()}${path}`)
      socket = current
      let opened = false
      let resting = false
      let over = false
      let heard = Date.now()
      let ping: ReturnType<typeof setInterval> | undefined
      const down = () => {
        if (over) return
        over = true
        clearTimeout(late)
        clearInterval(ping)
        unrest?.()
        current.onopen = current.onmessage = current.onclose = null
        if (socket === current) socket = undefined
        if (stopped.signal.aborted) return
        void (async () => {
          if (resting && options.attention !== undefined) {
            // Not a failure, so there is nothing to back off from.
            await attended(options.attention, stopped.signal)
            return connect()
          }
          const wait = await handlers.lost(opened)
          if (wait === null || stopped.signal.aborted) return
          retry = setTimeout(connect, wait ?? reconnectDelay(attempt++))
        })()
      }
      const drop = (code: number, reason: string) => {
        try {
          current.close(code, reason)
        } catch {
          // Already closed.
        }
        // A socket whose other end has gone can take its time to say it is closed.
        down()
      }
      // A socket nobody is looking at is let go of, and made again when someone is.
      const unrest =
        options.attention === undefined
          ? undefined
          : whenUnattended(options.attention, options.restAfterMs ?? REST_AFTER_MS, () => {
              resting = true
              drop(1000, "Nobody is looking")
            })
      const late = setTimeout(() => drop(4000, "It was not answered"), CONNECT_MS)
      current.onopen = () => {
        clearTimeout(late)
        opened = true
        attempt = 0
        heard = Date.now()
        ping = setInterval(() => {
          // A connection can die without ending: a laptop that slept, a network that changed.
          if (Date.now() - heard > SILENCE_MS) return drop(4000, "Nothing was heard")
          try {
            current.send(PING_FRAME)
          } catch {
            // It is closing, and says so by itself.
          }
        }, PING_MS)
        handlers.open()
      }
      current.onmessage = (event) => {
        heard = Date.now()
        const text = String(event.data)
        if (text === PONG_FRAME) return
        let value: unknown
        try {
          value = JSON.parse(text)
        } catch {
          return
        }
        handlers.message(value)
      }
      current.onclose = down
    }
    connect()
    return {
      say(value) {
        try {
          socket?.send(JSON.stringify(value))
        } catch {
          // Not connected. Whatever matters is said again when it is.
        }
      },
      close() {
        if (stopped.signal.aborted) return
        stopped.abort()
        clearTimeout(retry)
        const current = socket
        socket = undefined
        if (current === undefined) return
        current.onopen = current.onmessage = current.onclose = null
        try {
          current.close(1000, "Done")
        } catch {
          // Already closed.
        }
      },
    }
  }

  type AgentSub = { onEvent: OnAgent; onStatus: OnStatus; stream?: Subscription }
  type ChatSub = { onState: OnChat; onStatus: OnStatus; stream?: Subscription }
  type Chat = { state: ChatState; loaded: boolean; subs: Set<ChatSub> }

  /** Everything followed of one agent, over one socket. */
  type Following = {
    readonly agentSubs: Set<AgentSub>
    readonly chats: Map<string, Chat>
    /** Bring the sockets into step with what is followed. */
    sync(): void
    /** Whether the socket is connected and has said the agent is ready. */
    ready(): boolean
    follow(chatId: string): void
    unfollow(chatId: string): void
    /** Follow everything by stream from here on. */
    toStreams(): void
  }
  const agents = new Map<string, Following>()

  function following(agentId: string): Following {
    const existing = agents.get(agentId)
    if (existing !== undefined) return existing
    const base = `/api/agents/${encodeURIComponent(agentId)}`
    const agentSubs = new Set<AgentSub>()
    const chats = new Map<string, Chat>()
    let agentLink: Link | undefined
    let libraryLink: Link | undefined
    /** Connected right now. */
    let up = false
    /** Where each of the agent's documents stood when last told, once it has said it is ready. */
    let docs: DocDigests | undefined
    /** Connected at least once: sockets can be had here. */
    let worked = false
    let failures = 0
    let libraryRev: number | undefined
    let libraryFailures = 0

    const status = (status: StreamStatus) => {
      for (const sub of agentSubs) sub.onStatus?.(status)
      for (const chat of chats.values()) for (const sub of chat.subs) sub.onStatus?.(status)
    }
    const tell = (event: AgentEvent) => {
      for (const sub of [...agentSubs]) sub.onEvent(event)
    }
    const say = (request: AgentSocketRequest) => agentLink?.say(request)

    const heard = (message: AgentSocketMessage) => {
      if (message.type === "agent") {
        if (message.event.type === "ready") {
          docs = { ...message.docs }
          for (const sub of agentSubs) sub.onStatus?.("open")
        } else if (docs !== undefined && message.at !== undefined) {
          docs[message.event.what] = message.at
        }
        return tell(message.event)
      }
      if (message.type === "chat") {
        const chat = chats.get(message.chat)
        if (chat === undefined) return
        chat.state = reduceChat(chat.state, message.event)
        if (message.event.type === "snapshot") {
          chat.loaded = true
          for (const sub of chat.subs) sub.onStatus?.("open")
        }
        for (const sub of [...chat.subs]) sub.onState(chat.state)
        return
      }
      if (message.type === "gone") {
        const chat = chats.get(message.chat)
        if (chat === undefined) return
        // Refused, as a stream is: whoever follows it is told, and it is not asked for again.
        chats.delete(message.chat)
        for (const sub of chat.subs) sub.onStatus?.("closed")
        return self.sync()
      }
      if (message.type === "resumed") {
        // The agent was put away and is back. Whatever is held here that is not what it has
        // now was missed, and is asked for again.
        for (const [chatId, chat] of chats) {
          if (!chat.loaded || message.chats[chatId] !== digest(chat.state)) {
            say({ type: "follow", chat: chatId })
          }
        }
        if (docs === undefined) return
        const before = docs
        docs = { ...message.docs }
        for (const [what, at] of Object.entries(message.docs)) {
          if (before[what] !== at) tell({ type: "changed", what } as AgentEvent)
        }
      }
    }

    const lost = async (opened: boolean): Promise<number | null | undefined> => {
      up = false
      docs = undefined
      if (opened) {
        status("reconnecting")
        return undefined
      }
      // A socket that is refused does not say why, so the agent is asked the plain way.
      const answer = await options.probe(agentId)
      if (agents.get(agentId) !== self) return null
      if (answer !== undefined && answer >= 400 && answer < 500) {
        // It will be refused again: there is no such agent for whoever is asking.
        status("closed")
        agents.delete(agentId)
        libraryLink?.close()
        agentLink?.close()
        return null
      }
      if (answer !== undefined && answer < 400 && !worked && ++failures >= SOCKET_TRIES) {
        // The server is there and gives no socket. Everything is followed by stream.
        streamsOnly = true
        for (const each of [...agents.values()]) each.toStreams()
        return null
      }
      status("reconnecting")
      return !worked && failures > 0 ? SECOND_TRY_MS : undefined
    }

    const self: Following = {
      agentSubs,
      chats,
      ready: () => up && docs !== undefined,
      follow: (chatId) => {
        if (up) say({ type: "follow", chat: chatId })
      },
      unfollow: (chatId) => {
        if (up) say({ type: "unfollow", chat: chatId })
      },
      sync() {
        if (agents.get(agentId) !== self) return
        if (agentSubs.size === 0 && chats.size === 0) {
          agents.delete(agentId)
          libraryLink?.close()
          agentLink?.close()
          return
        }
        agentLink ??= link(`${base}/socket`, {
          open() {
            up = true
            worked = true
            for (const chatId of chats.keys()) say({ type: "follow", chat: chatId })
          },
          message: (value) => heard(value as AgentSocketMessage),
          lost,
        })
        // The library is its workspace's, and says for itself when it changed.
        if (agentSubs.size === 0) {
          libraryLink?.close()
          libraryLink = undefined
          return
        }
        libraryLink ??= link(`${base}/library/socket`, {
          open() {
            libraryFailures = 0
          },
          message(value) {
            const { type, rev } = value as LibrarySocketMessage
            if (type !== "at" || typeof rev !== "number") return
            // The first is where it stands, which whoever follows the agent has just read.
            if (libraryRev !== undefined && rev !== libraryRev) {
              tell({ type: "changed", what: "library" })
            }
            libraryRev = rev
          },
          // Without it the library is still read whenever the agent says it is ready.
          lost: async (opened) =>
            !opened && ++libraryFailures >= LIBRARY_TRIES ? null : undefined,
        })
      },
      toStreams() {
        agents.delete(agentId)
        libraryLink?.close()
        agentLink?.close()
        for (const sub of agentSubs) {
          sub.stream = options.streams.agent(agentId, sub.onEvent, sub.onStatus)
        }
        for (const [chatId, chat] of chats) {
          for (const sub of chat.subs) {
            sub.stream = options.streams.chat(agentId, chatId, sub.onState, sub.onStatus)
          }
        }
      },
    }
    agents.set(agentId, self)
    return self
  }

  return {
    /** Calls `onEvent` when something about the agent changed and should be read again. */
    watch(agentId: string, onEvent: OnAgent, onStatus: OnStatus): Subscription {
      if (streamsOnly) return options.streams.agent(agentId, onEvent, onStatus)
      const agent = following(agentId)
      const sub: AgentSub = { onEvent, onStatus }
      onStatus?.("connecting")
      agent.agentSubs.add(sub)
      // One that joins a socket already telling of the agent starts as any other does.
      if (agent.ready()) {
        queueMicrotask(() => {
          if (!agent.agentSubs.has(sub) || sub.stream !== undefined) return
          onStatus?.("open")
          onEvent({ type: "ready" })
        })
      }
      agent.sync()
      return {
        close() {
          if (!agent.agentSubs.delete(sub)) return
          sub.stream?.close()
          agent.sync()
        },
      }
    },

    /** Follows a chat: `onState` is called with its state, and again after every change. */
    watchChat(agentId: string, chatId: string, onState: OnChat, onStatus: OnStatus): Subscription {
      if (streamsOnly) return options.streams.chat(agentId, chatId, onState, onStatus)
      const agent = following(agentId)
      const sub: ChatSub = { onState, onStatus }
      onStatus?.("connecting")
      let chat = agent.chats.get(chatId)
      if (chat === undefined) {
        chat = { state: EMPTY_CHAT, loaded: false, subs: new Set([sub]) }
        agent.chats.set(chatId, chat)
        agent.follow(chatId)
      } else {
        chat.subs.add(sub)
        const joined = chat
        if (joined.loaded) {
          queueMicrotask(() => {
            if (!joined.subs.has(sub) || sub.stream !== undefined) return
            onStatus?.("open")
            onState(joined.state)
          })
        }
      }
      agent.sync()
      const held = chat
      return {
        close() {
          if (!held.subs.delete(sub)) return
          sub.stream?.close()
          if (held.subs.size > 0 || agent.chats.get(chatId) !== held) return
          agent.chats.delete(chatId)
          agent.unfollow(chatId)
          agent.sync()
        },
      }
    },
  }
}

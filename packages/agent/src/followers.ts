import {
  type AgentEvent,
  type AgentSocketMessage,
  type AgentSocketRequest,
  type ChatEvent,
  type ChatState,
  diffChat,
  digest,
  type DocDigests,
  MAX_FOLLOWED_CHATS,
} from "@do-computer/protocol"
import type { ActorHost, ActorSocket } from "@do-computer/runtime"
import type { Context } from "@earendil-works/chord"
import type {
  Conversation,
  DocumentWatch,
  Harness,
  JsonObject,
  SessionDocToken,
} from "@earendil-works/pi-durable"
import { projectChat } from "./project.ts"

type Told = Extract<AgentEvent, { type: "changed" }>["what"]
type Doc = SessionDocToken<JsonObject>
type ChatWatch = Awaited<ReturnType<Conversation["watch"]>>

export type FollowersOptions = {
  readonly host: ActorHost
  /** The documents everyone following the agent is told of, and what each goes by. */
  readonly docs: readonly (readonly [Told, Doc])[]
  /** The chat with this id, or undefined where there is none to follow. */
  readonly chat: (harness: Harness, chatId: string) => Promise<Conversation | undefined>
  readonly context: Context
  readonly onError: (error: unknown) => void
}

/** The chats a socket follows, as kept with it. */
function followed(socket: ActorSocket): string[] | undefined {
  if (socket.note === undefined) return undefined
  try {
    const chats = JSON.parse(socket.note) as unknown
    return Array.isArray(chats) ? chats.filter((chat) => typeof chat === "string") : []
  } catch {
    return []
  }
}

/**
 * Everyone following the agent over a socket: told when one of its documents changes, and sent
 * every change to the chats they follow.
 *
 * What each socket follows is kept with the socket and not here, because the runtime may put
 * the agent away while its sockets stay connected, and bring it back with nothing in memory.
 * Whatever brings it back opens the agent, which attaches this again: the documents and the
 * chats are watched anew from where they stand, and every socket is told where that is
 * (`resumed`), so that one holding something else can ask again. Nothing changes while the
 * agent is put away, so a client that was told of everything before holds what is here now.
 *
 * A document or a chat is watched once, however many sockets follow it.
 */
export class Followers {
  readonly #options: FollowersOptions
  #harness: Harness | undefined
  readonly #docs = new Map<Told, { watch: DocumentWatch<JsonObject>; at: string }>()
  readonly #chats = new Map<string, { watch: ChatWatch; state: ChatState }>()
  /** One thing at a time: following and letting go wait on watches being made. */
  #line: Promise<void> = Promise.resolve()

  constructor(options: FollowersOptions) {
    this.#options = options
  }

  #then<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#line.then(work)
    this.#line = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  /** The sockets that are following: one that has only just connected is not yet. */
  #sockets(except?: string): ActorSocket[] {
    return this.#options.host
      .sockets()
      .filter((socket) => socket.id !== except && socket.note !== undefined)
  }

  #say(socket: ActorSocket, message: AgentSocketMessage): void {
    socket.send(JSON.stringify(message))
  }

  /** Whether anyone is following a chat right now, the agent being in memory or not. */
  following(chatId: string): boolean {
    return this.#sockets().some((socket) => followed(socket)?.includes(chatId))
  }

  async #watchDocs(harness: Harness): Promise<DocDigests> {
    for (const [what, doc] of this.#options.docs) {
      if (this.#docs.has(what)) continue
      const watch = await harness.watchDoc(doc, this.#options.context)
      if (watch === undefined) continue
      const entry = { watch, at: digest(watch.value) }
      this.#docs.set(what, entry)
      watch.start(async (value) => {
        entry.at = digest(value)
        const frame = JSON.stringify({
          type: "agent",
          event: { type: "changed", what },
          at: entry.at,
        } satisfies AgentSocketMessage)
        for (const socket of this.#sockets()) socket.send(frame)
      })
    }
    return Object.fromEntries([...this.#docs].map(([what, entry]) => [what, entry.at]))
  }

  /** The watch of a chat, made if there is none. Undefined where there is no such chat. */
  async #watchChat(harness: Harness, chatId: string) {
    const watching = this.#chats.get(chatId)
    if (watching !== undefined) return watching
    const conversation = await this.#options.chat(harness, chatId)
    if (conversation === undefined) return undefined
    const watch = await conversation.watch(this.#options.context)
    const entry = { watch, state: projectChat(watch.value) }
    this.#chats.set(chatId, entry)
    watch.start(async (value) => {
      const next = projectChat(value)
      const events = diffChat(entry.state, next)
      entry.state = next
      if (events.length === 0) return
      const frames = events.map((event: ChatEvent) =>
        JSON.stringify({ type: "chat", chat: chatId, event } satisfies AgentSocketMessage),
      )
      for (const socket of this.#sockets()) {
        if (!followed(socket)?.includes(chatId)) continue
        for (const frame of frames) socket.send(frame)
      }
    })
    // It ended by itself: the chat was deleted. One that was let go of is no longer kept here,
    // and one that ended with the harness is followed again by whoever opens the agent next.
    void watch.closed.then((end) => {
      if (end.reason === "session_closed" || end.reason === "session_failed") return
      if (this.#chats.get(chatId) !== entry) return
      this.#chats.delete(chatId)
      for (const socket of this.#sockets()) this.#drop(socket, chatId, true)
    })
    return entry
  }

  /** Take a chat out of what a socket follows, telling it so where it did not ask for that. */
  #drop(socket: ActorSocket, chatId: string, tell: boolean): void {
    const chats = followed(socket)
    if (chats === undefined || !chats.includes(chatId)) return
    socket.keep(JSON.stringify(chats.filter((chat) => chat !== chatId)))
    if (tell) this.#say(socket, { type: "gone", chat: chatId })
  }

  /** Stop watching what no socket follows any more. `except` is a socket that is closing. */
  #prune(except?: string): void {
    const sockets = this.#sockets(except)
    const wanted = new Set(sockets.flatMap((socket) => followed(socket) ?? []))
    for (const [chatId, entry] of this.#chats) {
      if (wanted.has(chatId)) continue
      this.#chats.delete(chatId)
      void entry.watch.stop()
    }
    if (sockets.length > 0) return
    for (const entry of this.#docs.values()) void entry.watch.stop()
    this.#docs.clear()
  }

  /**
   * The agent has been opened. Sockets that were following before it was, which are there when
   * it was put away and has come back, are followed for again and told where things stand.
   */
  attach(harness: Harness): Promise<void> {
    return this.#then(async () => {
      this.#harness = harness
      const sockets = this.#sockets()
      if (sockets.length === 0) return
      const docs = await this.#watchDocs(harness)
      for (const socket of sockets) {
        const chats: Record<string, string> = {}
        for (const chatId of followed(socket) ?? []) {
          const entry = await this.#watchChat(harness, chatId)
          if (entry === undefined) this.#drop(socket, chatId, true)
          else chats[chatId] = digest(entry.state)
        }
        this.#say(socket, { type: "resumed", docs, chats })
      }
    })
  }

  /** A socket connected. It is told of the agent's documents from here on. */
  open(socket: ActorSocket): Promise<void> {
    return this.#then(async () => {
      if (this.#harness === undefined) return
      const docs = await this.#watchDocs(this.#harness)
      socket.keep("[]")
      // Said once everything is being watched. What changed before this is not told here, so a
      // client that hears it asks again for whatever it already has.
      this.#say(socket, { type: "agent", event: { type: "ready" }, docs })
    })
  }

  message(socket: ActorSocket, data: string): Promise<void> {
    return this.#then(async () => {
      const harness = this.#harness
      const chats = followed(socket)
      if (harness === undefined || chats === undefined) return
      let request: AgentSocketRequest
      try {
        request = JSON.parse(data) as AgentSocketRequest
      } catch {
        return
      }
      if (request === null || typeof request !== "object") return
      const chatId = request.chat
      if (typeof chatId !== "string" || chatId === "" || chatId.length > 40) return
      if (request.type === "unfollow") {
        this.#drop(socket, chatId, false)
        this.#prune()
        return
      }
      if (request.type !== "follow") return
      const known = chats.includes(chatId)
      const entry =
        !known && chats.length >= MAX_FOLLOWED_CHATS
          ? undefined
          : await this.#watchChat(harness, chatId)
      if (entry === undefined) {
        this.#drop(socket, chatId, false)
        this.#say(socket, { type: "gone", chat: chatId })
        return
      }
      if (!known) socket.keep(JSON.stringify([...chats, chatId]))
      // Asked for again, it is sent again: that is how a client that fell out of step gets back.
      this.#say(socket, {
        type: "chat",
        chat: chatId,
        event: { type: "snapshot", state: entry.state },
      })
    })
  }

  /** A socket closed. What only it followed is no longer watched. */
  close(socket: ActorSocket): Promise<void> {
    return this.#then(async () => this.#prune(socket.id))
  }

  /** Stop watching everything. The sockets stay; whoever opens the agent next attaches again. */
  stop(): void {
    this.#harness = undefined
    for (const entry of this.#chats.values()) void entry.watch.stop()
    this.#chats.clear()
    for (const entry of this.#docs.values()) void entry.watch.stop()
    this.#docs.clear()
  }
}

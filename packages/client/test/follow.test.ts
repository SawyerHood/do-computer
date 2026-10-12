import {
  type AgentEvent,
  type AgentSocketMessage,
  type ChatState,
  digest,
  EMPTY_CHAT,
  encodeSse,
  type LibrarySocketMessage,
  PING_FRAME,
  PONG_FRAME,
} from "@do-computer/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createClient, type SocketLike } from "../src/index.ts"

/** A WebSocket as the test's server sees it: everything the client said, and a way to answer. */
class FakeSocket implements SocketLike {
  static made: FakeSocket[] = []
  /** Called for each new socket, where a test wants to answer as a server would. */
  static serve: ((socket: FakeSocket) => void) | undefined
  onopen: ((event: never) => unknown) | null = null
  onmessage: ((event: { data: unknown }) => unknown) | null = null
  onclose: ((event: never) => unknown) | null = null
  readonly said: unknown[] = []
  readonly path: string
  closed = false
  constructor(readonly url: string) {
    this.path = new URL(url).pathname
    FakeSocket.made.push(this)
    queueMicrotask(() => FakeSocket.serve?.(this))
  }
  send(data: string): void {
    if (data === PING_FRAME)
      return void queueMicrotask(() => this.onmessage?.({ data: PONG_FRAME }))
    this.said.push(JSON.parse(data))
  }
  close(): void {
    this.closed = true
  }
  /** The server accepted it. */
  open(): void {
    this.onopen?.(undefined as never)
  }
  tell(message: AgentSocketMessage | LibrarySocketMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
  /** The connection went away, or was never made. */
  drop(): void {
    this.closed = true
    this.onclose?.(undefined as never)
  }
}

const AGENT = "/api/agents/a/socket"
const LIBRARY = "/api/agents/a/library/socket"
const sockets = (path: string) => FakeSocket.made.filter((socket) => socket.path === path)
const tick = () => vi.advanceTimersByTimeAsync(0)

const chatOf = (text: string, busy = false): ChatState => ({
  ...EMPTY_CHAT,
  busy,
  messages: [{ id: "1", role: "user", parts: [{ type: "text", text }], status: "done" }],
})

function client(fetch?: typeof globalThis.fetch, more: Record<string, unknown> = {}) {
  return createClient({
    baseUrl: "http://app.test",
    sockets: true,
    webSocket: FakeSocket,
    fetch: fetch ?? (async () => Response.json({})),
    ...more,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.made = []
  FakeSocket.serve = undefined
})
afterEach(() => {
  vi.useRealTimers()
})

describe("following an agent over a socket", () => {
  it("carries the agent's events and its chats' over one socket", async () => {
    const api = client()
    const events: AgentEvent[] = []
    const agentStatuses: string[] = []
    const states: ChatState[] = []
    const chatStatuses: string[] = []
    const watching = api.agent("a").watch(
      (event) => events.push(event),
      (status) => agentStatuses.push(status),
    )
    const chat = api.agent("a").watchChat(
      "7",
      (state) => states.push(state),
      (status) => chatStatuses.push(status),
    )
    await tick()
    expect(FakeSocket.made.map((socket) => socket.url)).toEqual([
      `ws://app.test${AGENT}`,
      `ws://app.test${LIBRARY}`,
    ])
    const [socket] = sockets(AGENT)
    socket!.open()
    expect(socket!.said).toEqual([{ type: "follow", chat: "7" }])
    socket!.tell({ type: "agent", event: { type: "ready" }, docs: { identity: "a1" } })
    socket!.tell({
      type: "chat",
      chat: "7",
      event: { type: "snapshot", state: chatOf("hi", true) },
    })
    socket!.tell({ type: "chat", chat: "7", event: { type: "busy", busy: false } })
    socket!.tell({ type: "agent", event: { type: "changed", what: "identity" }, at: "a2" })
    // A chat nobody here follows is not theirs to hear of.
    socket!.tell({ type: "chat", chat: "8", event: { type: "snapshot", state: chatOf("other") } })

    expect(events).toEqual([{ type: "ready" }, { type: "changed", what: "identity" }])
    expect(agentStatuses).toEqual(["connecting", "open"])
    expect(states).toEqual([chatOf("hi", true), chatOf("hi")])
    expect(chatStatuses).toEqual(["connecting", "open"])

    // Another chat joins the same socket, and one that is let go of is said to be.
    const second = api.agent("a").watchChat("9", () => {})
    expect(socket!.said.at(-1)).toEqual({ type: "follow", chat: "9" })
    chat.close()
    expect(socket!.said.at(-1)).toEqual({ type: "unfollow", chat: "7" })
    expect(sockets(AGENT)).toHaveLength(1)
    expect(socket!.closed).toBe(false)

    // With the agent no longer watched, its library is not followed either.
    watching.close()
    expect(sockets(LIBRARY)[0]!.closed).toBe(true)
    expect(socket!.closed).toBe(false)
    second.close()
    expect(socket!.closed).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeSocket.made).toHaveLength(2)
  })

  it("gives one who joins what is already followed where it stands", async () => {
    const api = client()
    api.agent("a").watch(() => {})
    api.agent("a").watchChat("7", () => {})
    await tick()
    const [socket] = sockets(AGENT)
    socket!.open()
    socket!.tell({ type: "agent", event: { type: "ready" }, docs: {} })
    socket!.tell({ type: "chat", chat: "7", event: { type: "snapshot", state: chatOf("hi") } })

    const events: AgentEvent[] = []
    const states: ChatState[] = []
    const statuses: string[] = []
    api.agent("a").watch((event) => events.push(event))
    api.agent("a").watchChat(
      "7",
      (state) => states.push(state),
      (status) => statuses.push(status),
    )
    await tick()
    expect(events).toEqual([{ type: "ready" }])
    expect(states).toEqual([chatOf("hi")])
    expect(statuses).toEqual(["connecting", "open"])
    // Nothing more was asked of the server for it.
    expect(socket!.said).toEqual([{ type: "follow", chat: "7" }])
    expect(FakeSocket.made).toHaveLength(2)
  })

  it("checks what it holds against an agent that was put away and is back", async () => {
    const api = client()
    const events: AgentEvent[] = []
    api.agent("a").watch((event) => events.push(event))
    api.agent("a").watchChat("7", () => {})
    api.agent("a").watchChat("9", () => {})
    await tick()
    const [socket] = sockets(AGENT)
    socket!.open()
    socket!.tell({
      type: "agent",
      event: { type: "ready" },
      docs: { identity: "a1", chats: "b1", skills: "c1" },
    })
    socket!.tell({ type: "chat", chat: "7", event: { type: "snapshot", state: chatOf("seven") } })
    socket!.tell({ type: "chat", chat: "9", event: { type: "snapshot", state: chatOf("nine") } })
    socket!.tell({ type: "agent", event: { type: "changed", what: "chats" }, at: "b2" })
    const said = socket!.said.length
    const told = events.length

    // Everything is as it was held: nothing is asked for again.
    socket!.tell({
      type: "resumed",
      docs: { identity: "a1", chats: "b2", skills: "c1" },
      chats: { "7": digest(chatOf("seven")), "9": digest(chatOf("nine")) },
    })
    expect(socket!.said).toHaveLength(said)
    expect(events).toHaveLength(told)

    // One chat and one document are not: those are asked for again, and nothing else.
    socket!.tell({
      type: "resumed",
      docs: { identity: "a1", chats: "b2", skills: "c2" },
      chats: { "7": digest(chatOf("seven")), "9": digest(chatOf("nine, and more")) },
    })
    expect(socket!.said.slice(said)).toEqual([{ type: "follow", chat: "9" }])
    expect(events.slice(told)).toEqual([{ type: "changed", what: "skills" }])
    // And a chat the agent no longer has it following is followed again.
    socket!.tell({
      type: "resumed",
      docs: { identity: "a1", chats: "b2", skills: "c2" },
      chats: { "9": digest(chatOf("nine")) },
    })
    expect(socket!.said.slice(said + 1)).toEqual([{ type: "follow", chat: "7" }])
  })

  it("says the library changed when its workspace's library says it stands elsewhere", async () => {
    const api = client()
    const events: AgentEvent[] = []
    api.agent("a").watch((event) => events.push(event))
    await tick()
    const [library] = sockets(LIBRARY)
    library!.open()
    // Where it stands on connecting is what whoever follows the agent is about to read.
    library!.tell({ type: "at", rev: 4 })
    library!.tell({ type: "at", rev: 4 })
    expect(events).toEqual([])
    library!.tell({ type: "at", rev: 5 })
    expect(events).toEqual([{ type: "changed", what: "library" }])
    // Connected again, it is told of only what changed while it was not.
    library!.drop()
    await vi.advanceTimersByTimeAsync(2_000)
    const again = sockets(LIBRARY)[1]!
    again.open()
    again.tell({ type: "at", rev: 5 })
    expect(events).toHaveLength(1)
    again.tell({ type: "at", rev: 6 })
    expect(events).toHaveLength(2)
  })

  it("tells a chat that is not there as a refused stream is told", async () => {
    const api = client()
    const statuses: string[] = []
    api.agent("a").watchChat(
      "404",
      () => {},
      (status) => statuses.push(status),
    )
    await tick()
    const [socket] = sockets(AGENT)
    socket!.open()
    socket!.tell({ type: "gone", chat: "404" })
    expect(statuses).toEqual(["connecting", "closed"])
    // Nothing is followed any more, so the socket is let go of.
    expect(socket!.closed).toBe(true)
  })

  it("connects again when the socket is lost, and follows everything again", async () => {
    const api = client()
    const events: AgentEvent[] = []
    const states: ChatState[] = []
    const statuses: string[] = []
    api.agent("a").watch((event) => events.push(event))
    api.agent("a").watchChat(
      "7",
      (state) => states.push(state),
      (status) => statuses.push(status),
    )
    await tick()
    const [first] = sockets(AGENT)
    first!.open()
    first!.tell({ type: "agent", event: { type: "ready" }, docs: {} })
    first!.tell({ type: "chat", chat: "7", event: { type: "snapshot", state: chatOf("hi", true) } })
    first!.drop()
    await tick()
    expect(statuses).toEqual(["connecting", "open", "reconnecting"])
    await vi.advanceTimersByTimeAsync(1_000)
    const second = sockets(AGENT)[1]!
    second.open()
    expect(second.said).toEqual([{ type: "follow", chat: "7" }])
    second.tell({ type: "agent", event: { type: "ready" }, docs: {} })
    second.tell({ type: "chat", chat: "7", event: { type: "snapshot", state: chatOf("hi") } })
    expect(events).toEqual([{ type: "ready" }, { type: "ready" }])
    expect(states.at(-1)).toEqual(chatOf("hi"))
    expect(statuses).toEqual(["connecting", "open", "reconnecting", "open"])
  })

  it("takes a socket that has gone quiet for lost, and one that answers its pings for alive", async () => {
    const api = client()
    api.agent("a").watch(() => {})
    await tick()
    const [socket] = sockets(AGENT)
    socket!.open()
    // It has nothing to say for minutes, and answers each ping: it is kept.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(sockets(AGENT)).toHaveLength(1)
    expect(socket!.closed).toBe(false)
    // Then it stops answering.
    socket!.send = () => {}
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(socket!.closed).toBe(true)
    expect(sockets(AGENT).length).toBeGreaterThan(1)
  })

  it("lets go of its sockets when nobody is looking, and makes them again when someone is", async () => {
    let looking = true
    const watching = new Set<() => void>()
    const look = (now: boolean) => {
      looking = now
      for (const changed of [...watching]) changed()
    }
    const api = client(undefined, {
      attention: {
        here: () => looking,
        watch(changed: () => void) {
          watching.add(changed)
          return () => watching.delete(changed)
        },
      },
      restAfterMs: 10_000,
    })
    const statuses: string[] = []
    const watch = api.agent("a").watchChat(
      "7",
      () => {},
      (status) => statuses.push(status),
    )
    await tick()
    const [first] = sockets(AGENT)
    first!.open()
    first!.tell({ type: "chat", chat: "7", event: { type: "snapshot", state: chatOf("hi") } })

    look(false)
    await vi.advanceTimersByTimeAsync(9_000)
    look(true)
    await vi.advanceTimersByTimeAsync(9_000)
    expect(first!.closed).toBe(false)

    look(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(first!.closed).toBe(true)
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(sockets(AGENT)).toHaveLength(1)
    // It did not fail, so it is not said to have.
    expect(statuses).toEqual(["connecting", "open"])

    look(true)
    await tick()
    expect(sockets(AGENT)).toHaveLength(2)
    sockets(AGENT)[1]!.open()
    expect(sockets(AGENT)[1]!.said).toEqual([{ type: "follow", chat: "7" }])

    look(false)
    await vi.advanceTimersByTimeAsync(10_000)
    watch.close()
    look(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sockets(AGENT)).toHaveLength(2)
    expect(watching.size).toBe(0)
  })

  it("stops when the agent is refused, as for one that is gone or someone signed out", async () => {
    const asked: string[] = []
    const api = client(async (input) => {
      asked.push(new URL(String(input)).pathname)
      return Response.json({ error: "Agent not found" }, { status: 404 })
    })
    const statuses: string[] = []
    api.agent("a").watchChat(
      "7",
      () => {},
      (status) => statuses.push(status),
    )
    await tick()
    sockets(AGENT)[0]!.drop()
    await tick()
    expect(asked).toEqual(["/api/agents/a"])
    expect(statuses).toEqual(["connecting", "closed"])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets(AGENT)).toHaveLength(1)
  })

  it("keeps trying while the server cannot be reached at all", async () => {
    const api = client(async () => {
      throw new TypeError("Failed to fetch")
    })
    const statuses: string[] = []
    api.agent("a").watchChat(
      "7",
      () => {},
      (status) => statuses.push(status),
    )
    await tick()
    for (let tries = 0; tries < 4; tries++) {
      sockets(AGENT).at(-1)!.drop()
      await vi.advanceTimersByTimeAsync(10_000)
    }
    expect(sockets(AGENT)).toHaveLength(5)
    expect(statuses).toEqual([
      "connecting",
      "reconnecting",
      "reconnecting",
      "reconnecting",
      "reconnecting",
    ])
  })

  it("follows by event stream where the server answers and gives no socket", async () => {
    const asked: string[] = []
    const api = client(async (input, init) => {
      const path = new URL(String(input)).pathname
      asked.push(path)
      if (!path.endsWith("/events")) return Response.json({})
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encodeSse(
                path.includes("/chats/")
                  ? { type: "snapshot", state: chatOf("by stream") }
                  : { type: "ready" },
              ),
            )
            init!.signal!.addEventListener("abort", () => controller.error(new Error("gone")))
          },
        }),
      )
    })
    // Every socket is refused as it is made.
    FakeSocket.serve = (socket) => socket.drop()
    const events: AgentEvent[] = []
    const states: ChatState[] = []
    const statuses: string[] = []
    const watch = api.agent("a").watch((event) => events.push(event))
    const chat = api.agent("a").watchChat(
      "7",
      (state) => states.push(state),
      (status) => statuses.push(status),
    )
    await vi.advanceTimersByTimeAsync(1_000)
    // Tried twice, and then the streams.
    expect(sockets(AGENT)).toHaveLength(2)
    expect(asked).toEqual([
      "/api/agents/a",
      "/api/agents/a",
      "/api/agents/a/events",
      "/api/agents/a/chats/7/events",
    ])
    expect(events).toEqual([{ type: "ready" }])
    expect(states).toEqual([chatOf("by stream")])
    expect(statuses.at(-1)).toBe("open")

    // What is followed from here on goes by stream at once, for any agent.
    const made = FakeSocket.made.length
    const other = api.agent("b").watchChat("1", () => {})
    await tick()
    expect(FakeSocket.made).toHaveLength(made)
    expect(asked.at(-1)).toBe("/api/agents/b/chats/1/events")
    // And letting go lets go of the streams.
    watch.close()
    chat.close()
    other.close()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(asked).toHaveLength(5)
  })
})

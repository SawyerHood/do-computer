import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AgentSocketMessage,
  type AgentSocketRequest,
  type ChatState,
  type ChatSummary,
  digest,
  type LibrarySocketMessage,
  EMPTY_CHAT,
  MAX_FOLLOWED_CHATS,
  reduceChat,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace, type SocketLike } from "@do-computer/runtime/node"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { type AgentNotification, createAgentActor, createLibraryActor } from "../src/index.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
  notified: AgentNotification[]
}

const worlds: World[] = []

function open(tokensPerSecond = 2_000): World {
  const directory = mkdtempSync(join(tmpdir(), "dc-agent-sockets-"))
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond })
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: unknown[] = []
  const notified: AgentNotification[] = []
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
        onNotify: (notification) => notified.push(notification),
        onReport: (error) => reports.push(error),
      }),
    onError: (error) => reports.push(error),
  })
  namespace.start()
  const world = { namespace, faux, reports, notified }
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

async function call<T>(world: World, path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await world.namespace.get("agent-1").fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
    }),
  )
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`)
  return result
}

async function setup(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  return call<ChatSummary>(world, "/chats", "POST", {})
}

const send = (world: World, chatId: string, text: string) =>
  call<{ submissionId: string }>(world, `/chats/${chatId}/messages`, "POST", {
    text,
    requestId: crypto.randomUUID(),
  })

/** The client's end of a socket to the agent, holding what a client holds. */
type Client = {
  say(request: AgentSocketRequest): void
  close(): void
  /** Everything heard so far, in order. */
  heard: AgentSocketMessage[]
  /** Each followed chat, as its changes have made it. */
  chats: Map<string, ChatState>
  /** Resolves once `done` holds, looked at again after each message. */
  until(done: () => boolean): Promise<void>
}

async function connect(world: World): Promise<Client> {
  const listeners = {
    message: [] as ((data: unknown, binary: boolean) => void)[],
    close: [] as ((code: number, reason: unknown) => void)[],
  }
  const heard: AgentSocketMessage[] = []
  const chats = new Map<string, ChatState>()
  let waiting: (() => void)[] = []
  let state = 1
  const server: SocketLike = {
    get readyState() {
      return state
    },
    send: (data) => {
      const message = JSON.parse(data) as AgentSocketMessage
      heard.push(message)
      if (message.type === "chat") {
        chats.set(message.chat, reduceChat(chats.get(message.chat) ?? EMPTY_CHAT, message.event))
      }
      for (const look of waiting.splice(0)) look()
    },
    close: () => {
      state = 3
    },
    on: (event: string, listener: never) => {
      if (event === "message" || event === "close") listeners[event].push(listener)
      return server
    },
  }
  await world.namespace.connect("agent-1", server, new Request("http://actor/socket"))
  return {
    heard,
    chats,
    say: (request) =>
      queueMicrotask(() =>
        listeners.message.forEach((listener) => listener(JSON.stringify(request), false)),
      ),
    close: () => {
      if (state !== 1) return
      state = 3
      queueMicrotask(() => listeners.close.forEach((listener) => listener(1000, "")))
    },
    until: (done) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Not heard in time. Heard: ${JSON.stringify(heard).slice(-600)}`)),
          8_000,
        )
        const look = () => {
          if (!done()) return void waiting.push(look)
          clearTimeout(timer)
          resolve()
        }
        look()
      }),
  }
}

const answered = (client: Client, chatId: string, count: number) => () => {
  const state = client.chats.get(chatId)
  return (
    state !== undefined &&
    !state.busy &&
    state.messages.filter((m) => m.role === "assistant" && m.status === "done").length >= count
  )
}

const kinds = (client: Client, chatId: string) =>
  client.heard.flatMap((message) =>
    message.type === "chat" && message.chat === chatId ? [message.event.type] : [],
  )

const settled = () => new Promise((resolve) => setTimeout(resolve, 50))

describe("following an agent over a socket", () => {
  it("says the agent is ready, and then when one of its documents changes", async () => {
    const world = open()
    await setup(world)
    const client = await connect(world)
    await client.until(() => client.heard.length > 0)
    const ready = client.heard[0]!
    expect(ready).toMatchObject({ type: "agent", event: { type: "ready" } })
    const docs = ready.type === "agent" ? ready.docs! : {}
    expect(Object.keys(docs)).toEqual(expect.arrayContaining(["identity", "chats", "skills"]))

    await call(world, "/", "PATCH", { name: "Juniper" })
    const changed = () =>
      client.heard.find(
        (message) =>
          message.type === "agent" &&
          message.event.type === "changed" &&
          message.event.what === "identity",
      )
    await client.until(() => changed() !== undefined)
    const told = changed()!
    // It says where the document now stands, which is not where it stood.
    expect(told.type === "agent" && told.at).toMatch(/^[0-9a-f]{16}$/)
    expect(told.type === "agent" && told.at).not.toBe(docs.identity)
    expect(world.reports).toEqual([])
  })

  it("sends a chat whole, and then each change to it", async () => {
    const world = open(60)
    const chat = await setup(world)
    const answer = "Hello there, it is very nice to meet you today. ".repeat(3).trim()
    world.faux.setResponses([fauxAssistantMessage(answer)])
    const client = await connect(world)
    client.say({ type: "follow", chat: chat.id })
    await client.until(() => client.chats.has(chat.id))
    await send(world, chat.id, "hi")
    await client.until(answered(client, chat.id, 1))

    const state = client.chats.get(chat.id)!
    expect(state.messages.map((m) => [m.role, m.status])).toEqual([
      ["user", "done"],
      ["assistant", "done"],
    ])
    expect(state.messages[1]!.parts).toEqual([{ type: "text", text: answer }])
    // What the socket's changes made is what the chat is.
    expect(digest(state)).toBe(digest(await call<ChatState>(world, `/chats/${chat.id}`)))
    expect(kinds(client, chat.id).filter((kind) => kind === "snapshot")).toHaveLength(1)
    expect(kinds(client, chat.id).filter((kind) => kind === "delta").length).toBeGreaterThan(0)
  })

  it("sends a chat to everyone following it, and no longer to one who stopped", async () => {
    const world = open()
    const chat = await setup(world)
    const other = await call<ChatSummary>(world, "/chats", "POST", {})
    world.faux.setResponses([fauxAssistantMessage("One."), fauxAssistantMessage("Two.")])
    const first = await connect(world)
    const second = await connect(world)
    first.say({ type: "follow", chat: chat.id })
    second.say({ type: "follow", chat: chat.id })
    second.say({ type: "follow", chat: other.id })
    await first.until(() => first.chats.has(chat.id))
    await second.until(() => second.chats.has(other.id))
    await send(world, chat.id, "hi")
    await first.until(answered(first, chat.id, 1))
    await second.until(answered(second, chat.id, 1))
    expect(digest(first.chats.get(chat.id))).toBe(digest(second.chats.get(chat.id)))
    // Only the one following the other chat hears of it.
    expect(first.chats.has(other.id)).toBe(false)

    first.say({ type: "unfollow", chat: chat.id })
    await settled()
    const heard = first.heard.length
    await send(world, chat.id, "again")
    await second.until(answered(second, chat.id, 2))
    expect(first.heard.slice(heard).filter((message) => message.type === "chat")).toEqual([])
  })

  it("says a chat is gone where there is none, and follows no more than a few", async () => {
    const world = open()
    const chat = await setup(world)
    const client = await connect(world)
    client.say({ type: "follow", chat: "999" })
    client.say({ type: "follow", chat: "constructor" })
    await client.until(() => client.heard.filter((message) => message.type === "gone").length === 2)

    const ids = [chat.id]
    for (let made = 1; made < MAX_FOLLOWED_CHATS + 1; made++) {
      ids.push((await call<ChatSummary>(world, "/chats", "POST", {})).id)
    }
    for (const id of ids) client.say({ type: "follow", chat: id })
    await client.until(() => client.heard.at(-1)?.type === "gone")
    expect(client.chats.size).toBe(MAX_FOLLOWED_CHATS)
    expect(client.heard.at(-1)).toEqual({ type: "gone", chat: ids.at(-1) })

    expect(world.reports).toEqual([])
  })

  it("comes back to its sockets after being put away, without sending a chat again", async () => {
    const world = open(200)
    const chat = await setup(world)
    world.faux.setResponses([fauxAssistantMessage("One."), fauxAssistantMessage("Two, at length.")])
    const client = await connect(world)
    client.say({ type: "follow", chat: chat.id })
    await client.until(() => client.chats.has(chat.id))
    await send(world, chat.id, "hi")
    await client.until(answered(client, chat.id, 1))
    await settled()
    const ready = client.heard[0]!
    const docsBefore = {
      ...(ready.type === "agent" ? ready.docs : {}),
      ...Object.fromEntries(
        client.heard.flatMap((message) =>
          message.type === "agent" && message.event.type === "changed"
            ? [[message.event.what, message.at]]
            : [],
        ),
      ),
    }

    // Nothing of the agent is left in memory. Its socket is still connected.
    await world.namespace.evict("agent-1")
    const heard = client.heard.length
    await send(world, chat.id, "again")
    await client.until(answered(client, chat.id, 2))

    const since = client.heard.slice(heard)
    const resumed = since[0]!
    expect(resumed.type).toBe("resumed")
    if (resumed.type !== "resumed") throw new Error("unreachable")
    // Where it says the chat stands is what the client was holding, so nothing is asked again.
    const before = client.heard
      .slice(0, heard)
      .reduce(
        (state, message) =>
          message.type === "chat" && message.chat === chat.id
            ? reduceChat(state, message.event)
            : state,
        EMPTY_CHAT,
      )
    expect(resumed.chats).toEqual({ [chat.id]: digest(before) })
    // And where it says each document stands is the last the client was told of it.
    expect(resumed.docs).toEqual(docsBefore)
    // The second answer arrived as changes to what the client already had.
    const after = since.flatMap((message) => (message.type === "chat" ? [message.event.type] : []))
    expect(after).not.toContain("snapshot")
    expect(after.length).toBeGreaterThan(0)
    expect(client.chats.get(chat.id)!.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ])
    expect(digest(client.chats.get(chat.id))).toBe(
      digest(await call<ChatState>(world, `/chats/${chat.id}`)),
    )
    // The documents are told of again too.
    await call(world, "/", "PATCH", { name: "Juniper" })
    await client.until(() =>
      client.heard
        .slice(heard)
        .some(
          (message) =>
            message.type === "agent" &&
            message.event.type === "changed" &&
            message.event.what === "identity",
        ),
    )
    expect(world.reports).toEqual([])
  })

  it("sends a chat again to a client that asks again, as one out of step does", async () => {
    const world = open()
    const chat = await setup(world)
    const client = await connect(world)
    client.say({ type: "follow", chat: chat.id })
    await client.until(() => client.chats.has(chat.id))
    await world.namespace.evict("agent-1")
    client.say({ type: "follow", chat: chat.id })
    await client.until(() => kinds(client, chat.id).length === 2)
    expect(kinds(client, chat.id)).toEqual(["snapshot", "snapshot"])
    // What brought it back was the socket itself, and it was told where things stand first.
    expect(client.heard.map((message) => message.type)).toEqual([
      "agent",
      "chat",
      "resumed",
      "chat",
    ])
  })

  it("counts someone following a chat as there to see its answer, put away or not", async () => {
    const world = open()
    const chat = await setup(world)
    world.faux.setResponses([
      fauxAssistantMessage("Seen."),
      fauxAssistantMessage("Seen again."),
      fauxAssistantMessage("Unseen."),
    ])
    const client = await connect(world)
    client.say({ type: "follow", chat: chat.id })
    await client.until(() => client.chats.has(chat.id))
    await send(world, chat.id, "hi")
    await client.until(answered(client, chat.id, 1))
    await settled()
    await world.namespace.evict("agent-1")
    await send(world, chat.id, "again")
    await client.until(answered(client, chat.id, 2))
    await settled()
    expect(world.notified).toEqual([])

    client.close()
    await settled()
    await send(world, chat.id, "anyone?")
    const deadline = Date.now() + 8_000
    while (world.notified.length === 0 && Date.now() < deadline) await settled()
    expect(world.notified.map((notification) => notification.text)).toEqual(["Unseen."])
  })
})

describe("following a workspace's library over a socket", () => {
  it("says where the library stands: on connecting, when it changes, and on coming back", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dc-library-sockets-"))
    const libraries = new NodeActorNamespace({
      directory: join(directory, "libraries"),
      blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
      factory: (host) => createLibraryActor(host),
    })
    try {
      const heard: LibrarySocketMessage[] = []
      let waiting: (() => void)[] = []
      const server: SocketLike = {
        readyState: 1,
        send: (data) => {
          heard.push(JSON.parse(data) as LibrarySocketMessage)
          for (const look of waiting.splice(0)) look()
        },
        close: () => {},
        on: () => server,
      }
      const hears = (count: number) =>
        new Promise<void>((resolve) => {
          const look = () => (heard.length >= count ? resolve() : void waiting.push(look))
          look()
        })
      const put = (name: string) =>
        libraries.get("workspace-1").fetch(
          new Request(`http://library/library?name=${name}`, {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: "hello",
          }),
        )
      await libraries.connect("workspace-1", server, new Request("http://library/socket"))
      await hears(1)
      expect(heard).toEqual([{ type: "at", rev: 0 }])

      expect((await put("a.txt")).status).toBe(201)
      await hears(2)
      expect(heard[1]!.rev).toBeGreaterThan(0)

      // Put away and brought back by a read: the socket is told where things stand, which
      // is where they stood.
      await libraries.evict("workspace-1")
      const listing = await libraries
        .get("workspace-1")
        .fetch(new Request("http://library/library"))
      expect(listing.status).toBe(200)
      await hears(3)
      expect(heard[2]).toEqual(heard[1])

      expect((await put("b.txt")).status).toBe(201)
      await hears(4)
      expect(heard[3]!.rev).toBeGreaterThan(heard[2]!.rev)
    } finally {
      await libraries.close()
    }
  })
})

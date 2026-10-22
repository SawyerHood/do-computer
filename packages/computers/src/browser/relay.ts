import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PreviewSocket } from "./preview.ts"

/**
 * One DevTools socket to the owner's own browser, shared by everything here that speaks to it.
 *
 * A Chrome that was allowed from chrome://inspect asks its owner about every socket that is
 * opened to it, even while one they allowed is still open. So one is opened, once, and kept for
 * as long as the browser is there. dev-browser and the live view each get what looks to them
 * like a socket of their own: a session on the browser itself (`Target.attachToBrowserTarget`),
 * which has its own targets, its own sessions under it, and its own numbering of calls.
 */

export type RelayOptions = {
  log?: (line: string) => void
  /** Opens the one socket to the browser. Absent: a WebSocket. */
  openSocket?: (url: string) => PreviewSocket
}

export interface Relay {
  /** What dev-browser is told to connect to: a socket in a folder only this user can open. */
  readonly address: string
  /**
   * Resolves with "open" once the browser has let this in, with "asking" where its owner has
   * not answered within `waitMs`, and with "closed" where they said no or the browser went away.
   */
  answer(waitMs: number): Promise<"open" | "asking" | "closed">
  /** False once the browser said no or went away: this one is then of no more use. */
  alive(): boolean
  /** A socket of its own on the shared one, for something in this process. */
  open(): PreviewSocket
  /**
   * Hear of each page dev-browser acts on (goes to, brings to the front, types or clicks in, takes
   * a picture of): the page the agent is using, whichever tab the owner has in front.
   */
  onUse(listener: (targetId: string) => void): void
  close(): Promise<void>
}

type Json = Record<string, unknown>
const obj = (value: unknown): Json =>
  typeof value === "object" && value !== null ? (value as Json) : {}

/** Something that speaks DevTools through the shared socket as if it had one of its own. */
type Client = {
  /** The session on the browser that stands for this one's socket. None until the browser gives one. */
  session: string | null
  /** What it said before it had a session. */
  waiting: string[]
  gone: boolean
  /** dev-browser, over the socket of this machine, rather than something in this process. */
  agent: boolean
  deliver(message: string): void
  opened(): void
  ended(): void
}

type Call =
  | { client: Client; id: unknown; method: unknown; targetId?: string }
  | { settle(message: Json): void }

/** What is only done to a page that is being used, and never to one merely looked over. */
const ACTS = new Set([
  "Page.bringToFront",
  "Page.navigate",
  "Page.reload",
  "Page.navigateToHistoryEntry",
  "Page.captureScreenshot",
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
  "Input.dispatchTouchEvent",
  "Input.insertText",
])

const SOCKET_CONNECTING = 0
const SOCKET_OPEN = 1
const SOCKET_CLOSED = 3

export async function createRelay(url: string, options: RelayOptions = {}): Promise<Relay> {
  const log = options.log ?? (() => {})
  const openSocket =
    options.openSocket ?? ((to: string) => new WebSocket(to) as unknown as PreviewSocket)
  const clients = new Set<Client>()
  /** Whose each session is: a client's own, and those attached under it. */
  const owners = new Map<string, Client>()
  /** The page each session is on, for those that are on one. */
  const pages = new Map<string, string>()
  const users = new Set<(targetId: string) => void>()
  const calls = new Map<number, Call>()
  const waiters = new Set<() => void>()
  let state: "asking" | "open" | "closed" = "asking"
  let nextId = 0

  function used(targetId: string) {
    for (const listener of [...users]) listener(targetId)
  }

  // mkdtemp makes a folder that only this user can open: whoever can open the socket is let
  // into the browser without being asked.
  const folder = await mkdtemp(join(tmpdir(), "dc-cdp-"))
  const path = join(folder, "s")
  let server: Server | undefined

  /** Ask the browser something for the relay itself, on the socket's own session. */
  function ask(method: string, params: Json): Promise<Json> {
    return new Promise((resolve, reject) => {
      if (state !== "open") return reject(new Error("The browser is not connected."))
      const id = ++nextId
      calls.set(id, {
        settle(message) {
          if (message.error) reject(new Error(String(obj(message.error).message)))
          else resolve(obj(message.result))
        },
      })
      upstream.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Give a client its session on the browser, and pass on what it has said meanwhile. */
  function attach(client: Client) {
    ask("Target.attachToBrowserTarget", {}).then(
      (result) => {
        const session = String(result.sessionId)
        if (client.gone) {
          void ask("Target.detachFromTarget", { sessionId: session }).catch(() => {})
          return
        }
        client.session = session
        owners.set(session, client)
        client.opened()
        for (const raw of client.waiting.splice(0)) fromClient(client, raw)
      },
      () => leave(client, true),
    )
  }

  function enter(client: Client) {
    if (state === "closed") {
      // After whoever opened it has had the chance to listen.
      queueMicrotask(() => leave(client, true))
      return
    }
    clients.add(client)
    if (state === "open") attach(client)
  }

  /** A client is done with, by its own choice or the browser's. Its sessions are let go of. */
  function leave(client: Client, tell: boolean) {
    if (client.gone) return
    client.gone = true
    clients.delete(client)
    for (const [session, owner] of owners) {
      if (owner !== client) continue
      owners.delete(session)
      pages.delete(session)
    }
    for (const [id, call] of calls) if ("client" in call && call.client === client) calls.delete(id)
    // Detaching its session on the browser detaches everything it attached under it.
    if (client.session !== null && state === "open") {
      void ask("Target.detachFromTarget", { sessionId: client.session }).catch(() => {})
    }
    if (tell) client.ended()
  }

  function fromClient(client: Client, raw: string) {
    if (client.gone || state === "closed") return
    if (client.session === null) {
      client.waiting.push(raw)
      return
    }
    let message: Json
    try {
      message = obj(JSON.parse(raw))
    } catch {
      return
    }
    const session = typeof message.sessionId === "string" ? message.sessionId : undefined
    if (session !== undefined && owners.get(session) !== client) {
      // As the browser itself answers for a session it does not know.
      client.deliver(
        JSON.stringify({
          id: message.id,
          error: { code: -32001, message: "Session with given id not found." },
          sessionId: session,
        }),
      )
      return
    }
    const params = obj(message.params)
    if (client.agent) {
      const page = session === undefined ? undefined : pages.get(session)
      if (page !== undefined && typeof message.method === "string" && ACTS.has(message.method))
        used(page)
      else if (message.method === "Target.activateTarget" && typeof params.targetId === "string")
        used(params.targetId)
    }
    const id = ++nextId
    calls.set(id, {
      client,
      id: message.id,
      method: message.method,
      ...(typeof params.targetId === "string" ? { targetId: params.targetId } : {}),
    })
    upstream.send(JSON.stringify({ ...message, id, sessionId: session ?? client.session }))
  }

  function fromBrowser(raw: string) {
    const message = obj(JSON.parse(raw))
    if (typeof message.id === "number") {
      const call = calls.get(message.id)
      calls.delete(message.id)
      if (call === undefined) return
      if ("settle" in call) return call.settle(message)
      const client = call.client
      // A session the client attached itself is its own from here on.
      const result = obj(message.result)
      const made = result.sessionId
      if (
        typeof made === "string" &&
        (call.method === "Target.attachToTarget" || call.method === "Target.attachToBrowserTarget")
      ) {
        owners.set(made, client)
        if (call.method === "Target.attachToTarget" && call.targetId !== undefined)
          pages.set(made, call.targetId)
      }
      // A page dev-browser opened is one it is about to use.
      if (
        client.agent &&
        call.method === "Target.createTarget" &&
        typeof result.targetId === "string"
      ) {
        used(result.targetId)
      }
      const { sessionId, ...rest } = message
      client.deliver(
        JSON.stringify({
          ...rest,
          id: call.id,
          ...(sessionId === undefined || sessionId === client.session ? {} : { sessionId }),
        }),
      )
      return
    }
    // What happens on the socket's own session is nobody's: no client asked there.
    if (typeof message.sessionId !== "string") return
    const client = owners.get(message.sessionId)
    if (client === undefined) return
    const params = obj(message.params)
    if (typeof params.sessionId === "string") {
      if (message.method === "Target.attachedToTarget") {
        owners.set(params.sessionId, client)
        const targetId = obj(params.targetInfo).targetId
        if (typeof targetId === "string") pages.set(params.sessionId, targetId)
      } else if (message.method === "Target.detachedFromTarget") {
        owners.delete(params.sessionId)
        pages.delete(params.sessionId)
      }
    }
    const { sessionId, ...rest } = message
    if (sessionId === client.session) {
      client.deliver(JSON.stringify(rest))
    } else {
      // One message to a line is how dev-browser reads them.
      client.deliver(raw.includes("\n") ? JSON.stringify(message) : raw)
    }
  }

  function down(why?: string) {
    if (state === "closed") return
    log(
      why ??
        (state === "asking"
          ? "browser: the owner's own browser did not let itself be used"
          : "browser: the owner's own browser is no longer connected"),
    )
    state = "closed"
    calls.clear()
    for (const client of [...clients]) leave(client, true)
    for (const waiter of [...waiters]) waiter()
    server?.close()
    void rm(folder, { recursive: true, force: true }).catch(() => {})
  }

  const upstream = openSocket(url)
  upstream.addEventListener("open", () => {
    if (state !== "asking") return
    state = "open"
    for (const client of clients) attach(client)
    for (const waiter of [...waiters]) waiter()
  })
  upstream.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return
    try {
      fromBrowser(event.data)
    } catch {
      // A message that cannot be read is left out.
    }
  })
  upstream.addEventListener("close", () => down())
  upstream.addEventListener("error", () => down())

  // dev-browser speaks DevTools over a socket of this machine as it does over a WebSocket: one
  // message to a line.
  const listening = createServer((socket) => {
    socket.setEncoding("utf8")
    let unread = ""
    const client: Client = {
      session: null,
      waiting: [],
      gone: false,
      agent: true,
      deliver(message) {
        if (!socket.destroyed) socket.write(`${message}\n`)
      },
      opened() {},
      ended() {
        socket.destroy()
      },
    }
    socket.on("data", (chunk: string) => {
      unread += chunk
      for (let end = unread.indexOf("\n"); end >= 0; end = unread.indexOf("\n")) {
        const line = unread.slice(0, end)
        unread = unread.slice(end + 1)
        if (line !== "") fromClient(client, line)
      }
    })
    socket.on("error", () => {})
    socket.on("close", () => leave(client, false))
    enter(client)
  })
  server = listening
  try {
    await new Promise<void>((resolve, reject) => {
      listening.once("error", reject)
      listening.listen(path, resolve)
    })
  } catch (error) {
    upstream.close()
    down()
    throw error
  }

  return {
    address: `unix:${path}`,
    answer(waitMs) {
      if (state !== "asking") return Promise.resolve(state)
      return new Promise((resolve) => {
        const settle = () => {
          waiters.delete(settle)
          clearTimeout(timer)
          resolve(state)
        }
        const timer = setTimeout(settle, waitMs)
        timer.unref()
        waiters.add(settle)
      })
    },
    alive: () => state !== "closed",
    open() {
      const heard: { [type: string]: ((event: { data: unknown }) => void)[] } = {}
      const tell = (type: string, data?: unknown) => {
        for (const listener of heard[type] ?? []) listener({ data })
      }
      let readyState = SOCKET_CONNECTING
      const client: Client = {
        session: null,
        waiting: [],
        gone: false,
        agent: false,
        deliver: (message) => tell("message", message),
        opened() {
          readyState = SOCKET_OPEN
          tell("open")
        },
        ended() {
          readyState = SOCKET_CLOSED
          tell("close")
        },
      }
      enter(client)
      return {
        get readyState() {
          return readyState
        },
        send(data) {
          fromClient(client, data)
        },
        close() {
          if (readyState === SOCKET_CLOSED) return
          readyState = SOCKET_CLOSED
          leave(client, false)
          queueMicrotask(() => tell("close"))
        },
        addEventListener(type: string, listener: (event: { data: unknown }) => void) {
          ;(heard[type] ??= []).push(listener)
        },
      }
    },
    onUse(listener) {
      users.add(listener)
    },
    async close() {
      if (state !== "closed") {
        // The browser lets go of every session when its socket closes.
        upstream.close()
        down("browser: let go of the owner's own browser")
      }
      await new Promise<void>((resolve) => listening.close(() => resolve()))
    },
  }
}

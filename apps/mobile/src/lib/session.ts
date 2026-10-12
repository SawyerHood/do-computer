import { type Client, createClient, type SocketConstructor } from "@durable-computer/client"
import { expoClient } from "@better-auth/expo/client"
import { createAuthClient } from "better-auth/react"
import { fetch as expoFetch } from "expo/fetch"
import * as SecureStore from "expo-secure-store"
import { atom, getDefaultStore } from "jotai"
import { AppState, Platform } from "react-native"
import { storage } from "./storage.ts"

const SERVER_KEY = "dc.server"
const AGENT_KEY = "dc.agent"
const SCHEME = "durablecomputer"

/** Where the app is hosted for everyone. Someone who hosts their own names it when signing in. */
export const DEFAULT_SERVER = "https://do.computer"

/** A browser build is served by the deployment it talks to; a device has to be told where that is. */
const initialServer =
  Platform.OS === "web" ? (globalThis.location?.origin ?? null) : storage.get(SERVER_KEY)

/** The deployment this app is connected to, without a trailing slash; null until one is chosen. */
export const serverAtom = atom<string | null>(initialServer)
/** The agent whose chats are on screen. */
export const agentIdAtom = atom<string | null>(storage.get(AGENT_KEY))

const store = getDefaultStore()

export function setServer(url: string | null): void {
  if (url === null) storage.remove(SERVER_KEY)
  else storage.set(SERVER_KEY, url)
  store.set(serverAtom, url)
}

export function setAgentId(agentId: string | null): void {
  if (agentId === null) storage.remove(AGENT_KEY)
  else storage.set(AGENT_KEY, agentId)
  store.set(agentIdAtom, agentId)
}

/** Tidy what someone typed into an address: add the scheme, drop trailing slashes. */
export function normalizeServer(input: string): string | undefined {
  const trimmed = input.trim().replace(/\/+$/, "")
  if (trimmed === "") return undefined
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    return `${url.protocol}//${url.host}`
  } catch {
    return undefined
  }
}

function createAuth(server: string) {
  return createAuthClient({
    baseURL: server,
    // On a device the session cookie is kept in the secure store and sent by hand; a browser
    // keeps its own.
    plugins:
      Platform.OS === "web"
        ? []
        : [expoClient({ scheme: SCHEME, storagePrefix: "dc", storage: SecureStore })],
  })
}

export type Auth = ReturnType<typeof createAuth>
export type Session = { server: string; auth: Auth; client: Client }

let current: Session | undefined

/** The session cookie each auth client was last seen to hold, as a header's value. */
const cookies = new WeakMap<Auth, string>()

/**
 * The session cookie as it is now, read from where the auth client keeps it. On a phone that is
 * the secure store, which is read without blocking, so this cannot be had at once.
 */
async function readCookie(auth: Auth): Promise<string> {
  if (Platform.OS === "web") return ""
  const cookie = await (auth as unknown as { getCookie(): Promise<string> }).getCookie()
  cookies.set(auth, cookie)
  return cookie
}

/**
 * The session cookie as a header's value, for what cannot wait for it: the one last read, which
 * every request to the server reads again. "" where the platform keeps its own, and before the
 * first request.
 */
export const cookieOf = (auth: Auth): string => cookies.get(auth) ?? ""

/** The headers that carry the session, for what fetches by itself: a picture, a web view, a download. */
export const authHeaders = (auth: Auth): Record<string, string> => {
  const cookie = cookieOf(auth)
  return cookie ? { cookie } : {}
}

/**
 * A WebSocket that carries the session. A phone's own sends no cookie, so the server would take
 * it for nobody's; React Native's takes headers as a third argument, which a browser's does not.
 */
function socketFor(server: string, auth: Auth) {
  const Native = WebSocket as unknown as new (
    url: string,
    protocols?: string[] | null,
    options?: { headers: Record<string, string> },
  ) => WebSocket
  return class SessionSocket extends Native {
    constructor(url: string) {
      super(url, null, { headers: { cookie: cookieOf(auth), origin: server } })
    }
  }
}

/** The auth and API clients for a server. One pair per server address, reused across screens. */
export function sessionFor(server: string): Session {
  if (current?.server === server) return current
  const auth = createAuth(server)
  const native = Platform.OS !== "web"
  const client = createClient({
    baseUrl: server,
    // The platform fetch on a device cannot stream a response body; Expo's can.
    fetch: native ? (expoFetch as unknown as typeof fetch) : undefined,
    credentials: native ? "omit" : "include",
    headers: async (): Promise<Record<string, string>> => {
      const cookie = await readCookie(auth)
      return cookie ? { cookie } : {}
    },
    // Agents are followed over sockets, which do not keep them in memory on the server as
    // event streams do, and the list of agents hears of each over the person's own feed.
    sockets: true,
    webSocket: native ? (socketFor(server, auth) as unknown as SocketConstructor) : undefined,
    // An app that is not in front is not being looked at: what it follows is let go of after
    // a while, and taken up again when it comes back.
    attention: native
      ? {
          here: () => AppState.currentState === "active",
          watch: (changed) => {
            const subscription = AppState.addEventListener("change", changed)
            return () => subscription.remove()
          },
        }
      : undefined,
  })
  current = { server, auth, client }
  return current
}

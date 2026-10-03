import { type Client, createClient } from "@durable-computer/client"
import { expoClient } from "@better-auth/expo/client"
import { createAuthClient } from "better-auth/react"
import { fetch as expoFetch } from "expo/fetch"
import * as SecureStore from "expo-secure-store"
import { atom, getDefaultStore } from "jotai"
import { Platform } from "react-native"
import { storage } from "./storage.ts"

const SERVER_KEY = "dc.server"
const AGENT_KEY = "dc.agent"
const SCHEME = "durablecomputer"

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
    headers: (): Record<string, string> => {
      const cookie = native ? (auth as unknown as { getCookie(): string }).getCookie() : ""
      return cookie ? { cookie } : {}
    },
  })
  current = { server, auth, client }
  return current
}

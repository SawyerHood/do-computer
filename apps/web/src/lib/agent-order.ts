import type { DoodOrder } from "@do-computer/protocol"
import { atom, getDefaultStore } from "jotai"
import { useEffect } from "react"
import { client } from "./client.ts"

const store = getDefaultStore()

/**
 * Where this browser kept the order before the server did: for each workspace, its Doods' ids
 * from the top down. It is read once, carried up to the server, and then let go.
 */
export const AGENT_ORDER_KEY = "dc-agent-order"

const agentOrder = atom<DoodOrder>({})

/**
 * Writes of this tab's to each workspace's order that the server has not answered yet. While
 * there are any, what the feed says of that workspace is this tab's own word coming back, and
 * may be an older one than the last: the answer to the last write is taken instead.
 */
const pending = new Map<string, Promise<unknown>>()
const inFlight = new Map<string, number>()

function set(workspaceId: string, ids: readonly string[] | null) {
  store.set(agentOrder, (kept) => {
    const { [workspaceId]: _was, ...rest } = kept
    return ids === null ? rest : { ...rest, [workspaceId]: ids }
  })
}

/**
 * Send a workspace's order to the server, after whatever this tab sent it before, so that the
 * last one written is the last one kept.
 */
function send(workspaceId: string, ids: readonly string[] | null) {
  inFlight.set(workspaceId, (inFlight.get(workspaceId) ?? 0) + 1)
  const before = pending.get(workspaceId) ?? Promise.resolve()
  const sent = before
    .catch(() => {})
    .then(() => client.workspace(workspaceId).putAgentOrder(ids))
    .then(
      (kept) => {
        if (inFlight.get(workspaceId) === 1) set(workspaceId, kept)
      },
      () => {
        // It did not stand. What the server has is what every other device shows, so this
        // one goes back to it rather than keep an order nobody else has.
        if (inFlight.get(workspaceId) === 1) void loadAgentOrder()
      },
    )
    .finally(() => {
      const left = (inFlight.get(workspaceId) ?? 1) - 1
      if (left === 0) inFlight.delete(workspaceId)
      else inFlight.set(workspaceId, left)
      if (pending.get(workspaceId) === sent) pending.delete(workspaceId)
    })
  pending.set(workspaceId, sent)
}

/**
 * The order each workspace's agents were put in by hand, by workspace: their ids, the top one
 * first. A workspace that is not here was never put in order, and has the one last heard from
 * first. It is the person's own and kept on the server, so every browser, the desktop app and
 * the phone have the same. Writing a list keeps it, and writing none gives it up; the sidebar
 * moves at once and the server is told after.
 */
export const agentOrderAtom = atom(
  (get) => get(agentOrder),
  (_get, _set, workspaceId: string, ids: readonly string[] | undefined) => {
    set(workspaceId, ids ?? null)
    send(workspaceId, ids ?? null)
  },
)

/** What the feed said: the person put a workspace in order on another tab or device. */
export function takeAgentOrder(workspaceId: string, ids: readonly string[] | null): void {
  if (inFlight.has(workspaceId)) return
  set(workspaceId, ids)
}

let loading: Promise<void> | undefined

/** Ask the server for the whole order again, keeping what this tab is still sending. */
export function loadAgentOrder(): Promise<void> {
  loading ??= client
    .agentOrder()
    .then((order) => {
      store.set(agentOrder, (kept) => {
        const next: Record<string, readonly string[]> = { ...order }
        for (const workspaceId of inFlight.keys()) {
          const mine = kept[workspaceId]
          if (mine === undefined) delete next[workspaceId]
          else next[workspaceId] = mine
        }
        return next
      })
    })
    // Asked for again the next time the feed connects, or the page is loaded.
    .catch(() => {})
    .finally(() => {
      loading = undefined
    })
  return loading
}

function keptInBrowser(): DoodOrder {
  try {
    const found: unknown = JSON.parse(localStorage.getItem(AGENT_ORDER_KEY) ?? "{}")
    if (typeof found !== "object" || found === null) return {}
    return Object.fromEntries(
      Object.entries(found).filter((entry): entry is [string, string[]] => {
        return Array.isArray(entry[1]) && entry[1].every((id) => typeof id === "string")
      }),
    )
  } catch {
    // Storage can be unavailable, or hold something else; then there is nothing to carry.
    return {}
  }
}

/**
 * Carry up what this browser kept before the server kept the order, once. An order stands on
 * the server only for a workspace that has none there yet, so a second browser that kept one of
 * its own does not undo the first. A workspace the person has left since is refused, and let go.
 */
async function carryUp(): Promise<void> {
  const kept = keptInBrowser()
  const workspaces = Object.keys(kept)
  if (workspaces.length === 0) return
  const results = await Promise.allSettled(
    workspaces.map(async (workspaceId) => {
      const ids = await client
        .workspace(workspaceId)
        .putAgentOrder(kept[workspaceId]!, { carried: true })
      if (!inFlight.has(workspaceId)) set(workspaceId, ids)
    }),
  )
  // A failure that is not a refusal is tried again on the next page load.
  const again = results.some(
    (result) =>
      result.status === "rejected" &&
      !(typeof result.reason === "object" && result.reason?.status === 404),
  )
  if (again) return
  try {
    localStorage.removeItem(AGENT_ORDER_KEY)
  } catch {
    // Then it is carried again next time, and the server keeps what it has.
  }
}

/** Keep the order from the server for as long as the signed-in app is up. */
export function useAgentOrder(userId: string): void {
  useEffect(() => {
    void loadAgentOrder().then(carryUp)
  }, [userId])
}

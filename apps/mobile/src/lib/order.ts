import type { DoodOrder } from "@do-computer/protocol"
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { useSession } from "./use-session.ts"

/** Where the order is kept among what is fetched from the server. */
export const orderKey = ["agent-order"] as const

/**
 * Writes of this phone's to each workspace's order that the server has not answered yet. While
 * there are any, what the feed says of that workspace is this phone's own word coming back, and
 * may be older than the last: the answer to the last write is taken instead.
 */
const inFlight = new Map<string, number>()
const pending = new Map<string, Promise<unknown>>()

function set(queryClient: QueryClient, workspaceId: string, ids: readonly string[] | null) {
  queryClient.setQueryData<DoodOrder>(orderKey, (kept = {}) => {
    const { [workspaceId]: _was, ...rest } = kept
    return ids === null ? rest : { ...rest, [workspaceId]: ids }
  })
}

/** What the feed said: the person put a workspace in order in a browser or on another phone. */
export function takeOrder(
  queryClient: QueryClient,
  workspaceId: string,
  ids: readonly string[] | null,
): void {
  if (inFlight.has(workspaceId)) return
  set(queryClient, workspaceId, ids)
}

/**
 * The order the person put each workspace's Doods in by hand: the web app's, the desktop app's
 * and this phone's, which are one, kept on the server. A workspace that is not in it has its
 * Doods latest-first. `put` moves them at once and tells the server after, one write after
 * another, so that the last one made is the one kept; null gives the order up.
 */
export function useDoodOrder() {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const order = useQuery<DoodOrder>({ queryKey: orderKey, queryFn: () => client.agentOrder() })
  const put = useCallback(
    (workspaceId: string, ids: readonly string[] | null) => {
      set(queryClient, workspaceId, ids)
      inFlight.set(workspaceId, (inFlight.get(workspaceId) ?? 0) + 1)
      const sent = (pending.get(workspaceId) ?? Promise.resolve())
        .catch(() => {})
        .then(() => client.workspace(workspaceId).putAgentOrder(ids))
        .then(
          (kept) => {
            if (inFlight.get(workspaceId) === 1) set(queryClient, workspaceId, kept)
          },
          () => {
            // It did not stand: what the server has is what every other device shows.
            if (inFlight.get(workspaceId) === 1) {
              void queryClient.invalidateQueries({ queryKey: orderKey })
            }
          },
        )
        .finally(() => {
          const left = (inFlight.get(workspaceId) ?? 1) - 1
          if (left === 0) inFlight.delete(workspaceId)
          else inFlight.set(workspaceId, left)
          if (pending.get(workspaceId) === sent) pending.delete(workspaceId)
        })
      pending.set(workspaceId, sent)
    },
    [client, queryClient],
  )
  return { order: order.data, put, refetch: order.refetch }
}

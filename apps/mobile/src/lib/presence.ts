import type { PresenceLink } from "@do-computer/client"
import type { Presence, PresenceUpdate } from "@do-computer/protocol"
import { useQueryClient } from "@tanstack/react-query"
import { atom, getDefaultStore, useAtomValue } from "jotai"
import { useEffect } from "react"
import { keys } from "./queries.ts"
import { useSession } from "./use-session.ts"

const store = getDefaultStore()

/** Who is where in each team right now, one entry for each place a person has open. */
const hereAtom = atom<Readonly<Record<string, readonly Presence[]>>>({})

const links = new Map<string, PresenceLink>()

/**
 * Join the presence of the teams the person is in, for as long as the signed-in app is open:
 * hear where everyone is, and that a team changed.
 */
export function usePresence(workspaceIds: readonly string[]): void {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const wanted = workspaceIds.join("\n")
  useEffect(() => {
    const ids = wanted === "" ? [] : wanted.split("\n")
    for (const id of ids) {
      if (links.has(id)) continue
      links.set(
        id,
        client.workspace(id).presence((event) => {
          if (event.type === "presence") {
            store.set(hereAtom, (kept) => ({ ...kept, [id]: event.here }))
          } else {
            void queryClient.invalidateQueries({ queryKey: keys.workspaces })
            void queryClient.invalidateQueries({ queryKey: keys.agents, exact: true })
          }
        }),
      )
    }
    for (const [id, link] of links) {
      if (ids.includes(id)) continue
      link.close()
      links.delete(id)
    }
  }, [client, queryClient, wanted])
  useEffect(
    () => () => {
      for (const link of links.values()) link.close()
      links.clear()
      store.set(hereAtom, {})
    },
    [client],
  )
}

/** Everyone who has a team open, by workspace. */
export const useHere = () => useAtomValue(hereAtom)

/** Tell a team where this phone is: which agent and chat is open, and whether a message is being written. */
export function sayWhere(workspaceId: string | undefined, where: PresenceUpdate): void {
  if (workspaceId !== undefined) links.get(workspaceId)?.update(where)
}

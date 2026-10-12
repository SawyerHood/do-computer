import type { CreatureState, Outfit } from "@durable-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo } from "react"
import { keys } from "@/lib/queries"
import { useSession } from "@/lib/use-session"

export { boxProgress, foundLine, SLOT_NAMES } from "./words"

/** How long after a box was due it is asked for, and how soon again where this clock is ahead of the server's. */
const DUE_GRACE_MS = 500
const DUE_AGAIN_MS = 60_000

/**
 * What an agent's creature has been given and has on. Undefined until it has been heard from.
 * It is asked for again when its next box is due, as on the web, so that the box turns up while
 * the page is open; otherwise the agent's event socket says when it has changed.
 */
export function useCreature(agentId: string, enabled = true): CreatureState | undefined {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const { data, dataUpdatedAt } = useQuery<CreatureState>({
    queryKey: keys.creature(agentId),
    queryFn: () => client.agent(agentId).creature(),
    enabled,
  })
  const due = data?.nextBoxAt
  // biome-ignore lint/correctness/useExhaustiveDependencies: armed again by each answer, the same one included
  useEffect(() => {
    if (due === undefined) return
    const wait = due - Date.now()
    const timer = setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: keys.creature(agentId) }),
      wait > 0 ? wait + DUE_GRACE_MS : DUE_AGAIN_MS,
    )
    return () => clearTimeout(timer)
  }, [agentId, due, dataUpdatedAt, queryClient])
  return data
}

/**
 * What can be done for an agent's creature: give it a treat, open a box, dress it. Each shows
 * what it did at once, wherever the creature's state is read, and then takes the server's word.
 */
export function useCare(agentId: string) {
  const { client } = useSession()
  const queryClient = useQueryClient()
  return useMemo(() => {
    const key = keys.creature(agentId)
    const set = (change: (state: CreatureState) => CreatureState) =>
      queryClient.setQueryData<CreatureState>(key, (state) =>
        state === undefined ? state : change(state),
      )
    const refetch = () => void queryClient.invalidateQueries({ queryKey: key })
    return {
      /** Give it a treat. There is always one to give, and all it comes to is the count of them. */
      feed: async (): Promise<void> => {
        set((state) => ({ ...state, fed: state.fed + 1 }))
        try {
          queryClient.setQueryData(key, await client.agent(agentId).feedCreature())
        } catch {
          // It could not be reached: what is true is asked for.
          refetch()
        }
      },
      /** Open one of its boxes. Answers with the id of what was inside. */
      open: async (): Promise<string> => {
        const { item, creature } = await client.agent(agentId).openBox()
        queryClient.setQueryData(key, creature)
        return item
      },
      /** Dress it. It is shown dressed at once, wherever its agent is drawn. */
      wear: async (outfit: Outfit): Promise<void> => {
        set((state) => ({ ...state, outfit }))
        try {
          queryClient.setQueryData(key, await client.agent(agentId).wear(outfit))
        } catch {
          refetch()
        }
        // Every drawing of the agent is given what it has on with the rest of what it is.
        void queryClient.invalidateQueries({ queryKey: keys.agents, exact: true })
        void queryClient.invalidateQueries({ queryKey: keys.agent(agentId) })
      },
    }
  }, [agentId, client, queryClient])
}

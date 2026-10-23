import {
  type AgentSummary,
  BOX_EVERY_MS,
  type CreatureState,
  type Outfit,
} from "@do-computer/protocol"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { useQuery } from "@tanstack/react-query"
import { atom } from "jotai"
import { useEffect } from "react"
import { client } from "./client.ts"
import { agentKey, agentsCollection, agentsKey, creatureKey, creatureQuery } from "./collections.ts"
import { queryClient } from "./query.ts"
import { useListedAgent } from "./workspaces.ts"

/**
 * The creature's windows over the agent's pages: its wardrobe, and a box of its being opened,
 * which opens over the wardrobe when that is where it was pressed. Not in the address, as the
 * settings are: neither is somewhere to come back to.
 */
export const creatureWardrobeAtom = atom(false)
export const creatureBoxAtom = atom(false)

/** How long after a box was due it is asked for, and how soon again where this clock is ahead of the server's. */
const DUE_GRACE_MS = 500
const DUE_AGAIN_MS = 60_000

/**
 * What an agent's creature has been given and has on. Undefined until it has been heard from.
 * It is asked for again when its next box is due, so that the box turns up while the page is open.
 * While a box of its own waits there is no next one, and nothing to ask for.
 */
export function useCreature(agentId: string, enabled = true): CreatureState | undefined {
  const { data, dataUpdatedAt } = useQuery({ ...creatureQuery(agentId), enabled })
  const due = data?.nextBoxAt
  useEffect(() => {
    if (due === undefined) return
    const wait = due - Date.now()
    const timer = setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: creatureKey(agentId) }),
      wait > 0 ? wait + DUE_GRACE_MS : DUE_AGAIN_MS,
    )
    return () => clearTimeout(timer)
    // Armed again by each answer, the same one included: the server may not have got there yet.
  }, [agentId, due, dataUpdatedAt])
  return data
}

/** How far along its next box is, from 0 to 1, and about how long is left, in words. */
export function boxProgress(state: Pick<CreatureState, "nextBoxAt">, now = Date.now()) {
  const left = Math.max(0, (state.nextBoxAt ?? now + BOX_EVERY_MS) - now)
  const hours = Math.round(left / 3_600_000)
  const minutes = Math.max(1, Math.round(left / 60_000))
  return {
    part: Math.min(1, Math.max(0, 1 - left / BOX_EVERY_MS)),
    left:
      minutes < 60
        ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
        : `${hours} ${hours === 1 ? "hour" : "hours"}`,
  }
}

const set = (agentId: string, change: (state: CreatureState) => CreatureState) =>
  queryClient.setQueryData<CreatureState>(creatureKey(agentId), (state) =>
    state === undefined ? state : change(state),
  )
const refetch = (agentId: string) =>
  void queryClient.invalidateQueries({ queryKey: creatureKey(agentId) })

/**
 * Give the creature a treat. There is always one to give, and all it comes to is the count of
 * them, which is shown at once and asked for after: the treat is already on its way to its mouth.
 */
export async function feedCreature(agentId: string): Promise<void> {
  set(agentId, (state) => ({ ...state, fed: state.fed + 1 }))
  try {
    const state = await client.agent(agentId).feedCreature()
    queryClient.setQueryData(creatureKey(agentId), state)
  } catch {
    // It could not be reached: what is true is asked for.
    refetch(agentId)
  }
}

/**
 * Every Dood of the workspace an agent is in that has hatched, the agent among them, as the list
 * of agents has them: who shares its wardrobe.
 */
export function useWardrobeDoods(agentId: string): AgentSummary[] {
  const workspaceId = useListedAgent(agentId)?.workspaceId
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ agent: agentsCollection })
        .where(({ agent }) => eq(agent.workspaceId, workspaceId ?? "")),
    [workspaceId],
  )
  return (data ?? []).filter((agent) => agent.hatched)
}

/**
 * Open one of its workspace's boxes. Answers with the id of what was inside. The wardrobe is its
 * workspace's, so every other Dood's is asked for again: it has the thing in it too.
 */
export async function openBox(agentId: string): Promise<string> {
  const { item, creature } = await client.agent(agentId).openBox()
  queryClient.setQueryData(creatureKey(agentId), creature)
  void queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === "agents" && queryKey[2] === "creature" && queryKey[1] !== agentId,
  })
  return item
}

/** Dress the creature. It is shown dressed at once, wherever its agent is drawn. */
export async function wear(agentId: string, outfit: Outfit): Promise<void> {
  set(agentId, (state) => ({ ...state, outfit }))
  try {
    const state = await client.agent(agentId).wear(outfit)
    queryClient.setQueryData(creatureKey(agentId), state)
  } catch {
    refetch(agentId)
  }
  // Every drawing of the agent is given what it has on with the rest of what it is.
  void queryClient.invalidateQueries({ queryKey: agentsKey, exact: true })
  void queryClient.invalidateQueries({ queryKey: agentKey(agentId) })
}

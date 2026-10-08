import {
  type CreatureState,
  hasEverything,
  type Outfit,
  TREATS_PER_BOX,
} from "@durable-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { atom } from "jotai"
import { client } from "./client.ts"
import { agentKey, agentsKey, creatureKey, creatureQuery } from "./collections.ts"
import { queryClient } from "./query.ts"

/**
 * Which of the creature's windows is open over the agent's pages: its wardrobe, or a box of its
 * being opened. Not in the address, as the settings are: neither is somewhere to come back to.
 */
export const creatureWindowAtom = atom<"wardrobe" | "box" | null>(null)

/** What an agent's creature has been given and has on. Undefined until it has been heard from. */
export function useCreature(agentId: string, enabled = true): CreatureState | undefined {
  return useQuery({ ...creatureQuery(agentId), enabled }).data
}

const set = (agentId: string, change: (state: CreatureState) => CreatureState) =>
  queryClient.setQueryData<CreatureState>(creatureKey(agentId), (state) =>
    state === undefined ? state : change(state),
  )
const refetch = (agentId: string) =>
  void queryClient.invalidateQueries({ queryKey: creatureKey(agentId) })

/**
 * Give the creature one of its treats. What that comes to is shown at once and asked for after:
 * the treat is already on its way to its mouth.
 */
export async function feedCreature(agentId: string): Promise<void> {
  set(agentId, (state) => {
    if (state.treats <= 0) return state
    const joy = state.joy + 1
    const box = !hasEverything(state.owned) && joy >= TREATS_PER_BOX
    return {
      ...state,
      treats: state.treats - 1,
      fed: state.fed + 1,
      joy: box ? 0 : hasEverything(state.owned) ? state.joy : joy,
      boxes: state.boxes + (box ? 1 : 0),
    }
  })
  try {
    const state = await client.agent(agentId).feedCreature()
    queryClient.setQueryData(creatureKey(agentId), state)
  } catch {
    // Someone else gave it the last one, or it could not be reached: what is true is asked for.
    refetch(agentId)
  }
}

/** Open one of its boxes. Answers with the id of what was inside. */
export async function openBox(agentId: string): Promise<string> {
  const { item, creature } = await client.agent(agentId).openBox()
  queryClient.setQueryData(creatureKey(agentId), creature)
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

import { useNavigate } from "@tanstack/react-router"
import { atom, getDefaultStore, useAtomValue } from "jotai"
import { useCallback, useState } from "react"
import { rememberMainChat } from "./chats.ts"
import { client } from "./client.ts"
import { agentsKey, listAgent } from "./collections.ts"
import { queryClient } from "./query.ts"

const store = getDefaultStore()

/**
 * The workspaces an agent is being made in right now, by id. Kept for the whole page and not by
 * the button that was pressed: the sidebar holds a row for the agent while it is on its way,
 * whichever button that was.
 */
const makingAtom = atom<readonly string[]>([])

/** Whether an agent is being made in a workspace right now. */
export const useMakingAgent = (workspaceId: string): boolean =>
  useAtomValue(makingAtom).includes(workspaceId)

/**
 * Makes an agent in a workspace and opens it. `making` is true from the press until the agent
 * is made, and `error` says why there is none where it could not be. The server sends the agent
 * and its main chat, so the agent is put in the list and its chat is opened from what came
 * back: asking for the list again waits for every agent there is.
 */
export function useNewAgent(workspaceId: string, onNavigate?: () => void) {
  const navigate = useNavigate()
  const making = useMakingAgent(workspaceId)
  const [error, setError] = useState<string>()
  const create = useCallback(async () => {
    // One at a time in a workspace: a second press while the first is on its way is the same one.
    if (store.get(makingAtom).includes(workspaceId)) return
    store.set(makingAtom, (ids) => [...ids, workspaceId])
    setError(undefined)
    try {
      const { agent, chat } = await client.makeAgent(workspaceId)
      listAgent(agent)
      // A list that was on its way from before the agent was made would leave it out.
      void queryClient.invalidateQueries({ queryKey: agentsKey, exact: true })
      if (chat !== undefined) rememberMainChat(agent.id, chat.id)
      onNavigate?.()
      // Not waited for: the agent is in the list from here, and its page says what it waits on.
      void (chat === undefined
        ? navigate({ to: "/a/$agentId", params: { agentId: agent.id } })
        : navigate({ to: "/a/$agentId/c/$chatId", params: { agentId: agent.id, chatId: chat.id } }))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The Dood could not be made.")
    } finally {
      store.set(makingAtom, (ids) => ids.filter((id) => id !== workspaceId))
    }
  }, [workspaceId, onNavigate, navigate])
  return { create, making, error }
}

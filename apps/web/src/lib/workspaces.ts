import type { PresenceLink } from "@durable-computer/client"
import {
  type AgentSummary,
  isPersonalWorkspace,
  type Person,
  type Presence,
  type WorkspacesState,
  type WorkspaceSummary,
} from "@durable-computer/protocol"
import { queryOptions, useQuery } from "@tanstack/react-query"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { atom, getDefaultStore, useAtomValue } from "jotai"
import { createContext, useEffect, useMemo } from "react"
import { client } from "./client.ts"
import { agentsCollection, agentsKey } from "./collections.ts"
import { queryClient } from "./query.ts"

export const workspacesKey = ["workspaces"] as const
export const invitationsKey = (workspaceId: string) =>
  ["workspaces", workspaceId, "invitations"] as const

export const workspaceOptionsKey = (workspaceId: string) =>
  ["workspaces", workspaceId, "settings"] as const

export const workspacesQuery = queryOptions({
  queryKey: workspacesKey,
  queryFn: () => client.workspaces(),
})

/** The user's workspaces and the invitations waiting for them. */
export function useWorkspaces(): WorkspacesState | undefined {
  return useQuery(workspacesQuery).data
}

export function useWorkspace(workspaceId: string | undefined): WorkspaceSummary | undefined {
  return useWorkspaces()?.workspaces.find((workspace) => workspace.id === workspaceId)
}

/**
 * An agent as the list of agents has it. That list is here before any one agent's own state is,
 * so the agent's name, creature and color can be drawn from it while the rest is on its way.
 */
export function useListedAgent(agentId: string | undefined): AgentSummary | undefined {
  const { data } = useLiveQuery(
    (q) => q.from({ agent: agentsCollection }).where(({ agent }) => eq(agent.id, agentId ?? "")),
    [agentId],
  )
  return data?.[0]
}

/** The workspace an agent is in, once the lists of agents and workspaces have arrived. */
export function useWorkspaceOfAgent(agentId: string): WorkspaceSummary | undefined {
  return useWorkspace(useListedAgent(agentId)?.workspaceId)
}

/**
 * The team a chat is in, for the parts of it that show who said what: which user is reading,
 * and everyone in the team by id. Undefined in a personal workspace, where it is only ever you.
 */
export const TeamContext = createContext<{ meId: string; people: Map<string, Person> } | undefined>(
  undefined,
)

/** Everything that depends on who is in a team and what it holds. */
export function refreshWorkspaces(): void {
  void queryClient.invalidateQueries({ queryKey: workspacesKey })
  void queryClient.invalidateQueries({ queryKey: agentsKey })
}

const store = getDefaultStore()
const hereAtoms = new Map<string, ReturnType<typeof atom<Presence[]>>>()
const NOBODY: Presence[] = []
const nowhere = atom<Presence[]>(NOBODY)

/** Who is where in one team right now, fed by its presence socket. */
function hereAtom(workspaceId: string) {
  let existing = hereAtoms.get(workspaceId)
  if (existing === undefined) {
    existing = atom<Presence[]>(NOBODY)
    hereAtoms.set(workspaceId, existing)
  }
  return existing
}

/** The team this tab is connected to, if any. One at a time: the one on screen. */
let current: { workspaceId: string; link: PresenceLink; where: Where } | undefined

type Where = { agentId: string | null; chatId: string | null }
const TYPING_MS = 4_000
let typingTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Be present in a team for as long as the component is mounted, saying where this tab is. A
 * personal workspace has nobody to be present for, so nothing is opened for one.
 */
export function usePresence(workspaceId: string | undefined, where: Where): void {
  const team =
    workspaceId !== undefined && !isPersonalWorkspace(workspaceId) ? workspaceId : undefined
  useEffect(() => {
    if (team === undefined) return
    const link = client.workspace(team).presence((event) => {
      if (event.type === "presence") store.set(hereAtom(team), event.here)
      else {
        refreshWorkspaces()
        void queryClient.invalidateQueries({ queryKey: invitationsKey(team) })
      }
    })
    const mine = { workspaceId: team, link, where: { agentId: null, chatId: null } }
    current = mine
    return () => {
      link.close()
      if (current === mine) current = undefined
      store.set(hereAtom(team), NOBODY)
    }
  }, [team])
  useEffect(() => {
    if (current === undefined || current.workspaceId !== team) return
    clearTimeout(typingTimer)
    current.where = { agentId: where.agentId, chatId: where.chatId }
    current.link.update({ ...current.where, typing: false })
  }, [team, where.agentId, where.chatId])
}

/** Say that the user is writing in the chat this tab has open. It lapses when they pause. */
export function noteTyping(typing: boolean): void {
  if (current === undefined || current.where.chatId === null) return
  const link = current
  clearTimeout(typingTimer)
  link.link.update({ ...link.where, typing })
  if (typing) {
    typingTimer = setTimeout(() => link.link.update({ ...link.where, typing: false }), TYPING_MS)
  }
}

/** Everyone who is somewhere in a team right now, one entry for each place they have open. */
export function useHere(workspaceId: string | undefined): Presence[] {
  return useAtomValue(
    workspaceId === undefined || isPersonalWorkspace(workspaceId) ? nowhere : hereAtom(workspaceId),
  )
}

/** The people of a workspace by id, for putting a face to a message or a place. */
export function usePeople(workspace: WorkspaceSummary | undefined): Map<string, Person> {
  return useMemo(
    () => new Map((workspace?.members ?? []).map((member) => [member.id, member])),
    [workspace],
  )
}

/** The ids of the people for whom `matches` holds somewhere, each once, in the order they came. */
export function whoIs(here: readonly Presence[], matches: (place: Presence) => boolean): string[] {
  const ids: string[] = []
  for (const place of here) {
    if (matches(place) && !ids.includes(place.userId)) ids.push(place.userId)
  }
  return ids
}

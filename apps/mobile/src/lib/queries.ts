import type { AgentState, Me } from "@durable-computer/client"
import type { AgentSummary, FeedEvent, WorkspacesState } from "@durable-computer/protocol"
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query"
import { atom, getDefaultStore, useAtomValue } from "jotai"
import { useEffect } from "react"
import type { Session } from "./session.ts"
import { useSession } from "./use-session.ts"

/**
 * The name each thing fetched from the server is kept under. Everything of one agent is under
 * `["agents", id, …]`, so that all of it can be asked for again at once.
 */
export const keys = {
  me: ["me"] as const,
  agents: ["agents"] as const,
  workspaces: ["workspaces"] as const,
  settings: ["settings"] as const,
  computers: ["computers"] as const,
  computerRequests: ["computers", "requests"] as const,
  computerKinds: ["computer-kinds"] as const,
  models: (workspaceId?: string) => ["models", workspaceId ?? "all"] as const,
  workspace: (workspaceId: string, what: string) => ["workspaces", workspaceId, what] as const,
  of: (agentId: string) => ["agents", agentId] as const,
  agent: (agentId: string) => ["agents", agentId, "state"] as const,
  schedules: (agentId: string) => ["agents", agentId, "schedules"] as const,
  skills: (agentId: string) => ["agents", agentId, "skills"] as const,
  library: (agentId: string) => ["agents", agentId, "library"] as const,
  sites: (agentId: string) => ["agents", agentId, "sites"] as const,
  approvals: (agentId: string) => ["agents", agentId, "approvals"] as const,
  connectors: (agentId: string) => ["agents", agentId, "connectors"] as const,
  secrets: (agentId: string) => ["agents", agentId, "secrets"] as const,
  creature: (agentId: string) => ["agents", agentId, "creature"] as const,
  jobs: (agentId: string) => ["agents", agentId, "jobs"] as const,
  usage: (agentId: string) => ["agents", agentId, "usage"] as const,
  slack: (agentId: string) => ["agents", agentId, "slack"] as const,
}

/** The signed-in person, and what this deployment lets them do. */
export function useMe() {
  const { client } = useSession()
  return useQuery<Me>({ queryKey: keys.me, queryFn: () => client.me(), staleTime: 5 * 60_000 })
}

/** Every agent the person can use, in every workspace, as the list of agents shows them. */
export function useAgents() {
  const { client } = useSession()
  return useQuery<AgentSummary[]>({ queryKey: keys.agents, queryFn: () => client.listAgents() })
}

/** One agent as the list has it: who it is and what it is up to. Undefined until the list is in. */
export function useAgentSummary(agentId: string): AgentSummary | undefined {
  return useAgents().data?.find((agent) => agent.id === agentId)
}

/** The person's workspaces, and the invitations waiting for them. */
export function useWorkspaces() {
  const { client } = useSession()
  return useQuery<WorkspacesState>({
    queryKey: keys.workspaces,
    queryFn: () => client.workspaces(),
  })
}

/** Everything about one agent that is not a chat: its identity, memory and list of chats. */
export function useAgentState(agentId: string) {
  const { client } = useSession()
  useAgentLive(agentId)
  return useQuery<AgentState>({
    queryKey: keys.agent(agentId),
    queryFn: () => client.agent(agentId).state(),
  })
}

/* ---------- keeping an agent's data current ---------- */

/** Which of an agent's things each kind of change means asking for again. */
const CHANGED: Record<string, (agentId: string) => readonly unknown[]> = {
  schedules: keys.schedules,
  skills: keys.skills,
  library: keys.library,
  approvals: keys.approvals,
  connectors: keys.connectors,
  secrets: keys.secrets,
  creature: keys.creature,
  jobs: keys.jobs,
}

type Watch = { count: number; close: () => void }
const watching = new Map<string, Watch>()

function watch(session: Session, queryClient: QueryClient, agentId: string): Watch {
  // A phone's connection is often cut, and each time it comes back anything may have changed,
  // so everything of the agent is asked for again.
  let connected = false
  const subscription = session.client.agent(agentId).watch((event) => {
    if (event.type === "ready") {
      if (connected) void queryClient.invalidateQueries({ queryKey: keys.of(agentId) })
      connected = true
      return
    }
    if (event.type !== "changed") return
    if (event.what === "identity")
      void queryClient.invalidateQueries({ queryKey: keys.agents, exact: true })
    if (event.what === "computers") void queryClient.invalidateQueries({ queryKey: keys.computers })
    if (event.what === "library")
      void queryClient.invalidateQueries({ queryKey: keys.sites(agentId) })
    const key = CHANGED[event.what]?.(agentId) ?? keys.agent(agentId)
    void queryClient.invalidateQueries({ queryKey: key })
  })
  return { count: 0, close: () => subscription.close() }
}

/**
 * Keep what is known of an agent current for as long as a screen showing it is mounted. However
 * many screens ask, the agent is followed once: the last to go lets it be.
 */
export function useAgentLive(agentId: string | undefined): void {
  const session = useSession()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (agentId === undefined || agentId === "") return
    const id = `${session.server}\n${agentId}`
    const entry = watching.get(id) ?? watch(session, queryClient, agentId)
    watching.set(id, entry)
    entry.count += 1
    return () => {
      entry.count -= 1
      // Leaving one screen for another of the same agent would otherwise drop it and take it up again.
      setTimeout(() => {
        if (entry.count > 0 || watching.get(id) !== entry) return
        watching.delete(id)
        entry.close()
      }, 2_000)
    }
  }, [session, queryClient, agentId])
}

/* ---------- the list of agents, kept current by the person's own feed ---------- */

const store = getDefaultStore()

/** When each agent was last looked at from this phone, by the server's clock. */
const seenHereAtom = atom<Readonly<Record<string, number>>>({})
export const useSeenHere = () => useAtomValue(seenHereAtom)
const note = (agentId: string, at: number) =>
  store.set(seenHereAtom, (kept) => ({ ...kept, [agentId]: Math.max(kept[agentId] ?? 0, at) }))

/** How lately the list has to have been asked for to be taken as it is when the feed connects. */
const FRESH_MS = 3_000

/**
 * Keep the list of agents current while the signed-in app is open. Each agent says what it is up
 * to as that changes and the server passes it on over one socket of the person's own, so nothing
 * is asked for on a timer. What is said while the socket is down is said to nobody, so the list
 * is asked for whenever it comes back up.
 */
export function useFeed(userId: string | undefined): void {
  const { client } = useSession()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (userId === undefined) return
    const askAgain = () =>
      void queryClient.invalidateQueries({ queryKey: keys.agents, exact: true })
    const take = (event: FeedEvent) => {
      const listed = queryClient.getQueryData<AgentSummary[]>(keys.agents)
      // An agent the list does not have yet: the list is asked for, which has it whole.
      if (listed === undefined || !listed.some((agent) => agent.id === event.agentId)) {
        return askAgain()
      }
      queryClient.setQueryData<AgentSummary[]>(
        keys.agents,
        listed.map((agent) => {
          if (agent.id !== event.agentId) return agent
          if (event.type === "seen") return { ...agent, seenAt: event.seenAt }
          const { latest, working, asking } = event
          return { ...agent, working, asking, ...(latest === undefined ? {} : { latest }) }
        }),
      )
    }
    const feed = client.feed(userId, {
      event: take,
      connected: (again) => {
        const list = queryClient.getQueryState(keys.agents)
        const fresh =
          list?.fetchStatus === "fetching" || Date.now() - (list?.dataUpdatedAt ?? 0) < FRESH_MS
        if (again || !fresh) askAgain()
      },
    })
    return () => feed.close()
  }, [client, queryClient, userId])
}

/**
 * Say that the agent on screen has been looked at: when it is opened, and again whenever
 * something comes from it while it is being looked at.
 */
export function useMarkSeen(agentId: string | undefined): void {
  const { client } = useSession()
  const agent = useAgents().data?.find((each) => each.id === agentId)
  const here = useSeenHere()
  const latestAt = agent?.latest?.at
  const seen = Math.max(agent?.seenAt ?? 0, agentId === undefined ? 0 : (here[agentId] ?? 0))
  const due = agentId !== undefined && agent !== undefined && (seen === 0 || (latestAt ?? 0) > seen)
  useEffect(() => {
    if (!due || agentId === undefined) return
    // Noted before the server answers: the mark must not be asked for twice while it is on its way.
    note(agentId, Math.max(latestAt ?? 0, 1))
    client
      .agent(agentId)
      .seen()
      .then(({ seenAt }) => note(agentId, seenAt))
      .catch(() => {})
  }, [client, due, agentId, latestAt])
}

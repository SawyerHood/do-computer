import type { AgentState } from "@durable-computer/client"
import type { AgentSummary, ChatSummary } from "@durable-computer/protocol"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { type Query, queryOptions } from "@tanstack/react-query"
import { createCollection } from "@tanstack/react-db"
import { client, patience } from "./client.ts"
import { queryClient } from "./query.ts"

export const agentsKey = ["agents"] as const
export const agentKey = (agentId: string) => ["agents", agentId, "state"] as const
export const schedulesKey = (agentId: string) => ["agents", agentId, "schedules"] as const
export const skillsKey = (agentId: string) => ["agents", agentId, "skills"] as const
export const computersKey = ["computers"] as const
/** Under the computers' key, so that whatever refreshes those refreshes these. */
export const computerRequestsKey = ["computers", "requests"] as const
export const usageKey = (agentId: string) => ["agents", agentId, "usage"] as const
export const creatureKey = (agentId: string) => ["agents", agentId, "creature"] as const
export const modelsKey = ["models"] as const
/**
 * The models an agent in one workspace can be set to: the deployment's and those of the
 * providers the workspace is signed in to. Under the models' key, so that whatever refreshes
 * those refreshes these.
 */
export const workspaceModelsKey = (workspaceId: string | undefined) =>
  ["models", workspaceId ?? "any"] as const
/** The model providers there are, and which of them a workspace is signed in to. */
export const modelProvidersKey = (workspaceId: string) => ["model-providers", workspaceId] as const
export const settingsKey = ["settings"] as const
export const computerKindsKey = ["computer-kinds"] as const
export const approvalsKey = (agentId: string) => ["agents", agentId, "approvals"] as const
export const connectorsKey = (agentId: string) => ["agents", agentId, "connectors"] as const
export const secretsKey = (agentId: string) => ["agents", agentId, "secrets"] as const
export const slackKey = (agentId: string) => ["agents", agentId, "slack"] as const
export const jobsKey = (agentId: string) => ["agents", agentId, "jobs"] as const
export const libraryKey = (agentId: string) => ["agents", agentId, "library"] as const
/** A library file's text at one revision. Kept apart from the listing, which changes; this never does. */
export const libraryTextKey = (agentId: string, fileId: string, rev: number) =>
  ["agents", agentId, "library-text", fileId, rev] as const
export const libraryVersionsKey = (agentId: string, fileId: string) =>
  ["agents", agentId, "library-versions", fileId] as const

export const meKey = ["me"] as const

/**
 * Who is signed in. Asked once and kept for as long as the page is open: a session that has
 * ended is found out by whatever is asked for next, which is refused.
 */
export const meQuery = queryOptions({
  queryKey: meKey,
  queryFn: () => client.me({ signal: patience() }),
  staleTime: Number.POSITIVE_INFINITY,
})

/** One agent's state: what it is, and its chats. */
export const agentQuery = (agentId: string) =>
  queryOptions({ queryKey: agentKey(agentId), queryFn: () => client.agent(agentId).state() })

/** What an agent's creature has been given and has on. */
export const creatureQuery = (agentId: string) =>
  queryOptions({
    queryKey: creatureKey(agentId),
    queryFn: () => client.agent(agentId).creature(),
  })

/** The commands an agent left running in the background, and those lately over. */
export const jobsQuery = (agentId: string) =>
  queryOptions({ queryKey: jobsKey(agentId), queryFn: () => client.agent(agentId).jobs() })

/** The signed-in user's agents. The server asks each agent what it is, so one can hold up them all. */
const listAgents = () => client.listAgents({ signal: patience() })

export const agentsQuery = queryOptions({ queryKey: agentsKey, queryFn: listAgents })

export const schedulesQuery = (agentId: string) =>
  queryOptions({
    queryKey: schedulesKey(agentId),
    queryFn: () => client.agent(agentId).schedules(),
  })

export const libraryQuery = (agentId: string) =>
  queryOptions({
    queryKey: libraryKey(agentId),
    queryFn: () => client.agent(agentId).libraryListing(),
  })

/** The signed-in user's agents. */
export const agentsCollection = createCollection(
  queryCollectionOptions({
    id: "agents",
    queryKey: agentsKey,
    queryFn: listAgents,
    queryClient,
    getKey: (agent: AgentSummary) => agent.id,
  }),
)

function createChatsCollection(agentId: string) {
  const api = client.agent(agentId)
  return createCollection(
    queryCollectionOptions({
      id: `chats:${agentId}`,
      // The agent's state is one response; the chat rows are picked out of it.
      queryKey: agentKey(agentId),
      queryFn: () => api.state(),
      select: (state: AgentState) => state.chats,
      queryClient,
      getKey: (chat: ChatSummary) => chat.id,
      onUpdate: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          await api.updateChat(String(mutation.key), {
            title: mutation.changes.title,
            archived: mutation.changes.archived,
          })
        }
      },
    }),
  )
}

type ChatsCollection = ReturnType<typeof createChatsCollection>
const chatsCollections = new Map<string, ChatsCollection>()

/** The chats of one agent. One collection per agent, created on first use. */
export function chatsCollection(agentId: string): ChatsCollection {
  let collection = chatsCollections.get(agentId)
  if (collection === undefined) {
    collection = createChatsCollection(agentId)
    chatsCollections.set(agentId, collection)
  }
  return collection
}

/** Refetch what an agent event says changed. */
export function refreshAgent(agentId: string, what: string): void {
  if (what === "identity") void queryClient.invalidateQueries({ queryKey: agentsKey })
  if (what === "schedules") {
    void queryClient.invalidateQueries({ queryKey: schedulesKey(agentId) })
    return
  }
  if (what === "approvals") {
    void queryClient.invalidateQueries({ queryKey: approvalsKey(agentId) })
    return
  }
  if (what === "secrets") {
    void queryClient.invalidateQueries({ queryKey: secretsKey(agentId) })
    // Giving an access token adds a connector.
    void queryClient.invalidateQueries({ queryKey: connectorsKey(agentId) })
    return
  }
  if (what === "connectors") {
    void queryClient.invalidateQueries({ queryKey: connectorsKey(agentId) })
    // A rule can be set for each connector, so the list of those changes with it.
    void queryClient.invalidateQueries({ queryKey: approvalsKey(agentId) })
    return
  }
  if (what === "library") {
    void queryClient.invalidateQueries({ queryKey: libraryKey(agentId) })
    void queryClient.invalidateQueries({ queryKey: ["agents", agentId, "library-versions"] })
    return
  }
  if (what === "computers") {
    void queryClient.invalidateQueries({ queryKey: computersKey })
    void queryClient.invalidateQueries({ queryKey: approvalsKey(agentId) })
    return
  }
  if (what === "creature") {
    void queryClient.invalidateQueries({ queryKey: creatureKey(agentId) })
    // What it has on is part of what every drawing of the agent is given.
    void queryClient.invalidateQueries({ queryKey: agentsKey, exact: true })
    return
  }
  if (what === "jobs") {
    // What each has printed is kept under the same key, and is not asked for again here.
    void queryClient.invalidateQueries({ queryKey: jobsKey(agentId), exact: true })
    return
  }
  if (what === "skills") {
    void queryClient.invalidateQueries({ queryKey: skillsKey(agentId) })
    return
  }
  if (what === "identity" || what === "chats") {
    void queryClient.invalidateQueries({ queryKey: agentKey(agentId) })
    return
  }
  // Something this page has no name for: whatever it was is among all that is kept of the agent.
  void queryClient.invalidateQueries({ queryKey: [...agentsKey, agentId] })
}

/**
 * Refetch all that is kept of an agent. The agent's event stream tells of changes only while it
 * is connected, so this is what is done each time it connects: the first time for what was
 * fetched before `since`, when the page began to listen, and after that for everything, since
 * anything may have changed while the stream was down.
 */
export function catchUpAgent(agentId: string, since?: number): void {
  const missed = (query: Query) =>
    since === undefined ||
    (query.state.dataUpdatedAt < since && query.state.fetchStatus !== "fetching")
  void queryClient.invalidateQueries({ queryKey: [...agentsKey, agentId], predicate: missed })
  // What every drawing of the agent is given, and the machines it works on, are kept apart.
  void queryClient.invalidateQueries({ queryKey: agentsKey, exact: true, predicate: missed })
  void queryClient.invalidateQueries({ queryKey: computersKey, predicate: missed })
}

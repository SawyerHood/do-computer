import type { AgentState } from "@do-computer/client"
import type { AgentSummary, ChatSummary } from "@do-computer/protocol"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { CancelledError, queryOptions } from "@tanstack/react-query"
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

/**
 * The list of agents, for a route that waits for it before it shows anything. The request can
 * be cancelled under it: the sidebar shows the same list, and whatever lets go of a request
 * that is on its way, as one page gives way to another, gives it up for everyone waiting. That
 * is not the list failing, so it is asked for again.
 */
export async function listedAgents(): Promise<AgentSummary[]> {
  for (let tries = 1; ; tries++) {
    try {
      return await queryClient.fetchQuery(agentsQuery)
    } catch (error) {
      if (!(error instanceof CancelledError) || tries >= 5) throw error
    }
  }
}

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

/**
 * Put an agent in the list of agents as it is kept here, in place of what was kept of it. The
 * server has just said what it is, and asking for the list again waits for every agent there is.
 */
export function listAgent(agent: AgentSummary): void {
  queryClient.setQueryData<AgentSummary[]>(agentsKey, (listed) =>
    listed === undefined ? listed : [...listed.filter((entry) => entry.id !== agent.id), agent],
  )
}

/**
 * Take agents out of the list of agents as it is kept here: ones that were deleted, or are in a
 * team that was left. The list is then good to choose another agent from at once. Whoever calls
 * this asks for the list again once the page has moved on.
 */
export function unlistAgents(gone: (agent: AgentSummary) => boolean): void {
  queryClient.setQueryData<AgentSummary[]>(agentsKey, (listed) =>
    listed?.filter((agent) => !gone(agent)),
  )
}

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
 * Ask again for what is kept under a key. What is still on its way is let arrive, since a page
 * may be waiting to draw from it, and is then asked for once more.
 */
function askAgain(queryKey: readonly unknown[], exact = false): void {
  const onTheirWay = queryClient
    .getQueryCache()
    .findAll({ queryKey, exact, fetchStatus: "fetching" })
  void queryClient.invalidateQueries({ queryKey, exact }, { cancelRefetch: false })
  for (const query of onTheirWay) {
    const arrived = () =>
      void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true })
    void query.promise?.then(arrived, arrived)
  }
}

/**
 * Ask again for all that is kept of an agent. Its event stream tells of what changes from the
 * moment it connects, so this is what is done each time it does: whatever was asked for before
 * then, a moment before as much as an hour, may have changed since without a word. When the
 * stream is `back` after being down, the list of agents and the machines are asked for too.
 */
export function catchUpAgent(agentId: string, back: boolean): void {
  askAgain([...agentsKey, agentId])
  if (!back) return
  // What every drawing of the agent is given, and the machines it works on, are kept apart.
  askAgain(agentsKey, true)
  askAgain(computersKey)
}

import type { AgentState } from "@durable-computer/client"
import type { AgentSummary, ChatSummary } from "@durable-computer/protocol"
import { queryCollectionOptions } from "@tanstack/query-db-collection"
import { createCollection } from "@tanstack/react-db"
import { client } from "./client.ts"
import { queryClient } from "./query.ts"

export const agentsKey = ["agents"] as const
export const agentKey = (agentId: string) => ["agents", agentId, "state"] as const
export const schedulesKey = (agentId: string) => ["agents", agentId, "schedules"] as const
export const skillsKey = (agentId: string) => ["agents", agentId, "skills"] as const
export const computersKey = ["computers"] as const
export const connectorsKey = (agentId: string) => ["agents", agentId, "connectors"] as const
export const libraryKey = (agentId: string) => ["agents", agentId, "library"] as const

/** The signed-in user's agents. */
export const agentsCollection = createCollection(
  queryCollectionOptions({
    id: "agents",
    queryKey: agentsKey,
    queryFn: () => client.listAgents(),
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
  if (what === "connectors") {
    void queryClient.invalidateQueries({ queryKey: connectorsKey(agentId) })
    return
  }
  if (what === "library") {
    void queryClient.invalidateQueries({ queryKey: libraryKey(agentId) })
    return
  }
  if (what === "computers") {
    void queryClient.invalidateQueries({ queryKey: computersKey })
    return
  }
  if (what === "skills") {
    void queryClient.invalidateQueries({ queryKey: skillsKey(agentId) })
    return
  }
  void queryClient.invalidateQueries({ queryKey: agentKey(agentId) })
}

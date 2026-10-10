import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useAtomValue } from "jotai"
import { useEffect } from "react"
import { agentIdAtom, setAgentId } from "./session.ts"
import { useSession } from "./use-session.ts"

export const keys = {
  agents: ["agents"] as const,
  agent: (agentId: string) => ["agents", agentId, "state"] as const,
  schedules: (agentId: string) => ["agents", agentId, "schedules"] as const,
  skills: (agentId: string) => ["agents", agentId, "skills"] as const,
  library: (agentId: string) => ["agents", agentId, "library"] as const,
  approvals: (agentId: string) => ["agents", agentId, "approvals"] as const,
}

/**
 * The agent on screen: the one last chosen, or the user's first, created on a first visit. Also
 * keeps its data fresh from its event stream while a screen using this is mounted.
 */
export function useAgent() {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const chosen = useAtomValue(agentIdAtom)

  const agents = useQuery({
    queryKey: keys.agents,
    queryFn: async () => {
      const existing = await client.listAgents()
      return existing.length > 0 ? existing : [await client.createAgent()]
    },
  })
  const agentId = agents.data?.find((agent) => agent.id === chosen)?.id ?? agents.data?.[0]?.id

  useEffect(() => {
    if (agentId !== undefined && agentId !== chosen) setAgentId(agentId)
  }, [agentId, chosen])

  const state = useQuery({
    queryKey: keys.agent(agentId ?? ""),
    queryFn: () => client.agent(agentId!).state(),
    enabled: agentId !== undefined,
  })

  useEffect(() => {
    if (agentId === undefined) return
    // The stream tells of what changes while it is connected. A phone's is often cut, and each
    // time it comes back anything may have changed, so everything here is asked for again.
    let connected = false
    const subscription = client.agent(agentId).watch((event) => {
      if (event.type === "ready") {
        if (connected) void queryClient.invalidateQueries()
        connected = true
      }
      if (event.type !== "changed") return
      if (event.what === "identity") void queryClient.invalidateQueries({ queryKey: keys.agents })
      const key =
        event.what === "schedules"
          ? keys.schedules(agentId)
          : event.what === "skills"
            ? keys.skills(agentId)
            : event.what === "library"
              ? keys.library(agentId)
              : event.what === "approvals"
                ? keys.approvals(agentId)
                : keys.agent(agentId)
      void queryClient.invalidateQueries({ queryKey: key })
    })
    return () => subscription.close()
  }, [client, agentId, queryClient])

  return {
    agentId,
    agents: agents.data ?? [],
    state: state.data,
    error: agents.error ?? state.error,
  }
}

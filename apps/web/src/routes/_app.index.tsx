import { createFileRoute, redirect } from "@tanstack/react-router"
import { client } from "@/lib/client"
import { agentsKey, agentsQuery } from "@/lib/collections"
import { comingBackTo, lastAgent } from "@/lib/last-agent"
import { queryClient } from "@/lib/query"

/**
 * Land on the agent that was open here last, whichever workspace it is in. Where none was, or
 * it is no longer the user's to open, on their first agent, creating it on a first visit.
 */
export const Route = createFileRoute("/_app/")({
  beforeLoad: async () => {
    const last = lastAgent()
    // This is where the desktop app starts, every time. The agent it was left on is gone to
    // without waiting for the list, which takes as long as the slowest agent takes to answer.
    // An agent that turns out to be gone sends the visitor back here, with nothing kept.
    const listed = queryClient.getQueryData(agentsQuery.queryKey)
    if (last !== undefined && (listed === undefined || listed.some((agent) => agent.id === last))) {
      comingBackTo(last)
      throw redirect({ to: "/a/$agentId", params: { agentId: last }, replace: true })
    }
    // The list the sidebar shows, asked for again only if it is no longer good.
    const agents = await queryClient.fetchQuery(agentsQuery)
    let agent = agents.find((candidate) => candidate.id === last) ?? agents[0]
    if (agent === undefined) {
      agent = await client.createAgent()
      void queryClient.invalidateQueries({ queryKey: agentsKey })
    }
    throw redirect({ to: "/a/$agentId", params: { agentId: agent.id } })
  },
})

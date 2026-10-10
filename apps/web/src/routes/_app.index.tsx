import { createFileRoute, redirect } from "@tanstack/react-router"
import { agentsQuery, listedAgents } from "@/lib/collections"
import { comingBackTo, lastAgent } from "@/lib/last-agent"
import { queryClient } from "@/lib/query"

/**
 * Land on the agent that was open here last, whichever workspace it is in. Where none was, or
 * it is no longer the user's to open, on their first agent. Someone who has none yet is sent to
 * meet one.
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
    const agents = await listedAgents()
    const agent = agents.find((candidate) => candidate.id === last) ?? agents[0]
    // Someone with no agent is new here: their first is met, and named, in the first run.
    if (agent === undefined) throw redirect({ to: "/welcome", replace: true })
    throw redirect({ to: "/a/$agentId", params: { agentId: agent.id } })
  },
})

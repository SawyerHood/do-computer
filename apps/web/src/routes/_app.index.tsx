import { createFileRoute, redirect } from "@tanstack/react-router"
import { client } from "@/lib/client"
import { agentsKey, agentsQuery } from "@/lib/collections"
import { queryClient } from "@/lib/query"

/** Land on the user's first agent, creating it on a first visit. */
export const Route = createFileRoute("/_app/")({
  beforeLoad: async () => {
    // The list the sidebar shows, asked for again only if it is no longer good.
    const agents = await queryClient.fetchQuery(agentsQuery)
    let agent = agents[0]
    if (agent === undefined) {
      agent = await client.createAgent()
      void queryClient.invalidateQueries({ queryKey: agentsKey })
    }
    throw redirect({ to: "/a/$agentId", params: { agentId: agent.id } })
  },
})

import { createFileRoute, redirect } from "@tanstack/react-router"
import { client } from "@/lib/client"

/** Land on the user's first agent, creating it on a first visit. */
export const Route = createFileRoute("/_app/")({
  beforeLoad: async () => {
    const agents = await client.listAgents()
    const agent = agents[0] ?? (await client.createAgent())
    throw redirect({ to: "/a/$agentId", params: { agentId: agent.id } })
  },
})

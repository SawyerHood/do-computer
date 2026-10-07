import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { connectAgent, disconnectAgent } from "@/server/computers"

export const Route = createFileRoute("/api/computers/$computerId/agents/$agentId")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        withUser(request, (user) => connectAgent(user, params.computerId, params.agentId)),
      DELETE: ({ request, params }) =>
        withUser(request, (user) => disconnectAgent(user, params.computerId, params.agentId)),
    },
  },
})

import { createFileRoute } from "@tanstack/react-router"
import { proxyToAgent, withUser } from "@/server/agents"
import { connectConnector } from "@/server/connectors"

export const Route = createFileRoute("/api/agents/$agentId/connectors")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withUser(request, (user) => proxyToAgent(request, user, params.agentId, "connectors")),
      POST: ({ request, params }) =>
        withUser(request, (user) => connectConnector(user, request, params.agentId)),
    },
  },
})

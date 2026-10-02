import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { connectConnector } from "@/server/connectors"

export const Route = createFileRoute("/api/agents/$agentId/connectors/$connectorId/connect")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withUser(request, (user) =>
          connectConnector(user, request, params.agentId, params.connectorId),
        ),
    },
  },
})

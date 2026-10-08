import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { addSlackConnector } from "@/server/slack-requests"

export const Route = createFileRoute("/api/agents/$agentId/slack/connector")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withUser(request, (user) => addSlackConnector(user, request, params.agentId)),
    },
  },
})

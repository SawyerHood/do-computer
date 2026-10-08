import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { addToSlack, readSlack, removeFromSlack } from "@/server/slack-requests"

export const Route = createFileRoute("/api/agents/$agentId/slack")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withUser(request, (user) => readSlack(user, request, params.agentId)),
      PUT: ({ request, params }) =>
        withUser(request, (user) => addToSlack(user, request, params.agentId)),
      DELETE: ({ request, params }) =>
        withUser(request, (user) => removeFromSlack(user, params.agentId)),
    },
  },
})

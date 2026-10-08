import { createFileRoute } from "@tanstack/react-router"
import { receiveSlack } from "@/server/slack-requests"

export const Route = createFileRoute("/api/slack/events/$agentId")({
  server: {
    handlers: { POST: ({ request, params }) => receiveSlack(request, params.agentId) },
  },
})

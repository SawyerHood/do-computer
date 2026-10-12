import { createFileRoute } from "@tanstack/react-router"
import { markAgentSeen } from "@/server/agent-seen"
import { withUser } from "@/server/agents"

export const Route = createFileRoute("/api/agents/$agentId/seen")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        withUser(request, (user) => markAgentSeen(user, params.agentId)),
    },
  },
})

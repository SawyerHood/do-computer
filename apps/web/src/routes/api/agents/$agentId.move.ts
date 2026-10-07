import { createFileRoute } from "@tanstack/react-router"
import { moveAgent } from "@/server/agent-move"
import { withUser } from "@/server/agents"

export const Route = createFileRoute("/api/agents/$agentId/move")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withUser(request, async (user) => {
          const input = (await request.json().catch(() => ({}))) as { workspaceId?: unknown } | null
          return moveAgent(user, params.agentId, input?.workspaceId)
        }),
    },
  },
})

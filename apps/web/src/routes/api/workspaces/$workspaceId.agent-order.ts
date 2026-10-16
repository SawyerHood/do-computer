import { createFileRoute } from "@tanstack/react-router"
import { forgetAgentOrder, writeAgentOrder } from "@/server/agent-order"
import { withUser } from "@/server/agents"

export const Route = createFileRoute("/api/workspaces/$workspaceId/agent-order")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        withUser(request, (user) => writeAgentOrder(user, params.workspaceId, request)),
      DELETE: ({ request, params }) =>
        withUser(request, (user) => forgetAgentOrder(user, params.workspaceId)),
    },
  },
})

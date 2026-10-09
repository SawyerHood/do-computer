import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { listModelProviders } from "@/server/model-access"

export const Route = createFileRoute("/api/workspaces/$workspaceId/model-providers/")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withUser(request, (user) => listModelProviders(user, params.workspaceId)),
    },
  },
})

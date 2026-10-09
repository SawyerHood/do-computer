import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { startModelLogin } from "@/server/model-access"

export const Route = createFileRoute("/api/workspaces/$workspaceId/model-logins/")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withUser(request, (user) => startModelLogin(user, request, params.workspaceId)),
    },
  },
})

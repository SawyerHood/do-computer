import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { listSavedLogins, saveLogin } from "@/server/passwords"

export const Route = createFileRoute("/api/workspaces/$workspaceId/passwords/")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withUser(request, (user) => listSavedLogins(user, params.workspaceId)),
      POST: ({ request, params }) =>
        withUser(request, (user) => saveLogin(user, request, params.workspaceId)),
    },
  },
})

import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { cancelModelLogin, getModelLogin } from "@/server/model-access"

export const Route = createFileRoute("/api/workspaces/$workspaceId/model-logins/$loginId/")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withUser(request, (user) =>
          getModelLogin(user, request, params.workspaceId, params.loginId),
        ),
      DELETE: ({ request, params }) =>
        withUser(request, (user) => cancelModelLogin(user, params.workspaceId, params.loginId)),
    },
  },
})

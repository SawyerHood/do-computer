import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { changeSavedLogin, removeSavedLogin } from "@/server/passwords"

export const Route = createFileRoute("/api/workspaces/$workspaceId/passwords/$loginId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        withUser(request, (user) =>
          changeSavedLogin(user, request, params.workspaceId, params.loginId),
        ),
      DELETE: ({ request, params }) =>
        withUser(request, (user) => removeSavedLogin(user, params.workspaceId, params.loginId)),
    },
  },
})

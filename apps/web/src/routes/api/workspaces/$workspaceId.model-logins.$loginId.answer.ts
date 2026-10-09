import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { answerModelLogin } from "@/server/model-access"

export const Route = createFileRoute("/api/workspaces/$workspaceId/model-logins/$loginId/answer")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withUser(request, (user) =>
          answerModelLogin(user, request, params.workspaceId, params.loginId),
        ),
    },
  },
})

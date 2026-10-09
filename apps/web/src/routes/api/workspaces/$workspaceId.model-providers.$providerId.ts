import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { signOutOfModelProvider } from "@/server/model-access"

export const Route = createFileRoute("/api/workspaces/$workspaceId/model-providers/$providerId")({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        withUser(request, (user) =>
          signOutOfModelProvider(user, params.workspaceId, params.providerId),
        ),
    },
  },
})

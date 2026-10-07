import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { patchWorkspace, removeWorkspace } from "@/server/workspaces"

export const Route = createFileRoute("/api/workspaces/$workspaceId/")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        withUser(request, (user) => patchWorkspace(user, request, params.workspaceId)),
      DELETE: ({ request, params }) =>
        withUser(request, (user) => removeWorkspace(user, params.workspaceId)),
    },
  },
})

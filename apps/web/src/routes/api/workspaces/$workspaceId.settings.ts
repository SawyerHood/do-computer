import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { getWorkspaceOptions, patchWorkspaceOptions } from "@/server/workspaces"

export const Route = createFileRoute("/api/workspaces/$workspaceId/settings")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withUser(request, (user) => getWorkspaceOptions(user, params.workspaceId)),
      PATCH: ({ request, params }) =>
        withUser(request, (user) => patchWorkspaceOptions(user, request, params.workspaceId)),
    },
  },
})

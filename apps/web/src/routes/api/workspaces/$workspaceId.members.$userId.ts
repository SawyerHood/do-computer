import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { deleteMember, patchMember } from "@/server/workspaces"

export const Route = createFileRoute("/api/workspaces/$workspaceId/members/$userId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        withUser(request, (user) => patchMember(user, request, params.workspaceId, params.userId)),
      DELETE: ({ request, params }) =>
        withUser(request, (user) => deleteMember(user, params.workspaceId, params.userId)),
    },
  },
})

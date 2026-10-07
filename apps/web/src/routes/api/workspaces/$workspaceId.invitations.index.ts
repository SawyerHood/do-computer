import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { getInvitations, postInvitations } from "@/server/workspaces"

export const Route = createFileRoute("/api/workspaces/$workspaceId/invitations/")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withUser(request, (user) => getInvitations(user, params.workspaceId)),
      POST: ({ request, params }) =>
        withUser(request, (user) => postInvitations(user, request, params.workspaceId)),
    },
  },
})

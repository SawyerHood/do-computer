import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { renewInvite, withdrawInvite } from "@/server/workspaces"

export const Route = createFileRoute("/api/workspaces/$workspaceId/invitations/$invitationId")({
  server: {
    handlers: {
      // Sends it again, with a new link.
      POST: ({ request, params }) =>
        withUser(request, (user) =>
          renewInvite(user, request, params.workspaceId, params.invitationId),
        ),
      DELETE: ({ request, params }) =>
        withUser(request, (user) => withdrawInvite(user, params.workspaceId, params.invitationId)),
    },
  },
})

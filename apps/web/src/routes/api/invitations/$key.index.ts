import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { getUser } from "@/server/auth"
import { declineInvite, getInvitation } from "@/server/workspaces"

export const Route = createFileRoute("/api/invitations/$key/")({
  server: {
    handlers: {
      // No sign-in needed to look: the link is what was given to the person it is for.
      GET: async ({ request, params }) => getInvitation(await getUser(request), params.key),
      DELETE: ({ request, params }) => withUser(request, (user) => declineInvite(user, params.key)),
    },
  },
})

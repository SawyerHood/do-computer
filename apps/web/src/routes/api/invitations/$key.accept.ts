import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { acceptInvite } from "@/server/workspaces"

export const Route = createFileRoute("/api/invitations/$key/accept")({
  server: {
    handlers: {
      POST: ({ request, params }) => withUser(request, (user) => acceptInvite(user, params.key)),
    },
  },
})

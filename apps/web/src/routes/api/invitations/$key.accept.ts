import { createFileRoute } from "@tanstack/react-router"
import { withSignedIn } from "@/server/agents"
import { acceptInvite } from "@/server/workspaces"

export const Route = createFileRoute("/api/invitations/$key/accept")({
  server: {
    handlers: {
      // Someone on the waiting list may accept too: being asked into a team is what lets them in.
      POST: ({ request, params }) =>
        withSignedIn(request, (user) => acceptInvite(user, params.key)),
    },
  },
})

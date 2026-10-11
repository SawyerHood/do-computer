import { createFileRoute } from "@tanstack/react-router"
import { withSignedIn } from "@/server/agents"
import { claimDood } from "@/server/doods"

/**
 * `POST /api/doods/:id/claim`: whoever hatched it makes it theirs. Someone on the waiting list
 * may: the Dood is what they have while they wait.
 */
export const Route = createFileRoute("/api/doods/$doodId/claim")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withSignedIn(request, (user) => claimDood(params.doodId, request, user)),
    },
  },
})

import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { getDood, removeDood } from "@/server/doods"

/** `GET /api/doods/:id`: a Dood, for anyone who has its address. */
export const Route = createFileRoute("/api/doods/$doodId/")({
  server: {
    handlers: {
      GET: ({ params }) => getDood(params.doodId),
      DELETE: ({ request, params }) => withUser(request, (user) => removeDood(params.doodId, user)),
    },
  },
})

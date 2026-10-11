import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { wakeDood } from "@/server/doods"

/** `POST /api/doods/:id/agent`: their Dood becomes their agent, once they may use the app. */
export const Route = createFileRoute("/api/doods/$doodId/agent")({
  server: {
    handlers: {
      POST: ({ request, params }) => withUser(request, (user) => wakeDood(params.doodId, user)),
    },
  },
})

import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { updateDaemon } from "@/server/computers"

export const Route = createFileRoute("/api/computers/$computerId/update")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withUser(request, (user) => updateDaemon(user, params.computerId, request)),
    },
  },
})

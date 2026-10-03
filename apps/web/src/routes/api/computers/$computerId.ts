import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { removeComputer } from "@/server/computers"

export const Route = createFileRoute("/api/computers/$computerId")({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        withUser(request, (user) => removeComputer(user, params.computerId)),
    },
  },
})

import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { connectorInBrowser } from "@/server/connectors"

export const Route = createFileRoute("/api/connectors/browser")({
  server: {
    handlers: {
      POST: ({ request }) => withUser(request, (user) => connectorInBrowser(user, request)),
    },
  },
})

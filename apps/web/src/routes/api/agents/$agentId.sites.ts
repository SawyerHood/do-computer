import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { createSite, listSites } from "@/server/sites"

/** The sites of the workspace an agent is in: pages of its library shared as websites. */
export const Route = createFileRoute("/api/agents/$agentId/sites")({
  server: {
    handlers: {
      GET: ({ request, params }) => withUser(request, (user) => listSites(user, params.agentId)),
      POST: ({ request, params }) =>
        withUser(request, (user) => createSite(user, request, params.agentId)),
    },
  },
})

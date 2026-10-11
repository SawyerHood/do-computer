import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { removeSite, updateSite } from "@/server/sites"

export const Route = createFileRoute("/api/agents/$agentId/sites/$siteId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        withUser(request, (user) => updateSite(user, request, params.agentId, params.siteId)),
      DELETE: ({ request, params }) =>
        withUser(request, (user) => removeSite(user, params.agentId, params.siteId)),
    },
  },
})

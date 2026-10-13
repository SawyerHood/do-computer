import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { removeSavedCard } from "@/server/passwords"

export const Route = createFileRoute("/api/workspaces/$workspaceId/cards/$cardId")({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        withUser(request, (user) => removeSavedCard(user, params.workspaceId, params.cardId)),
    },
  },
})

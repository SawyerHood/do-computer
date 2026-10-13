import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { listSavedCards, saveCard } from "@/server/passwords"

export const Route = createFileRoute("/api/workspaces/$workspaceId/cards/")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withUser(request, (user) => listSavedCards(user, params.workspaceId)),
      POST: ({ request, params }) =>
        withUser(request, (user) => saveCard(user, request, params.workspaceId)),
    },
  },
})

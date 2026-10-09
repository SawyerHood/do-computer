import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { listModels } from "@/server/models"

export const Route = createFileRoute("/api/models")({
  server: {
    handlers: { GET: ({ request }) => withUser(request, (user) => listModels(user, request)) },
  },
})

import { createFileRoute } from "@tanstack/react-router"
import { createAgent, listAgents, withUser } from "@/server/agents"

export const Route = createFileRoute("/api/agents/")({
  server: {
    handlers: {
      GET: ({ request }) => withUser(request, listAgents),
      POST: ({ request }) => withUser(request, createAgent),
    },
  },
})

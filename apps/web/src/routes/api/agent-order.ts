import { createFileRoute } from "@tanstack/react-router"
import { readAgentOrder } from "@/server/agent-order"
import { withUser } from "@/server/agents"

export const Route = createFileRoute("/api/agent-order")({
  server: {
    handlers: {
      GET: ({ request }) => withUser(request, (user) => readAgentOrder(user)),
    },
  },
})

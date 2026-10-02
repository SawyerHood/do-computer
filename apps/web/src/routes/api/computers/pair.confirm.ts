import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { confirmPairing } from "@/server/computers"

export const Route = createFileRoute("/api/computers/pair/confirm")({
  server: {
    handlers: { POST: ({ request }) => withUser(request, (user) => confirmPairing(user, request)) },
  },
})

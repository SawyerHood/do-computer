import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { answerComputerRequest } from "@/server/computers"

export const Route = createFileRoute("/api/computers/requests/$requestId")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withUser(request, (user) => answerComputerRequest(user, params.requestId, request)),
    },
  },
})

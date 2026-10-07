import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { addComputer, listComputers } from "@/server/computers"

export const Route = createFileRoute("/api/computers/")({
  server: {
    handlers: {
      GET: ({ request }) => withUser(request, listComputers),
      POST: ({ request }) => withUser(request, (user) => addComputer(user, request)),
    },
  },
})

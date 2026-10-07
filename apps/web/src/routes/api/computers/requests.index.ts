import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { listComputerRequests } from "@/server/computers"

export const Route = createFileRoute("/api/computers/requests/")({
  server: { handlers: { GET: ({ request }) => withUser(request, listComputerRequests) } },
})

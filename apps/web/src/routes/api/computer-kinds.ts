import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { listComputerKinds } from "@/server/settings"

export const Route = createFileRoute("/api/computer-kinds")({
  server: { handlers: { GET: ({ request }) => withUser(request, () => listComputerKinds()) } },
})

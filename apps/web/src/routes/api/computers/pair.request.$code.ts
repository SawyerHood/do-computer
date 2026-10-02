import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { getPairing } from "@/server/computers"

export const Route = createFileRoute("/api/computers/pair/request/$code")({
  server: {
    handlers: { GET: ({ request, params }) => withUser(request, () => getPairing(params.code)) },
  },
})

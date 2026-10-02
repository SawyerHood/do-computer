import { createFileRoute } from "@tanstack/react-router"
import { pollPairing } from "@/server/computers"

export const Route = createFileRoute("/api/computers/pair/poll")({
  server: { handlers: { POST: ({ request }) => pollPairing(request) } },
})

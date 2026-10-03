import { createFileRoute } from "@tanstack/react-router"
import { startPairing } from "@/server/computers"

export const Route = createFileRoute("/api/computers/pair/start")({
  server: { handlers: { POST: ({ request }) => startPairing(request) } },
})

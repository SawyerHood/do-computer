import { createFileRoute } from "@tanstack/react-router"
import { connectorCallback } from "@/server/connectors"

export const Route = createFileRoute("/api/connectors/callback")({
  server: { handlers: { GET: ({ request }) => connectorCallback(request) } },
})

import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { transcribe } from "@/server/transcribe"

export const Route = createFileRoute("/api/transcribe")({
  server: { handlers: { POST: ({ request }) => withUser(request, () => transcribe(request)) } },
})

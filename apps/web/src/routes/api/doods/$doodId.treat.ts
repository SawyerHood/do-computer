import { createFileRoute } from "@tanstack/react-router"
import { treatDood } from "@/server/doods"

/** `POST /api/doods/:id/treat`: a treat for it, from anyone, once a day. */
export const Route = createFileRoute("/api/doods/$doodId/treat")({
  server: { handlers: { POST: ({ request, params }) => treatDood(params.doodId, request) } },
})

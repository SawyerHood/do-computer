import { createFileRoute } from "@tanstack/react-router"
import { patDood } from "@/server/doods"

/** `POST /api/doods/:id/pats`: it was stroked, by anyone. */
export const Route = createFileRoute("/api/doods/$doodId/pats")({
  server: { handlers: { POST: ({ request, params }) => patDood(params.doodId, request) } },
})

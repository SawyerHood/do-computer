import { createFileRoute } from "@tanstack/react-router"
import { getSignedIn } from "@/server/auth"
import { makeDood } from "@/server/doods"

/** `POST /api/doods`: hatch one. Anyone may, signed in or not. */
export const Route = createFileRoute("/api/doods/")({
  server: {
    handlers: {
      POST: async ({ request }) => makeDood(request, await getSignedIn(request)),
    },
  },
})

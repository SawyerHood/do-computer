import { createFileRoute } from "@tanstack/react-router"
import { fail, json, withUser } from "@/server/agents"
import { isDeploymentAdmin } from "@/server/model-access"
import { admit } from "@/server/waitlist"

/** `POST /api/waitlist/:user`: let someone in off the list. */
export const Route = createFileRoute("/api/waitlist/$userId")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withUser(request, async (user) => {
          if (!isDeploymentAdmin(user)) return fail(404, "Not found")
          return (await admit(params.userId, user))
            ? json({ ok: true })
            : fail(404, "There is no such account.")
        }),
    },
  },
})

import { createFileRoute } from "@tanstack/react-router"
import { fail, json, withUser } from "@/server/agents"
import { isDeploymentAdmin } from "@/server/model-access"
import { listWaiting } from "@/server/waitlist"

/** `GET /api/waitlist`: who is waiting to be let in, for those who run the deployment. */
export const Route = createFileRoute("/api/waitlist/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        withUser(request, async (user) =>
          isDeploymentAdmin(user) ? json(await listWaiting()) : fail(404, "Not found"),
        ),
    },
  },
})

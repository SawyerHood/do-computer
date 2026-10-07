import { getPlatform } from "#platform"
import { createFileRoute } from "@tanstack/react-router"
import { fail, json, withUser } from "@/server/agents"
import { sendTestPush } from "@/server/push"

export const Route = createFileRoute("/api/push/test")({
  server: {
    handlers: {
      /** Send a notification to one of the user's own browsers, to see that they arrive. */
      POST: ({ request }) =>
        withUser(request, async (user) => {
          const input = (await request.json().catch(() => ({}))) as { endpoint?: unknown }
          if (typeof input.endpoint !== "string") return fail(400, "endpoint is required")
          return json({ ok: await sendTestPush(getPlatform().db, user.id, input.endpoint) })
        }),
    },
  },
})

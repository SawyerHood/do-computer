import { getPlatform } from "#platform"
import { createFileRoute } from "@tanstack/react-router"
import { fail, json, withUser } from "@/server/agents"
import { unregisterPushToken } from "@/server/push"

export const Route = createFileRoute("/api/push/unregister")({
  server: {
    handlers: {
      POST: ({ request }) =>
        withUser(request, async (user) => {
          const input = (await request.json().catch(() => ({}))) as { token?: unknown }
          if (typeof input.token !== "string") return fail(400, "token is required")
          await unregisterPushToken(getPlatform().db, user.id, input.token)
          return json({ ok: true })
        }),
    },
  },
})

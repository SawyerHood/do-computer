import { getPlatform } from "#platform"
import { createFileRoute } from "@tanstack/react-router"
import { fail, json, withUser } from "@/server/agents"
import { isExpoPushToken, registerPushToken } from "@/server/push"

export const Route = createFileRoute("/api/push/register")({
  server: {
    handlers: {
      POST: ({ request }) =>
        withUser(request, async (user) => {
          const input = (await request.json().catch(() => ({}))) as {
            token?: unknown
            platform?: unknown
          }
          if (!isExpoPushToken(input.token)) return fail(400, "token must be an Expo push token")
          const platform =
            typeof input.platform === "string" ? input.platform.slice(0, 20) : "unknown"
          await registerPushToken(getPlatform().db, user.id, input.token, platform)
          return json({ ok: true })
        }),
    },
  },
})

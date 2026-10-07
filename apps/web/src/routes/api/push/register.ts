import { getPlatform } from "#platform"
import { checkAddress } from "@durable-computer/runtime"
import { createFileRoute } from "@tanstack/react-router"
import { fail, json, withUser } from "@/server/agents"
import { isExpoPushToken, registerBrowser, registerPushToken } from "@/server/push"
import { readSubscription } from "@/server/web-push"

export const Route = createFileRoute("/api/push/register")({
  server: {
    handlers: {
      /** A phone sends the token Expo gave it; a browser sends its push subscription. */
      POST: ({ request }) =>
        withUser(request, async (user) => {
          const input = (await request.json().catch(() => ({}))) as {
            token?: unknown
            platform?: unknown
            subscription?: unknown
          }
          const { db, config } = getPlatform()
          if (input.subscription !== undefined) {
            const subscription = readSubscription(input.subscription)
            if (subscription === undefined) return fail(400, "That is not a push subscription.")
            try {
              // The server will be calling this address, so it has to be one it may call.
              checkAddress(subscription.endpoint, config.allowPrivateHosts)
            } catch (error) {
              return fail(400, error instanceof Error ? error.message : "Bad address.")
            }
            const origin = config.baseUrl ?? new URL(request.url).origin
            await registerBrowser(db, user.id, subscription, origin)
            return json({ ok: true })
          }
          if (!isExpoPushToken(input.token)) return fail(400, "token must be an Expo push token")
          const platform =
            typeof input.platform === "string" ? input.platform.slice(0, 20) : "unknown"
          await registerPushToken(db, user.id, input.token, platform)
          return json({ ok: true })
        }),
    },
  },
})

import { getPlatform } from "#platform"
import { createFileRoute } from "@tanstack/react-router"
import { json, withUser } from "@/server/agents"
import { vapidKeys } from "@/server/web-push"

export const Route = createFileRoute("/api/push/key")({
  server: {
    handlers: {
      /** The public key a browser subscribes with, so that only this deployment can notify it. */
      GET: ({ request }) =>
        withUser(request, async () => json({ key: (await vapidKeys(getPlatform().db)).publicKey })),
    },
  },
})

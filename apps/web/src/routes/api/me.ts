import { createFileRoute } from "@tanstack/react-router"
import { fail, json } from "@/server/agents"
import { authMethods, getSignedIn } from "@/server/auth"
import { waitingDood } from "@/server/doods"
import { isDeploymentAdmin } from "@/server/model-access"
import { isWaiting } from "@/server/waitlist"

export const Route = createFileRoute("/api/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Someone on the waiting list is told who they are too, and that they are waiting.
        const user = await getSignedIn(request)
        if (user === undefined) return fail(401, "Sign in first", "unauthenticated")
        const waiting = await isWaiting(user)
        const dood = await waitingDood(user.id)
        return json({
          user: { id: user.id, email: user.email, name: user.name, image: user.image ?? null },
          ...authMethods(),
          // Whether they may sign the deployment itself in to model providers.
          admin: !waiting && isDeploymentAdmin(user),
          ...(waiting ? { waiting: true } : {}),
          // The Dood they made theirs, until it is their agent.
          ...(dood === undefined ? {} : { dood }),
        })
      },
    },
  },
})

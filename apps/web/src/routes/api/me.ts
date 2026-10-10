import { createFileRoute } from "@tanstack/react-router"
import { fail, json } from "@/server/agents"
import { authMethods, getUser } from "@/server/auth"
import { isDeploymentAdmin } from "@/server/model-access"

export const Route = createFileRoute("/api/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getUser(request)
        if (user === undefined) return fail(401, "Sign in first", "unauthenticated")
        return json({
          user: { id: user.id, email: user.email, name: user.name, image: user.image ?? null },
          ...authMethods(),
          // Whether they may sign the deployment itself in to model providers.
          admin: isDeploymentAdmin(user),
        })
      },
    },
  },
})

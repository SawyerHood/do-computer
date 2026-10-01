import { createFileRoute } from "@tanstack/react-router"
import { fail, json } from "@/server/agents"
import { authMethods, getUser } from "@/server/auth"

export const Route = createFileRoute("/api/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getUser(request)
        if (user === undefined) return fail(401, "Sign in first", "unauthenticated")
        return json({ user: { id: user.id, email: user.email, name: user.name }, ...authMethods() })
      },
    },
  },
})

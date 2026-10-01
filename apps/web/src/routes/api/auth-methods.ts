import { createFileRoute } from "@tanstack/react-router"
import { json } from "@/server/agents"
import { authMethods } from "@/server/auth"

/** Which sign-in options the login page should offer. Public: it says nothing about any account. */
export const Route = createFileRoute("/api/auth-methods")({
  server: { handlers: { GET: async () => json(authMethods()) } },
})

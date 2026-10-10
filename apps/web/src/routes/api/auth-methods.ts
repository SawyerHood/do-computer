import { createFileRoute } from "@tanstack/react-router"
import { json } from "@/server/agents"
import { frontDoor } from "@/server/auth"

/**
 * Which sign-in options the login page should offer, and what someone who is not signed in is
 * shown. Public: it says nothing about any account.
 */
export const Route = createFileRoute("/api/auth-methods")({
  server: { handlers: { GET: async () => json(await frontDoor()) } },
})

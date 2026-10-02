import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { getSettings, updateSettings } from "@/server/models"

export const Route = createFileRoute("/api/settings")({
  server: {
    handlers: {
      GET: ({ request }) => withUser(request, (user) => getSettings(user)),
      PATCH: ({ request }) => withUser(request, (user) => updateSettings(user, request)),
    },
  },
})

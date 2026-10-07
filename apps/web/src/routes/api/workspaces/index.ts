import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { getWorkspaces, postWorkspace } from "@/server/workspaces"

export const Route = createFileRoute("/api/workspaces/")({
  server: {
    handlers: {
      GET: ({ request }) => withUser(request, getWorkspaces),
      POST: ({ request }) => withUser(request, (user) => postWorkspace(user, request)),
    },
  },
})

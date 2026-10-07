import { createFileRoute } from "@tanstack/react-router"
import { withUser } from "@/server/agents"
import { patchComputer, removeComputer } from "@/server/computers"

export const Route = createFileRoute("/api/computers/$computerId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        withUser(request, (user) => patchComputer(user, params.computerId, request)),
      DELETE: ({ request, params }) =>
        withUser(request, (user) => removeComputer(user, params.computerId)),
    },
  },
})

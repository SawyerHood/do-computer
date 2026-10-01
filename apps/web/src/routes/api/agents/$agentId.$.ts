import { createFileRoute } from "@tanstack/react-router"
import { proxyToAgent, withUser } from "@/server/agents"

type Input = { request: Request; params: { agentId: string; _splat?: string } }

const handle = ({ request, params }: Input) =>
  withUser(request, (user) => proxyToAgent(request, user, params.agentId, params._splat ?? ""))

export const Route = createFileRoute("/api/agents/$agentId/$")({
  server: { handlers: { GET: handle, POST: handle, PATCH: handle, DELETE: handle } },
})

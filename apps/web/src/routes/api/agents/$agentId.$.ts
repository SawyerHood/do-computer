import { createFileRoute } from "@tanstack/react-router"
import { deleteAgent } from "@/server/agent-delete"
import { proxyToAgent, withUser } from "@/server/agents"

type Input = { request: Request; params: { agentId: string; _splat?: string } }

const handle = ({ request, params }: Input) =>
  withUser(request, (user) => proxyToAgent(request, user, params.agentId, params._splat ?? ""))

/** `DELETE /api/agents/:id` deletes the agent itself; anything deeper is the agent's to answer. */
const remove = (input: Input) =>
  (input.params._splat ?? "") === ""
    ? withUser(input.request, (user) =>
        deleteAgent(
          user,
          input.params.agentId,
          new URL(input.request.url).searchParams.get("computers") === "keep",
        ),
      )
    : handle(input)

export const Route = createFileRoute("/api/agents/$agentId/$")({
  server: { handlers: { GET: handle, POST: handle, PUT: handle, PATCH: handle, DELETE: remove } },
})

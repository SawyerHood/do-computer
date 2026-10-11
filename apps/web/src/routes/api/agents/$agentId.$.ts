import type { Outfit } from "@durable-computer/protocol"
import { createFileRoute } from "@tanstack/react-router"
import { deleteAgent } from "@/server/agent-delete"
import { proxyToAgent, withUser } from "@/server/agents"
import { followAgent } from "@/server/doods"

type Input = { request: Request; params: { agentId: string; _splat?: string } }

const handle = async ({ request, params }: Input) => {
  const path = params._splat ?? ""
  const response = await withUser(request, (user) =>
    proxyToAgent(request, user, params.agentId, path),
  )
  // An agent that was a Dood has a page anyone can open, which says what the agent now does.
  const renamed = request.method === "PATCH" && path === ""
  const dressed = request.method === "PUT" && path === "creature/outfit"
  if (response.ok && (renamed || dressed)) {
    const said = (await response
      .clone()
      .json()
      .catch(() => undefined)) as
      | { agent?: { name?: string | null; avatar?: { color: string; seed?: string } | null } }
      | { outfit?: Outfit }
      | undefined
    if (said !== undefined) {
      await followAgent(
        params.agentId,
        "outfit" in said ? { outfit: said.outfit } : ("agent" in said ? (said.agent ?? {}) : {}),
      ).catch(() => undefined)
    }
  }
  return response
}

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

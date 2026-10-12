import type { AgentDirectory, PeerAgent } from "@do-computer/agent"
import { type AgentSummary, personalWorkspaceId } from "@do-computer/protocol"
import type { ActorNamespace, AppDatabase } from "@do-computer/runtime"

type Row = { id: string; owner_id: string; workspace_id: string | null }

const workspaceOf = (row: Row) => row.workspace_id ?? personalWorkspaceId(row.owner_id)

/**
 * The other agents in an agent's workspace, oldest first: every agent of one person's own, or
 * every agent of a team. An agent can write to each of these and to no others.
 */
export async function agentsBeside(db: AppDatabase, agentId: string): Promise<string[]> {
  const agent = await db.get<Row>(
    "SELECT id, owner_id, workspace_id FROM dc_agents WHERE id = ?",
    agentId,
  )
  if (agent === undefined) return []
  const rows = await db.all<{ id: string }>(
    "SELECT id FROM dc_agents WHERE workspace_id = ? AND id != ? ORDER BY created_at",
    workspaceOf(agent),
    agentId,
  )
  return rows.map((row) => row.id)
}

/** Whether two agents are in one workspace, and so may write to each other. */
export async function areBeside(db: AppDatabase, one: string, other: string): Promise<boolean> {
  if (one === other) return false
  const rows = await db.all<Row>(
    "SELECT id, owner_id, workspace_id FROM dc_agents WHERE id IN (?, ?)",
    one,
    other,
  )
  return rows.length === 2 && workspaceOf(rows[0]!) === workspaceOf(rows[1]!)
}

/**
 * How an agent finds the other agents of its workspace and reaches them. It runs where the agent
 * does, which is not always where requests are served, so it is handed the database and the
 * agents instead of finding the platform. Who is beside whom is looked up each time something is
 * handed over, so an agent that was moved or deleted is not reached by what it was told before.
 */
export function agentDirectory(
  db: AppDatabase,
  agents: () => ActorNamespace,
  /**
   * How an agent makes another in its workspace. It needs what makes an agent from the app,
   * which whoever starts the agents has. Without it, an agent cannot.
   */
  create?: NonNullable<AgentDirectory["create"]>,
): AgentDirectory {
  const call = (agentId: string, path: string, body?: unknown) =>
    agents()
      .get(agentId)
      .fetch(
        new Request(`http://agent${path}`, {
          method: body === undefined ? "GET" : "POST",
          ...(body === undefined
            ? {}
            : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        }),
      )
  const problem = async (response: Response) => {
    const { error } = (await response.json().catch(() => ({}))) as { error?: string }
    return new Error(error ?? `The agent answered ${response.status}`)
  }
  return {
    ...(create === undefined ? {} : { create }),
    async list(agentId) {
      const ids = await agentsBeside(db, agentId)
      const found = await Promise.all(
        ids.map(async (id): Promise<PeerAgent | undefined> => {
          // One that cannot be reached right now is left out, and the rest are still listed.
          const response = await call(id, "/").catch(() => undefined)
          if (response === undefined || !response.ok) return undefined
          const { agent } = (await response.json()) as { agent: AgentSummary }
          return { id, name: agent.name, tagline: agent.tagline }
        }),
      )
      return found.filter((agent) => agent !== undefined)
    },
    async send(agentId, to, message) {
      if (!(await areBeside(db, agentId, to))) return undefined
      const response = await call(to, `/peers/${encodeURIComponent(agentId)}/message`, message)
      if (!response.ok) throw await problem(response)
      return (await response.json()) as { threadId: string }
    },
    async reply(agentId, to, reply) {
      if (!(await areBeside(db, agentId, to))) return false
      const response = await call(to, `/peers/${encodeURIComponent(agentId)}/reply`, reply)
      // The chat it asked from is gone, so there is nowhere left for an answer to go.
      if (response.status === 404) return false
      if (!response.ok) throw await problem(response)
      return true
    },
  }
}

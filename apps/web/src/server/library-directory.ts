import { personalWorkspaceId } from "@durable-computer/protocol"
import type { ActorNamespace, ActorStub, AppDatabase } from "@durable-computer/runtime"

/**
 * Where an agent's library is: the one its workspace keeps for all its agents. It runs where the
 * agent does, which is not always where requests are served, so it is handed the database and
 * the libraries instead of finding the platform. Looked up each time, since an agent can be
 * moved; undefined for an agent the record does not have.
 */
export function libraryDirectory(
  db: AppDatabase,
  libraries: ActorNamespace,
): (agentId: string) => Promise<ActorStub | undefined> {
  return async (agentId) => {
    const row = await db.get<{ owner_id: string; workspace_id: string | null }>(
      "SELECT owner_id, workspace_id FROM dc_agents WHERE id = ?",
      agentId,
    )
    if (row === undefined) return undefined
    return libraries.get(row.workspace_id ?? personalWorkspaceId(row.owner_id))
  }
}

import { personalWorkspaceId } from "@do-computer/protocol"
import type { ActorNamespace, ActorStub, AppDatabase } from "@do-computer/runtime"

/**
 * Where an agent's workspace keeps its sign-ins to model providers. It runs where the agent
 * does, which is not always where requests are served, so it is handed the database and the
 * actors instead of finding the platform. Looked up each time, since an agent can be moved;
 * undefined for an agent the record does not have.
 */
export function modelAccessDirectory(
  db: AppDatabase,
  modelAccess: ActorNamespace,
): (agentId: string) => Promise<ActorStub | undefined> {
  return async (agentId) => {
    const row = await db.get<{ owner_id: string; workspace_id: string | null }>(
      "SELECT owner_id, workspace_id FROM dc_agents WHERE id = ?",
      agentId,
    )
    if (row === undefined) return undefined
    return modelAccess.get(row.workspace_id ?? personalWorkspaceId(row.owner_id))
  }
}

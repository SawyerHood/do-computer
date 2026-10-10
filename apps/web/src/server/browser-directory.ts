import { personalWorkspaceId } from "@durable-computer/protocol"
import type { AppDatabase } from "@durable-computer/runtime"
import { showsBrowser } from "./teams.ts"

/**
 * Whether the browser an agent uses on a computer is shown there, as the agent's workspace has
 * it. It runs where the agent does, which is not always where requests are served, so it is
 * handed the database instead of finding the platform. Looked up each time, since the choice
 * can be changed and an agent can be moved; undefined for an agent the record does not have.
 */
export function browserDirectory(
  db: AppDatabase,
): (agentId: string) => Promise<boolean | undefined> {
  return async (agentId) => {
    const row = await db.get<{ owner_id: string; workspace_id: string | null }>(
      "SELECT owner_id, workspace_id FROM dc_agents WHERE id = ?",
      agentId,
    )
    if (row === undefined) return undefined
    return showsBrowser(db, row.workspace_id ?? personalWorkspaceId(row.owner_id))
  }
}

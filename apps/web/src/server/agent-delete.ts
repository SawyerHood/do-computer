import { getPlatform } from "#platform"
import { callAgent, fail, json, ownedAgent } from "./agents.ts"
import type { SessionUser } from "./auth.ts"
import { removeComputer } from "./computers.ts"

/**
 * Delete an agent for good: its paired computers' access, its own computer, and everything it has
 * stored. The row that makes it reachable goes last, so a failure leaves something to retry.
 */
export async function deleteAgent(user: SessionUser, agentId: string): Promise<Response> {
  if ((await ownedAgent(user, agentId)) === undefined) return fail(404, "Agent not found")
  const { db } = getPlatform()
  const computers = await db.all<{ id: string }>(
    "SELECT id FROM dc_computers WHERE agent_id = ? AND owner_id = ?",
    agentId,
    user.id,
  )
  for (const computer of computers) await removeComputer(user, computer.id)
  const response = await callAgent(agentId, "/destroy", { method: "POST" })
  if (!response.ok) return response
  await db.batch([
    { sql: "DELETE FROM dc_oauth_states WHERE agent_id = ?", params: [agentId] },
    { sql: "DELETE FROM dc_agents WHERE id = ?", params: [agentId] },
  ])
  return json({ ok: true })
}

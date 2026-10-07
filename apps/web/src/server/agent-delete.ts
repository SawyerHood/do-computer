import { getPlatform } from "#platform"
import { agentFor, callAgent, fail, json } from "./agents.ts"
import type { SessionUser } from "./auth.ts"
import { removeComputersOf } from "./computers.ts"
import { announce } from "./presence.ts"
import { mayRemoveAgent } from "./teams.ts"

/**
 * Delete an agent for good: its paired computers' access, its own computer, and everything it has
 * stored. The row that makes it reachable goes last, so a failure leaves something to retry.
 */
export async function deleteAgent(user: SessionUser, agentId: string): Promise<Response> {
  const access = await agentFor(user, agentId)
  if (access === undefined) return fail(404, "Agent not found")
  // A team's agent is everyone's, so deleting it is for the people who run the team.
  if (!mayRemoveAgent(access)) return fail(403, "Only an admin can delete a team's agent.")
  const { db } = getPlatform()
  await removeComputersOf(agentId)
  const response = await callAgent(agentId, "/destroy", { method: "POST" })
  if (!response.ok) return response
  await db.batch([
    { sql: "DELETE FROM dc_oauth_states WHERE agent_id = ?", params: [agentId] },
    { sql: "DELETE FROM dc_agents WHERE id = ?", params: [agentId] },
  ])
  await announce(access.workspaceId)
  return json({ ok: true })
}

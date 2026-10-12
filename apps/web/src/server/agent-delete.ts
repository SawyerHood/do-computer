import { getPlatform } from "#platform"
import { agentFor, callAgent, fail, json } from "./agents.ts"
import type { SessionUser } from "./auth.ts"
import { deleteMachinesOf, forgetComputersOf, forgetMachines } from "./computers.ts"
import { announce } from "./presence.ts"
import { mayRemoveAgent } from "./teams.ts"

/**
 * Delete an agent for good: its access to computers, and everything it has stored. The machines
 * that only it could use are deleted too, unless `keepComputers` says to leave them in the
 * workspace. Its files in the workspace's library stay: they are the workspace's. The row that
 * makes it reachable goes last, so a failure leaves something to retry.
 */
export async function deleteAgent(
  user: SessionUser,
  agentId: string,
  keepComputers = false,
): Promise<Response> {
  const access = await agentFor(user, agentId)
  if (access === undefined) return fail(404, "Agent not found")
  // A team's agent is everyone's, so deleting it is for the people who run the team.
  if (!mayRemoveAgent(access)) return fail(403, "Only an admin can delete a team's agent.")
  const { db } = getPlatform()
  // The machines first, while nothing else is lost yet. If a provider cannot be reached the
  // agent is left whole, to try again, instead of a machine being paid for that nobody can find.
  const gone = await deleteMachinesOf(agentId, keepComputers)
  if (gone instanceof Response) return gone
  await forgetMachines(gone)
  await forgetComputersOf(agentId)
  const response = await callAgent(agentId, "/destroy", { method: "POST" })
  if (!response.ok) return response
  await db.batch([
    { sql: "DELETE FROM dc_oauth_states WHERE agent_id = ?", params: [agentId] },
    { sql: "DELETE FROM dc_slack_apps WHERE agent_id = ?", params: [agentId] },
    { sql: "DELETE FROM dc_agent_seen WHERE agent_id = ?", params: [agentId] },
    { sql: "DELETE FROM dc_agents WHERE id = ?", params: [agentId] },
  ])
  await announce(access.workspaceId)
  return json({ ok: true })
}

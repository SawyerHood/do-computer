import { getPlatform } from "#platform"
import {
  agentFor,
  fail,
  json,
  MAX_AGENTS_PER_WORKSPACE,
  teamName,
  tellAgentItsTeam,
} from "./agents.ts"
import type { SessionUser } from "./auth.ts"
import { removeMisfitComputersOf } from "./computers.ts"
import { announce } from "./presence.ts"
import { mayRemoveAgent, roleIn } from "./teams.ts"

/**
 * Move an agent to another of the user's workspaces, with everything it has. Whoever could
 * delete it where it is can move it, to anywhere they are a member.
 */
export async function moveAgent(
  user: SessionUser,
  agentId: string,
  workspaceId: unknown,
): Promise<Response> {
  const { db } = getPlatform()
  const access = await agentFor(user, agentId)
  if (access === undefined) return fail(404, "Agent not found")
  if (typeof workspaceId !== "string") return fail(400, "Say which workspace to move it to.")
  if (!mayRemoveAgent(access)) return fail(403, "Only an admin can move a team's agent.")
  if ((await roleIn(db, user.id, workspaceId)) === undefined) return fail(404, "Team not found")
  if (workspaceId === access.workspaceId) return json({ ok: true })
  const count = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dc_agents WHERE workspace_id = ?",
    workspaceId,
  )
  if ((count?.n ?? 0) >= MAX_AGENTS_PER_WORKSPACE) {
    return fail(409, `It is full there: at most ${MAX_AGENTS_PER_WORKSPACE} agents.`)
  }
  // Told first: an agent that thinks it is in a team it is not yet in does no harm, and one
  // that is shared without knowing it would talk as if to one person.
  if (!(await tellAgentItsTeam(agentId, await teamName(workspaceId)))) {
    return fail(502, "The agent could not be told. Try again.")
  }
  await db.run("UPDATE dc_agents SET workspace_id = ? WHERE id = ?", workspaceId, agentId)
  // A computer connected to it served the people it was shared with then. One that belongs to
  // a team it has left, or to someone who is not among the people it is shared with now, stops.
  await removeMisfitComputersOf(agentId)
  await announce(access.workspaceId)
  await announce(workspaceId)
  return json({ ok: true })
}

import { getPlatform } from "#platform"
import type { AgentSummary, Outfit } from "@do-computer/protocol"
import {
  agentFor,
  callAgent,
  fail,
  json,
  MAX_AGENTS_PER_WORKSPACE,
  teamName,
  tellAgentItsTeam,
} from "./agents.ts"
import type { SessionUser } from "./auth.ts"
import { moveMachinesOf, removeMisfitComputersOf } from "./computers.ts"
import { defaultModelIn, offersModel } from "./models.ts"
import { announce } from "./presence.ts"
import { mayRemoveAgent, roleIn } from "./teams.ts"
import { addToWardrobe } from "./wardrobe.ts"

/**
 * An agent runs on a model of a provider its workspace is signed in to only while it is there.
 * Moved to a workspace that is not signed in to it, it is set to that workspace's usual model,
 * so that it goes on answering.
 */
async function keepRunnable(agentId: string, workspaceId: string): Promise<void> {
  const response = await callAgent(agentId, "/").catch(() => undefined)
  if (response === undefined || !response.ok) return
  const { agent } = (await response.json()) as { agent: AgentSummary }
  if (await offersModel(agent.model, workspaceId)) return
  await callAgent(agentId, "/", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: await defaultModelIn(workspaceId) }),
  }).catch(() => undefined)
}

/**
 * The wardrobe stays with the workspace an agent leaves, as the library does, and it keeps on
 * what it has on: those things go into the wardrobe where it arrives, as found by it.
 */
async function bringWhatItWears(agentId: string, workspaceId: string): Promise<void> {
  const response = await callAgent(agentId, "/creature").catch(() => undefined)
  if (response === undefined || !response.ok) return
  const { outfit } = (await response.json()) as { outfit?: Outfit }
  await addToWardrobe(workspaceId, Object.values(outfit ?? {}), agentId).catch(() => undefined)
}

/**
 * Move an agent to another of the user's workspaces, with what is its own: its memory, chats,
 * skills and connectors, and the machines that only it can use. The library it wrote in stays
 * with the workspace it leaves, and where it arrives it has that workspace's. Whoever could
 * delete it where it is can move it, to anywhere they are a member.
 */
export async function moveAgent(
  user: SessionUser,
  agentId: string,
  workspaceId: unknown,
): Promise<Response> {
  const { db } = getPlatform()
  const access = await agentFor(user, agentId)
  if (access === undefined) return fail(404, "Dood not found")
  if (typeof workspaceId !== "string") return fail(400, "Say which workspace to move it to.")
  if (!mayRemoveAgent(access)) return fail(403, "Only an admin can move a team's Dood.")
  if ((await roleIn(db, user.id, workspaceId)) === undefined) return fail(404, "Team not found")
  if (workspaceId === access.workspaceId) return json({ ok: true })
  const count = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dc_agents WHERE workspace_id = ?",
    workspaceId,
  )
  if ((count?.n ?? 0) >= MAX_AGENTS_PER_WORKSPACE) {
    return fail(409, `It is full there: at most ${MAX_AGENTS_PER_WORKSPACE} Doods.`)
  }
  // Told first: an agent that thinks it is in a team it is not yet in does no harm, and one
  // that is shared without knowing it would talk as if to one person.
  if (!(await tellAgentItsTeam(agentId, await teamName(workspaceId)))) {
    return fail(502, "The Dood could not be told. Try again.")
  }
  await db.run("UPDATE dc_agents SET workspace_id = ? WHERE id = ?", workspaceId, agentId)
  await keepRunnable(agentId, workspaceId)
  await moveMachinesOf(agentId, workspaceId)
  // A computer connected to it served the people it was shared with then. One that belongs to
  // a team it has left, or to someone who is not among the people it is shared with now, stops.
  await removeMisfitComputersOf(agentId)
  await bringWhatItWears(agentId, workspaceId)
  await announce(access.workspaceId)
  await announce(workspaceId)
  return json({ ok: true })
}

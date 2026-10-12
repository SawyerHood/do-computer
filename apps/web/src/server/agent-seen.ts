import { getPlatform } from "#platform"
import { agentFor, fail, json } from "./agents.ts"
import type { SessionUser } from "./auth.ts"

/**
 * The user is looking at an agent now. What it says from here on is new to them, and what it
 * said before is not. The time is this server's, never the client's, so that it can be compared
 * with when the agent said something. It is kept for each person apart: one member of a team
 * looking at an agent leaves it unread for the others.
 */
export async function markAgentSeen(user: SessionUser, agentId: string): Promise<Response> {
  const access = await agentFor(user, agentId)
  if (access === undefined) return fail(404, "Agent not found")
  const seenAt = Date.now()
  await getPlatform().db.run(
    `INSERT INTO dc_agent_seen (user_id, agent_id, seen_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id, agent_id) DO UPDATE SET seen_at = excluded.seen_at`,
    user.id,
    agentId,
    seenAt,
  )
  return json({ seenAt })
}

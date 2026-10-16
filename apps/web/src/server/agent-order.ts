import { type DoodOrder, readOrderIds } from "@do-computer/protocol"
import { getPlatform } from "#platform"
import { fail, json } from "./agents.ts"
import type { SessionUser } from "./auth.ts"
import { tellPerson } from "./feed.ts"
import { roleIn, workspaceIdsOf } from "./teams.ts"

/**
 * The order the user put each of their workspaces' Doods in by hand. A workspace they have left
 * since is not in it, and one they never put in order is not either. An id that is no longer a
 * Dood of its workspace is left for the app to pass over, which it must do anyway for a Dood
 * moved or deleted since.
 */
export async function readAgentOrder(user: SessionUser): Promise<Response> {
  const { db } = getPlatform()
  const workspaceIds = new Set(await workspaceIdsOf(db, user.id))
  const rows = await db.all<{ workspace_id: string; agent_ids: string }>(
    "SELECT workspace_id, agent_ids FROM dc_agent_order WHERE user_id = ?",
    user.id,
  )
  const order: Record<string, string[]> = {}
  for (const row of rows) {
    if (!workspaceIds.has(row.workspace_id)) continue
    const ids = readOrderIds(parse(row.agent_ids))
    if (ids !== undefined) order[row.workspace_id] = ids
  }
  return json({ order: order satisfies DoodOrder })
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Keep the order the user put a workspace's Doods in: `ids`, the top one first. Only the
 * workspace's own Doods are kept of it, so that what is kept says nothing of anyone else's.
 *
 * With `carried` it is an order this browser kept before the server did, carried up once: it
 * stands only where the user has no order for the workspace yet, so that a second browser
 * carrying its own does not undo the first. Either way the answer is what is kept now.
 */
export async function writeAgentOrder(
  user: SessionUser,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  const { db, presence } = getPlatform()
  if ((await roleIn(db, user.id, workspaceId)) === undefined) {
    return fail(404, "Workspace not found")
  }
  const input = (await request.json().catch(() => null)) as {
    ids?: unknown
    carried?: unknown
  } | null
  const asked = readOrderIds(input?.ids)
  if (asked === undefined) return fail(400, "An order is a list of the Doods' ids")
  const theirs = new Set(
    (
      await db.all<{ id: string }>("SELECT id FROM dc_agents WHERE workspace_id = ?", workspaceId)
    ).map((row) => row.id),
  )
  const ids = asked.filter((id) => theirs.has(id))
  const carried = input?.carried === true
  const kept = async () => {
    const row = await db.get<{ agent_ids: string }>(
      "SELECT agent_ids FROM dc_agent_order WHERE user_id = ? AND workspace_id = ?",
      user.id,
      workspaceId,
    )
    return row === undefined ? undefined : (readOrderIds(parse(row.agent_ids)) ?? [])
  }
  if (carried) {
    const before = await kept()
    if (before !== undefined) return json({ ids: before })
  }
  await db.run(
    `INSERT INTO dc_agent_order (user_id, workspace_id, agent_ids, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, workspace_id) DO ${
         // Another browser may have carried its own up in the moment since it was looked for.
         carried
           ? "NOTHING"
           : "UPDATE SET agent_ids = excluded.agent_ids, updated_at = excluded.updated_at"
       }`,
    user.id,
    workspaceId,
    JSON.stringify(ids),
    Date.now(),
  )
  const now = carried ? ((await kept()) ?? ids) : ids
  // Their other tabs and devices put the workspace in the same order.
  await tellPerson(presence, user.id, { type: "order", workspaceId, ids: now })
  return json({ ids: now })
}

/** Give up the order the user put a workspace's Doods in: they are latest-first again. */
export async function forgetAgentOrder(user: SessionUser, workspaceId: string): Promise<Response> {
  const { db, presence } = getPlatform()
  if ((await roleIn(db, user.id, workspaceId)) === undefined) {
    return fail(404, "Workspace not found")
  }
  await db.run(
    "DELETE FROM dc_agent_order WHERE user_id = ? AND workspace_id = ?",
    user.id,
    workspaceId,
  )
  await tellPerson(presence, user.id, { type: "order", workspaceId, ids: null })
  return json({ ids: null })
}

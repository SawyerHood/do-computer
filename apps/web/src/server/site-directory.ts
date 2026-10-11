import { type SiteDirectory, SiteError } from "@durable-computer/agent"
import {
  MAX_SITE_TITLE,
  MAX_SITES_PER_WORKSPACE,
  personalWorkspaceId,
  type SiteSummary,
} from "@durable-computer/protocol"
import type { AppDatabase } from "@durable-computer/runtime"

/**
 * A site as it is kept: a page or a folder of a workspace's library, given an address. `secret`
 * signs the addresses its files are served at, and is made anew whenever fewer people may open
 * the site, so that an address handed out before stops working at once.
 */
export type SiteRow = {
  id: string
  workspace_id: string
  path: string
  title: string
  public: number
  secret: string
  agent_id: string | null
  user_id: string | null
  created_at: number
  updated_at: number
}

const COLUMNS =
  "id, workspace_id, path, title, public, secret, agent_id, user_id, created_at, updated_at"

export const siteOf = (row: SiteRow): SiteSummary => ({
  id: row.id,
  path: row.path,
  title: row.title,
  public: row.public === 1,
  agentId: row.agent_id,
  userId: row.user_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

/** Letters and digits that are not mistaken for one another when read aloud or typed. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"

/** What a site's address ends in: sixteen characters nobody could guess. */
function newSiteId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("")
}

function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function siteById(db: AppDatabase, siteId: string): Promise<SiteRow | undefined> {
  return db.get<SiteRow>(`SELECT ${COLUMNS} FROM dc_sites WHERE id = ?`, siteId)
}

/** The sites of a workspace, newest first. */
export async function sitesOf(db: AppDatabase, workspaceId: string): Promise<SiteSummary[]> {
  const rows = await db.all<SiteRow>(
    `SELECT ${COLUMNS} FROM dc_sites WHERE workspace_id = ? ORDER BY created_at DESC, id`,
    workspaceId,
  )
  return rows.map(siteOf)
}

/**
 * Share what is at `path` in a workspace's library. A place that is shared already keeps its
 * address and who can open it, and takes the new title if one is given. Whether there is
 * anything at `path` is for the caller to have looked: it has the library.
 */
export async function shareSite(
  db: AppDatabase,
  workspaceId: string,
  input: { path: string; title?: string; agentId?: string; userId?: string },
): Promise<SiteSummary> {
  const title = input.title?.replace(/\s+/g, " ").trim().slice(0, MAX_SITE_TITLE)
  const existing = await db.get<SiteRow>(
    `SELECT ${COLUMNS} FROM dc_sites WHERE workspace_id = ? AND path = ?`,
    workspaceId,
    input.path,
  )
  const now = Date.now()
  if (existing !== undefined) {
    if (title === undefined || title === "" || title === existing.title) return siteOf(existing)
    await db.run(
      "UPDATE dc_sites SET title = ?, updated_at = ? WHERE id = ?",
      title,
      now,
      existing.id,
    )
    return siteOf({ ...existing, title, updated_at: now })
  }
  const count = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dc_sites WHERE workspace_id = ?",
    workspaceId,
  )
  if ((count?.n ?? 0) >= MAX_SITES_PER_WORKSPACE) {
    throw new SiteError(
      `The workspace already shares ${MAX_SITES_PER_WORKSPACE} sites, which is the most it can. Stop sharing one first.`,
    )
  }
  const row: SiteRow = {
    id: newSiteId(),
    workspace_id: workspaceId,
    path: input.path,
    title: title === undefined || title === "" ? input.path : title,
    public: 0,
    secret: newSecret(),
    agent_id: input.agentId ?? null,
    user_id: input.userId ?? null,
    created_at: now,
    updated_at: now,
  }
  await db.run(
    `INSERT INTO dc_sites (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.workspace_id,
    row.path,
    row.title,
    row.public,
    row.secret,
    row.agent_id,
    row.user_id,
    row.created_at,
    row.updated_at,
  )
  return siteOf(row)
}

/** Change a site's title, or who can open it. Undefined for a site the workspace does not have. */
export async function changeSite(
  db: AppDatabase,
  workspaceId: string,
  siteId: string,
  change: { public?: boolean; title?: string },
): Promise<SiteSummary | undefined> {
  const row = await siteById(db, siteId)
  if (row === undefined || row.workspace_id !== workspaceId) return undefined
  const title = change.title?.replace(/\s+/g, " ").trim().slice(0, MAX_SITE_TITLE)
  const next: SiteRow = {
    ...row,
    title: title === undefined || title === "" ? row.title : title,
    public: change.public === undefined ? row.public : change.public ? 1 : 0,
    updated_at: Date.now(),
  }
  // Closed to those outside: the addresses its files were served at stop working now.
  if (row.public === 1 && next.public === 0) next.secret = newSecret()
  await db.run(
    "UPDATE dc_sites SET title = ?, public = ?, secret = ?, updated_at = ? WHERE id = ?",
    next.title,
    next.public,
    next.secret,
    next.updated_at,
    siteId,
  )
  return siteOf(next)
}

/** Stop sharing a site. Whether the workspace had it. */
export async function stopSite(
  db: AppDatabase,
  workspaceId: string,
  siteId: string,
): Promise<boolean> {
  const row = await siteById(db, siteId)
  if (row === undefined || row.workspace_id !== workspaceId) return false
  await db.run("DELETE FROM dc_sites WHERE id = ?", siteId)
  return true
}

/**
 * The sites of an agent's workspace, for the agent. It runs where the agent does, which is not
 * always where requests are served, so it is handed the database instead of finding the
 * platform. Which workspace that is is looked up each time, since an agent can be moved.
 */
export function siteDirectory(db: AppDatabase): SiteDirectory {
  const workspaceOf = async (agentId: string): Promise<string> => {
    const row = await db.get<{ owner_id: string; workspace_id: string | null }>(
      "SELECT owner_id, workspace_id FROM dc_agents WHERE id = ?",
      agentId,
    )
    if (row === undefined) throw new SiteError("This agent is not in a workspace any more.")
    return row.workspace_id ?? personalWorkspaceId(row.owner_id)
  }
  return {
    list: async (agentId) => sitesOf(db, await workspaceOf(agentId)),
    publish: async (agentId, input) =>
      shareSite(db, await workspaceOf(agentId), { ...input, agentId }),
    setPublic: async (agentId, siteId, open) =>
      changeSite(db, await workspaceOf(agentId), siteId, { public: open }),
    remove: async (agentId, siteId) => stopSite(db, await workspaceOf(agentId), siteId),
  }
}

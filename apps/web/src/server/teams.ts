import {
  type Invitation,
  type InvitationPreview,
  type InviteRequest,
  type InviteResult,
  isPersonalWorkspace,
  type Person,
  personalWorkspaceId,
  type SentInvitation,
  WORKSPACE_COLORS,
  type WorkspaceMember,
  type WorkspaceOptions,
  type WorkspaceRole,
  type WorkspaceSummary,
} from "@do-computer/protocol"
import type { AppDatabase } from "@do-computer/runtime"

/**
 * Teams, their members and their invitations, as rows in the app database. Nothing here knows
 * about requests or the platform, so that who may do what can be tested against a database alone.
 */

const MAX_TEAMS_PER_USER = 20
const MAX_MEMBERS = 50
const MAX_PENDING_INVITATIONS = 50
const MAX_NAME_CHARS = 60
const MAX_NOTE_CHARS = 500
/** How many people one request may invite. Each GitHub username is looked up at GitHub. */
const MAX_INVITED_AT_ONCE = 20
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60_000

/** Something the caller may not do, or asked for wrongly. Answered with its status and words. */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** The signed-in user, as far as teams need to know them. */
export type Who = {
  id: string
  email: string
  name: string
  image?: string | null | undefined
  /** Whether the address is known to be theirs. Only then does an invitation to it find them. */
  emailVerified?: boolean | undefined
}

export type GithubUser = { id: string; login: string; name: string | null }

/** What inviting needs from outside the database. */
export type InviteDeps = {
  /** The app's public address, for the link. */
  origin: string
  now?: () => number
  /** Look a GitHub username up. Undefined when there is no such account. */
  github: (login: string) => Promise<GithubUser | undefined>
  /** Send the invitation by email. Resolves false when no mail is set up or it did not go. */
  email: (message: { to: string; subject: string; text: string }) => Promise<boolean>
}

const RANK: Record<WorkspaceRole, number> = { member: 1, admin: 2, owner: 3 }
const atLeast = (role: WorkspaceRole | undefined, wanted: WorkspaceRole) =>
  role !== undefined && RANK[role] >= RANK[wanted]

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function randomToken(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...raw))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
}

/** What the user is in a workspace, or undefined when they are not in it. */
export async function roleIn(
  db: AppDatabase,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole | undefined> {
  if (isPersonalWorkspace(workspaceId)) {
    return workspaceId === personalWorkspaceId(userId) ? "owner" : undefined
  }
  const row = await db.get<{ role: WorkspaceRole }>(
    "SELECT role FROM dc_members WHERE workspace_id = ? AND user_id = ?",
    workspaceId,
    userId,
  )
  return row?.role
}

export type AgentAccess = {
  id: string
  /** Who made it. */
  ownerId: string
  workspaceId: string
  createdAt: number
  /** What the user is in the agent's workspace. */
  role: WorkspaceRole
}

/**
 * An agent the user may use, or undefined. This is the one place that decides it: an agent is
 * reachable by the members of its workspace and by nobody else.
 */
export async function agentAccess(
  db: AppDatabase,
  userId: string,
  agentId: string,
): Promise<AgentAccess | undefined> {
  const row = await db.get<{
    id: string
    owner_id: string
    workspace_id: string | null
    created_at: number
  }>("SELECT id, owner_id, workspace_id, created_at FROM dc_agents WHERE id = ?", agentId)
  if (row === undefined) return undefined
  const workspaceId = row.workspace_id ?? personalWorkspaceId(row.owner_id)
  const role = await roleIn(db, userId, workspaceId)
  if (role === undefined) return undefined
  return { id: row.id, ownerId: row.owner_id, workspaceId, createdAt: row.created_at, role }
}

/** Whether the user may delete the agent or move it elsewhere: its team's admins, or its owner. */
export const mayRemoveAgent = (access: AgentAccess) => atLeast(access.role, "admin")

/** The ids of every workspace the user is in, their own first. */
export async function workspaceIdsOf(db: AppDatabase, userId: string): Promise<string[]> {
  const rows = await db.all<{ workspace_id: string }>(
    "SELECT workspace_id FROM dc_members WHERE user_id = ? ORDER BY created_at",
    userId,
  )
  return [personalWorkspaceId(userId), ...rows.map((row) => row.workspace_id)]
}

/** Everyone who should hear from an agent: its owner, or the members of its team. */
export async function peopleOfAgent(db: AppDatabase, agentId: string): Promise<string[]> {
  const row = await db.get<{ owner_id: string; workspace_id: string | null }>(
    "SELECT owner_id, workspace_id FROM dc_agents WHERE id = ?",
    agentId,
  )
  if (row === undefined) return []
  if (row.workspace_id === null || isPersonalWorkspace(row.workspace_id)) return [row.owner_id]
  const members = await db.all<{ user_id: string }>(
    "SELECT user_id FROM dc_members WHERE workspace_id = ?",
    row.workspace_id,
  )
  return members.map((member) => member.user_id)
}

type MemberRow = {
  workspace_id: string
  user_id: string
  role: WorkspaceRole
  created_at: number
  name: string | null
  email: string | null
  image: string | null
}

async function membersOf(
  db: AppDatabase,
  workspaceIds: readonly string[],
): Promise<Map<string, WorkspaceMember[]>> {
  const byWorkspace = new Map<string, WorkspaceMember[]>()
  if (workspaceIds.length === 0) return byWorkspace
  const rows = await db.all<MemberRow>(
    `SELECT m.workspace_id, m.user_id, m.role, m.created_at, u.name, u.email, u.image
       FROM dc_members m LEFT JOIN user u ON u.id = m.user_id
      WHERE m.workspace_id IN (${workspaceIds.map(() => "?").join(", ")})
      ORDER BY m.created_at, m.rowid`,
    ...workspaceIds,
  )
  for (const row of rows) {
    const list = byWorkspace.get(row.workspace_id) ?? []
    list.push({
      id: row.user_id,
      name: row.name ?? "Someone",
      email: row.email ?? "",
      image: row.image,
      role: row.role,
      joinedAt: row.created_at,
    })
    byWorkspace.set(row.workspace_id, list)
  }
  return byWorkspace
}

type WorkspaceRow = {
  id: string
  name: string
  color: string
  created_by: string
  created_at: number
}

/** The user's workspaces: their own, then their teams in the order they joined them. */
export async function listWorkspaces(db: AppDatabase, who: Who): Promise<WorkspaceSummary[]> {
  const rows = await db.all<WorkspaceRow & { role: WorkspaceRole }>(
    `SELECT w.id, w.name, w.color, w.created_by, w.created_at, m.role
       FROM dc_members m JOIN dc_workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ? ORDER BY m.created_at`,
    who.id,
  )
  const members = await membersOf(
    db,
    rows.map((row) => row.id),
  )
  return [
    {
      id: personalWorkspaceId(who.id),
      name: "Personal",
      color: WORKSPACE_COLORS[0].id,
      kind: "personal",
      role: "owner",
      members: [
        {
          id: who.id,
          name: who.name,
          email: who.email,
          image: who.image ?? null,
          role: "owner",
          joinedAt: 0,
        },
      ],
      createdAt: 0,
    },
    ...rows.map((row): WorkspaceSummary => ({
      id: row.id,
      name: row.name,
      color: row.color,
      kind: "team",
      role: row.role,
      members: members.get(row.id) ?? [],
      createdAt: row.created_at,
    })),
  ]
}

function cleanName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Refusal(400, "A team needs a name.")
  }
  return value.trim().slice(0, MAX_NAME_CHARS)
}

function cleanColor(value: unknown): string {
  if (value === undefined) return WORKSPACE_COLORS[0].id
  if (!WORKSPACE_COLORS.some((color) => color.id === value)) {
    throw new Refusal(
      400,
      `A team's color is one of: ${WORKSPACE_COLORS.map((c) => c.id).join(", ")}.`,
    )
  }
  return value as string
}

/** Start a team, with the user as its owner. */
export async function createWorkspace(
  db: AppDatabase,
  who: Who,
  input: { name?: unknown; color?: unknown },
  now = Date.now(),
): Promise<string> {
  const name = cleanName(input.name)
  const color = cleanColor(input.color)
  const count = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dc_members WHERE user_id = ?",
    who.id,
  )
  if ((count?.n ?? 0) >= MAX_TEAMS_PER_USER) {
    throw new Refusal(409, `An account can be in at most ${MAX_TEAMS_PER_USER} teams.`)
  }
  const id = crypto.randomUUID()
  await db.batch([
    {
      sql: "INSERT INTO dc_workspaces (id, name, color, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
      params: [id, name, color, who.id, now],
    },
    {
      sql: "INSERT INTO dc_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
      params: [id, who.id, now],
    },
  ])
  return id
}

async function require(
  db: AppDatabase,
  userId: string,
  workspaceId: string,
  wanted: WorkspaceRole,
): Promise<WorkspaceRole> {
  // A personal workspace has no people to manage and nothing to rename.
  if (isPersonalWorkspace(workspaceId)) throw new Refusal(404, "Team not found")
  const role = await roleIn(db, userId, workspaceId)
  // Someone outside a team is not told that it exists.
  if (role === undefined) throw new Refusal(404, "Team not found")
  if (!atLeast(role, wanted)) {
    throw new Refusal(
      403,
      wanted === "owner" ? "Only the team's owner can do that." : "Only an admin can do that.",
    )
  }
  return role
}

/** Rename a team or change its color. Resolves with its new name. */
export async function updateWorkspace(
  db: AppDatabase,
  who: Who,
  workspaceId: string,
  input: { name?: unknown; color?: unknown },
): Promise<{ name: string }> {
  await require(db, who.id, workspaceId, "admin")
  if (input.name !== undefined) {
    await db.run(
      "UPDATE dc_workspaces SET name = ? WHERE id = ?",
      cleanName(input.name),
      workspaceId,
    )
  }
  if (input.color !== undefined) {
    await db.run(
      "UPDATE dc_workspaces SET color = ? WHERE id = ?",
      cleanColor(input.color),
      workspaceId,
    )
  }
  const row = await db.get<{ name: string }>(
    "SELECT name FROM dc_workspaces WHERE id = ?",
    workspaceId,
  )
  return { name: row?.name ?? "" }
}

/**
 * Whether the browser a workspace's agents use on a computer opens in a window its owner can
 * watch. It does until someone there says otherwise.
 */
export async function showsBrowser(db: AppDatabase, workspaceId: string): Promise<boolean> {
  const row = await db.get<{ show_browser: number }>(
    "SELECT show_browser FROM dc_workspace_settings WHERE workspace_id = ?",
    workspaceId,
  )
  return row === undefined || row.show_browser !== 0
}

/** What a workspace has chosen for all its agents, for anyone in it to read. */
export async function workspaceOptions(
  db: AppDatabase,
  who: Who,
  workspaceId: string,
): Promise<WorkspaceOptions> {
  const role = await roleIn(db, who.id, workspaceId)
  // Someone outside a workspace is not told that it exists.
  if (role === undefined) throw new Refusal(404, "Workspace not found")
  return { showBrowser: await showsBrowser(db, workspaceId), canChange: atLeast(role, "admin") }
}

/**
 * Change what a workspace has chosen for all its agents: a team's admins may, and the owner of
 * a personal workspace.
 */
export async function updateWorkspaceOptions(
  db: AppDatabase,
  who: Who,
  workspaceId: string,
  input: { showBrowser?: unknown },
): Promise<void> {
  const role = await roleIn(db, who.id, workspaceId)
  if (role === undefined) throw new Refusal(404, "Workspace not found")
  if (!atLeast(role, "admin")) throw new Refusal(403, "Only an admin can do that.")
  if (input.showBrowser === undefined) return
  if (typeof input.showBrowser !== "boolean") {
    throw new Refusal(400, "Whether the browser is shown is true or false.")
  }
  await db.run(
    `INSERT INTO dc_workspace_settings (workspace_id, show_browser) VALUES (?, ?)
       ON CONFLICT (workspace_id) DO UPDATE SET show_browser = excluded.show_browser`,
    workspaceId,
    input.showBrowser ? 1 : 0,
  )
}

/** Delete a team. It has to be empty of agents first: deleting those is a decision of its own. */
export async function deleteWorkspace(
  db: AppDatabase,
  who: Who,
  workspaceId: string,
): Promise<void> {
  await require(db, who.id, workspaceId, "owner")
  const agents = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dc_agents WHERE workspace_id = ?",
    workspaceId,
  )
  if ((agents?.n ?? 0) > 0) {
    throw new Refusal(409, "Move or delete the team's Doods first.")
  }
  await db.batch([
    { sql: "DELETE FROM dc_invitations WHERE workspace_id = ?", params: [workspaceId] },
    { sql: "DELETE FROM dc_members WHERE workspace_id = ?", params: [workspaceId] },
    { sql: "DELETE FROM dc_workspaces WHERE id = ?", params: [workspaceId] },
    { sql: "DELETE FROM dc_workspace_settings WHERE workspace_id = ?", params: [workspaceId] },
    { sql: "DELETE FROM dc_sites WHERE workspace_id = ?", params: [workspaceId] },
  ])
}

/**
 * Change what someone is in a team. Admins are made and unmade by the owner. Making someone else
 * the owner hands the team on: the one who was becomes an admin.
 */
export async function setRole(
  db: AppDatabase,
  who: Who,
  workspaceId: string,
  userId: string,
  role: unknown,
): Promise<void> {
  await require(db, who.id, workspaceId, "owner")
  if (role !== "owner" && role !== "admin" && role !== "member") {
    throw new Refusal(400, "A role is owner, admin or member.")
  }
  if (userId === who.id)
    throw new Refusal(409, "Hand the team to someone else to change your own role.")
  if ((await roleIn(db, userId, workspaceId)) === undefined) {
    throw new Refusal(404, "They are not in this team.")
  }
  const change = {
    sql: "UPDATE dc_members SET role = ? WHERE workspace_id = ? AND user_id = ?",
    params: [role, workspaceId, userId],
  }
  await db.batch(
    role === "owner"
      ? [
          {
            sql: "UPDATE dc_members SET role = 'admin' WHERE workspace_id = ? AND user_id = ?",
            params: [workspaceId, who.id],
          },
          change,
        ]
      : [change],
  )
}

/**
 * Take someone out of a team, or leave it. An admin removes members, the owner removes anyone, and
 * anyone but the owner can leave: a team always has its owner.
 */
export async function removeMember(
  db: AppDatabase,
  who: Who,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const mine = await require(db, who.id, workspaceId, "member")
  const theirs = await roleIn(db, userId, workspaceId)
  if (theirs === undefined) throw new Refusal(404, "They are not in this team.")
  if (theirs === "owner") {
    throw new Refusal(
      409,
      userId === who.id
        ? "Hand the team to someone else before you leave it."
        : "The team's owner cannot be removed.",
    )
  }
  if (userId !== who.id && !(atLeast(mine, "admin") && RANK[mine] > RANK[theirs])) {
    throw new Refusal(403, "Only an admin can remove someone, and only the owner an admin.")
  }
  await db.run("DELETE FROM dc_members WHERE workspace_id = ? AND user_id = ?", workspaceId, userId)
}

type InvitationRow = {
  id: string
  workspace_id: string
  email: string | null
  github_id: string | null
  github_login: string | null
  role: "admin" | "member"
  note: string | null
  invited_by: string
  created_at: number
  expires_at: number
  inviter_name: string | null
  inviter_image: string | null
}

const INVITATION_COLUMNS = `i.id, i.workspace_id, i.email, i.github_id, i.github_login, i.role, i.note,
  i.invited_by, i.created_at, i.expires_at, u.name AS inviter_name, u.image AS inviter_image`
const INVITATIONS = `SELECT ${INVITATION_COLUMNS} FROM dc_invitations i LEFT JOIN user u ON u.id = i.invited_by`

const inviter = (row: InvitationRow): Person => ({
  id: row.invited_by,
  name: row.inviter_name ?? "Someone",
  image: row.inviter_image,
})

const invitation = (row: InvitationRow): Invitation => ({
  id: row.id,
  workspaceId: row.workspace_id,
  email: row.email,
  githubLogin: row.github_login,
  role: row.role,
  note: row.note,
  invitedBy: inviter(row),
  createdAt: row.created_at,
  expiresAt: row.expires_at,
})

/** The people a team has asked who have not answered. Any member can see who is on the way. */
export async function listInvitations(
  db: AppDatabase,
  who: Who,
  workspaceId: string,
  now = Date.now(),
): Promise<Invitation[]> {
  await require(db, who.id, workspaceId, "member")
  const rows = await db.all<InvitationRow>(
    `${INVITATIONS} WHERE i.workspace_id = ? AND i.expires_at >= ? ORDER BY i.created_at`,
    workspaceId,
    now,
  )
  return rows.map(invitation)
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** GitHub's own rule: letters, digits and single hyphens, not at either end, up to 39. */
const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i

function invitationText(
  team: string,
  from: string,
  link: string,
  note: string | null,
): { subject: string; text: string } {
  return {
    subject: `${from} invited you to ${team} on Do Computer`,
    text: [
      `${from} invited you to join ${team} on Do Computer, where you would share its Doods and their chats.`,
      ...(note === null ? [] : ["", `"${note}"`]),
      "",
      `Join here: ${link}`,
      "",
      "The link works for seven days. If you were not expecting this, you can ignore it.",
    ].join("\n"),
  }
}

/**
 * Ask people to join a team, each by an email address or a GitHub username. Everyone asked gets a
 * link of their own, which the sender is shown once; an email address is also written to, where
 * the deployment can send mail. Asking someone again replaces what they were sent before.
 */
export async function invite(
  db: AppDatabase,
  who: Who,
  workspaceId: string,
  input: InviteRequest,
  deps: InviteDeps,
): Promise<InviteResult> {
  await require(db, who.id, workspaceId, "admin")
  const now = deps.now?.() ?? Date.now()
  const role = input.role ?? "member"
  if (role !== "admin" && role !== "member")
    throw new Refusal(400, "Invite as a member or an admin.")
  if (!Array.isArray(input.who) || input.who.some((entry) => typeof entry !== "string")) {
    throw new Refusal(400, "Say who to invite: email addresses or GitHub usernames.")
  }
  const note =
    typeof input.note === "string" && input.note.trim() !== ""
      ? input.note.trim().slice(0, MAX_NOTE_CHARS)
      : null
  const team = await db.get<{ name: string }>(
    "SELECT name FROM dc_workspaces WHERE id = ?",
    workspaceId,
  )
  const members = (await membersOf(db, [workspaceId])).get(workspaceId) ?? []
  const result: InviteResult = { invitations: [], problems: [] }
  const entries = [...new Set(input.who.map((entry) => entry.trim()).filter(Boolean))]
  if (entries.length > MAX_INVITED_AT_ONCE) {
    throw new Refusal(400, `Invite at most ${MAX_INVITED_AT_ONCE} people at a time.`)
  }

  for (const entry of entries) {
    const problem = (error: string) => result.problems.push({ who: entry, error })
    let email: string | null = null
    let github: GithubUser | undefined
    if (EMAIL.test(entry)) {
      email = entry.toLowerCase()
      if (members.some((member) => member.email.toLowerCase() === email)) {
        problem("They are already in this team.")
        continue
      }
    } else {
      const login = entry.replace(/^@/, "")
      if (!GITHUB_LOGIN.test(login)) {
        problem("That is not an email address or a GitHub username.")
        continue
      }
      try {
        github = await deps.github(login)
      } catch {
        problem("GitHub could not be asked about that username just now. Try again.")
        continue
      }
      if (github === undefined) {
        problem("There is no GitHub account with that username.")
        continue
      }
      const linked = await db.get<{ userId: string }>(
        "SELECT userId FROM account WHERE providerId = 'github' AND accountId = ?",
        github.id,
      )
      if (linked !== undefined && members.some((member) => member.id === linked.userId)) {
        problem("They are already in this team.")
        continue
      }
    }
    const pending = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM dc_invitations WHERE workspace_id = ? AND expires_at >= ?",
      workspaceId,
      now,
    )
    if (members.length + (pending?.n ?? 0) >= MAX_MEMBERS) {
      problem(`A team can have at most ${MAX_MEMBERS} people.`)
      continue
    }
    if ((pending?.n ?? 0) >= MAX_PENDING_INVITATIONS) {
      problem("Too many invitations are waiting for an answer. Withdraw some first.")
      continue
    }
    const id = crypto.randomUUID()
    const token = randomToken()
    await db.batch([
      // Expired ones are swept up here, and so is anything this person was sent before.
      { sql: "DELETE FROM dc_invitations WHERE expires_at < ?", params: [now] },
      {
        sql:
          email === null
            ? "DELETE FROM dc_invitations WHERE workspace_id = ? AND github_id = ?"
            : "DELETE FROM dc_invitations WHERE workspace_id = ? AND email = ?",
        params: [workspaceId, email ?? github!.id],
      },
      {
        sql: `INSERT INTO dc_invitations
                (id, workspace_id, email, github_id, github_login, role, note, invited_by,
                 token_hash, created_at, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          id,
          workspaceId,
          email,
          github?.id ?? null,
          github?.login ?? null,
          role,
          note,
          who.id,
          await sha256(token),
          now,
          now + INVITATION_TTL_MS,
        ],
      },
    ])
    const link = `${deps.origin}/invite/${token}`
    const emailed =
      email === null
        ? false
        : await deps
            .email({ to: email, ...invitationText(team?.name ?? "a team", who.name, link, note) })
            .catch(() => false)
    result.invitations.push({
      id,
      workspaceId,
      email,
      githubLogin: github?.login ?? null,
      role,
      note,
      invitedBy: { id: who.id, name: who.name, image: who.image ?? null },
      createdAt: now,
      expiresAt: now + INVITATION_TTL_MS,
      link,
      emailed,
    } satisfies SentInvitation)
  }
  return result
}

/**
 * Give an invitation a new link and seven more days, and send it again. The old link stops
 * working: a link is only ever shown when it is made, so this is also how one is copied later.
 */
export async function renewInvitation(
  db: AppDatabase,
  who: Who,
  workspaceId: string,
  invitationId: string,
  deps: InviteDeps,
): Promise<SentInvitation> {
  await require(db, who.id, workspaceId, "admin")
  const now = deps.now?.() ?? Date.now()
  const row = await db.get<InvitationRow>(
    `${INVITATIONS} WHERE i.id = ? AND i.workspace_id = ?`,
    invitationId,
    workspaceId,
  )
  if (row === undefined) throw new Refusal(404, "That invitation is gone.")
  const token = randomToken()
  await db.run(
    "UPDATE dc_invitations SET token_hash = ?, expires_at = ? WHERE id = ?",
    await sha256(token),
    now + INVITATION_TTL_MS,
    row.id,
  )
  const team = await db.get<{ name: string }>(
    "SELECT name FROM dc_workspaces WHERE id = ?",
    workspaceId,
  )
  const link = `${deps.origin}/invite/${token}`
  const emailed =
    row.email === null
      ? false
      : await deps
          .email({
            to: row.email,
            ...invitationText(team?.name ?? "a team", inviter(row).name, link, row.note),
          })
          .catch(() => false)
  return { ...invitation(row), expiresAt: now + INVITATION_TTL_MS, link, emailed }
}

export async function withdrawInvitation(
  db: AppDatabase,
  who: Who,
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  await require(db, who.id, workspaceId, "admin")
  await db.run(
    "DELETE FROM dc_invitations WHERE id = ? AND workspace_id = ?",
    invitationId,
    workspaceId,
  )
}

/** The user's GitHub account ids, as Better Auth recorded them when they signed in with GitHub. */
async function githubIdsOf(db: AppDatabase, userId: string): Promise<string[]> {
  const rows = await db.all<{ accountId: string }>(
    "SELECT accountId FROM account WHERE providerId = 'github' AND userId = ?",
    userId,
  )
  return rows.map((row) => row.accountId)
}

/**
 * Whether an invitation was sent to this user. An email address only counts once it is known to
 * be theirs: anyone can sign up with an address they do not hold.
 */
function addressedTo(row: InvitationRow, who: Who, githubIds: readonly string[]): boolean {
  if (row.github_id !== null) return githubIds.includes(row.github_id)
  return who.emailVerified === true && row.email === who.email.toLowerCase()
}

/**
 * Find an invitation by what its holder has: the token from its link, or its id when it was
 * addressed to the user. Undefined when there is none, it expired, or it is not theirs.
 */
async function findInvitation(
  db: AppDatabase,
  key: string,
  who: Who | undefined,
  now: number,
): Promise<InvitationRow | undefined> {
  const byToken = await db.get<InvitationRow>(
    `${INVITATIONS} WHERE i.token_hash = ? AND i.expires_at >= ?`,
    await sha256(key),
    now,
  )
  if (byToken !== undefined) return byToken
  if (who === undefined) return undefined
  const byId = await db.get<InvitationRow>(
    `${INVITATIONS} WHERE i.id = ? AND i.expires_at >= ?`,
    key,
    now,
  )
  if (byId === undefined) return undefined
  return addressedTo(byId, who, await githubIdsOf(db, who.id)) ? byId : undefined
}

async function preview(
  db: AppDatabase,
  row: InvitationRow,
): Promise<InvitationPreview | undefined> {
  const team = await db.get<WorkspaceRow>(
    "SELECT id, name, color, created_by, created_at FROM dc_workspaces WHERE id = ?",
    row.workspace_id,
  )
  if (team === undefined) return undefined
  const members = (await membersOf(db, [team.id])).get(team.id) ?? []
  return {
    id: row.id,
    workspace: { id: team.id, name: team.name, color: team.color },
    invitedBy: inviter(row),
    note: row.note,
    role: row.role,
    members: members.map(({ id, name, image }) => ({ id, name, image })),
    // Filled in by the caller, which can ask the agents who they are.
    agents: [],
    expiresAt: row.expires_at,
  }
}

/** What an invitation is to, for whoever holds its link. Signing in is not needed to look. */
export async function previewInvitation(
  db: AppDatabase,
  key: string,
  who: Who | undefined,
  now = Date.now(),
): Promise<InvitationPreview | undefined> {
  const row = await findInvitation(db, key, who, now)
  return row === undefined ? undefined : preview(db, row)
}

/** The invitations waiting for this user, found by their GitHub account or their own address. */
export async function invitationsFor(
  db: AppDatabase,
  who: Who,
  now = Date.now(),
): Promise<InvitationPreview[]> {
  const githubIds = await githubIdsOf(db, who.id)
  const rows = await db.all<InvitationRow>(
    `${INVITATIONS} WHERE i.expires_at >= ? AND (i.email = ? OR i.github_id IN (${
      githubIds.length === 0 ? "NULL" : githubIds.map(() => "?").join(", ")
    })) ORDER BY i.created_at`,
    now,
    who.email.toLowerCase(),
    ...githubIds,
  )
  const previews: InvitationPreview[] = []
  for (const row of rows) {
    if (!addressedTo(row, who, githubIds)) continue
    // Already in: nothing to answer.
    if ((await roleIn(db, who.id, row.workspace_id)) !== undefined) continue
    const one = await preview(db, row)
    if (one !== undefined) previews.push(one)
  }
  return previews
}

/** Join the team an invitation is to. It is used up, whoever it was addressed to. */
export async function acceptInvitation(
  db: AppDatabase,
  who: Who,
  key: string,
  now = Date.now(),
): Promise<{ workspaceId: string }> {
  const row = await findInvitation(db, key, who, now)
  if (row === undefined)
    throw new Refusal(404, "That invitation is no longer good. Ask for a new one.")
  if ((await roleIn(db, who.id, row.workspace_id)) === undefined) {
    const members = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM dc_members WHERE workspace_id = ?",
      row.workspace_id,
    )
    if ((members?.n ?? 0) >= MAX_MEMBERS) {
      throw new Refusal(409, `That team is full: it can have at most ${MAX_MEMBERS} people.`)
    }
  }
  await db.batch([
    {
      sql: `INSERT INTO dc_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
            ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      params: [row.workspace_id, who.id, row.role, now],
    },
    { sql: "DELETE FROM dc_invitations WHERE id = ?", params: [row.id] },
  ])
  return { workspaceId: row.workspace_id }
}

/** Turn an invitation down. Only one that was addressed to the user: a link is not theirs to spend. */
export async function declineInvitation(
  db: AppDatabase,
  who: Who,
  invitationId: string,
  now = Date.now(),
): Promise<void> {
  const row = await db.get<InvitationRow>(
    `${INVITATIONS} WHERE i.id = ? AND i.expires_at >= ?`,
    invitationId,
    now,
  )
  if (row === undefined || !addressedTo(row, who, await githubIdsOf(db, who.id))) {
    throw new Refusal(404, "That invitation is gone.")
  }
  await db.run("DELETE FROM dc_invitations WHERE id = ?", row.id)
}

/**
 * Whether someone who has no account yet was invited to a team, so that a deployment where
 * sign-up is by invitation lets them in.
 */
export async function isInvited(
  db: AppDatabase,
  identity: { email?: string | undefined; githubId?: string | undefined },
  now = Date.now(),
): Promise<boolean> {
  if (identity.githubId !== undefined) {
    const row = await db.get<{ id: string }>(
      "SELECT id FROM dc_invitations WHERE github_id = ? AND expires_at >= ? LIMIT 1",
      identity.githubId,
      now,
    )
    if (row !== undefined) return true
  }
  if (identity.email === undefined || identity.email === "") return false
  const row = await db.get<{ id: string }>(
    "SELECT id FROM dc_invitations WHERE email = ? AND expires_at >= ? LIMIT 1",
    identity.email.toLowerCase(),
    now,
  )
  return row !== undefined
}

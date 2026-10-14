import {
  isPersonalWorkspace,
  personalWorkspaceId,
  type SecretKind,
  type WorkspaceSummary,
} from "@do-computer/protocol"
import type { ActorNamespace, ActorStub, AppDatabase } from "@do-computer/runtime"
import type { Config } from "./platform.ts"

/**
 * Which workspaces keep logins for their Doods to sign in to websites with, and where an
 * agent finds its workspace's. Apart from the gateway in `passwords.ts`, since it also runs
 * where an agent does, which is not always where requests are served: it is handed the
 * database and the settings instead of finding the platform.
 */

type Settings = Pick<Config, "secrets" | "secretKinds" | "adminEmails" | "signup">

/**
 * Whether an account is one of the deployment's admins, going by the account as it is kept:
 * its address is one `DC_ADMIN_EMAILS` names, and is known to be its own. Where accounts are
 * by invitation it is; where anyone can make one, only an address a social sign-in vouched for
 * counts, or whoever signed up with an admin's address first would be taken for them.
 */
export const isAdminAccount = (
  settings: Pick<Config, "adminEmails" | "signup">,
  account: { email: string | null; emailVerified: unknown },
): boolean =>
  account.email !== null &&
  settings.adminEmails.includes(account.email.toLowerCase()) &&
  (settings.signup === "invite" || account.emailVerified === 1 || account.emailVerified === true)

/** The accounts of everyone in a workspace: its owner, or a team's members. */
async function accountsOf(
  db: AppDatabase,
  workspaceId: string,
): Promise<{ id: string; email: string | null; emailVerified: unknown }[]> {
  if (isPersonalWorkspace(workspaceId)) {
    return db.all(
      "SELECT id, email, emailVerified FROM user WHERE id = ?",
      workspaceId.slice(personalWorkspaceId("").length),
    )
  }
  return db.all(
    `SELECT m.user_id AS id, u.email, u.emailVerified
       FROM dc_members m LEFT JOIN user u ON u.id = m.user_id
      WHERE m.workspace_id = ?`,
    workspaceId,
  )
}

/**
 * Whether a workspace has one of the kinds of thing that are kept for Doods to use unseen:
 * saved logins, or cards. It has none of a kind the deployment does not name. Where the
 * deployment keeps them for its admins,
 * which it does unless told otherwise, that is a workspace in which everyone is one: a team
 * with anyone else in it has none, since that person's conversations with its Doods could
 * otherwise use what an admin saved. Asked each time, of the database, so that it stops being
 * so the moment someone else joins.
 */
export async function hasSaved(
  db: AppDatabase,
  settings: Settings,
  workspaceId: string,
  kind: SecretKind,
): Promise<boolean> {
  if (settings.secrets === "off" || !settings.secretKinds.includes(kind)) return false
  if (settings.secrets === "on") return true
  const accounts = await accountsOf(db, workspaceId)
  return accounts.length > 0 && accounts.every((account) => isAdminAccount(settings, account))
}

/** Whether a workspace has saved logins. */
export const hasSavedLogins = (db: AppDatabase, settings: Settings, workspaceId: string) =>
  hasSaved(db, settings, workspaceId, "passwords")

/**
 * Where an agent's workspace keeps its saved logins, for the agent to sign in with: the actor
 * that keeps them, or undefined where the workspace has none to use. It runs where the agent
 * does, which is not always where requests are served, so it is handed what it needs. Looked
 * up each time, since an agent can be moved and a workspace can gain a member.
 */
export function savedDirectory(
  db: AppDatabase,
  modelAccess: ActorNamespace,
  settings: Settings,
  kind: SecretKind,
): (agentId: string) => Promise<ActorStub | undefined> {
  return async (agentId) => {
    if (settings.secrets === "off" || !settings.secretKinds.includes(kind)) return undefined
    const row = await db.get<{ owner_id: string; workspace_id: string | null }>(
      "SELECT owner_id, workspace_id FROM dc_agents WHERE id = ?",
      agentId,
    )
    if (row === undefined) return undefined
    const workspaceId = row.workspace_id ?? personalWorkspaceId(row.owner_id)
    if (!(await hasSaved(db, settings, workspaceId, kind))) return undefined
    return modelAccess.get(workspaceId)
  }
}

/** Mark the workspaces of a person's that keep logins, and cards, they may see. */
export async function withSavedLogins(
  db: AppDatabase,
  settings: Settings,
  workspaces: WorkspaceSummary[],
): Promise<WorkspaceSummary[]> {
  if (settings.secrets === "off") return workspaces
  return Promise.all(
    workspaces.map(async (workspace) => ({
      ...workspace,
      ...((await hasSaved(db, settings, workspace.id, "passwords"))
        ? { savedLogins: true as const }
        : {}),
      ...((await hasSaved(db, settings, workspace.id, "cards"))
        ? { savedCards: true as const }
        : {}),
    })),
  )
}

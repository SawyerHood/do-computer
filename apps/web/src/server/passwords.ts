import { getPlatform } from "#platform"
import { CALLER_HEADER, encodeCaller } from "@do-computer/agent"
import { fail } from "./agents.ts"
import type { SessionUser } from "./auth.ts"
import type { SecretKind } from "@do-computer/protocol"
import { hasSaved } from "./passwords-directory.ts"
import { roleIn } from "./teams.ts"

/**
 * Saved logins: what a workspace keeps for its Doods to sign in to websites with. They are
 * kept by the actor that keeps the workspace's sign-ins to model providers, sealed, and this
 * is the gateway in front of it: who may see that a workspace has any, and add, change and
 * remove them. Nothing here, and no route there is, hands a password back.
 */

/** Call the vault of a workspace. The path is `/passwords` or `/cards` and what follows. */
function callVault(
  workspaceId: string,
  path: string,
  init?: RequestInit & { by?: SessionUser },
): Promise<Response> {
  const { by, ...rest } = init ?? {}
  return getPlatform()
    .modelAccess.get(workspaceId)
    .fetch(
      new Request(`http://models${path}`, {
        ...rest,
        // Built from nothing, so that who is asking is only ever what this gateway says.
        headers: {
          "content-type": "application/json",
          ...(by === undefined
            ? {}
            : { [CALLER_HEADER]: encodeCaller({ id: by.id, name: by.name }) }),
        },
      }),
    )
}

/**
 * Run `handle` for someone in a workspace that keeps logins. Anyone else is told there is no
 * such thing, whether that is because they are not in the workspace or because it has none:
 * which of the two is not theirs to learn.
 */
async function inVault(
  user: SessionUser,
  workspaceId: string,
  handle: () => Promise<Response>,
  kind: SecretKind = "passwords",
): Promise<Response> {
  const { db, config } = getPlatform()
  const role = await roleIn(db, user.id, workspaceId)
  if (role === undefined || !(await hasSaved(db, config, workspaceId, kind))) {
    return fail(404, "Not found")
  }
  return handle()
}

/** The logins a workspace has saved: everything of each but its password. */
export function listSavedLogins(user: SessionUser, workspaceId: string): Promise<Response> {
  return inVault(user, workspaceId, () => callVault(workspaceId, "/passwords"))
}

/** Save a login. Anyone in the workspace can: it is then the workspace's, for all its Doods. */
export function saveLogin(
  user: SessionUser,
  request: Request,
  workspaceId: string,
): Promise<Response> {
  return inVault(user, workspaceId, async () =>
    callVault(workspaceId, "/passwords", {
      method: "POST",
      body: await request.text(),
      by: user,
    }),
  )
}

/** Change a login's name, username or sites, or give it a new password. */
export function changeSavedLogin(
  user: SessionUser,
  request: Request,
  workspaceId: string,
  loginId: string,
): Promise<Response> {
  return inVault(user, workspaceId, async () =>
    callVault(workspaceId, `/passwords/${encodeURIComponent(loginId)}`, {
      method: "PATCH",
      body: await request.text(),
      by: user,
    }),
  )
}

export function removeSavedLogin(
  user: SessionUser,
  workspaceId: string,
  loginId: string,
): Promise<Response> {
  return inVault(user, workspaceId, () =>
    callVault(workspaceId, `/passwords/${encodeURIComponent(loginId)}`, { method: "DELETE" }),
  )
}

/** The cards a workspace has saved: everything of each but its number, of which the last four digits. */
export function listSavedCards(user: SessionUser, workspaceId: string): Promise<Response> {
  return inVault(user, workspaceId, () => callVault(workspaceId, "/cards"), "cards")
}

/** Save a card. Its security code is not asked for, and would not be kept. */
export function saveCard(
  user: SessionUser,
  request: Request,
  workspaceId: string,
): Promise<Response> {
  return inVault(
    user,
    workspaceId,
    async () =>
      callVault(workspaceId, "/cards", { method: "POST", body: await request.text(), by: user }),
    "cards",
  )
}

export function removeSavedCard(
  user: SessionUser,
  workspaceId: string,
  cardId: string,
): Promise<Response> {
  return inVault(
    user,
    workspaceId,
    () => callVault(workspaceId, `/cards/${encodeURIComponent(cardId)}`, { method: "DELETE" }),
    "cards",
  )
}

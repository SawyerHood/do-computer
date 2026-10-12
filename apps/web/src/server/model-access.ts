import { getPlatform } from "#platform"
import { CALLER_HEADER, DEPLOYMENT_MODEL_ACCESS, encodeCaller } from "@do-computer/agent"
import type { ModelOption, ModelProvidersState } from "@do-computer/protocol"
import { fail } from "./agents.ts"
import type { SessionUser } from "./auth.ts"
import { roleIn } from "./teams.ts"
import { vouchedFor } from "./waitlist.ts"

/** Call the actor that keeps a workspace's sign-ins. The path is relative to it. */
function callModelAccess(
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

/** The models the providers a workspace is signed in to give its agents. None if it cannot say. */
export async function modelsSignedInTo(workspaceId: string): Promise<ModelOption[]> {
  const response = await callModelAccess(workspaceId, "/models").catch(() => undefined)
  if (response === undefined || !response.ok) return []
  return ((await response.json()) as { models: ModelOption[] }).models
}

async function providersOf(workspaceId: string): Promise<ModelProvidersState | undefined> {
  const response = await callModelAccess(workspaceId, "/providers")
  return response.ok ? ((await response.json()) as ModelProvidersState) : undefined
}

/**
 * Whether someone may sign the deployment itself in to model providers, which then answer for
 * everyone's agents: those whose email the deployment's settings name. Where anyone can make an
 * account, the address has to be known to be theirs as well, or whoever signed up with it
 * first would be let in.
 */
export function isDeploymentAdmin(user: SessionUser): boolean {
  const { config } = getPlatform()
  return config.adminEmails.includes(user.email.toLowerCase()) && vouchedFor(user)
}

/**
 * Run `handle` for someone in the workspace, or answer that there is no such team. The
 * deployment's own sign-ins are kept as a workspace's are, under a name no workspace has, and
 * are its admins' to change.
 */
async function inWorkspace(
  user: SessionUser,
  workspaceId: string,
  handle: (role: NonNullable<Awaited<ReturnType<typeof roleIn>>>) => Promise<Response>,
): Promise<Response> {
  if (workspaceId === DEPLOYMENT_MODEL_ACCESS) {
    return isDeploymentAdmin(user) ? handle("owner") : fail(404, "Team not found")
  }
  const role = await roleIn(getPlatform().db, user.id, workspaceId)
  if (role === undefined) return fail(404, "Team not found")
  return handle(role)
}

/** The model providers there are, and which of them the workspace is signed in to. */
export function listModelProviders(user: SessionUser, workspaceId: string): Promise<Response> {
  return inWorkspace(user, workspaceId, () => callModelAccess(workspaceId, "/providers"))
}

/**
 * Start signing a workspace in to a model provider. Anyone in it can: what they sign in with is
 * theirs to share, and from then on every agent of the workspace can run on it.
 */
export function startModelLogin(
  user: SessionUser,
  request: Request,
  workspaceId: string,
): Promise<Response> {
  return inWorkspace(user, workspaceId, async () =>
    callModelAccess(workspaceId, "/logins", {
      method: "POST",
      body: await request.text(),
      by: user,
    }),
  )
}

/** How a sign-in stands. With `rev` and `wait` it answers when there is something new. */
export function getModelLogin(
  user: SessionUser,
  request: Request,
  workspaceId: string,
  loginId: string,
): Promise<Response> {
  return inWorkspace(user, workspaceId, () =>
    callModelAccess(
      workspaceId,
      `/logins/${encodeURIComponent(loginId)}${new URL(request.url).search}`,
      { by: user, signal: request.signal },
    ),
  )
}

/** Answer what a sign-in asked: a key, a code, or one of its choices. */
export function answerModelLogin(
  user: SessionUser,
  request: Request,
  workspaceId: string,
  loginId: string,
): Promise<Response> {
  return inWorkspace(user, workspaceId, async () =>
    callModelAccess(workspaceId, `/logins/${encodeURIComponent(loginId)}/answer`, {
      method: "POST",
      body: await request.text(),
      by: user,
    }),
  )
}

export function cancelModelLogin(
  user: SessionUser,
  workspaceId: string,
  loginId: string,
): Promise<Response> {
  return inWorkspace(user, workspaceId, () =>
    callModelAccess(workspaceId, `/logins/${encodeURIComponent(loginId)}`, {
      method: "DELETE",
      by: user,
    }),
  )
}

/**
 * Sign a workspace out of a model provider. Whoever signed in can, since it is theirs, and so
 * can an admin of the team. Agents set to one of its models stop answering until they are set
 * to another.
 */
export function signOutOfModelProvider(
  user: SessionUser,
  workspaceId: string,
  providerId: string,
): Promise<Response> {
  return inWorkspace(user, workspaceId, async (role) => {
    const state = await providersOf(workspaceId)
    const provider = state?.providers.find((entry) => entry.id === providerId)
    if (provider === undefined || provider.signedIn === null) {
      return fail(404, "The workspace is not signed in to that.")
    }
    if (role === "member" && provider.signedIn.byId !== user.id) {
      return fail(403, "Only an admin, or whoever signed in, can sign out.")
    }
    return callModelAccess(workspaceId, `/providers/${encodeURIComponent(providerId)}`, {
      method: "DELETE",
    })
  })
}

/** Someone left a team, or was taken out: what they signed it in with goes with them. */
export async function removeModelSignInsOf(userId: string, workspaceId: string): Promise<void> {
  await callModelAccess(workspaceId, `/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  }).catch(() => undefined)
}

/** A workspace is gone, and what it was signed in with goes with it. */
export async function removeModelAccessOf(workspaceId: string): Promise<void> {
  await callModelAccess(workspaceId, "/destroy", { method: "POST" }).catch(() => undefined)
}

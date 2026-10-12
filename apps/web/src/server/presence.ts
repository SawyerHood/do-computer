import { getPlatform } from "#platform"
import { CALLER_HEADER, encodeCaller } from "@durable-computer/agent"
import { isPersonalWorkspace, personalWorkspaceId } from "@durable-computer/protocol"
import { getUser } from "./auth.ts"
import { roleIn } from "./teams.ts"

/** Where a member's browser connects to say where it is and hear where the others are. */
export const PRESENCE_PATH = "/api/presence/"

/** The team a presence request is for, or undefined when the path is not one. */
export function presenceWorkspace(pathname: string): string | undefined {
  if (!pathname.startsWith(PRESENCE_PATH)) return undefined
  try {
    const workspaceId = decodeURIComponent(pathname.slice(PRESENCE_PATH.length))
    return workspaceId === "" || workspaceId.includes("/") ? undefined : workspaceId
  } catch {
    return undefined
  }
}

/**
 * Check a request to join a team's presence, or a person's own feed, and resolve with the
 * request to hand its actor: the same one, saying who is asking. Undefined when it is not a
 * member's, not the person's own, or not from the app itself.
 */
export async function admitToPresence(
  request: Request,
  workspaceId: string,
): Promise<Request | undefined> {
  const { config, db } = getPlatform()
  // A browser sends cookies with a WebSocket to any site that asks, so a page elsewhere could
  // open one as the signed-in user. Only the app's own pages may.
  const origin = request.headers.get("origin")
  const allowed = new URL(config.baseUrl ?? request.url).origin
  if (origin !== null && origin !== allowed && origin !== new URL(request.url).origin) {
    return undefined
  }
  const user = await getUser(request)
  if (user === undefined) return undefined
  // A personal workspace has nobody to be present for: its address is its owner's own feed,
  // where they hear what their agents are up to, and nobody else's to join.
  if (isPersonalWorkspace(workspaceId)) {
    if (workspaceId !== personalWorkspaceId(user.id)) return undefined
  } else if ((await roleIn(db, user.id, workspaceId)) === undefined) return undefined
  const headers = new Headers(request.headers)
  headers.set(CALLER_HEADER, encodeCaller({ id: user.id, name: user.name }))
  return new Request(request, { headers })
}

const tell = (workspaceId: string, path: string, body?: unknown) =>
  getPlatform()
    .presence.get(workspaceId)
    .fetch(
      new Request(`http://presence${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }),
    )
    .then(
      () => undefined,
      () => undefined,
    )

/**
 * Tell everyone who has a team open that it changed: its people, its agents or its name. A
 * courtesy, so it never fails what caused it; a tab that misses it sees the change on its next visit.
 */
export function announce(workspaceId: string): Promise<void> {
  return isPersonalWorkspace(workspaceId) ? Promise.resolve() : tell(workspaceId, "/changed")
}

/** Let go of the open tabs of someone who is no longer in a team. */
export function dismiss(workspaceId: string, userId: string): Promise<void> {
  return tell(workspaceId, "/remove", { userId })
}

import { getPlatform } from "#platform"
import {
  type AgentSummary,
  type CreateWorkspaceRequest,
  type InvitationPreview,
  type InviteRequest,
  type InviteResult,
  type WorkspacesState,
} from "@durable-computer/protocol"
import { moveAgent } from "./agent-move.ts"
import { callAgent, fail, json, tellAgentItsTeam } from "./agents.ts"
import type { SessionUser } from "./auth.ts"
import { removeComputersOfMember } from "./computers.ts"
import { sendEmail } from "./email.ts"
import { findGithubUser } from "./github.ts"
import { announce, dismiss } from "./presence.ts"
import {
  acceptInvitation,
  createWorkspace,
  declineInvitation,
  deleteWorkspace,
  invitationsFor,
  invite,
  type InviteDeps,
  listInvitations,
  listWorkspaces,
  previewInvitation,
  Refusal,
  removeMember,
  renewInvitation,
  setRole,
  updateWorkspace,
  withdrawInvitation,
} from "./teams.ts"

/** Answer with what `work` resolves to, or with the refusal it threw. */
async function answer(work: () => Promise<unknown>, status = 200): Promise<Response> {
  try {
    return json((await work()) ?? { ok: true }, status)
  } catch (error) {
    if (error instanceof Refusal) return fail(error.status, error.message)
    throw error
  }
}

const read = async <T>(request: Request): Promise<T> =>
  ((await request.json().catch(() => ({}))) ?? {}) as T

function inviteDeps(request: Request): InviteDeps {
  const { config } = getPlatform()
  return {
    origin: config.baseUrl ?? new URL(request.url).origin,
    github: (login) => findGithubUser(config, login),
    email: (message) => sendEmail(config, message),
  }
}

/** Who the agents of a team are, for someone deciding whether to join it. */
async function withAgents(preview: InvitationPreview): Promise<InvitationPreview> {
  const rows = await getPlatform().db.all<{ id: string }>(
    "SELECT id FROM dc_agents WHERE workspace_id = ? ORDER BY created_at",
    preview.workspace.id,
  )
  const agents = await Promise.all(
    rows.map(async (row) => {
      const response = await callAgent(row.id, "/").catch(() => undefined)
      if (response === undefined || !response.ok) return undefined
      const { agent } = (await response.json()) as { agent: AgentSummary }
      return { id: agent.id, name: agent.name, avatar: agent.avatar, hatched: agent.hatched }
    }),
  )
  return { ...preview, agents: agents.filter((agent) => agent !== undefined) }
}

export function getWorkspaces(user: SessionUser): Promise<Response> {
  return answer(async (): Promise<WorkspacesState> => {
    const { db } = getPlatform()
    const invitations = await invitationsFor(db, user)
    return {
      workspaces: await listWorkspaces(db, user),
      invitations: await Promise.all(invitations.map(withAgents)),
    }
  })
}

/** Start a team, optionally bringing agents of the user's own and asking people to join. */
export async function postWorkspace(user: SessionUser, request: Request): Promise<Response> {
  const input = await read<CreateWorkspaceRequest>(request)
  return answer(async () => {
    const { db } = getPlatform()
    const id = await createWorkspace(db, user, input)
    for (const agentId of Array.isArray(input.agentIds) ? input.agentIds.slice(0, 20) : []) {
      if (typeof agentId === "string") await moveAgent(user, agentId, id)
    }
    let invited: InviteResult | undefined
    if (
      input.invite !== undefined &&
      Array.isArray(input.invite.who) &&
      input.invite.who.length > 0
    ) {
      invited = await invite(db, user, id, input.invite, inviteDeps(request))
    }
    const workspace = (await listWorkspaces(db, user)).find((entry) => entry.id === id)
    return { workspace, invited }
  }, 201)
}

export async function patchWorkspace(
  user: SessionUser,
  request: Request,
  workspaceId: string,
): Promise<Response> {
  const input = await read<{ name?: unknown; color?: unknown }>(request)
  return answer(async () => {
    const { db } = getPlatform()
    const { name } = await updateWorkspace(db, user, workspaceId, input)
    if (input.name !== undefined) {
      // Its agents know the team by name.
      const agents = await db.all<{ id: string }>(
        "SELECT id FROM dc_agents WHERE workspace_id = ?",
        workspaceId,
      )
      for (const agent of agents) await tellAgentItsTeam(agent.id, name).catch(() => false)
    }
    await announce(workspaceId)
  })
}

export function removeWorkspace(user: SessionUser, workspaceId: string): Promise<Response> {
  return answer(async () => {
    await deleteWorkspace(getPlatform().db, user, workspaceId)
    await announce(workspaceId)
  })
}

export function getInvitations(user: SessionUser, workspaceId: string): Promise<Response> {
  return answer(async () => ({
    invitations: await listInvitations(getPlatform().db, user, workspaceId),
  }))
}

export async function postInvitations(
  user: SessionUser,
  request: Request,
  workspaceId: string,
): Promise<Response> {
  const input = await read<InviteRequest>(request)
  return answer(async () => {
    const result = await invite(getPlatform().db, user, workspaceId, input, inviteDeps(request))
    await announce(workspaceId)
    return result
  }, 201)
}

export function renewInvite(
  user: SessionUser,
  request: Request,
  workspaceId: string,
  invitationId: string,
): Promise<Response> {
  return answer(() =>
    renewInvitation(getPlatform().db, user, workspaceId, invitationId, inviteDeps(request)),
  )
}

export function withdrawInvite(
  user: SessionUser,
  workspaceId: string,
  invitationId: string,
): Promise<Response> {
  return answer(async () => {
    await withdrawInvitation(getPlatform().db, user, workspaceId, invitationId)
    await announce(workspaceId)
  })
}

export async function patchMember(
  user: SessionUser,
  request: Request,
  workspaceId: string,
  userId: string,
): Promise<Response> {
  const input = await read<{ role?: unknown }>(request)
  return answer(async () => {
    await setRole(getPlatform().db, user, workspaceId, userId, input.role)
    await announce(workspaceId)
  })
}

/** Remove someone from a team, or leave it. Computers of theirs stop serving its agents. */
export function deleteMember(
  user: SessionUser,
  workspaceId: string,
  userId: string,
): Promise<Response> {
  return answer(async () => {
    await removeMember(getPlatform().db, user, workspaceId, userId)
    await removeComputersOfMember(userId, workspaceId)
    await dismiss(workspaceId, userId)
    await announce(workspaceId)
  })
}

/** What an invitation is to. Whoever holds its link may look, signed in or not. */
export async function getInvitation(user: SessionUser | undefined, key: string): Promise<Response> {
  const preview = await previewInvitation(getPlatform().db, key, user)
  if (preview === undefined) {
    return fail(404, "That invitation is no longer good. Ask for a new one.")
  }
  return json(await withAgents(preview))
}

export function acceptInvite(user: SessionUser, key: string): Promise<Response> {
  return answer(async () => {
    const joined = await acceptInvitation(getPlatform().db, user, key)
    await announce(joined.workspaceId)
    return joined
  })
}

export function declineInvite(user: SessionUser, invitationId: string): Promise<Response> {
  return answer(() => declineInvitation(getPlatform().db, user, invitationId))
}

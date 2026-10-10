import { getPlatform } from "#platform"
import {
  type AgentModels,
  createAgentModels,
  DEPLOYMENT_MODEL_ACCESS,
  type DeploymentModels,
  ECHO_MODEL,
  offeredModels,
} from "@durable-computer/agent"
import type { ModelOption } from "@durable-computer/protocol"
import { fail, json } from "./agents.ts"
import type { SessionUser } from "./auth.ts"
import { modelsSignedInTo } from "./model-access.ts"
import { roleIn, workspaceIdsOf } from "./teams.ts"

let catalog: AgentModels | undefined

/**
 * The models this deployment offers everyone and the one it starts new agents on: what its key
 * gives, and what the deployment itself is signed in to, less whatever its settings leave out.
 * Asked each time, since the deployment can be signed in or out while the server runs.
 */
export function deploymentModels(): Promise<DeploymentModels> {
  if (catalog === undefined) {
    catalog = createAgentModels(getPlatform().config, {
      deployment: async () => getPlatform().modelAccess.get(DEPLOYMENT_MODEL_ACCESS),
    })
  }
  return catalog.offered()
}

/**
 * The models an agent in a workspace can be set to: the deployment's, then those of the
 * providers the workspace is signed in to.
 */
export async function workspaceModels(workspaceId: string): Promise<ModelOption[]> {
  const [deployment, signedIn] = await Promise.all([
    deploymentModels(),
    modelsSignedInTo(workspaceId),
  ])
  return offeredModels(deployment.options, signedIn)
}

/** Every model a user could set an agent to somewhere: across their own workspace and their teams. */
async function modelsOf(userId: string): Promise<ModelOption[]> {
  const workspaceIds = await workspaceIdsOf(getPlatform().db, userId)
  const [deployment, ...signedIn] = await Promise.all([
    deploymentModels(),
    ...workspaceIds.map((id) => modelsSignedInTo(id)),
  ])
  return signedIn.reduce<ModelOption[]>(offeredModels, [...deployment.options])
}

export const offersModel = async (model: string, workspaceId: string) =>
  (await workspaceModels(workspaceId)).some((option) => option.id === model)

/** Whether a user could choose a model as the one their new agents start on. */
export const offersModelTo = async (model: string, userId: string) =>
  (await modelsOf(userId)).some((option) => option.id === model)

/**
 * The model a new agent in a workspace starts on when its maker's own choice cannot be had
 * there. The deployment's, unless that is the echo of a deployment with nothing to run and the
 * workspace is signed in to something real.
 */
export async function defaultModelIn(workspaceId: string): Promise<string> {
  const deployment = (await deploymentModels()).defaultModel
  if (deployment !== ECHO_MODEL) return deployment
  const signedIn = await modelsSignedInTo(workspaceId)
  return (signedIn.find((option) => option.recommended === true) ?? signedIn[0])?.id ?? deployment
}

/**
 * The models to choose from. With `workspaceId`, those an agent there can be set to; without,
 * every model the user could choose somewhere, which is what a default for new agents is
 * chosen from.
 */
export async function listModels(user: SessionUser, request: Request): Promise<Response> {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")
  if (workspaceId === null) return json({ models: await modelsOf(user.id) })
  if ((await roleIn(getPlatform().db, user.id, workspaceId)) === undefined) {
    return fail(404, "Team not found")
  }
  return json({ models: await workspaceModels(workspaceId) })
}

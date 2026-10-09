import { getPlatform } from "#platform"
import { createAgentModels, ECHO_MODEL, mergeModelOptions } from "@durable-computer/agent"
import type { ModelOption } from "@durable-computer/protocol"
import { fail, json } from "./agents.ts"
import type { SessionUser } from "./auth.ts"
import { modelsSignedInTo } from "./model-access.ts"
import { roleIn, workspaceIdsOf } from "./teams.ts"

type Catalog = { readonly defaultModel: string; readonly options: readonly ModelOption[] }
let catalog: Catalog | undefined

/** The models this deployment offers and the one it starts new agents on, built once. */
export function deploymentModels(): Catalog {
  if (catalog === undefined) {
    const { defaultModel, options } = createAgentModels(getPlatform().config)
    catalog = { defaultModel, options }
  }
  return catalog
}

/**
 * The models an agent in a workspace can be set to: the deployment's, then those of the
 * providers the workspace is signed in to.
 */
export async function workspaceModels(workspaceId: string): Promise<ModelOption[]> {
  return mergeModelOptions(deploymentModels().options, await modelsSignedInTo(workspaceId))
}

/** Every model a user could set an agent to somewhere: across their own workspace and their teams. */
async function modelsOf(userId: string): Promise<ModelOption[]> {
  const workspaceIds = await workspaceIdsOf(getPlatform().db, userId)
  const signedIn = await Promise.all(workspaceIds.map((id) => modelsSignedInTo(id)))
  return signedIn.reduce<ModelOption[]>(mergeModelOptions, [...deploymentModels().options])
}

export const offersModel = async (model: string, workspaceId: string) =>
  (await workspaceModels(workspaceId)).some((option) => option.id === model)

/** Whether a user could choose a model as the one their new agents start on. */
export const offersModelTo = async (model: string, userId: string) =>
  deploymentModels().options.some((option) => option.id === model) ||
  (await modelsOf(userId)).some((option) => option.id === model)

/**
 * The model a new agent in a workspace starts on when its maker's own choice cannot be had
 * there. The deployment's, unless that is the echo of a deployment without a key and the
 * workspace is signed in to something real.
 */
export async function defaultModelIn(workspaceId: string): Promise<string> {
  const deployment = deploymentModels().defaultModel
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

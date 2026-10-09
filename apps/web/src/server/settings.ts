import { getPlatform } from "#platform"
import type { ComputerKinds, UserSettings } from "@durable-computer/protocol"
import { fail, json } from "./agents.ts"
import type { SessionUser } from "./auth.ts"
import { defaultModelIn, deploymentModels, offersModel, offersModelTo } from "./models.ts"
import { offeredKinds } from "./sandbox.ts"

let kinds: ComputerKinds | undefined

/** The kinds of computer this deployment offers and the one it gives new agents, read once. */
export function deploymentComputers(): ComputerKinds {
  if (kinds === undefined) {
    const { config, target } = getPlatform()
    const offered = offeredKinds(config, target)
    kinds = { kinds: [...offered.kinds], default: offered.default }
  }
  return kinds
}

const offersComputer = (kind: string) =>
  deploymentComputers().kinds.some((offered) => offered.id === kind)

type Row = { default_model: string | null; default_computer: string | null }

/** What a user chose, less a kind of computer the deployment has stopped offering since. */
async function chosen(userId: string): Promise<{ model: string | null; computer: string | null }> {
  const row = await getPlatform().db.get<Row>(
    "SELECT default_model, default_computer FROM dc_user_settings WHERE user_id = ?",
    userId,
  )
  const computer = row?.default_computer ?? null
  return {
    model: row?.default_model ?? null,
    computer: computer !== null && offersComputer(computer) ? computer : null,
  }
}

/**
 * The model a user's new agent in a workspace starts on: their own choice where they made one
 * and it can be had there, the workspace's otherwise. A model is only to be had in a workspace
 * that is signed in to its provider, so a choice made in one may not hold in another.
 */
export async function defaultModelFor(userId: string, workspaceId: string): Promise<string> {
  const { model } = await chosen(userId)
  return model !== null && (await offersModel(model, workspaceId))
    ? model
    : defaultModelIn(workspaceId)
}

/** The kind of machine a workspace is given for a user's new agent: their choice, or the deployment's. */
export async function defaultComputerFor(userId: string): Promise<string> {
  return (await chosen(userId)).computer ?? deploymentComputers().default
}

async function settings(user: SessionUser): Promise<UserSettings> {
  const { model, computer } = await chosen(user.id)
  return {
    // One that nobody offers them any more, in any workspace, is no choice.
    defaultModel: model !== null && (await offersModelTo(model, user.id)) ? model : null,
    deploymentDefaultModel: deploymentModels().defaultModel,
    defaultComputer: computer,
    deploymentDefaultComputer: deploymentComputers().default,
  }
}

export async function listComputerKinds(): Promise<Response> {
  return json(deploymentComputers())
}

export async function getSettings(user: SessionUser): Promise<Response> {
  return json(await settings(user))
}

/** Change account settings. Null for either default goes back to the deployment's. */
export async function updateSettings(user: SessionUser, request: Request): Promise<Response> {
  const input = (await request.json().catch(() => undefined)) as
    { defaultModel?: unknown; defaultComputer?: unknown } | undefined
  if (input === undefined || input === null || typeof input !== "object") {
    return fail(400, "Send the settings to change.")
  }
  const { db } = getPlatform()
  if ("defaultModel" in input) {
    const model = input.defaultModel
    if (model !== null && (typeof model !== "string" || !(await offersModelTo(model, user.id)))) {
      return fail(400, "That model is not available on this deployment.")
    }
    await db.run(
      `INSERT INTO dc_user_settings (user_id, default_model) VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET default_model = excluded.default_model`,
      user.id,
      model,
    )
  }
  if ("defaultComputer" in input) {
    const computer = input.defaultComputer
    if (computer !== null && (typeof computer !== "string" || !offersComputer(computer))) {
      return fail(400, "This deployment does not offer that kind of computer.")
    }
    await db.run(
      `INSERT INTO dc_user_settings (user_id, default_computer) VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET default_computer = excluded.default_computer`,
      user.id,
      computer,
    )
  }
  return json(await settings(user))
}

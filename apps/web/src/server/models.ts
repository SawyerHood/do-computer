import { getPlatform } from "#platform"
import { createAgentModels } from "@durable-computer/agent"
import type { ModelOption, UserSettings } from "@durable-computer/protocol"
import { fail, json } from "./agents.ts"
import type { SessionUser } from "./auth.ts"

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

const offered = (model: string) => deploymentModels().options.some((option) => option.id === model)

/**
 * The model a user's new agents start on: their own choice if they made one and it is still
 * offered, otherwise the deployment's.
 */
export async function defaultModelFor(userId: string): Promise<string> {
  const row = await getPlatform().db.get<{ default_model: string | null }>(
    "SELECT default_model FROM dc_user_settings WHERE user_id = ?",
    userId,
  )
  const chosen = row?.default_model ?? undefined
  return chosen !== undefined && offered(chosen) ? chosen : deploymentModels().defaultModel
}

async function settings(user: SessionUser): Promise<UserSettings> {
  const row = await getPlatform().db.get<{ default_model: string | null }>(
    "SELECT default_model FROM dc_user_settings WHERE user_id = ?",
    user.id,
  )
  const chosen = row?.default_model ?? null
  return {
    defaultModel: chosen !== null && offered(chosen) ? chosen : null,
    deploymentDefaultModel: deploymentModels().defaultModel,
  }
}

export async function listModels(): Promise<Response> {
  return json({ models: deploymentModels().options })
}

export async function getSettings(user: SessionUser): Promise<Response> {
  return json(await settings(user))
}

/** Change account settings. `defaultModel: null` goes back to the deployment's default. */
export async function updateSettings(user: SessionUser, request: Request): Promise<Response> {
  const input = (await request.json().catch(() => undefined)) as
    { defaultModel?: unknown } | undefined
  if (input === undefined || typeof input !== "object")
    return fail(400, "Send the settings to change.")
  if ("defaultModel" in input) {
    const model = input.defaultModel
    if (model !== null && (typeof model !== "string" || !offered(model))) {
      return fail(400, "That model is not available on this deployment.")
    }
    await getPlatform().db.run(
      `INSERT INTO dc_user_settings (user_id, default_model) VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET default_model = excluded.default_model`,
      user.id,
      model,
    )
  }
  return json(await settings(user))
}

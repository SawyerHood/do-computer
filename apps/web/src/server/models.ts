import { getPlatform } from "#platform"
import { createAgentModels } from "@durable-computer/agent"
import type { ModelOption } from "@durable-computer/protocol"
import { json } from "./agents.ts"

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

export const offersModel = (model: string) =>
  deploymentModels().options.some((option) => option.id === model)

export async function listModels(): Promise<Response> {
  return json({ models: deploymentModels().options })
}

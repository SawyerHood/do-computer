import type { ModelOption } from "@durable-computer/protocol"
import {
  fauxAssistantMessage,
  fauxProvider,
  type FauxProviderHandle,
} from "@earendil-works/pi-ai/providers/faux"
import { createModels, type Models } from "@earendil-works/pi-ai/models"
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter"
import type { ModelRef } from "@earendil-works/pi-durable"

/** OpenRouter models offered in the picker, best first. Ones the catalog lacks are dropped. */
const CURATED = [
  "anthropic/claude-sonnet-5.5",
  "anthropic/claude-opus-5.5",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-5.1",
  "google/gemini-3.8-flash",
  "moonshotai/kimi-k3",
]

export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-5.5"

export type AgentModels = {
  readonly models: Models
  /** `provider/modelId` used when an agent has not chosen one. */
  readonly defaultModel: string
  readonly options: readonly ModelOption[]
  /** Present only for the built-in echo model, so tests can script its answers. */
  readonly faux?: FauxProviderHandle
}

export type AgentModelsConfig = {
  /** Without a key the deployment runs on a built-in echo model, which is enough to try the app. */
  readonly openrouterApiKey?: string
  /** OpenRouter model id, for example `anthropic/claude-sonnet-5.5`. */
  readonly defaultModel?: string
}

/** `provider/modelId` to a pi-durable model reference. The provider is the first path segment. */
export function parseModel(model: string): ModelRef {
  const slash = model.indexOf("/")
  if (slash === -1) throw new Error(`Model "${model}" is not of the form provider/model`)
  return { provider: model.slice(0, slash), modelId: model.slice(slash + 1) }
}

export function formatModel(ref: ModelRef): string {
  return `${ref.provider}/${ref.modelId}`
}

function lastUserText(context: {
  messages: readonly { role: string; content: unknown }[]
}): string {
  for (let index = context.messages.length - 1; index >= 0; index--) {
    const message = context.messages[index]!
    if (message.role !== "user") continue
    if (typeof message.content === "string") return message.content
    if (Array.isArray(message.content)) {
      return message.content
        .map((block: { type: string; text?: string }) => (block.type === "text" ? block.text : ""))
        .join("")
    }
  }
  return ""
}

/**
 * Model access for a deployment: OpenRouter when a key is configured, otherwise an echo model that
 * needs no network.
 */
export function createAgentModels(config: AgentModelsConfig): AgentModels {
  if (config.openrouterApiKey === undefined || config.openrouterApiKey === "") {
    const faux = fauxProvider({
      provider: "echo",
      models: [{ id: "echo-1", name: "Echo (no model key configured)" }],
      tokensPerSecond: 60,
    })
    const models = createModels()
    models.setProvider(faux.provider)
    // An endless script: each request is answered from the conversation it carries.
    const echo = (context: Parameters<typeof lastUserText>[0]) =>
      fauxAssistantMessage(
        `You said: ${lastUserText(context)}\n\n(No OPENROUTER_API_KEY is configured, so this is the built-in echo model.)`,
      )
    const refill = () => {
      if (faux.getPendingResponseCount() < 8) {
        faux.appendResponses(
          Array.from({ length: 64 }, () => (context) => {
            refill()
            return echo(context)
          }),
        )
      }
    }
    refill()
    return {
      models,
      defaultModel: "echo/echo-1",
      options: [{ id: "echo/echo-1", name: "Echo", reasoning: false, inputCost: 0, outputCost: 0 }],
      faux,
    }
  }

  const key = config.openrouterApiKey
  const models = createModels({
    // The key comes from deployment config, never from the process environment or disk.
    authContext: {
      env: async (name) => (name === "OPENROUTER_API_KEY" ? key : undefined),
      fileExists: async () => false,
    },
  })
  const provider = openrouterProvider()
  models.setProvider(provider)

  const catalog = new Map(provider.getModels().map((model) => [model.id, model]))
  const preferred = config.defaultModel ?? DEFAULT_OPENROUTER_MODEL
  const ids = [...new Set([preferred, ...CURATED])].filter((id) => catalog.has(id))
  const options = ids.map((id): ModelOption => {
    const model = catalog.get(id)!
    return {
      id: `openrouter/${id}`,
      name: model.name,
      reasoning: model.reasoning,
      inputCost: model.cost.input,
      outputCost: model.cost.output,
    }
  })
  if (options.length === 0) {
    throw new Error(`None of the configured OpenRouter models exist in the model catalog`)
  }
  const defaultModel = catalog.has(preferred) ? `openrouter/${preferred}` : options[0]!.id
  return { models, defaultModel, options }
}

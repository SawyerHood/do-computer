import type { ModelOption } from "@durable-computer/protocol"
import {
  fauxAssistantMessage,
  fauxProvider,
  type FauxProviderHandle,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { createModels, type Models } from "@earendil-works/pi-ai/models"
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter"
import type { ModelRef } from "@earendil-works/pi-durable"
import type { WebSearchOptions } from "./web-search.ts"

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
/**
 * Reads web search results when no search model is configured. Reading a handful of pages and
 * reporting what they say does not need the agent's own model, and one search with it cost
 * about eight cents when measured.
 */
const DEFAULT_SEARCH_MODEL = "anthropic/claude-haiku-4.5"

export type AgentModels = {
  readonly models: Models
  /** `provider/modelId` used when an agent has not chosen one. */
  readonly defaultModel: string
  readonly options: readonly ModelOption[]
  /** Present only for the built-in echo model, so tests can script its answers. */
  readonly faux?: FauxProviderHandle
  /** What web search needs. Absent without a model key: there is nothing to search with. */
  readonly webSearch?: WebSearchOptions
}

export type AgentModelsConfig = {
  /** Without a key the deployment runs on a built-in echo model, which is enough to try the app. */
  readonly openrouterApiKey?: string
  /** OpenRouter model id, for example `anthropic/claude-sonnet-5.5`. */
  readonly defaultModel?: string
  /** OpenRouter model id that reads web search results. Default: a small, fast model. */
  readonly searchModel?: string
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

type EchoContext = { messages: readonly { role: string; content: unknown }[] }

const blockText = (content: unknown): string => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block: { type: string; text?: string }) =>
      block.type === "text" && !block.text?.startsWith("<meta ") ? (block.text ?? "") : "",
    )
    .join("")
}

/**
 * What the echo model answers. It repeats the last user message, with one affordance for trying
 * the app without a model key: a message of the form `/tool <name> <json arguments>` makes it call
 * that tool and then report the result.
 */
function echoAnswer(context: EchoContext) {
  // Prompt changes are recorded as system entries, which can follow a tool result.
  const last = context.messages.findLast((message) => message.role !== "system")
  if (last?.role === "toolResult") {
    return fauxAssistantMessage(`The tool returned:\n\n${blockText(last.content)}`)
  }
  const user = context.messages.findLast((message) => message.role === "user")
  const text = blockText(user?.content)
  const command = /^\/tool\s+(\w+)\s+(\{[\s\S]*\})\s*$/.exec(text)
  if (command) {
    try {
      const args = JSON.parse(command[2]!)
      return fauxAssistantMessage([fauxToolCall(command[1]!, args)], { stopReason: "toolUse" })
    } catch {
      return fauxAssistantMessage("Those tool arguments are not valid JSON.")
    }
  }
  return fauxAssistantMessage(
    `You said: ${text}\n\n(No OPENROUTER_API_KEY is configured, so this is the built-in echo model.)`,
  )
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
    const refill = () => {
      if (faux.getPendingResponseCount() < 8) {
        faux.appendResponses(
          Array.from({ length: 64 }, () => (context: EchoContext) => {
            refill()
            return echoAnswer(context)
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
  return {
    models,
    defaultModel,
    options,
    webSearch: {
      apiKey: key,
      model:
        config.searchModel ??
        (catalog.has(DEFAULT_SEARCH_MODEL)
          ? DEFAULT_SEARCH_MODEL
          : defaultModel.slice("openrouter/".length)),
    },
  }
}

import type { ModelOption } from "@durable-computer/protocol"
import {
  fauxAssistantMessage,
  fauxProvider,
  type FauxProviderHandle,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import type { CredentialStore } from "@earendil-works/pi-ai"
import { createModels, type Models } from "@earendil-works/pi-ai/models"
import type { ModelRef } from "@earendil-works/pi-durable"
import type { ReviewOptions } from "./journal.ts"
import type { JudgeOptions } from "./keep-going.ts"
import { modelOption, modelProviders } from "./model-providers.ts"
import type { WebSearchOptions } from "./web-search.ts"

/** OpenRouter models suggested first in the picker. Ones the catalog lacks are dropped. */
const CURATED = [
  "anthropic/claude-sonnet-5.5",
  "anthropic/claude-opus-5.5",
  "anthropic/claude-haiku-5.5",
  "openai/gpt-5.1",
  "google/gemini-3.8-flash",
  "moonshotai/kimi-k3",
]

export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-5.5"
/** The model a deployment without a key runs on. It repeats what it is told. */
export const ECHO_MODEL = "echo/echo-1"
/**
 * Reads web search results when no search model is configured. Reading a handful of pages and
 * reporting what they say does not need the agent's own model, and one search with it cost
 * about eight cents when measured.
 */
const DEFAULT_SEARCH_MODEL = "anthropic/claude-haiku-4.5"

/**
 * The model that is asked whether an agent meant to stop. It reads one message against what was
 * asked and answers with a word, but a wrong "carry on" would push an agent past a question it
 * had put to its user, so it has to judge well. Tried on 2026-10-06 on twelve endings: this one
 * was right on all of them, four times over, at about a thirteenth of the search model's
 * price; the still cheaper `openai/gpt-4.1-nano` got a third of them wrong.
 */
export const DEFAULT_JUDGE_MODEL = "mistralai/mistral-small-3.2-24b-instruct"

export type AgentModels = {
  readonly models: Models
  /** `provider/modelId` used when an agent has not chosen one. */
  readonly defaultModel: string
  readonly options: readonly ModelOption[]
  /** Present only for the built-in echo model, so tests can script its answers. */
  readonly faux?: FauxProviderHandle
  /** What web search needs. Absent without a model key: there is nothing to search with. */
  readonly webSearch?: WebSearchOptions
  /** What judging whether an agent meant to stop needs. Absent without a model key. */
  readonly judge?: JudgeOptions
  /** What keeping a note of where each chat stands needs. Absent without a model key. */
  readonly review?: ReviewOptions
}

export type AgentModelsConfig = {
  /** Without a key the deployment runs on a built-in echo model, which is enough to try the app. */
  readonly openrouterApiKey?: string
  /** OpenRouter model id, for example `anthropic/claude-sonnet-5.5`. */
  readonly defaultModel?: string
  /** OpenRouter model id that reads web search results. Default: a small, fast model. */
  readonly searchModel?: string
  /** OpenRouter model id that judges whether an agent meant to stop. Default: a small one. */
  readonly judgeModel?: string
  /** OpenRouter model id that notes where each chat stands. Default: the one that reads searches. */
  readonly reviewModel?: string
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
 * What the echo model answers. It repeats the last user message, with two affordances for trying
 * the app without a model key: a message of the form `/tool <name> <json arguments>` makes it call
 * that tool and then report the result (several such lines make it call them all in one round),
 * and `/fail <error>` makes the reply fail with that error, the way a model provider's would.
 */
function echoAnswer(context: EchoContext) {
  // Prompt changes are recorded as system entries, which can follow a tool result.
  const last = context.messages.findLast((message) => message.role !== "system")
  if (last?.role === "toolResult") {
    return fauxAssistantMessage(`The tool returned:\n\n${blockText(last.content)}`)
  }
  // The newest thing said to it. A note for the model alone, such as word that a sub-agent has
  // reported, says nothing to repeat: what it follows is repeated instead.
  const user = context.messages.findLast(
    (message) => message.role === "user" && blockText(message.content) !== "",
  )
  const text = blockText(user?.content)
  const failure = /^\/fail\s+([\s\S]+)$/.exec(text)
  if (failure) {
    return fauxAssistantMessage([], { stopReason: "error", errorMessage: failure[1]!.trim() })
  }
  // Several of them, one to a line, are called in one round, as a model calls several at once.
  const lines = text.split("\n").map((line) => /^\/tool\s+(\w+)\s+(\{.*\})\s*$/.exec(line))
  if (lines.length > 1 && lines.every((line) => line !== null)) {
    try {
      return fauxAssistantMessage(
        lines.map((line) => fauxToolCall(line![1]!, JSON.parse(line![2]!))),
        { stopReason: "toolUse" },
      )
    } catch {
      return fauxAssistantMessage("Those tool arguments are not valid JSON.")
    }
  }
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
 * needs no network. Either way every provider a workspace can sign in to is there as well, and
 * answers for the agents of a workspace that has: `credentials` is what the agent's workspace
 * keeps. Without it nobody is signed in to anything, and only the deployment's models run.
 */
export function createAgentModels(
  config: AgentModelsConfig,
  credentials?: CredentialStore,
): AgentModels {
  const key =
    config.openrouterApiKey === undefined || config.openrouterApiKey === ""
      ? undefined
      : config.openrouterApiKey
  const models = createModels({
    ...(credentials === undefined ? {} : { credentials }),
    // The key comes from deployment config, never from the process environment or disk.
    authContext: {
      env: async (name) => (name === "OPENROUTER_API_KEY" ? key : undefined),
      fileExists: async () => false,
    },
  })
  for (const provider of modelProviders()) models.setProvider(provider)

  if (key === undefined) {
    const faux = fauxProvider({
      provider: "echo",
      models: [{ id: "echo-1", name: "Echo (no model key configured)" }],
      tokensPerSecond: 60,
    })
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
      defaultModel: ECHO_MODEL,
      options: [
        {
          id: ECHO_MODEL,
          name: "Echo (no model key configured)",
          reasoning: false,
          inputCost: 0,
          outputCost: 0,
          recommended: true,
        },
      ],
      faux,
    }
  }

  const provider = models.getProvider("openrouter")!
  const catalog = new Map(provider.getModels().map((model) => [model.id, model]))
  const preferred = config.defaultModel ?? DEFAULT_OPENROUTER_MODEL
  // Every model in the catalog can be chosen: it is the set of OpenRouter models that can call
  // tools, which an agent needs. A few are suggested first, and the rest follow by name.
  const suggested = [...new Set([preferred, ...CURATED])].filter((id) => catalog.has(id))
  const rest = [...catalog.keys()]
    .filter((id) => !suggested.includes(id))
    .sort((a, b) => catalog.get(a)!.name.localeCompare(catalog.get(b)!.name))
  const options = [...suggested, ...rest].map((id) =>
    modelOption(catalog.get(id)!, provider, suggested.includes(id)),
  )
  if (options.length === 0) {
    throw new Error(`None of the configured OpenRouter models exist in the model catalog`)
  }
  const defaultModel = catalog.has(preferred) ? `openrouter/${preferred}` : options[0]!.id
  // Reading a stretch of text and saying what it comes to: the same work for a search and a note.
  const reader = catalog.has(DEFAULT_SEARCH_MODEL)
    ? DEFAULT_SEARCH_MODEL
    : defaultModel.slice("openrouter/".length)
  return {
    models,
    defaultModel,
    options,
    webSearch: { apiKey: key, model: config.searchModel ?? reader },
    // Asked for by its OpenRouter id, so it need not be a model an agent could run on.
    judge: { apiKey: key, model: config.judgeModel ?? DEFAULT_JUDGE_MODEL },
    review: { apiKey: key, model: config.reviewModel ?? reader },
  }
}

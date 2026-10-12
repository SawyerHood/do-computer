import type { ModelLoginMethod, ModelOption } from "@do-computer/protocol"
import type { Api, Model } from "@earendil-works/pi-ai"
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth"
import { getSupportedThinkingLevels, type Provider } from "@earendil-works/pi-ai/models"
import { antLingProvider } from "@earendil-works/pi-ai/providers/ant-ling"
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic"
import { azureProvider } from "@earendil-works/pi-ai/providers/azure"
import { basetenProvider } from "@earendil-works/pi-ai/providers/baseten"
import { cerebrasProvider } from "@earendil-works/pi-ai/providers/cerebras"
import { cloudflareAIGatewayProvider } from "@earendil-works/pi-ai/providers/cloudflare-ai-gateway"
import { cloudflareWorkersAIProvider } from "@earendil-works/pi-ai/providers/cloudflare-workers-ai"
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek"
import { fireworksProvider } from "@earendil-works/pi-ai/providers/fireworks"
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot"
import { googleProvider } from "@earendil-works/pi-ai/providers/google"
import { groqProvider } from "@earendil-works/pi-ai/providers/groq"
import { huggingfaceProvider } from "@earendil-works/pi-ai/providers/huggingface"
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding"
import { metaProvider } from "@earendil-works/pi-ai/providers/meta"
import { minimaxProvider } from "@earendil-works/pi-ai/providers/minimax"
import { minimaxCnProvider } from "@earendil-works/pi-ai/providers/minimax-cn"
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral"
import { moonshotaiProvider } from "@earendil-works/pi-ai/providers/moonshotai"
import { moonshotaiCnProvider } from "@earendil-works/pi-ai/providers/moonshotai-cn"
import { nvidiaProvider } from "@earendil-works/pi-ai/providers/nvidia"
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode"
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go"
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter"
import { qwenTokenPlanProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan"
import { qwenTokenPlanCnProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan-cn"
import { qwenTokenPlanIndividualProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan-individual"
import { togetherProvider } from "@earendil-works/pi-ai/providers/together"
import { typesafeProvider } from "@earendil-works/pi-ai/providers/typesafe"
import { vercelAIGatewayProvider } from "@earendil-works/pi-ai/providers/vercel-ai-gateway"
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai"
import { xiaomiProvider } from "@earendil-works/pi-ai/providers/xiaomi"
import { xiaomiTokenPlanAmsProvider } from "@earendil-works/pi-ai/providers/xiaomi-token-plan-ams"
import { xiaomiTokenPlanCnProvider } from "@earendil-works/pi-ai/providers/xiaomi-token-plan-cn"
import { xiaomiTokenPlanSgpProvider } from "@earendil-works/pi-ai/providers/xiaomi-token-plan-sgp"
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai"
import { zaiCodingCnProvider } from "@earendil-works/pi-ai/providers/zai-coding-cn"

// pi loads a provider's sign-in by a path it works out when it is needed, which a bundle cannot
// follow. Told of them here, it finds them in a bundle too.
registerBunOAuthFlows()

/**
 * The model providers pi knows that a workspace can sign in to from a page, the ones most asked
 * for first and the rest by name.
 *
 * Three of pi's are left out. Amazon Bedrock and Google Vertex are signed in to with files and
 * roles of the machine the server runs on, which belong to no workspace. Radius signs in by a
 * page that must reach the server on its own address, which a browser elsewhere cannot.
 */
export function modelProviders(): Provider[] {
  const first = [
    anthropicProvider(),
    openaiProvider(),
    openaiCodexProvider(),
    githubCopilotProvider(),
    openrouterProvider(),
    googleProvider(),
    xaiProvider(),
  ]
  const rest = [
    antLingProvider(),
    azureProvider(),
    basetenProvider(),
    cerebrasProvider(),
    cloudflareAIGatewayProvider(),
    cloudflareWorkersAIProvider(),
    deepseekProvider(),
    fireworksProvider(),
    groqProvider(),
    huggingfaceProvider(),
    kimiCodingProvider(),
    metaProvider(),
    minimaxProvider(),
    minimaxCnProvider(),
    mistralProvider(),
    moonshotaiProvider(),
    moonshotaiCnProvider(),
    nvidiaProvider(),
    opencodeProvider(),
    opencodeGoProvider(),
    qwenTokenPlanProvider(),
    qwenTokenPlanCnProvider(),
    qwenTokenPlanIndividualProvider(),
    togetherProvider(),
    typesafeProvider(),
    vercelAIGatewayProvider(),
    xiaomiProvider(),
    xiaomiTokenPlanAmsProvider(),
    xiaomiTokenPlanCnProvider(),
    xiaomiTokenPlanSgpProvider(),
    zaiProvider(),
    zaiCodingCnProvider(),
  ].sort((a, b) => a.name.localeCompare(b.name))
  return [...first, ...rest]
}

/** The providers most asked for, which the app shows ahead of the rest. */
const FEATURED = new Set([
  "anthropic",
  "openai",
  "openai-codex",
  "github-copilot",
  "openrouter",
  "google",
  "xai",
])
export const isFeatured = (provider: Pick<Provider, "id">) => FEATURED.has(provider.id)

/** The ways there are of signing in to a provider from the app. */
export function loginMethods(provider: Provider): ModelLoginMethod[] {
  const methods: ModelLoginMethod[] = []
  const { oauth, apiKey } = provider.auth
  if (oauth !== undefined) {
    methods.push({ type: "oauth", label: oauth.name, subscription: oauth.isSubscription === true })
  }
  // A provider with nowhere to type a key is one that reads it from the server's own files.
  if (apiKey?.login !== undefined) {
    methods.push({ type: "api_key", label: apiKey.name, subscription: false })
  }
  return methods
}

/**
 * Models suggested first for a provider a workspace signed in to. Ones its catalog lacks are
 * dropped, so a provider not listed here, or one whose models have moved on, suggests none.
 */
const SUGGESTED: Record<string, readonly string[]> = {
  anthropic: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
  openai: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"],
  "openai-codex": ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"],
  "github-copilot": ["claude-sonnet-5.5", "gpt-6.1-sol"],
}

export function isSuggested(model: Model<Api>): boolean {
  return SUGGESTED[model.provider]?.includes(model.id) === true
}

/** A provider's models in the order to offer them: the suggested ones, then the rest by name. */
export function inOfferedOrder(models: readonly Model<Api>[]): Model<Api>[] {
  const rank = (model: Model<Api>) => SUGGESTED[model.provider]?.indexOf(model.id) ?? -1
  return [
    ...models.filter(isSuggested).sort((a, b) => rank(a) - rank(b)),
    ...models.filter((model) => !isSuggested(model)).sort((a, b) => a.name.localeCompare(b.name)),
  ]
}

/** A model as the app offers it: what it is called, what it costs, what it can do. */
export function modelOption(
  model: Model<Api>,
  provider: Pick<Provider, "name">,
  recommended: boolean,
): ModelOption {
  return {
    id: `${model.provider}/${model.id}`,
    name: model.name,
    provider: provider.name,
    reasoning: model.reasoning,
    ...(model.reasoning ? { thinking: getSupportedThinkingLevels(model) } : {}),
    inputCost: model.cost.input,
    outputCost: model.cost.output,
    contextWindow: model.contextWindow,
    images: model.input.includes("image"),
    ...(recommended ? { recommended: true } : {}),
  }
}

/**
 * Two lists of models as one, the first list's first. A model both have is kept once: a
 * workspace signed in to a provider the deployment has a key for is offered its models once.
 */
export function mergeModelOptions(
  first: readonly ModelOption[],
  second: readonly ModelOption[],
): ModelOption[] {
  const seen = new Set(first.map((option) => option.id))
  return [...first, ...second.filter((option) => !seen.has(option.id))]
}

/**
 * The models an agent in a workspace can be set to: the deployment's, then those of the
 * providers its workspace is signed in to. A model both have is the workspace's, since its own
 * sign-in is what the model is then called with, and what pays for it.
 */
export function offeredModels(
  deployment: readonly ModelOption[],
  workspace: readonly ModelOption[],
): ModelOption[] {
  const theirs = new Set(workspace.map((option) => option.id))
  return [...deployment.filter((option) => !theirs.has(option.id)), ...workspace]
}

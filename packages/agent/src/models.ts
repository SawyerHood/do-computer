import type { ModelOption } from "@do-computer/protocol"
import {
  fauxAssistantMessage,
  fauxProvider,
  type FauxProviderHandle,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import type { CredentialStore } from "@earendil-works/pi-ai"
import { createModels, type Models } from "@earendil-works/pi-ai/models"
import type { ModelRef } from "@earendil-works/pi-durable"
import { TOOL_SEARCH_TOOL_NAME } from "@earendil-works/pi-durable/tool-search"
import { isExtraModel } from "./extra-models.ts"
import type { ReviewOptions } from "./journal.ts"
import type { JudgeOptions } from "./keep-going.ts"
import {
  type DeploymentAccess,
  cachedSignIns,
  credentialChain,
  deploymentModelOptions,
  workspaceCredentials,
} from "./model-access.ts"
import { mergeModelOptions, modelOption, modelProviders } from "./model-providers.ts"
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

export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-haiku-5.5"
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

/** The models a deployment offers everyone, and the one it starts new agents on. */
export type DeploymentModels = {
  /** `provider/modelId` used when an agent has not chosen one. */
  readonly defaultModel: string
  readonly options: readonly ModelOption[]
}

export type AgentModels = DeploymentModels & {
  readonly models: Models
  /**
   * What the deployment offers at the moment: `options` and `defaultModel` are what its key
   * alone gives, and this adds the providers the deployment itself is signed in to, which
   * someone can change while the server runs.
   */
  readonly offered: () => Promise<DeploymentModels>
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
  /**
   * The model new agents start on: `provider/model`, or an OpenRouter model id such as
   * `anthropic/claude-sonnet-5.5`. One the deployment does not offer is passed over.
   */
  readonly defaultModel?: string
  /**
   * The only models the deployment offers on its own account, each `provider/model` or an
   * OpenRouter model id. Absent: every model of whatever the deployment has a key for or is
   * signed in to. What a workspace signs in to with an account of its own is not narrowed.
   */
  readonly allowedModels?: readonly string[]
  /**
   * Models added to a provider's own list, each `provider/model` (`extra-models.ts`). They can
   * be called, but the deployment offers none of them on its own account: a workspace signed
   * in to the provider is what offers one.
   */
  readonly extraModels?: readonly string[]
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

type EchoContext = {
  messages: readonly {
    role: string
    content: unknown
    toolName?: string
    toolsAdded?: readonly { name: string }[]
    toolsRemoved?: readonly { name: string }[]
  }[]
  tools?: readonly { name: string }[]
}

const blockText = (content: unknown): string => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block: { type: string; text?: string }) =>
      block.type === "text" && !block.text?.startsWith("<meta ") ? (block.text ?? "") : "",
    )
    .join("")
}

/** The names of the tools a request offers, as its system messages give and take them. */
function offered(context: EchoContext): Set<string> {
  const names = new Set((context.tools ?? []).map((tool) => tool.name))
  for (const message of context.messages) {
    if (message.role !== "system") continue
    for (const tool of message.toolsRemoved ?? []) names.delete(tool.name)
    for (const tool of message.toolsAdded ?? []) names.add(tool.name)
  }
  return names
}

/** The tools a message asks for: one `/tool` with its arguments, or several, one to a line. */
function asked(text: string): { name: string; args: string }[] | undefined {
  const lines = text.split("\n").map((line) => /^\/tool\s+(\w+)\s+(\{.*\})\s*$/.exec(line))
  if (lines.length > 1 && lines.every((line) => line !== null)) {
    return lines.map((line) => ({ name: line![1]!, args: line![2]! }))
  }
  const command = /^\/tool\s+(\w+)\s+(\{[\s\S]*\})\s*$/.exec(text)
  return command ? [{ name: command[1]!, args: command[2]! }] : undefined
}

/** The tool a main chat or a thread in Slack says things to people with (`bus.ts`). */
const SEND = "send"

/**
 * Whether the echo model, answering a person where only what is sent is shown, has sent them
 * anything since their message: it then has nothing more to send, and says the rest to itself.
 */
function sentSince(context: EchoContext, person: number): boolean {
  return context.messages
    .slice(person + 1)
    .some(
      (message) =>
        message.role === "assistant" &&
        Array.isArray(message.content) &&
        message.content.some(
          (block: { type?: string; name?: string }) =>
            block.type === "toolCall" && block.name === SEND,
        ),
    )
}

/**
 * What the echo model answers. It repeats the last user message, with two affordances for trying
 * the app without a model key: a message of the form `/tool <name> <json arguments>` makes it call
 * that tool and then report the result (several such lines make it call them all in one round),
 * and `/fail <error>` makes the reply fail with that error, the way a model provider's would. An
 * automation's result's lines of that form are called in the same way.
 * A tool it is not offered yet, as a connector's is not, it looks for first, as a model would.
 *
 * Where it is offered `send`, in a main chat or a thread in Slack, it answers a person as a model
 * there would: what it would have said goes in a `send` marked `done`, once, which ends its turn
 * (a send it is told to make goes on to its result, and anything after that it says to itself). An event, or a note for the model alone, gets words that nobody is shown, and so does
 * a message that begins `/quiet`, as from a model that forgot to send.
 */
function echoAnswer(context: EchoContext) {
  const answer = echoWords(context)
  if (typeof answer === "object") return answer
  const at = context.messages.findLastIndex(
    (message) => message.role === "user" && blockText(message.content) !== "",
  )
  const newest = at === -1 ? "" : blockText(context.messages[at]!.content)
  const person =
    at !== -1 &&
    !newest.startsWith("<event ") &&
    !newest.startsWith("<meta ") &&
    !newest.startsWith("/quiet")
  if (!person || !offered(context).has(SEND) || sentSince(context, at)) {
    return fauxAssistantMessage(answer)
  }
  // Its answer is its last word for now, which ends its turn.
  return fauxAssistantMessage([fauxToolCall(SEND, { text: answer, done: true })], {
    stopReason: "toolUse",
  })
}

/** What the echo model would say, or the message it answers with where that is not words. */
function echoWords(context: EchoContext): string | ReturnType<typeof fauxAssistantMessage> {
  // Prompt changes are recorded as system entries, which can follow a tool result.
  const last = context.messages.findLast((message) => message.role !== "system")
  // The newest thing said to it. A note for the model alone, such as word that a sub-agent has
  // reported, says nothing to repeat: what it follows is repeated instead.
  const user = context.messages.findLast(
    (message) => message.role === "user" && blockText(message.content) !== "",
  )
  const text = blockText(user?.content)
  // An automation's result is answered as what it carries asks: a line in it of the form
  // `/tool …` is called, so that a main chat on the bus can be tried reacting to one. Only that
  // event: the others carry what came from outside, such as a page or a thread in Slack.
  const carried = text.startsWith('<event kind="automation"')
    ? text
        .split("\n")
        .filter((line) => /^\/tool\s+\w+\s+\{.*\}\s*$/.test(line))
        .join("\n")
    : ""
  const calls = asked(carried === "" ? text : carried)
  // It looked for what it was asked to use, and uses it now, found or not.
  const looked =
    last?.role === "toolResult" &&
    last.toolName === TOOL_SEARCH_TOOL_NAME &&
    calls !== undefined &&
    calls.every((call) => call.name !== TOOL_SEARCH_TOOL_NAME)
  if (last?.role === "toolResult" && !looked) {
    return `The tool returned:\n\n${blockText(last.content)}`
  }
  const failure = /^\/fail\s+([\s\S]+)$/.exec(text)
  if (failure) {
    return fauxAssistantMessage([], { stopReason: "error", errorMessage: failure[1]!.trim() })
  }
  if (calls !== undefined) {
    try {
      // Several of them are called in one round, as a model calls several at once.
      const use = calls.map((call) => fauxToolCall(call.name, JSON.parse(call.args)))
      const has = offered(context)
      const missing = calls.filter((call) => !has.has(call.name))
      if (!looked && missing.length > 0 && has.has(TOOL_SEARCH_TOOL_NAME)) {
        return fauxAssistantMessage(
          missing.map((call) => fauxToolCall(TOOL_SEARCH_TOOL_NAME, { query: call.name })),
          { stopReason: "toolUse" },
        )
      }
      return fauxAssistantMessage(use, { stopReason: "toolUse" })
    } catch {
      return "Those tool arguments are not valid JSON."
    }
  }
  return `You said: ${text}\n\n(No OPENROUTER_API_KEY is configured, so this is the built-in echo model.)`
}

/** What model access is built from besides the deployment's settings. */
export type AgentModelsSources = {
  /** What the agent's workspace is signed in to. Without it, only the deployment's models run. */
  readonly workspace?: CredentialStore
  /** What the deployment itself is signed in to, for everyone. Without it, only its key. */
  readonly deployment?: DeploymentAccess
}

const OPENROUTER = "openrouter/"

/**
 * Whether a deployment that names the models it offers names this one. A name is the model's
 * whole id, or, for one reached through OpenRouter, its id there.
 */
function allows(allowed: ReadonlySet<string> | undefined, id: string): boolean {
  if (allowed === undefined || allowed.has(id)) return true
  return id.startsWith(OPENROUTER) && allowed.has(id.slice(OPENROUTER.length))
}

/** Where a model stands among those the deployment names, for putting them in that order. */
function placeIn(allowed: readonly string[], id: string): number {
  const at = allowed.indexOf(id)
  return at !== -1 || !id.startsWith(OPENROUTER) ? at : allowed.indexOf(id.slice(OPENROUTER.length))
}

/**
 * One `Models` in front of two. A model the deployment offers is called with whatever there is
 * for its provider: the workspace's own sign-in, then the deployment's, then its key. Any other
 * model is called with the workspace's sign-in or not at all, so a deployment that names the
 * models it pays for never pays for another, whatever an agent was set to before.
 */
function routed(own: Models, theirs: Models, offers: (id: string) => boolean): Models {
  const calls = new Set<string | symbol>([
    "getAuth",
    "stream",
    "complete",
    "streamSimple",
    "completeSimple",
    "streamDeferred",
    "fetchDeferred",
    "cancelDeferred",
    "generateImages",
    "classify",
  ])
  return new Proxy(own, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown
      if (typeof value !== "function") return value
      if (!calls.has(property)) return value.bind(target)
      return (first: unknown, ...rest: unknown[]) => {
        // Auth is also asked for by a provider's id alone, which is the deployment's to answer.
        const model =
          typeof first === "object" && first !== null
            ? (first as { provider?: unknown; id?: unknown })
            : undefined
        const through =
          model === undefined || offers(`${String(model.provider)}/${String(model.id)}`)
            ? target
            : theirs
        const call = Reflect.get(through, property, through) as (...args: unknown[]) => unknown
        return call.call(through, first, ...rest)
      }
    },
  })
}

/**
 * Model access for a deployment: OpenRouter when a key is configured, and whatever the
 * deployment is signed in to besides. With neither, an echo model that needs no network. Every
 * provider a workspace can sign in to is there as well, and answers for the agents of a
 * workspace that has. Without `sources` nobody is signed in to anything, and only what the
 * deployment's key gives is there to run.
 */
export function createAgentModels(
  config: AgentModelsConfig,
  sources: AgentModelsSources = {},
): AgentModels {
  const key =
    config.openrouterApiKey === undefined || config.openrouterApiKey === ""
      ? undefined
      : config.openrouterApiKey
  const named = (config.allowedModels ?? []).map((name) => name.trim()).filter(Boolean)
  const allowed = named.length === 0 ? undefined : new Set(named)
  const offers = (id: string) => id === ECHO_MODEL || allows(allowed, id)
  // Asked for at most twice a minute by one agent: every agent of the deployment shares it.
  const signedIn =
    sources.deployment === undefined
      ? undefined
      : cachedSignIns(workspaceCredentials(sources.deployment))
  const build = (credentials: CredentialStore | undefined, withKey: boolean) => {
    const built = createModels({
      ...(credentials === undefined ? {} : { credentials }),
      // The key comes from deployment config, never from the process environment or disk.
      authContext: {
        env: async (name) => (withKey && name === "OPENROUTER_API_KEY" ? key : undefined),
        fileExists: async () => false,
      },
    })
    for (const provider of modelProviders(config.extraModels)) built.setProvider(provider)
    return built
  }
  const own = build(credentialChain(sources.workspace, signedIn), true)
  // Where every model is offered there is nothing to keep apart.
  const models = allowed === undefined ? own : routed(own, build(sources.workspace, false), offers)

  // The echo model is always there to call, and offered where there is nothing else.
  const faux = fauxProvider({
    provider: "echo",
    models: [{ id: "echo-1", name: "Echo (no model key configured)" }],
    tokensPerSecond: 60,
  })
  own.setProvider(faux.provider)
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
  const echo: ModelOption = {
    id: ECHO_MODEL,
    name: "Echo (no model key configured)",
    reasoning: false,
    inputCost: 0,
    outputCost: 0,
    recommended: true,
  }

  /** The one new agents start on, out of what is offered: the one configured, if it is there. */
  const startsOn = (options: readonly ModelOption[]): string => {
    // A deployment that names its models and no default starts on the first it names, whether
    // or not the usual default is among them.
    const wanted = config.defaultModel ?? (allowed === undefined ? DEFAULT_OPENROUTER_MODEL : "")
    const found = options.find(
      (option) => option.id === wanted || option.id === OPENROUTER + wanted,
    )
    return (found ?? options.find((option) => option.recommended === true) ?? options[0] ?? echo).id
  }
  /** In the order the deployment names its models, where it names them. */
  const inNamedOrder = (options: ModelOption[]): ModelOption[] =>
    allowed === undefined
      ? options
      : options.sort((a, b) => placeIn(named, a.id) - placeIn(named, b.id))

  /** What the key alone gives: OpenRouter's models that the deployment offers. */
  const fromKey = (): ModelOption[] => {
    if (key === undefined) return []
    const provider = own.getProvider("openrouter")!
    const catalog = new Map(
      provider
        .getModels()
        .filter((model) => !isExtraModel(model))
        .map((model) => [model.id, model]),
    )
    const offered = [...catalog.keys()].filter((id) => offers(OPENROUTER + id))
    // Every model in the catalog can be chosen: it is the set of OpenRouter models that can call
    // tools, which an agent needs. A few are suggested first, and the rest follow by name. A
    // deployment that names its models has chosen them all, and none is set apart.
    const wanted = (config.defaultModel ?? DEFAULT_OPENROUTER_MODEL).replace(/^openrouter\//, "")
    const suggested =
      allowed === undefined
        ? [...new Set([wanted, ...CURATED])].filter((id) => offered.includes(id))
        : []
    const rest = offered
      .filter((id) => !suggested.includes(id))
      .sort((a, b) => catalog.get(a)!.name.localeCompare(catalog.get(b)!.name))
    return inNamedOrder(
      [...suggested, ...rest].map((id) =>
        modelOption(catalog.get(id)!, provider, suggested.includes(id)),
      ),
    )
  }
  const keyed = fromKey()
  if (key !== undefined && allowed === undefined && keyed.length === 0) {
    throw new Error(`None of the configured OpenRouter models exist in the model catalog`)
  }
  const options = keyed.length === 0 ? [echo] : keyed
  const defaultModel = startsOn(options)

  const offered = async (): Promise<DeploymentModels> => {
    if (sources.deployment === undefined) return { defaultModel, options }
    // Offered as the deployment's own, whoever it was that signed the deployment in.
    const theirs = (await deploymentModelOptions(sources.deployment))
      .filter((option) => offers(option.id))
      .map(({ signIn: _, ...option }) => option)
    if (theirs.length === 0) return { defaultModel, options }
    const all = inNamedOrder(mergeModelOptions(keyed, theirs))
    return { defaultModel: startsOn(all), options: all }
  }

  const base = { models, defaultModel, options, offered }
  if (key === undefined) return { ...base, faux }
  // Reading a stretch of text and saying what it comes to: the same work for a search and a
  // note. Asked for by its OpenRouter id, as the judge is, so neither need be a model an agent
  // could run on.
  const catalog = own.getProvider("openrouter")!.getModels()
  const reader = catalog.some((model) => model.id === DEFAULT_SEARCH_MODEL)
    ? DEFAULT_SEARCH_MODEL
    : defaultModel.startsWith(OPENROUTER)
      ? defaultModel.slice(OPENROUTER.length)
      : DEFAULT_OPENROUTER_MODEL
  return {
    ...base,
    webSearch: { apiKey: key, model: config.searchModel ?? reader },
    judge: { apiKey: key, model: config.judgeModel ?? DEFAULT_JUDGE_MODEL },
    review: { apiKey: key, model: config.reviewModel ?? reader },
  }
}

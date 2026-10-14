import type { Api, FetchFunction, Model } from "@earendil-works/pi-ai"
import type { Provider } from "@earendil-works/pi-ai/models"

/**
 * Models a deployment adds to a provider's own list: ones the provider has that are not yet in
 * pi's list. They are named in the deployment's settings.
 *
 * Each is `provider/model`. `[1m]` after it asks for the model's long context, the way Claude
 * Code writes it, and `=model` after that names the model of the same provider it is treated
 * as, for all that pi knows of a model and cannot know of this one: how it thinks, what it
 * takes, what it costs. Without one that is the first of the models suggested for the
 * provider.
 */
export type ExtraModel = {
  readonly provider: string
  readonly id: string
  /** Asked for with `[1m]`: a context of a million tokens. */
  readonly longContext: boolean
  /** The model of the same provider it is treated as. Undefined: the provider's usual one. */
  readonly like: string | undefined
}

const ENTRY = /^([^/\s]+)\/(\S+?)(\[1m\])?(?:=(\S+))?$/i

const LONG_CONTEXT_TOKENS = 1_000_000
/** What a request to Anthropic names to be given a model's long context. */
const LONG_CONTEXT_BETA = "context-1m-2025-08-07"

/** The models a setting names. An entry that is not of the form above is passed over. */
export function parseExtraModels(entries: readonly string[]): ExtraModel[] {
  return entries.flatMap((entry): ExtraModel[] => {
    const found = ENTRY.exec(entry.trim())
    if (found === null) return []
    return [
      { provider: found[1]!, id: found[2]!, longContext: found[3] !== undefined, like: found[4] },
    ]
  })
}

/** The models that were added to a provider's list here, as opposed to the ones it came with. */
const added = new WeakSet<Model<Api>>()

/** Whether a model is one a deployment added to its provider's list. */
export const isExtraModel = (model: Model<Api>): boolean => added.has(model)

/** A fetch that also names the long context among the features a request asks Anthropic for. */
function askingForLongContext(inner: FetchFunction | undefined): FetchFunction {
  return (input, init) => {
    const headers = new Headers(init?.headers)
    const named = headers.get("anthropic-beta")
    headers.set(
      "anthropic-beta",
      named === null || named === "" ? LONG_CONTEXT_BETA : `${named},${LONG_CONTEXT_BETA}`,
    )
    const next = { ...init, headers }
    return inner === undefined ? fetch(input, next) : inner(input, next)
  }
}

/**
 * A provider with the extra models that are its own added to its list. One it has already, or
 * one to be treated as a model it lacks, is passed over. `preferred` are the models an extra
 * one is treated as when it does not say, the first of them that the provider has.
 */
export function withExtraModels(
  provider: Provider,
  extra: readonly ExtraModel[],
  preferred: readonly string[] = [],
): Provider {
  const known = provider.getModels()
  const mine = new Map<string, Model<Api>>()
  const long = new Set<string>()
  for (const entry of extra) {
    if (entry.provider !== provider.id || mine.has(entry.id)) continue
    if (known.some((model) => model.id === entry.id)) continue
    const like =
      entry.like === undefined
        ? (preferred.flatMap((id) => known.find((model) => model.id === id) ?? [])[0] ?? known[0])
        : known.find((model) => model.id === entry.like)
    if (like === undefined) continue
    // The models another may answer in its place are that model's own, and not this one's.
    const { allowedFallbackModels: _, ...compat } = (like.compat ?? {}) as Record<string, unknown>
    const model = {
      ...like,
      id: entry.id,
      name: entry.id,
      ...(entry.longContext ? { contextWindow: LONG_CONTEXT_TOKENS } : {}),
      ...(like.compat === undefined ? {} : { compat }),
    } as Model<Api>
    added.add(model)
    mine.set(entry.id, model)
    if (entry.longContext && model.api === "anthropic-messages") long.add(entry.id)
  }
  if (mine.size === 0) return provider

  /** A provider's list with the extra models after it, less any it has come to have itself. */
  const all = <T extends { id: string; type?: string }>(theirs: readonly T[]): T[] => [
    ...theirs,
    ...([...mine.values()] as unknown as T[]).filter(
      (model) =>
        !theirs.some((other) => (other.type ?? "chat") === "chat" && other.id === model.id),
    ),
  ]
  const sent = <T extends { fetch?: FetchFunction }>(
    model: Model<Api>,
    options: T | undefined,
  ): T | undefined =>
    long.has(model.id)
      ? ({ ...options, fetch: askingForLongContext(options?.fetch) } as T)
      : options
  const { getAllModels } = provider
  return {
    ...provider,
    getModels: () => all(provider.getModels()),
    ...(getAllModels === undefined ? {} : { getAllModels: () => all(getAllModels()) }),
    stream: (model, context, options) => provider.stream(model, context, sent(model, options)),
    streamSimple: (model, context, options) =>
      provider.streamSimple(model, context, sent(model, options)),
  }
}

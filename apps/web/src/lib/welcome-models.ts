import type { ModelOption } from "@durable-computer/protocol"

/** As many models of one place as the first run's card offers. The rest are in the agent's settings. */
const SHOWN = 6
/** As many of a provider's models as are offered where it suggests none itself. */
const UNSUGGESTED = 4

/** Models that come from one place, under what that place is called to the person. */
export type Source = {
  key: string
  /** The provider it is the person's sign-in to, by name. None for what the deployment includes. */
  provider?: string
  label: string
  /** How it is paid for, said beside it. Nothing to say of what is included. */
  tag?: string
  /** The few of its models that it can be set to from the card. */
  models: ModelOption[]
  /** The one of them it is on until another is chosen. */
  first: string
}

/** The few of a place's models that are worth offering: the suggested ones, where it has any. */
function few(models: readonly ModelOption[], keep: string): ModelOption[] {
  if (models.length <= SHOWN) return [...models]
  const suggested = models.filter((model) => model.recommended === true)
  const shown = (suggested.length === 0 ? models.slice(0, UNSUGGESTED) : suggested).slice(0, SHOWN)
  // The one it is set to is never left out of what it can be set to.
  const kept = models.find((model) => model.id === keep)
  return kept === undefined || shown.includes(kept) ? shown : [kept, ...shown.slice(0, SHOWN - 1)]
}

/**
 * What there is to choose from in the first run, by where it comes from: what the deployment
 * includes, which is on the model it starts a new agent on, then each provider the person has
 * signed in to, on the first of its models.
 */
export function sources(models: readonly ModelOption[], current: string): Source[] {
  const own = models.filter((model) => model.signIn === undefined)
  // The agent was made with the deployment's choice. Where that one has since become the
  // person's own, the deployment's next best stands in for it.
  const start =
    own.find((model) => model.id === current) ??
    own.find((model) => model.recommended === true) ??
    own[0]
  const found = new Map<string, ModelOption[]>()
  for (const model of models) {
    if (model.signIn === undefined) continue
    const key = `${model.provider ?? ""}/${model.signIn.subscription ? "subscription" : "key"}`
    found.set(key, [...(found.get(key) ?? []), model])
  }
  return [
    ...(start === undefined
      ? []
      : [{ key: "own", label: "Included", models: few(own, start.id), first: start.id }]),
    ...[...found].map(([key, theirs]): Source => {
      const [{ provider, signIn }] = theirs as [ModelOption, ...ModelOption[]]
      const kind = signIn!.subscription ? "subscription" : "key"
      const shown = few(theirs, current)
      return {
        key,
        ...(provider === undefined ? {} : { provider }),
        label: `Your ${provider ?? "own"} ${kind}`,
        tag: `On your ${kind}`,
        models: shown,
        first: (shown.find((model) => model.id === current) ?? shown[0]!).id,
      }
    }),
  ]
}

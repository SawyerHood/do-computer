import {
  type ModelLoginMethod,
  type ModelOption,
  type ModelProvider,
  personalWorkspaceId,
} from "@durable-computer/protocol"
import { CaretDownIcon, CaretRightIcon, CheckIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { Loads } from "@/components/loads"
import { CardsPlaceholder } from "@/components/placeholders"
import { ModelProviderList, ModelSignIn, type Scope } from "@/components/settings/models"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { client } from "@/lib/client"
import { modelProvidersKey, workspaceModelsKey } from "@/lib/collections"
import { cn } from "@/lib/utils"

/** As many models of one place as the card lists. The rest are in the agent's settings. */
const SHOWN = 6
/** As many of a provider's models as are listed where it suggests none itself. */
const UNSUGGESTED = 4

/** Models that come from one place, under what that place is called to the person. */
type Source = { key: string; label: string; tag: string; models: ModelOption[] }

/** The few of a place's models that are worth a line each: the suggested ones, where it has any. */
function few(models: readonly ModelOption[], keep: string): ModelOption[] {
  if (models.length <= SHOWN) return [...models]
  const suggested = models.filter((model) => model.recommended === true)
  const shown = (suggested.length === 0 ? models.slice(0, UNSUGGESTED) : suggested).slice(0, SHOWN)
  // The one it is set to is never left out of what it can be set to.
  const kept = models.find((model) => model.id === keep)
  return kept === undefined || shown.includes(kept) ? shown : [kept, ...shown.slice(0, SHOWN - 1)]
}

/**
 * What there is to choose from, by where it comes from: what the deployment offers everyone,
 * then each provider the person has signed in to.
 */
function sources(models: readonly ModelOption[], current: string): Source[] {
  const own = models.filter((model) => model.signIn === undefined)
  const found = new Map<string, Source>()
  for (const model of models) {
    if (model.signIn === undefined) continue
    const kind = model.signIn.subscription ? "subscription" : "key"
    const key = `${model.provider ?? ""}/${kind}`
    const source = found.get(key) ?? {
      key,
      label: `Your ${model.provider ?? "own"} ${kind}`,
      tag: model.signIn.subscription ? "On your subscription" : "On your key",
      models: [],
    }
    source.models.push(model)
    found.set(key, source)
  }
  return [
    ...(own.length === 0 ? [] : [{ key: "own", label: "Built in", tag: "Built in", models: own }]),
    ...found.values(),
  ].map((source) => ({ ...source, models: few(source.models, current) }))
}

/** What a model is called, without the maker's name that a catalog of many makers puts first. */
const called = (model: ModelOption) => model.name.replace(/^[^:]{1,24}:\s+/, "")

/** A provider's sign-in with an account, by what the account is called. */
const account = (providers: readonly ModelProvider[] | undefined, called: RegExp, id?: string) => {
  for (const provider of providers ?? []) {
    if (id !== undefined && provider.id !== id) continue
    const method = provider.methods.find((way) => way.type === "oauth" && called.test(way.label))
    if (method !== undefined) return { provider, method }
  }
  return undefined
}

/**
 * What the agent thinks with, asked while it is still in its egg: one of the models the
 * deployment offers, or one of the person's own, which they can sign in to from here. ChatGPT
 * and Claude are a press away, and every other provider and key is behind one more.
 */
export function Thinking({
  meId,
  name,
  current,
  busy,
  problem,
  onChosen,
}: {
  meId: string
  /** What the agent is called. */
  name: string
  /** The model it was made with. */
  current: string
  busy: boolean
  problem: React.ReactNode
  onChosen: (model: string) => void
}) {
  const workspace = useMemo<Scope>(
    () => ({
      id: personalWorkspaceId(meId),
      name: "Your workspace",
      kind: "personal",
      role: "owner",
    }),
    [meId],
  )
  const { data: models } = useQuery({
    queryKey: workspaceModelsKey(workspace.id),
    queryFn: () => client.models(workspace.id),
  })
  const { data: providers } = useQuery({
    queryKey: modelProvidersKey(workspace.id),
    queryFn: () => client.workspace(workspace.id).modelProviders(),
  })
  const [chosen, setChosen] = useState(current)
  const [more, setMore] = useState(false)
  const [signingIn, setSigningIn] = useState<{
    provider: ModelProvider
    method: ModelLoginMethod
  }>()

  const offered = useMemo(() => sources(models ?? [], current), [models, current])
  // Signing in to something is saying what to think with: the first of its models is chosen.
  const known = useRef<Set<string> | undefined>(undefined)
  useEffect(() => {
    if (models === undefined) return
    const keys = new Set(offered.map((source) => source.key))
    const fresh = offered.find(
      (source) => known.current !== undefined && !known.current.has(source.key),
    )
    known.current = keys
    if (fresh?.models[0] === undefined) return
    setChosen(fresh.models[0].id)
    // What was opened to sign in has done what it was opened for.
    setMore(false)
  }, [models, offered])

  const listed = offered.flatMap((source) => source.models)
  const picked = listed.find((model) => model.id === chosen)
  // What it was set to is gone, as when a sign-in was undone: back to what is still there.
  useEffect(() => {
    if (models !== undefined && picked === undefined && listed[0] !== undefined) {
      setChosen(listed[0].id)
    }
  }, [models, picked, listed])

  // The one chosen is in sight, in a list that is longer than it shows.
  const list = useRef<HTMLFormElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: each time another is chosen
  useEffect(() => {
    list.current?.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: "nearest" })
  }, [picked?.id])

  const quick = [
    { says: "ChatGPT", found: account(providers, /chatgpt/i) },
    { says: "Claude", found: account(providers, /claude/i, "anthropic") },
  ]

  return (
    <div className="mt-3 flex flex-col gap-3">
      {models === undefined ? (
        <CardsPlaceholder cards={1} />
      ) : (
        <RadioGroup
          // A form of its own, which the windows opened from this card are not inside of: what
          // is sent in one of those is not this being answered.
          render={
            <form
              ref={list}
              id="welcome-model"
              onSubmit={(event) => {
                event.preventDefault()
                if (event.target === event.currentTarget && picked !== undefined) {
                  onChosen(picked.id)
                }
              }}
            />
          }
          aria-label="What it thinks with"
          value={picked?.id ?? ""}
          onValueChange={(id) => setChosen(String(id))}
          className="max-h-[min(15rem,30vh)] gap-0 overflow-y-auto overscroll-contain rounded-xl border"
        >
          {offered.map((source, place) => (
            <div key={source.key} role="group" aria-label={source.label} className="contents">
              {offered.length > 1 ? (
                <p
                  className={cn(
                    "sticky top-0 z-10 border-b bg-secondary px-3 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase",
                    place > 0 && "border-t",
                  )}
                >
                  {source.label}
                </p>
              ) : null}
              {source.models.map((model, index) => (
                <label
                  key={model.id}
                  className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm not-last:border-b has-data-checked:bg-accent/60 hover:bg-accent/60"
                >
                  <RadioGroupItem
                    value={model.id}
                    {...(model.id === picked?.id || (picked === undefined && index === 0)
                      ? { "data-first": true }
                      : {})}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{called(model)}</span>
                  {/* Said once above them, where there is more than one place they come from. */}
                  {offered.length > 1 ? null : (
                    <span className="shrink-0 text-xs text-muted-foreground">{source.tag}</span>
                  )}
                </label>
              ))}
            </div>
          ))}
        </RadioGroup>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Or one of your own:</span>
        {quick.map(({ says, found }) =>
          found?.provider.signedIn ? (
            <span
              key={says}
              className="flex items-center gap-1 px-1.5 text-sm text-muted-foreground"
            >
              <CheckIcon className="text-primary" />
              {/* Signed in to with a key, it is the provider that is, not the subscription. */}
              {found.provider.signedIn.type === "oauth" ? says : `${found.provider.name} key`}
            </span>
          ) : (
            <Button
              key={says}
              type="button"
              size="sm"
              variant="outline"
              disabled={found === undefined}
              onClick={() => found !== undefined && setSigningIn(found)}
            >
              Sign in with {says}
            </Button>
          ),
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          aria-expanded={more}
          onClick={() => setMore(!more)}
        >
          {more ? (
            <CaretDownIcon data-icon="inline-start" />
          ) : (
            <CaretRightIcon data-icon="inline-start" />
          )}
          More
        </Button>
      </div>
      {more ? (
        // A list of its own to scroll, so that the card stays under the egg and not over it.
        <section
          aria-label="Model providers"
          className="-mr-2 max-h-[min(15rem,28vh)] overflow-y-auto overscroll-contain pr-2"
        >
          <Loads fallback={<CardsPlaceholder cards={2} />}>
            <ModelProviderList workspace={workspace} meId={meId} />
          </Loads>
          <p className="pt-2 text-xs text-muted-foreground">
            A subscription or a key of your own. What {name} uses then counts against your account
            there, and nobody is shown the key again.
          </p>
        </section>
      ) : null}

      {problem}
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-muted-foreground">This can be changed later.</span>
        <Button type="submit" form="welcome-model" disabled={busy || picked === undefined}>
          {busy ? "One moment…" : picked === undefined ? "Choose one" : `Use ${called(picked)}`}
        </Button>
      </div>
      {signingIn === undefined ? null : (
        <ModelSignIn
          workspace={workspace}
          provider={signingIn.provider}
          method={signingIn.method}
          onClose={() => setSigningIn(undefined)}
        />
      )}
    </div>
  )
}

import {
  type ModelLoginMethod,
  type ModelOption,
  type ModelProvider,
  personalWorkspaceId,
} from "@do-computer/protocol"
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Loads } from "@/components/loads"
import { CardsPlaceholder } from "@/components/placeholders"
import { ModelProviderList, ModelSignIn, type Scope, short } from "@/components/settings/models"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { client } from "@/lib/client"
import { modelProvidersKey, workspaceModelsKey } from "@/lib/collections"
import { cn } from "@/lib/utils"
import { type Source, sources } from "@/lib/welcome-models"

/** What a model is called, without the maker's name that a catalog of many makers puts first. */
const called = (model: ModelOption) => model.name.replace(/^[^:]{1,24}:\s+/, "")

type Account = { provider: ModelProvider; method: ModelLoginMethod }

/** A provider's sign-in with an account, by what the account is called. */
const account = (providers: readonly ModelProvider[] | undefined, called: RegExp, id?: string) => {
  for (const provider of providers ?? []) {
    if (id !== undefined && provider.id !== id) continue
    const method = provider.methods.find((way) => way.type === "oauth" && called.test(way.label))
    if (method !== undefined) return { provider, method }
  }
  return undefined
}

/** A line of the card: somewhere to think from that can be chosen, or one to sign in to first. */
type Choice =
  { source: Source; title: string } | { says: string; found: Account; source?: undefined }

const ROW = "flex w-full items-center gap-3 px-3 py-2.5 text-left not-last:border-b"

/**
 * Somewhere the agent can think from, as one of the card's choices: what it is called, the
 * model of its that would be used small under it, and a way to another of its models.
 */
function From({
  title,
  source,
  model,
  first,
  onModel,
}: {
  title: string
  source: Source
  /** The one of its models that choosing it would use. */
  model: ModelOption
  /** Whether it is what the card opens on. */
  first: boolean
  onModel: (id: string) => void
}) {
  const id = useId()
  return (
    <label className={cn(ROW, "cursor-pointer hover:bg-accent/60 has-data-checked:bg-accent/60")}>
      <RadioGroupItem
        value={source.key}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-model`}
        {...(first ? { "data-first": true } : {})}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={`${id}-title`} className="truncate text-sm font-medium">
          {title}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span id={`${id}-model`} className="truncate">
            {called(model)}
          </span>
          {source.models.length < 2 ? null : (
            <>
              <span aria-hidden>·</span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Change the model of ${title}`}
                  className="shrink-0 cursor-pointer rounded-sm underline decoration-muted-foreground/40 underline-offset-2 outline-none hover:text-foreground hover:decoration-current focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  Change
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" className="w-auto min-w-56">
                  <DropdownMenuRadioGroup
                    aria-label={`The model of ${title}`}
                    value={model.id}
                    onValueChange={(next) => onModel(String(next))}
                  >
                    {source.models.map((one) => (
                      <DropdownMenuRadioItem key={one.id} value={one.id}>
                        {called(one)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </span>
      </span>
      {source.tag === undefined ? null : (
        <span className="shrink-0 text-xs text-muted-foreground">{source.tag}</span>
      )}
    </label>
  )
}

/**
 * What the agent thinks with, asked while it is still in its egg, as a few choices: what the
 * deployment includes, a ChatGPT or a Claude account of the person's own, which they sign in
 * to from here, and every other provider and key behind one more press. Each says small which
 * of its models would be used, with a way to another.
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
  /** Where it thinks from, once that was chosen or signed in to. */
  const [from, setFrom] = useState<string>()
  /** The model of each place that was changed from the one it starts on. */
  const [changed, setChanged] = useState<Record<string, string>>({})
  const [more, setMore] = useState(false)
  const [signingIn, setSigningIn] = useState<Account>()

  const offered = useMemo(() => sources(models ?? [], current), [models, current])
  // Signing in to something is saying what to think with: it is chosen, on its first model.
  const known = useRef<Set<string> | undefined>(undefined)
  useEffect(() => {
    if (models === undefined) return
    const keys = new Set(offered.map((source) => source.key))
    const fresh = offered.find(
      (source) => known.current !== undefined && !known.current.has(source.key),
    )
    known.current = keys
    if (fresh === undefined) return
    setFrom(fresh.key)
    // What was opened to sign in has done what it was opened for.
    setMore(false)
  }, [models, offered])

  // What was chosen may be gone, as when a sign-in was undone: then it is where the agent's
  // own model comes from, or the first there is.
  const chosen =
    offered.find((source) => source.key === from) ??
    offered.find((source) => source.models.some((model) => model.id === current)) ??
    offered[0]
  const modelOf = (source: Source) =>
    source.models.find((model) => model.id === changed[source.key]) ??
    source.models.find((model) => model.id === source.first)!
  const picked = chosen === undefined ? undefined : modelOf(chosen)

  // The one chosen is in sight, in a list that is longer than it shows.
  const list = useRef<HTMLFormElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: each time another is chosen
  useEffect(() => {
    list.current?.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: "nearest" })
  }, [chosen?.key])

  // What is included first, then the two accounts most people have, each in one place whether
  // or not it is signed in to yet, then whatever else was signed in to.
  const choices: Choice[] = []
  const included = offered.find((source) => source.key === "own")
  if (included !== undefined) choices.push({ source: included, title: included.label })
  for (const { says, found } of [
    { says: "ChatGPT", found: account(providers, /chatgpt/i) },
    { says: "Claude", found: account(providers, /claude/i, "anthropic") },
  ]) {
    if (found === undefined) continue
    const { signedIn } = found.provider
    const source = offered.find((one) => one.provider === found.provider.name)
    if (source !== undefined) {
      // Signed in to with a key, it is the provider that is, not the subscription.
      choices.push({ source, title: signedIn?.type === "oauth" ? says : source.label })
    } else if (signedIn === null) {
      choices.push({ says, found })
    }
  }
  for (const source of offered) {
    if (!choices.some((choice) => choice.source === source)) {
      choices.push({ source, title: source.label })
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2.5">
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
          value={chosen?.key ?? ""}
          onValueChange={(key) => setFrom(String(key))}
          className="max-h-[min(15rem,30vh)] gap-0 overflow-y-auto overscroll-contain rounded-xl border"
        >
          {choices.map((choice) =>
            choice.source !== undefined ? (
              <From
                key={choice.source.key}
                title={choice.title}
                source={choice.source}
                model={modelOf(choice.source)}
                first={choice.source === chosen}
                onModel={(id) => {
                  setChanged((before) => ({ ...before, [choice.source.key]: id }))
                  setFrom(choice.source.key)
                }}
              />
            ) : (
              // Not one of the choices until it is signed in to, which choosing it starts.
              <button
                key={choice.says}
                type="button"
                aria-label={`Sign in with ${choice.says}`}
                className={cn(
                  ROW,
                  "group cursor-pointer outline-none hover:bg-accent/60 focus-visible:bg-accent/60",
                )}
                onClick={() => setSigningIn(choice.found)}
              >
                <span aria-hidden className="size-4 shrink-0 rounded-full bg-input/90" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{choice.says}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Your {short(choice.found.method)} subscription
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground group-hover:text-foreground">
                  Sign in
                  <CaretRightIcon />
                </span>
              </button>
            ),
          )}
        </RadioGroup>
      )}

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="-my-1 self-start text-muted-foreground"
        aria-expanded={more}
        onClick={() => setMore(!more)}
      >
        {more ? (
          <CaretDownIcon data-icon="inline-start" />
        ) : (
          <CaretRightIcon data-icon="inline-start" />
        )}
        Other providers
      </Button>
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

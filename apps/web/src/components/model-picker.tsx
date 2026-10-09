import { filterModels, type ModelOption } from "@durable-computer/protocol"
import { useMemo, useState } from "react"
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox"

/** How many matches are drawn at once. There are hundreds of models; typing narrows them. */
const SHOWN = 60

const perMillion = (cost: number) =>
  cost === 0 ? "free" : `$${cost < 1 ? cost.toFixed(2) : cost.toFixed(cost < 10 ? 1 : 0)}`

const context = (tokens: number | undefined) =>
  tokens === undefined
    ? ""
    : tokens >= 1_000_000
      ? `${Math.round(tokens / 100_000) / 10}M context`
      : `${Math.round(tokens / 1000)}K context`

/**
 * What a model costs and can hold, in one short line. One that a subscription pays for has no
 * price by the token to show.
 */
const facts = (model: ModelOption) =>
  [
    model.signIn?.subscription
      ? "on the subscription"
      : model.inputCost === 0 && model.outputCost === 0
        ? "free"
        : `${perMillion(model.inputCost)} in, ${perMillion(model.outputCost)} out per million tokens`,
    context(model.contextWindow),
  ]
    .filter(Boolean)
    .join(" · ")

/** Models that come from one place, under what that place is called. */
type Source = { value: string; items: ModelOption[] }

/** Where a model comes from: the deployment, or a provider the workspace is signed in to. */
const sourceOf = (model: ModelOption) =>
  model.signIn === undefined
    ? "own"
    : `${model.provider ?? ""}/${model.signIn.subscription ? "subscription" : "key"}`

/**
 * The models under where each comes from, the workspace's own sign-ins first. The same model
 * can be had twice, on a subscription and paid for by the token, and this is what tells the
 * two apart. Those from one place only are left as one list.
 */
function bySource(models: readonly ModelOption[]): Source[] | undefined {
  const found = new Map<string, ModelOption[]>()
  for (const model of models) {
    const key = sourceOf(model)
    found.set(key, [...(found.get(key) ?? []), model])
  }
  if (found.size < 2) return undefined
  const name = (key: string, items: ModelOption[]) => {
    const [first] = items
    if (key === "own") {
      const through = [...new Set(items.map((model) => model.provider).filter(Boolean))]
      return ["Do Computer", ...through].join(" · ")
    }
    const { subscription, by } = first!.signIn!
    return `${first!.provider ?? ""} ${subscription ? "subscription" : "key"}${
      by === null ? "" : ` · signed in by ${by}`
    }`
  }
  return [...found]
    .sort(([a], [b]) => Number(a === "own") - Number(b === "own"))
    .map(([key, items]) => ({ value: name(key, items), items }))
}

const flat = (source: Source) => source.items

/** What is left of the sources when everything that matches comes from one of them. */
function oneSource(sources: readonly Source[], shown: readonly ModelOption[]): Source[] {
  const [first] = shown
  if (first === undefined) return []
  const from = sources.find((source) => source.items.some((model) => model.id === first.id))
  return [{ value: from?.value ?? "", items: [...shown] }]
}

/**
 * Choose one model out of hundreds: a box that shows the current one, and opens into a list that
 * narrows as you type. Arrow keys move, Enter chooses, Escape puts things back.
 */
export function ModelPicker({
  label,
  models,
  value,
  onChange,
}: {
  label: string
  models: readonly ModelOption[]
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const current = models.find((model) => model.id === value)

  const matches = useMemo(() => filterModels(models, query), [models, query])
  const sources = useMemo(() => bySource(models), [models])
  // In the order they are drawn, which with sources is source by source.
  const ordered = useMemo(() => {
    const grouped = sources === undefined ? undefined : bySource(matches)
    return grouped === undefined ? matches : grouped.flatMap(flat)
  }, [sources, matches])
  const shown = useMemo(() => ordered.slice(0, SHOWN), [ordered])
  const shownSources = useMemo(
    () => (sources === undefined ? undefined : (bySource(shown) ?? oneSource(sources, shown))),
    [sources, shown],
  )
  const row = (model: ModelOption) => (
    <ComboboxItem key={model.id} value={model} className="items-start font-normal">
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-medium">{model.name}</span>
          {model.recommended ? (
            <span className="shrink-0 text-xs text-muted-foreground">suggested</span>
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {model.id.replace(/^openrouter\//, "")}
          {facts(model) ? ` · ${facts(model)}` : ""}
        </span>
      </span>
    </ComboboxItem>
  )

  return (
    <div>
      <Combobox
        items={sources ?? models}
        // Narrowed here and not by the list: it is given only as many as it draws at once.
        filteredItems={shownSources ?? shown}
        value={current ?? null}
        onValueChange={(model) => {
          if (model !== null) onChange(model.id)
        }}
        itemToStringLabel={(model) => model.name}
        itemToStringValue={(model) => model.id}
        isItemEqualToValue={(a, b) => a.id === b.id}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery("")
        }}
        // Closed, it shows the choice. Open, it is the search.
        inputValue={open ? query : (current?.name ?? value)}
        onInputValueChange={(next, details) => {
          // Only what is typed is a search: choosing a model writes its name here too.
          if (details.reason === "input-change") setQuery(next)
        }}
        autoHighlight
      >
        <ComboboxInput
          aria-label={label}
          autoComplete="off"
          spellCheck={false}
          placeholder={open ? `Search ${models.length} models` : undefined}
          className="w-full"
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            // With the list closed, Escape is not the picker's to take: it is left for the
            // window the picker is in.
            if (event.key === "Escape" && !open) event.preventBaseUIHandler()
          }}
        />
        <ComboboxContent>
          <ComboboxEmpty>No model matches.</ComboboxEmpty>
          <ComboboxList aria-label={label} className="max-h-80">
            {shownSources === undefined
              ? row
              : (source: Source) => (
                  <ComboboxGroup key={source.value} items={source.items}>
                    <ComboboxLabel className="pt-3 pb-1 font-medium tracking-wide uppercase">
                      {source.value}
                    </ComboboxLabel>
                    <ComboboxCollection>{row}</ComboboxCollection>
                  </ComboboxGroup>
                )}
          </ComboboxList>
          {matches.length > shown.length ? (
            <p className="border-t px-4.5 py-2 text-xs text-muted-foreground">
              {matches.length - shown.length} more. Type to narrow them down.
            </p>
          ) : null}
        </ComboboxContent>
      </Combobox>
      {current && !open ? (
        <p className="mt-1 px-1 text-xs text-muted-foreground">
          {current.id.replace(/^openrouter\//, "")}
          {facts(current) ? ` · ${facts(current)}` : ""}
        </p>
      ) : null}
    </div>
  )
}

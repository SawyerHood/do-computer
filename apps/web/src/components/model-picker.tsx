import { filterModels, type ModelOption } from "@durable-computer/protocol"
import { useMemo, useState } from "react"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
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

/** What a model costs and can hold, in one short line. */
const facts = (model: ModelOption) =>
  [
    model.inputCost === 0 && model.outputCost === 0
      ? "free"
      : `${perMillion(model.inputCost)} in, ${perMillion(model.outputCost)} out per million tokens`,
    context(model.contextWindow),
  ]
    .filter(Boolean)
    .join(" · ")

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
  const shown = useMemo(() => matches.slice(0, SHOWN), [matches])

  return (
    <div>
      <Combobox
        items={models}
        // Narrowed here and not by the list: it is given only as many as it draws at once.
        filteredItems={shown}
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
            {(model: ModelOption) => (
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

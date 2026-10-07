import { filterModels, type ModelOption } from "@durable-computer/protocol"
import { CaretUpDownIcon, CheckIcon } from "@phosphor-icons/react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"

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
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const current = models.find((model) => model.id === value)

  const matches = useMemo(() => filterModels(models, query), [models, query])
  const shown = matches.slice(0, SHOWN)

  // Start at the current model when the list opens, and at the top once the user types.
  useEffect(() => {
    if (!open) return
    const at = query === "" ? shown.findIndex((model) => model.id === value) : 0
    setActive(Math.max(0, at))
    // Only when it opens or the search changes, not on every move of the highlight.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  }, [open, query])

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" })
  }, [active, open])

  const close = () => {
    setOpen(false)
    setQuery("")
  }
  const choose = (model: ModelOption) => {
    onChange(model.id)
    close()
  }

  return (
    <div
      className="relative"
      onBlur={(event) => {
        // Closing only when focus leaves the whole picker, so a click on an option still lands.
        if (!event.currentTarget.contains(event.relatedTarget)) close()
      }}
    >
      <div className="flex items-center rounded-lg border border-input focus-within:ring-3 focus-within:ring-ring/30">
        <input
          ref={input}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${id}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          // Closed, it shows the choice. Open, it is the search.
          value={open ? query : (current?.name ?? value)}
          placeholder={open ? `Search ${models.length} models` : undefined}
          className="h-9 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setOpen(true)
            setQuery(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              if (!open) return setOpen(true)
              const step = event.key === "ArrowDown" ? 1 : -1
              setActive((at) => Math.min(Math.max(at + step, 0), Math.max(shown.length - 1, 0)))
            } else if (event.key === "Enter") {
              // Never submits the form around it: Enter here means "this one".
              event.preventDefault()
              const model = shown[active]
              if (open && model) choose(model)
            } else if (event.key === "Escape" && open) {
              event.preventDefault()
              // Only the list is closed: a window this is in stays as it is.
              event.stopPropagation()
              close()
            }
          }}
        />
        <CaretUpDownIcon className="mr-2.5 size-4 shrink-0 text-muted-foreground" />
      </div>
      {current && !open ? (
        <p className="mt-1 px-1 text-xs text-muted-foreground">
          {current.id.replace(/^openrouter\//, "")}
          {facts(current) ? ` · ${facts(current)}` : ""}
        </p>
      ) : null}
      {open ? (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg"
        >
          {shown.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No model matches.</li>
          ) : null}
          {shown.map((model, index) => (
            <li
              key={model.id}
              id={`${id}-${index}`}
              role="option"
              aria-selected={model.id === value}
              data-active={index === active}
              // Keeps focus in the input, so the list does not close before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActive(index)}
              onClick={() => choose(model)}
              className={cn(
                "flex cursor-default items-start gap-2 rounded-lg px-2.5 py-1.5 text-sm",
                index === active && "bg-accent",
              )}
            >
              <CheckIcon
                className={cn("mt-0.5 size-4 shrink-0", model.id !== value && "invisible")}
              />
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
            </li>
          ))}
          {matches.length > shown.length ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {matches.length - shown.length} more. Type to narrow them down.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

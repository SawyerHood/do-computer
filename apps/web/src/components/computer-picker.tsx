import type { ComputerKind } from "@durable-computer/protocol"
import { useId } from "react"

/**
 * A choice among the few kinds of computer a deployment offers. Each is shown with what it is,
 * since the names alone say little about what the agent will be able to do there.
 */
export function ComputerPicker({
  label,
  kinds,
  value,
  note,
  disabled,
  onChange,
}: {
  label: string
  kinds: readonly ComputerKind[]
  value: string
  /** A few words after one kind's name, for example to mark the default. */
  note?: (kind: ComputerKind) => string | undefined
  disabled?: boolean
  onChange: (id: string) => void
}) {
  const id = useId()
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="sr-only">{label}</legend>
      {kinds.map((kind) => (
        <label
          key={kind.id}
          className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm has-checked:border-primary has-disabled:cursor-default has-disabled:opacity-60 has-focus-visible:ring-3 has-focus-visible:ring-ring/30"
        >
          <input
            type="radio"
            name={id}
            value={kind.id}
            checked={kind.id === value}
            aria-labelledby={`${id}-${kind.id}-label`}
            aria-describedby={`${id}-${kind.id}-about`}
            className="mt-0.5 size-4 shrink-0 accent-primary outline-none"
            onChange={() => onChange(kind.id)}
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span id={`${id}-${kind.id}-label`} className="font-medium">
                {kind.label}
              </span>
              {note?.(kind) ? (
                <span className="text-xs text-muted-foreground">{note(kind)}</span>
              ) : null}
            </span>
            <span id={`${id}-${kind.id}-about`} className="block text-muted-foreground">
              {kind.description}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

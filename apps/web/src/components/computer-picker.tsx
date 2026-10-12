import type { ComputerKind } from "@do-computer/protocol"
import { useId } from "react"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

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
    <RadioGroup
      aria-label={label}
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next as string)}
      className="gap-2"
    >
      {kinds.map((kind) => (
        <label
          key={kind.id}
          className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm has-data-checked:border-primary has-data-disabled:cursor-default has-data-disabled:opacity-60"
        >
          <RadioGroupItem
            value={kind.id}
            aria-labelledby={`${id}-${kind.id}-label`}
            aria-describedby={`${id}-${kind.id}-about`}
            className="mt-0.5"
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
    </RadioGroup>
  )
}

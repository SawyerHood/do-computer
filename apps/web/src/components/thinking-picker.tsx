import { THINKING_LEVELS, type ThinkingLevel } from "@durable-computer/protocol"
import { useId } from "react"

const LABELS: Record<ThinkingLevel, string> = {
  off: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
}

/**
 * How hard an agent thinks before it answers: a row of a few choices. More thinking gives better
 * answers to hard questions, and makes every reply slower and dearer.
 */
export function ThinkingPicker({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: ThinkingLevel
  /** The chosen model cannot reason, so the choice would change nothing. */
  disabled?: boolean
  onChange: (level: ThinkingLevel) => void
}) {
  const id = useId()
  return (
    <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-4 gap-1 rounded-lg border border-input p-1 has-disabled:opacity-60">
        {THINKING_LEVELS.map((level) => (
          <label
            key={level}
            className="cursor-pointer rounded-md px-2 py-1.5 text-center text-sm has-checked:bg-primary has-checked:text-primary-foreground has-disabled:cursor-default has-focus-visible:ring-3 has-focus-visible:ring-ring/30"
          >
            <input
              type="radio"
              name={id}
              value={level}
              checked={level === value}
              className="sr-only"
              onChange={() => onChange(level)}
            />
            {LABELS[level]}
          </label>
        ))}
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        {disabled
          ? "This model does not think before it answers."
          : "How long it thinks before it answers. More is slower and costs more. Applies from its next reply."}
      </p>
    </fieldset>
  )
}

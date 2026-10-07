import { nearestThinking, type ThinkingLevel } from "@durable-computer/protocol"
import { useId } from "react"

const LABELS: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
}

/**
 * How hard an agent thinks before it answers: a row of the levels its model offers, which differ
 * from one model to the next. More thinking gives better answers to hard questions, and makes
 * every reply slower and dearer.
 */
export function ThinkingPicker({
  label,
  levels,
  value,
  onChange,
}: {
  label: string
  /** What the chosen model offers, least first. Empty for one that does not reason. */
  levels: readonly ThinkingLevel[]
  /** What the agent was set to. Where the model lacks it, the nearest it has is shown chosen. */
  value: ThinkingLevel
  onChange: (level: ThinkingLevel) => void
}) {
  const id = useId()
  const chosen = nearestThinking(levels, value)
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      {levels.length > 0 ? (
        <div className="flex gap-1 rounded-lg border border-input p-1">
          {levels.map((level) => (
            <label
              key={level}
              className="min-w-0 flex-1 cursor-pointer truncate rounded-md px-2 py-1.5 text-center text-sm has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-3 has-focus-visible:ring-ring/30"
            >
              <input
                type="radio"
                name={id}
                value={level}
                checked={level === chosen}
                className="sr-only"
                onChange={() => onChange(level)}
              />
              {LABELS[level]}
            </label>
          ))}
        </div>
      ) : null}
      <p className="px-1 text-xs text-muted-foreground">
        {levels.length === 0
          ? "This model does not think before it answers."
          : levels.length === 1
            ? "This model always thinks this much."
            : "How long it thinks before it answers. More is slower and costs more. Applies from its next reply."}
      </p>
    </fieldset>
  )
}

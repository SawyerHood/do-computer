import { nearestThinking, type ThinkingLevel } from "@durable-computer/protocol"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

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
  const chosen = nearestThinking(levels, value)
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      {levels.length > 0 ? (
        <ToggleGroup
          value={chosen === undefined ? [] : [chosen]}
          // Pressing the level that is chosen leaves it chosen: there is always one.
          onValueChange={([level]) => {
            if (level !== undefined) onChange(level as ThinkingLevel)
          }}
          size="sm"
          spacing={1}
          className="w-full rounded-lg border border-input p-1"
        >
          {levels.map((level) => (
            <ToggleGroupItem
              key={level}
              value={level}
              className="min-w-0 flex-1 px-2 font-normal aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary aria-pressed:hover:text-primary-foreground"
            >
              <span className="truncate">{LABELS[level]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
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

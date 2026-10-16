import {
  type AgentSummary,
  type ModelOption,
  nearestThinking,
  type ThinkingLevel,
} from "@do-computer/protocol"
import { CaretDownIcon } from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useRef } from "react"
import { ModelList } from "@/components/model-picker"
import { THINKING_LABELS, ThinkingPicker } from "@/components/thinking-picker"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { client } from "@/lib/client"
import { agentQuery, agentKey, agentsKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"

/**
 * What the agent thinks with, from the message box: its model's name and how hard it thinks,
 * as one quiet button that opens the models and, under them, the levels of the chosen one. It is the agent's own setting, the one in its
 * settings, so it holds for every chat with it and not only this one. Each choice is saved as it
 * is made, and the menu stays open for the next: a model, and then its level.
 *
 * Nothing is drawn where there is nothing to choose between.
 */
export function ThinksWith({
  agent,
  models,
}: {
  agent: AgentSummary
  /** What the agent's workspace offers. Undefined until that is known. */
  models: readonly ModelOption[] | undefined
}) {
  const { data: state } = useQuery(agentQuery(agent.id))
  const button = useRef<HTMLButtonElement>(null)
  // Both go each time, so that what is shown while one is on its way is the whole of it.
  const save = useMutation({
    mutationFn: (change: { model: string; thinking: ThinkingLevel }) =>
      client.agent(agent.id).update(change),
    onSuccess: (next) => {
      queryClient.setQueryData(agentKey(agent.id), next)
      void queryClient.invalidateQueries({ queryKey: agentsKey })
    },
  })
  const { model, thinking } = save.isPending ? save.variables : (state?.agent ?? agent)
  const levels = models?.find((option) => option.id === model)?.thinking ?? []
  if (models === undefined || (models.length < 2 && levels.length < 2)) return null

  const name = models.find((option) => option.id === model)?.name ?? model
  const level = nearestThinking(levels, thinking)
  return (
    <Popover>
      <PopoverTrigger
        ref={button}
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-w-0 gap-1 rounded-full px-2.5 text-[0.8125rem] font-normal text-muted-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
          />
        }
        aria-label="Model and thinking"
        title={level === undefined ? name : `${name} · ${THINKING_LABELS[level]}`}
      >
        <span className="max-w-40 truncate">
          {name}
          {level === undefined ? null : ` · ${THINKING_LABELS[level]}`}
        </span>
        <CaretDownIcon aria-hidden className="size-3 shrink-0" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        aria-label="Model and thinking"
        // Shut from the keyboard, it gives the cursor back to the message, to be gone on with.
        finalFocus={(how) =>
          (how === "keyboard" ? button.current?.form?.querySelector("textarea") : null) ?? true
        }
        className="w-88 max-w-(--available-width) gap-0 overflow-hidden p-0"
      >
        <ModelList
          label="Model"
          models={models}
          value={model}
          onChange={(id) =>
            save.mutate({
              model: id,
              // What is saved is what the row under it will show as chosen.
              thinking:
                nearestThinking(
                  models.find((option) => option.id === id)?.thinking ?? [],
                  thinking,
                ) ?? thinking,
            })
          }
          className="max-h-56"
        />
        <div className="border-t px-3 pt-2.5 pb-3">
          <ThinkingPicker
            label="Thinking"
            levels={levels}
            value={thinking}
            onChange={(next) => save.mutate({ model, thinking: next })}
            snug
          />
          {save.isError ? (
            <p role="alert" className="px-1 pt-1.5 text-xs text-destructive">
              {save.error.message}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

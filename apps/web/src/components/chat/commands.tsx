import { jobOutcome, type NoticePart } from "@durable-computer/protocol"
import {
  CaretRightIcon,
  CheckCircleIcon,
  StopCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

/** How a command ended, as the middle of a sentence: "finished in 4m 12s". */
const ended = (job: NonNullable<NoticePart["job"]>) => {
  const words = jobOutcome(job)
  return words.charAt(0).toLowerCase() + words.slice(1)
}

/**
 * Word that a command the agent left running in the background has ended, in the chat that
 * started it: how it ended, and the last of what it printed for whoever wants to look.
 */
export function CommandWord({ part }: { part: NoticePart }) {
  const job = part.job
  const command = (
    <span className="font-mono font-medium text-foreground">{part.text.split("\n")[0]}</span>
  )
  const stopped = job?.status === "stopped"
  const well = job === undefined || job.status === "done"
  const Icon = stopped ? StopCircleIcon : well ? CheckCircleIcon : WarningCircleIcon
  return (
    <div
      className="border-l-2 py-0.5 pl-3 text-sm text-muted-foreground"
      data-testid="command-word"
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 wrap-anywhere">
          {stopped ? (
            <>You stopped {command}</>
          ) : (
            <>
              {command} {job === undefined ? "ended" : ended(job)}
            </>
          )}
          {job?.computer ? ` on ${job.computer}` : null}
        </span>
      </div>
      {part.detail === undefined ? null : (
        <Collapsible className="mt-1">
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="group/more -ml-2 h-7 px-2 font-normal text-muted-foreground"
              />
            }
          >
            <CaretRightIcon
              data-icon="inline-start"
              className="transition-transform group-data-panel-open/more:rotate-90"
            />
            {well || stopped ? "What it printed" : "What went wrong"}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1.5 max-h-96 overflow-auto rounded-xl bg-surface px-3 py-2 font-mono text-xs whitespace-pre-wrap text-foreground">
              {part.detail}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

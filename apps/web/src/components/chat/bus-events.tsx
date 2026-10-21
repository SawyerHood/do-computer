import type { NoticePart } from "@do-computer/protocol"
import { CaretRightIcon, ClockIcon, KeyIcon, SlackLogoIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import { useContext } from "react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Markdown } from "./markdown.tsx"
import { AgentIdContext } from "./sent-file.tsx"

/**
 * An event the main chat was told of, where it is a message bus: what a run of an automation
 * came to, a sub-agent of its asking a person for something, or word from a thread in Slack.
 * Drawn in the chat where it was told, as the other events are.
 */
export function BusEvent({ part }: { part: NoticePart }) {
  const agentId = useContext(AgentIdContext)
  const name = <span className="font-medium text-foreground">{part.text}</span>
  const Icon =
    part.kind === "automation" ? ClockIcon : part.kind === "asked" ? KeyIcon : SlackLogoIcon
  const said =
    part.kind === "automation" ? (
      <>
        The automation {name} {part.outcome === "failed" ? "did not finish" : "reported"}
      </>
    ) : part.kind === "asked" ? (
      <>
        The sub-agent {name} asked for {part.detail ?? "something"}
      </>
    ) : (
      <>A thread in Slack, {name}, told it something</>
    )
  const open =
    part.kind === "automation"
      ? "View run"
      : part.kind === "asked"
        ? "Open its chat"
        : "Open thread"
  // What it asked for is said in the line; what the others said is shown open, and can be folded.
  const detail = part.kind === "asked" ? undefined : part.detail
  return (
    <div data-event={part.kind} className="border-l-2 py-0.5 pl-3 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon className="size-4 shrink-0" />
        <span className="min-w-0 wrap-anywhere">{said}</span>
        {agentId === undefined || part.chatId === undefined ? null : (
          <Link
            to="/a/$agentId/c/$chatId"
            params={{ agentId, chatId: part.chatId }}
            className="underline underline-offset-3 hover:text-foreground"
          >
            {open}
          </Link>
        )}
      </div>
      {detail === undefined ? null : (
        <Collapsible defaultOpen className="mt-1">
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
            {part.outcome === "failed" ? "What went wrong" : "What it said"}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1.5 rounded-xl bg-surface px-3 py-2 text-foreground">
              <Markdown text={detail} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

import { CaretRightIcon } from "@phosphor-icons/react"
import { useAtomValue, useSetAtom } from "jotai"
import type { ReactNode } from "react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { panelFoldsAtom } from "@/lib/atoms"
import { cn } from "@/lib/utils"

/** The sections of an agent's panel, by what each is kept under when it is folded. */
export type PanelSectionId =
  "pinned" | "screen" | "running" | "subagents" | "doods" | "slack" | "here" | "shared" | "did"

/** A section's heading as it is drawn: a caret that turns, and what the section is called. */
export function PanelHeading({ title, open }: { title: ReactNode; open: boolean }) {
  return (
    <>
      <CaretRightIcon
        aria-hidden
        className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
      />
      <span className="truncate">{title}</span>
    </>
  )
}

/** Where a section's heading sits, for whatever draws one that does not fold. */
export const PANEL_HEADING =
  "flex w-full min-w-0 items-center gap-1.5 pt-3.5 pr-4 pb-2 pl-4 text-left text-[0.8125rem] font-medium text-muted-foreground"

/** How many are in a section, at the end of its heading. */
function Count({ count }: { count: number }) {
  return (
    <span className="min-w-5 shrink-0 rounded-full bg-secondary px-1.5 py-px text-center text-[0.6875rem] font-normal tabular-nums">
      {count}
    </span>
  )
}

/**
 * One section of an agent's panel under a heading that folds it away. Folded, the heading still
 * says how many are inside and, in `said`, whether one of them wants looking at; nothing opens a
 * section but a press. How it was left is kept, for every agent alike.
 */
export function PanelSection({
  id,
  title,
  count,
  said,
  action,
  startsFolded = false,
  children,
}: {
  id: PanelSectionId
  title: string
  count?: number | undefined
  /** What the heading says of what is inside while it is folded. */
  said?: ReactNode
  /** Something to press at the end of the heading, which does not fold it. */
  action?: ReactNode
  /** Folded until it is opened by hand: for what is seldom wanted. */
  startsFolded?: boolean
  children: ReactNode
}) {
  const folded = useAtomValue(panelFoldsAtom)[id] ?? startsFolded
  const fold = useSetAtom(panelFoldsAtom)
  return (
    <Collapsible
      open={!folded}
      onOpenChange={(open) => fold(id, !open)}
      render={<section aria-label={title} />}
      className="shrink-0 border-t"
    >
      <div className="flex items-center">
        <h3 className="min-w-0 flex-1">
          <CollapsibleTrigger
            className={cn(
              PANEL_HEADING,
              "cursor-default outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset",
              folded && "pb-3.5",
              action !== undefined && "pr-2",
            )}
          >
            <PanelHeading title={title} open={!folded} />
            <span className="min-w-1 flex-1" />
            {folded && said !== undefined ? (
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-normal">{said}</span>
            ) : null}
            {count === undefined ? null : <Count count={count} />}
          </CollapsibleTrigger>
        </h3>
        {action === undefined ? null : <span className="shrink-0 pr-4">{action}</span>}
      </div>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}

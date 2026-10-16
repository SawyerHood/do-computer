import type { ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * What stands in for something that is on its way, in that thing's own shape so nothing moves
 * when it arrives. It waits a moment before it shows, so that an answer that comes quickly never
 * flashes one; `now` is for the first paint of the page, where there is nothing to flash over.
 */
export function Placeholder({
  className,
  now = false,
  children,
}: {
  className?: string
  now?: boolean
  children: ReactNode
}) {
  return (
    <div
      data-loading
      aria-busy="true"
      aria-label="Loading"
      className={cn(!now && "placeholder-late", className)}
    >
      {children}
    </div>
  )
}

/** Lines of text of the given widths. */
function Lines({ widths, className }: { widths: readonly string[]; className?: string }) {
  return (
    <>
      {widths.map((width, index) => (
        <Skeleton key={index} className={cn("h-2.5 rounded-full", className)} style={{ width }} />
      ))}
    </>
  )
}

/** A few turns of a conversation: what was asked on the right, what was answered on the left. */
export function TranscriptPlaceholder({ className, now }: { className?: string; now?: boolean }) {
  return (
    <Placeholder now={now} className={cn("flex flex-col gap-5", className)}>
      <Skeleton className="h-10 w-[44%] self-end rounded-2xl" />
      <div className="flex w-[62%] flex-col gap-2.5 rounded-2xl bg-secondary px-3.5 py-4">
        <Lines widths={["92%", "100%", "78%", "40%"]} />
      </div>
      <Skeleton className="h-10 w-[30%] self-end rounded-2xl" />
      <div className="flex w-[48%] flex-col gap-2.5 rounded-2xl bg-secondary px-3.5 py-4">
        <Lines widths={["100%", "64%"]} />
      </div>
    </Placeholder>
  )
}

/** Where the message box will be, as tall as it is with the cursor in it. */
export function ComposerPlaceholder() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
      <div className="h-[6.875rem] rounded-[1.25rem] bg-popover shadow-float" />
    </div>
  )
}

/** Rows of a list: a mark and a line each. */
export function RowsPlaceholder({
  rows = 3,
  className,
  now,
}: {
  rows?: number
  className?: string
  now?: boolean
}) {
  const widths = ["68%", "52%", "60%", "44%"]
  return (
    <Placeholder now={now} className={cn("flex flex-col", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-9 items-center gap-2.5 px-2.5">
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <Skeleton className="h-2.5 rounded-full" style={{ width: widths[index % 4] }} />
        </div>
      ))}
    </Placeholder>
  )
}

/** Cards of a list: a title and a line under it, each in a border. */
export function CardsPlaceholder({ cards = 2, className }: { cards?: number; className?: string }) {
  const widths = ["38%", "30%", "34%"]
  return (
    <Placeholder className={cn("flex flex-col gap-3", className)}>
      {Array.from({ length: cards }, (_, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-2xl border p-4">
          <Skeleton className="h-3 rounded-full" style={{ width: widths[index % 3] }} />
          <Skeleton className="h-2.5 w-[22%] rounded-full" />
        </div>
      ))}
    </Placeholder>
  )
}

/** Fields of a form: a label and a box each, the last one tall. */
export function FormPlaceholder({ fields = 3 }: { fields?: number }) {
  const labels = ["5.5rem", "7.5rem", "4.5rem"]
  return (
    <Placeholder className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-4 w-36 rounded-full" />
        <Skeleton className="h-2.5 w-72 max-w-full rounded-full" />
      </div>
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-3 rounded-full" style={{ width: labels[index % 3] }} />
          <Skeleton className={cn("w-full rounded-xl", index === fields - 1 ? "h-20" : "h-9")} />
        </div>
      ))}
    </Placeholder>
  )
}

/** A document: its title, and two paragraphs. */
export function DocPlaceholder({ className }: { className?: string }) {
  return (
    <Placeholder className={cn("mx-auto w-full max-w-3xl px-8 pt-12", className)}>
      <Skeleton className="h-8 w-[46%]" />
      <div className="mt-7 flex flex-col gap-3.5">
        <Lines widths={["100%", "96%", "88%", "34%"]} />
      </div>
      <div className="mt-8 flex flex-col gap-3.5">
        <Lines widths={["98%", "100%", "62%"]} />
      </div>
    </Placeholder>
  )
}

/** Files in a folder. */
export function TreePlaceholder() {
  const widths = ["62%", "74%", "48%"]
  return (
    <Placeholder className="flex flex-col gap-0.5 px-2 pt-2">
      {widths.map((width) => (
        <div key={width} className="flex h-8 items-center gap-2 px-2">
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <Skeleton className="h-2.5 rounded-full" style={{ width }} />
        </div>
      ))}
    </Placeholder>
  )
}

/** Agents in the sidebar: a face, a name, and a line under it. */
export function AgentRowsPlaceholder({
  now,
  narrow,
}: {
  now?: boolean
  /** On a narrow screen, where a face is nearer the edge, and may be all there is of a row. */
  narrow?: "rail" | "open" | undefined
}) {
  const widths = ["40%", "52%", "36%"]
  return (
    <Placeholder now={now} className="flex flex-col gap-0.5">
      {widths.map((width) => (
        <div
          key={width}
          className={cn(
            "flex items-center gap-3 pr-1",
            narrow === undefined ? "py-2 pl-2.5" : "py-1.5 pl-1",
          )}
        >
          <Skeleton className="size-10 shrink-0 rounded-full" />
          {narrow === "rail" ? null : (
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3 rounded-full" style={{ width }} />
              <Skeleton className="h-2.5 w-[70%] rounded-full" />
            </div>
          )}
        </div>
      ))}
    </Placeholder>
  )
}

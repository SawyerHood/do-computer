import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react"
import { useRef, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export type SettingsSection<Id extends string> = {
  id: Id
  label: string
  icon: ReactNode
}

/** Sections that are listed together, under a few words where they need telling apart. */
export type SettingsGroup<Id extends string> = {
  label?: string
  sections: readonly SettingsSection<Id>[]
}

/** A list's name inside a sentence. "Doods" is a name and keeps its capital. */
const spoken = (label: string) => (label === "Doods" ? label : label.toLowerCase())

/**
 * The settings window: whose settings are showing, a list of their sections, and the one that is
 * open. The same window shows the top of the settings, one agent's and one workspace's, told
 * apart by the mark and the words at its top; inside an agent or a workspace there is a way
 * back to the list it was chosen from. On a narrow screen it fills the screen and shows one
 * thing at a time: the list, and then the section chosen from it.
 */
export function SettingsDialog<Id extends string>({
  onClose,
  back,
  mark,
  name,
  kind,
  groups,
  section,
  listing,
  onSection,
  onList,
  children,
  contained = false,
}: {
  onClose: () => void
  /** The list this was chosen from, inside an agent or a workspace. */
  back?: { label: string; onClick: () => void } | undefined
  /** A face or a tile, small. */
  mark: ReactNode
  name: string
  /** A few words under the name: whose these are, or where it is. */
  kind: string
  groups: readonly SettingsGroup<Id>[]
  /** The section that is open. */
  section: Id
  /** No section was asked for. A narrow screen then shows the list, and not the first of them. */
  listing: boolean
  onSection: (section: Id) => void
  /** Back from a section to the list, on a narrow screen. */
  onList: () => void
  children: ReactNode
  /** A form with its own scrolling body and fixed action footer. */
  contained?: boolean
}) {
  const popup = useRef<HTMLDivElement>(null)
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        ref={popup}
        initialFocus={popup}
        // The way out stays over the bar a narrow screen has at the top of a section.
        className="flex h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[min(42rem,calc(100dvh-3rem))] sm:max-w-4xl sm:flex-row sm:rounded-2xl [&>[data-slot=dialog-close]]:z-20"
      >
        <nav
          aria-label={`${name}: sections`}
          className={cn(
            "min-h-0 flex-col gap-0.5 overflow-y-auto bg-frame/70 p-2.5 sm:flex sm:w-56 sm:shrink-0",
            listing ? "flex flex-1 sm:flex-none" : "hidden",
          )}
        >
          {back === undefined ? null : (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Back to ${spoken(back.label)}`}
              onClick={back.onClick}
              className="mb-1 focus-visible:ring-2 h-9 justify-start gap-1 self-start px-2 font-normal text-muted-foreground sm:h-7"
            >
              <CaretLeftIcon className="size-3.5" />
              {back.label}
            </Button>
          )}
          <div className="flex items-center gap-2.5 px-2 pt-1 pb-3 pr-12 sm:pr-2">
            {mark}
            <div className="min-w-0 leading-tight">
              <DialogTitle className="truncate text-sm font-semibold">{name}</DialogTitle>
              <DialogDescription className="truncate text-xs text-muted-foreground">
                {kind}
              </DialogDescription>
            </div>
          </div>
          {groups.map((group, index) => (
            <div
              key={group.label ?? index}
              role="group"
              aria-label={group.label}
              className="flex flex-col gap-0.5"
            >
              {group.label === undefined ? null : (
                <p className="px-2.5 pt-4 pb-1 text-xs font-medium text-muted-foreground">
                  {group.label}
                </p>
              )}
              {group.sections.map((entry) => (
                <Button
                  key={entry.id}
                  variant="ghost"
                  aria-current={entry.id === section ? "page" : undefined}
                  onClick={() => onSection(entry.id)}
                  // The list is only on a narrow screen when nothing is open, so nothing in it
                  // is marked as open there.
                  className="h-11 justify-start gap-2.5 px-2.5 text-[0.9375rem] font-normal hover:bg-foreground/6 sm:h-9 sm:text-sm sm:text-muted-foreground sm:aria-[current=page]:bg-primary/10 sm:aria-[current=page]:text-foreground "
                >
                  <span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-4">{entry.icon}</span>
                  <span className="truncate">{entry.label}</span>
                  <CaretRightIcon className="ml-auto size-3.5 text-muted-foreground sm:hidden" />
                </Button>
              ))}
            </div>
          ))}
        </nav>
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", contained ? "overflow-hidden" : "overflow-y-auto", listing && "hidden sm:flex")}>
          <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center bg-popover px-2 pr-14 sm:hidden">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Back to ${name}`}
              onClick={onList}
              className="h-9 min-w-0 gap-1 px-2 font-normal text-muted-foreground"
            >
              <CaretLeftIcon className="size-3.5 shrink-0" />
              <span className="truncate">{name}</span>
            </Button>
          </div>
          <div className={contained ? "min-h-0 flex-1" : "px-6 pt-1 pb-8 sm:px-9 sm:pt-7"}>{children}</div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

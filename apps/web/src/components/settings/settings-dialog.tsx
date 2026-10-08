import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export type SettingsSection<Id extends string> = {
  id: Id
  label: string
  icon: ReactNode
  /** Set apart from the rest, in the color of something that cannot be undone. */
  danger?: boolean
}

/**
 * A settings window: whose settings they are, a list of sections, and the one that is open. It
 * is the same window for an agent and for a workspace, told apart by the mark and the words at
 * its top. On a narrow screen it fills the screen and the sections are a row across the top.
 */
export function SettingsDialog<Id extends string>({
  open,
  onClose,
  mark,
  name,
  kind,
  sections,
  section,
  onSection,
  children,
}: {
  open: boolean
  onClose: () => void
  /** A face or a tile, small. */
  mark: ReactNode
  name: string
  /** What kind of settings these are: "Agent settings", "Workspace settings". */
  kind: string
  sections: readonly SettingsSection<Id>[]
  section: Id
  onSection: (section: Id) => void
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="flex h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[min(42rem,calc(100dvh-3rem))] sm:max-w-4xl sm:flex-row sm:rounded-2xl">
        <nav
          aria-label={kind}
          className="flex shrink-0 flex-col gap-0.5 border-b bg-rail/50 p-2.5 sm:w-56 sm:border-r sm:border-b-0"
        >
          <div className="flex items-center gap-2.5 px-2 pt-1 pb-3 pr-12 sm:pr-2">
            {mark}
            <div className="min-w-0 leading-tight">
              <DialogTitle className="truncate text-sm font-semibold">{name}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {kind}
              </DialogDescription>
            </div>
          </div>
          <div className="flex gap-0.5 overflow-x-auto sm:flex-col sm:overflow-visible">
            {sections.map((entry) => (
              <Button
                key={entry.id}
                variant="ghost"
                aria-current={entry.id === section ? "page" : undefined}
                onClick={() => onSection(entry.id)}
                className={cn(
                  "h-8.5 justify-start gap-2.5 px-2.5 font-normal text-muted-foreground hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:text-foreground",
                  entry.danger &&
                    "text-destructive hover:text-destructive aria-[current=page]:text-destructive sm:mt-3",
                )}
              >
                {entry.icon}
                {entry.label}
              </Button>
            ))}
          </div>
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pt-7 pb-8 sm:px-9">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}

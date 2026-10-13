import { useLocation } from "@tanstack/react-router"
import { PANEL_HEADING, PanelHeading } from "@/components/chat/panel-section"
import {
  AgentRowsPlaceholder,
  ComposerPlaceholder,
  RowsPlaceholder,
  TranscriptPlaceholder,
} from "@/components/placeholders"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * Runs before first paint, like the theme's script. It says on the document how the sidebar and
 * the agent's panel were left, and how wide, so that the frame drawn before the app has started
 * has them where the app will put them. Keep the keys in step with `lib/atoms.ts` and
 * `lib/columns.ts`.
 */
export const FRAME_INIT_SCRIPT = `try{var d=document.documentElement,s=localStorage,w=parseFloat(s.getItem("dc-sidebar-width")),p=parseFloat(s.getItem("dc-agent-panel-width"));d.dataset.sidebar=s.getItem("dc-chat-list")||"";d.dataset.panel=s.getItem("dc-agent-panel")||"";if(w)d.style.setProperty("--kept-sidebar",w+"px");if(p)d.style.setProperty("--kept-panel",p+"px")}catch(e){}`

/** The panel's place beside a page, before it is known whose panel it is. */
export function AgentPanelPlaceholder({
  width,
  className,
}: {
  width: string | number
  className?: string
}) {
  return (
    <aside
      data-loading
      aria-busy="true"
      className={cn(
        "relative mr-2.5 mb-2.5 overflow-hidden rounded-2xl border flex shrink-0 flex-col bg-rail/50",
        className,
      )}
      style={{ width }}
    >
      <div className="flex flex-col items-center gap-1 px-6 pt-10 pb-5">
        <div className="grid size-52 place-items-center">
          <Skeleton className="size-40 rounded-full" />
        </div>
        <div className="mt-3 flex h-7 items-center">
          <Skeleton className="h-3.5 w-24 rounded-full" />
        </div>
        <div className="flex h-5 items-center">
          <Skeleton className="h-2.5 w-16 rounded-full" />
        </div>
      </div>
      <div className="flex-1 border-t">
        <h3 className={PANEL_HEADING}>
          <PanelHeading title="What it did here" open />
        </h3>
        <RowsPlaceholder now className="px-2.5" />
      </div>
    </aside>
  )
}

/**
 * The frame of the app with nothing in it yet: what is on screen from the moment the page
 * arrives until who is signed in, and what they have, is known. It is in the page as it is sent,
 * so it is there before the app's own code has run. Everything in it is where the app puts it.
 */
export function AppSkeleton() {
  const page = useLocation({ select: (location) => location.pathname.split("/").at(-1) })
  const chat = page !== "library" && page !== "automations" && page !== "pair"
  return (
    <div data-loading aria-busy="true" aria-label="Loading" className="flex h-full min-h-0">
      <aside
        className="hidden shrink-0 flex-col md:[[data-sidebar=open]_&]:flex"
        style={{ width: "var(--kept-sidebar, 288px)" }}
      >
        <div className="flex h-8 items-center gap-2 px-2 pt-2.5 pb-0.5 box-content">
          <img src="/icon-192.png" alt="" className="size-6 shrink-0 rounded-md" />
          <span className="text-sm font-semibold">Do Computer</span>
        </div>
        <div className="flex h-9 items-center px-2">
          <h2 className="text-[0.8125rem] font-medium text-muted-foreground">Doods</h2>
        </div>
        <div className="flex-1 px-2">
          <AgentRowsPlaceholder now />
        </div>
        <div className="flex items-center gap-2.5 border-t px-4 py-3.5">
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="h-3 w-16 rounded-full" />
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-x-1.5 border-b px-2.5 md:h-13 md:px-3">
          {/* Where the button that shows the sidebar is, while the sidebar is hidden. */}
          <span className="size-8 md:[[data-sidebar=open]_&]:hidden" />
          <div className="flex h-full items-center gap-2 py-1 pr-2 pl-1">
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="h-3 w-20 rounded-full" />
          </div>
          <nav
            aria-hidden
            className="hidden h-full items-stretch text-sm font-medium text-muted-foreground/60 md:ml-1.5 md:flex"
          >
            <span className="flex items-center px-2.5">Chat</span>
            <span className="flex items-center px-2.5">Library</span>
            <span className="flex items-center px-2.5">Automations</span>
          </nav>
        </header>
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
              {chat ? (
                <TranscriptPlaceholder now className="mx-auto w-full max-w-3xl px-4 pb-6" />
              ) : null}
            </div>
            {chat ? <ComposerPlaceholder /> : null}
          </div>
          <AgentPanelPlaceholder
            width="var(--kept-panel, 320px)"
            className="hidden xl:flex [[data-panel=closed]_&]:hidden"
          />
        </div>
      </main>
    </div>
  )
}

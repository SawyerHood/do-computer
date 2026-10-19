import { useLocation } from "@tanstack/react-router"
import {
  AgentRowsPlaceholder,
  ComposerPlaceholder,
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
        "relative my-2.5 mr-2.5 overflow-hidden rounded-2xl border flex shrink-0 flex-col bg-rail/50",
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
    </aside>
  )
}

/** The user's own face and name at the foot of the sidebar, or the face alone. */
function AccountPlaceholder({ named = false }: { named?: boolean }) {
  return (
    <div className="px-2 py-1.5">
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <Skeleton className="size-7 shrink-0 rounded-full" />
        {named ? <Skeleton className="h-3 w-16 rounded-full" /> : null}
      </div>
    </div>
  )
}

/**
 * The frame of the app with nothing in it yet: what is on screen from the moment the page
 * arrives until who is signed in, and what they have, is known. It is in the page as it is sent,
 * so it is there before the app's own code has run. Everything in it is where the app puts it:
 * the sidebar as it was left, as faces or opened out, and the page flat against it with the
 * Dood's name floating over its chat.
 */
export function AppSkeleton() {
  const page = useLocation({ select: (location) => location.pathname.split("/").at(-1) })
  const chat = page !== "library" && page !== "automations" && page !== "pair"
  return (
    <div
      data-loading
      aria-busy="true"
      aria-label="Loading"
      className="flex h-full min-h-0 bg-frame"
    >
      {/* Opened out. In a window with no title bar, all that is over the list is its buttons. */}
      <aside
        className="hidden shrink-0 flex-col inset:pl-2.5 md:[[data-sidebar=open]_&]:flex"
        style={{ width: "var(--kept-sidebar, 288px)" }}
      >
        <div className="hidden h-10 shrink-0 inset:block" />
        <div className="h-2 shrink-0 inset:hidden" />
        <div className="flex h-9 items-center px-2.5">
          <h2 className="text-[0.8125rem] font-medium text-muted-foreground">Doods</h2>
        </div>
        <div className="flex-1 px-1">
          <AgentRowsPlaceholder now narrow="open" />
        </div>
        <AccountPlaceholder named />
      </aside>
      {/* As a column of faces, which is how it starts. On a narrow screen it is out of sight. */}
      <aside className="hidden w-15 shrink-0 flex-col inset:w-20 inset:px-2.5 md:flex md:[[data-sidebar=open]_&]:hidden">
        <div className="hidden h-10 shrink-0 inset:block" />
        <div className="h-2 shrink-0 inset:hidden" />
        <div className="h-9" />
        <div className="flex-1 px-1">
          <AgentRowsPlaceholder now narrow="rail" />
        </div>
        <AccountPlaceholder />
      </aside>
      <main className="relative flex min-w-0 flex-1 flex-col bg-background md:border-l md:border-hairline">
        {/* The Dood's name, floating over the middle of the page, clear of the panel beside it. */}
        <header className="absolute top-0 left-0 right-0 z-10 flex h-13 items-center justify-center xl:[[data-panel=open]_&]:right-[calc(var(--kept-panel,320px)+0.625rem)]">
          <div className="flex items-center gap-2 rounded-full bg-popover py-1 pr-3 pl-1 shadow-raised">
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="h-3 w-20 rounded-full" />
          </div>
        </header>
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
              {chat ? (
                <TranscriptPlaceholder now className="mx-auto w-full max-w-[45rem] px-4 pb-6" />
              ) : null}
            </div>
            {chat ? <ComposerPlaceholder /> : null}
          </div>
          <AgentPanelPlaceholder
            width="var(--kept-panel, 320px)"
            className="hidden xl:[[data-panel=open]_&]:flex"
          />
        </div>
      </main>
    </div>
  )
}

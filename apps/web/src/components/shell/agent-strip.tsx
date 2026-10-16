import type { AgentSummary, WorkspaceSummary } from "@do-computer/protocol"
import type { AgentState } from "@do-computer/client"
import {
  ArrowLeftIcon,
  CaretDownIcon,
  CheckIcon,
  PhoneIcon,
  SidebarSimpleIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useParams, useRouter, useSearch } from "@tanstack/react-router"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useEffect, useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { useCallButton } from "@/components/call/call"
import { FaceStack } from "@/components/people"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { agentPanelOpenAtom, stripEndAtom, stripStartAtom } from "@/lib/atoms"
import { agentPanelColumn, BESIDE_GAP, besideWidthAtom } from "@/lib/columns"
import { mainChatOf } from "@/lib/chats"
import { Skeleton } from "@/components/ui/skeleton"
import { agentQuery } from "@/lib/collections"
import { creatureWardrobeAtom, useCreature } from "@/lib/creature"
import { useSettings } from "@/lib/settings"
import { useWide } from "@/lib/use-wide"
import { cn } from "@/lib/utils"
import { useHere, usePeople, whoIs } from "@/lib/workspaces"
import { DoodsButton } from "./agent-list.tsx"
import { SideChats } from "./side-chats.tsx"

/** The pages of an agent: the things it is used for, as against how it is set up. */
export type AgentTab = "chat" | "library" | "automations"

/**
 * The chat each agent was last on, so that its Chat tab goes back to it from another tab. With
 * none to go back to, the tab opens the main chat.
 */
const lastChat = new Map<string, string>()

/** What each page is called, in the menu on the agent's name and beside the name itself. */
const tabs: [AgentTab, string][] = [
  ["chat", "Chat"],
  ["library", "Library"],
  ["automations", "Automations"],
]

/** The way to one of an agent's tabs from something that is not a link: a menu's row, a button. */
function useOpenTab(agentId: string, back: string | undefined) {
  const navigate = useNavigate()
  return (to: AgentTab) => {
    if (to === "library") {
      return navigate({ to: "/a/$agentId/library", params: { agentId }, search: {} })
    }
    if (to === "automations") {
      return navigate({ to: "/a/$agentId/automations", params: { agentId } })
    }
    return back === undefined
      ? navigate({ to: "/a/$agentId", params: { agentId } })
      : navigate({ to: "/a/$agentId/c/$chatId", params: { agentId, chatId: back } })
  }
}

/**
 * The agent's name, afloat over the top of its pages, and all there is above them. Its face is
 * the way to its panel (to its wardrobe, on a narrow screen). Its name opens what else there is
 * of it: its pages, its side chats, a call, its panel and its settings. Beside the name is which page is open, where the page does
 * not say so itself, and who else is here. In the library it is not afloat: it is in the bar
 * the library has there, drawn as part of it.
 */
function AgentPill({
  agent,
  workspace,
  page,
  back,
  state,
  callIn,
}: {
  agent: AgentSummary
  workspace: WorkspaceSummary
  page: AgentTab
  /** The chat the Chat page goes back to. */
  back: string | undefined
  state: AgentState | undefined
  /** The chat a call would be held in, once it is known. */
  callIn: string | undefined
}) {
  const { chatId } = useParams({ strict: false })
  const { side } = useSearch({ strict: false })
  const navigate = useNavigate()
  const open = useOpenTab(agent.id, back)
  const router = useRouter()
  const ahead = (to: AgentTab) => {
    const agentId = agent.id
    // What it finds out is kept for the page; that it could not be found out is the page's to say.
    if (to === "library") {
      void router.preloadRoute({ to: "/a/$agentId/library", params: { agentId }, search: {} })
    } else if (to === "automations") {
      void router.preloadRoute({ to: "/a/$agentId/automations", params: { agentId } })
    }
  }
  const { open: openSettings } = useSettings()
  const [shown, setShown] = useState(false)
  const name = agent.name ?? "New Dood"
  const openWardrobe = useSetAtom(creatureWardrobeAtom)
  const creature = useCreature(agent.id, agent.hatched)
  const waiting = (creature?.boxes ?? 0) > 0
  const call = useCallButton(agent)
  // The panel is only ever beside a page where there is room for both.
  const wide = useWide()
  const [wanted, setPanel] = useAtom(agentPanelOpenAtom)
  // A side chat beside the main chat is where the panel would be.
  const panel = wanted && side === undefined
  const togglePanel = () => {
    setPanel(!panel)
    // The side chat makes way for the panel.
    if (side !== undefined && chatId !== undefined) {
      void navigate({ to: "/a/$agentId/c/$chatId", params: { agentId: agent.id, chatId } })
    }
  }

  const team = workspace.kind === "team"
  const here = useHere(team ? workspace.id : undefined)
  const people = usePeople(team ? workspace : undefined)
  const flat = page === "library"
  const present =
    chatId === undefined
      ? []
      : whoIs(here, (place) => place.agentId === agent.id && place.chatId === chatId).flatMap(
          (id) => people.get(id) ?? [],
        )

  return (
    <div
      className={cn(
        "flex max-w-full min-w-0 items-center rounded-full p-0.5",
        // Over a chat it floats, as a thing of its own. In the library it is in a bar with the
        // rest of what is there, and is drawn as part of that.
        flat ? "[--pill:var(--background)]" : "bg-popover shadow-raised [--pill:var(--popover)]",
      )}
    >
      <DropdownMenu open={shown} onOpenChange={setShown}>
        {/* Its picture is the way to its panel, where it is looked after. A narrow screen has no
            room for the panel, so there it is the way to its wardrobe instead. */}
        {agent.hatched ? (
          <button
            type="button"
            aria-label={
              wide
                ? `${panel ? "Hide" : "Show"} ${name}'s panel${waiting ? ": a box is waiting" : ""}`
                : `${name}'s wardrobe${waiting ? ": a box is waiting" : ""}`
            }
            title={
              waiting
                ? `${name} found a box`
                : wide
                  ? `${panel ? "Hide" : "Show"} ${name}'s panel`
                  : `${name}'s wardrobe`
            }
            aria-pressed={wide ? panel : undefined}
            onClick={() => (wide ? togglePanel() : openWardrobe(true))}
            className="relative shrink-0 rounded-full p-0.5 outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <AgentFace agent={agent} className="size-7" still />
            {waiting ? (
              <span
                aria-hidden
                className="absolute top-0 right-0 size-2.5 rounded-full bg-amber-400 ring-2 ring-(--pill)"
              />
            ) : null}
          </button>
        ) : (
          <span className="p-0.5">
            <AgentFace agent={agent} className="size-7" still />
          </span>
        )}
        <DropdownMenuTrigger
          aria-label={`${name}: pages, side chats and settings`}
          className="flex h-8 min-w-0 items-center gap-1.5 rounded-full pr-2.5 pl-1.5 outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40 aria-expanded:bg-accent"
        >
          <span className="flex min-w-0 text-[0.875rem]">
            <span className="truncate font-medium">{name}</span>
            {/* A long name gives way to the page, which is said nowhere else. */}
            {/* The library says that it is the library, in its own words beside the name. */}
            {page === "chat" || page === "library" ? null : (
              <span className="shrink-0 whitespace-pre text-muted-foreground">
                {" · "}
                {tabs.find(([id]) => id === page)?.[1]}
              </span>
            )}
          </span>
          <CaretDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="center" sideOffset={8} className="w-64">
          <DropdownMenuGroup aria-label={`${name}'s pages`}>
            {tabs.map(([id, label]) => (
              // Pointing at one asks for what its page shows, as pointing at a link does.
              <DropdownMenuItem
                key={id}
                aria-current={id === page ? "page" : undefined}
                onPointerEnter={() => ahead(id)}
                onFocus={() => ahead(id)}
                onClick={() => open(id)}
              >
                <span className="flex-1">{label}</span>
                {id === page ? <CheckIcon className="size-4" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <SideChats
            agent={agent}
            workspace={workspace}
            state={state}
            onDone={() => setShown(false)}
          />
          {!call.available || callIn === undefined || !agent.hatched ? null : (
            <DropdownMenuItem disabled={call.busy} onClick={() => call.start(callIn)}>
              <PhoneIcon weight={call.on ? "fill" : "regular"} />
              {call.on ? `On a call with ${name}` : `Call ${name}`}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {wide ? (
            <DropdownMenuItem onClick={togglePanel}>
              <SidebarSimpleIcon className="-scale-x-100" />
              {panel ? `Hide ${name}'s panel` : `Show ${name}'s panel`}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => openSettings({ at: "agent", agentId: agent.id })}>
            <SlidersHorizontalIcon />
            {name}'s settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {page === "chat" && present.length > 0 ? (
        <span className="pr-1.5 pl-0.5 [--face-ring:var(--pill)]">
          <FaceStack people={present} className="size-6" max={4} />
        </span>
      ) : null}
    </div>
  )
}

/**
 * What is above an agent's pages: its name, in the middle, where it is on every page, so that
 * changing page changes only what is around it. A page with a bar of its own puts it in this
 * row, either side of the name, where there is room: where it is at the start, and what is done
 * to it at the end. The chat is where the
 * agent's other pages are gone to from, so on those a narrow screen has the way back to it at
 * the start of the row; and where the sidebar is out of sight, the way to it is there.
 */
export function AgentStrip({
  agentId,
  agent,
  workspace,
  page,
  meId,
  onShowSidebar,
}: {
  /** The agent whose pages these are. The address says so before the agent itself is here. */
  agentId: string
  /** That agent. Until it is here its name's place is held. */
  agent: AgentSummary | undefined
  workspace: WorkspaceSummary
  page: AgentTab
  meId: string
  /** Brings the sidebar out, where it is not beside the page. */
  onShowSidebar?: (() => void) | undefined
}) {
  const { chatId } = useParams({ strict: false })
  // Shares the layout's query, so this never fetches on its own.
  const { data: state } = useQuery(agentQuery(agentId))
  useEffect(() => {
    if (chatId !== undefined) lastChat.set(agentId, chatId)
  }, [agentId, chatId])
  const back = lastChat.get(agentId)
  const open = useOpenTab(agentId, back)
  // A call is held in the chat on screen where that is one the person talks in, and otherwise
  // in the Dood's main chat.
  const onScreen = state?.chats.find((chat) => chat.id === chatId)
  const callIn = (onScreen?.kind === "chat" ? onScreen : mainChatOf(state?.chats))?.id
  // The name is over the middle of the page's own column, and not of what is beside it: a
  // document or a side chat, or else the agent's panel, where that is wanted and there is room.
  const beside = useAtomValue(besideWidthAtom)
  const panel = useAtomValue(agentPanelOpenAtom)
  const panelWidth = useAtomValue(agentPanelColumn.width)
  const wide = useWide()
  const taken =
    beside > 0 ? `${beside}px` : panel && wide ? `calc(${panelWidth}px + ${BESIDE_GAP})` : "0px"

  const setStart = useSetAtom(stripStartAtom)
  const setEnd = useSetAtom(stripEndAtom)

  return (
    <header
      // With no title bar the window is dragged by it, and where the sidebar is out of sight
      // it starts past the window's buttons.
      data-title-drag=""
      data-agent-strip=""
      // A line under it only while a page's bar is in it: the name alone floats over the page.
      className="relative z-20 grid h-13 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-hairline pl-2.5 inset:max-md:pl-20 data-bar:border-b has-[[data-strip-slot]:not(:empty)]:border-b"
      // The library's row is a bar, whether or not a file is open to fill it.
      data-bar={page === "library" ? "" : undefined}
      style={{ paddingRight: `calc(0.5rem + ${taken})` }}
    >
      <div className="flex min-w-0 items-center gap-0.5">
        {onShowSidebar === undefined ? null : (
          <DoodsButton meId={meId} activeAgentId={agentId} onClick={onShowSidebar} />
        )}
        {page === "chat" ? null : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to the chat"
            className="text-muted-foreground md:hidden"
            onClick={() => open("chat")}
          >
            <ArrowLeftIcon />
          </Button>
        )}
        <div
          ref={setStart}
          data-strip-slot=""
          className="@container/viewer hidden min-w-0 flex-1 items-center gap-1 pl-0.5 lg:flex"
        />
      </div>
      {agent === undefined ? (
        <div
          data-loading
          aria-busy="true"
          className="flex items-center gap-2 rounded-full bg-popover py-1 pr-3 pl-1 shadow-raised"
        >
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="h-3 w-20 rounded-full" />
        </div>
      ) : (
        <AgentPill
          agent={agent}
          workspace={workspace}
          page={page}
          back={back}
          state={state}
          callIn={callIn}
        />
      )}
      <div
        ref={setEnd}
        data-strip-slot=""
        className="@container/viewer hidden min-w-0 items-center justify-end gap-1 lg:flex"
      />
    </header>
  )
}

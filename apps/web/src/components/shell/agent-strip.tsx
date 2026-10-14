import type { AgentSummary, WorkspaceSummary } from "@do-computer/protocol"
import {
  ArrowLeftIcon,
  CaretDownIcon,
  CheckIcon,
  ListIcon,
  SidebarSimpleIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { useAtom, useSetAtom } from "jotai"
import { useEffect } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { CallStripButton } from "@/components/call/call"
import { FaceStack } from "@/components/people"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { agentPanelOpenAtom } from "@/lib/atoms"
import { mainChatOf } from "@/lib/chats"
import { Skeleton } from "@/components/ui/skeleton"
import { agentQuery, agentsCollection } from "@/lib/collections"
import { creatureWardrobeAtom, useCreature } from "@/lib/creature"
import { useSettings } from "@/lib/settings"
import { useMedia } from "@/lib/use-wide"
import { cn } from "@/lib/utils"
import { useHere, usePeople, whoIs } from "@/lib/workspaces"
import { SideChats } from "./side-chats.tsx"

/** The pages of an agent that are tabs: the things it is used for, as against how it is set up. */
export type AgentTab = "chat" | "library" | "automations"

/**
 * The chat each agent was last on, so that its Chat tab goes back to it from another tab. With
 * none to go back to, the tab opens the main chat.
 */
const lastChat = new Map<string, string>()

const tab =
  "flex h-7 shrink-0 items-center rounded-[0.4375rem] px-3 text-[0.8125rem] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-raised dark:aria-[current=page]:bg-foreground/14"

/** The width from which the tabs are in the strip. It is the `md` the strip's classes speak of. */
const TABS_IN_STRIP = "(min-width: 48rem)"

/** What each tab is called, in the strip and in the name's menu. */
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
 * The agent's name, which is also the way to another agent without opening the sidebar. On a
 * narrow screen, where there is one row and no room in it for tabs, it is the way to the agent's
 * pages too, and says which of them is open when it is not the chat.
 */
function AgentSwitcher({
  agent,
  workspace,
  page,
  back,
}: {
  agent: AgentSummary
  workspace: WorkspaceSummary
  page: AgentTab
  /** The chat the Chat tab goes back to, as in the strip. */
  back: string | undefined
}) {
  const navigate = useNavigate()
  // Whether the strip has the tabs in it, which says what this menu is for.
  const tabbed = useMedia(TABS_IN_STRIP)
  const open = useOpenTab(agent.id, back)
  const { data: agents } = useLiveQuery(
    (q) =>
      q
        .from({ agent: agentsCollection })
        .where(({ agent }) => eq(agent.workspaceId, workspace.id))
        .orderBy(({ agent }) => agent.createdAt, "asc"),
    [workspace.id],
  )
  const name = agent.name ?? "New Dood"
  const openWardrobe = useSetAtom(creatureWardrobeAtom)
  const creature = useCreature(agent.id, agent.hatched)
  const waiting = (creature?.boxes ?? 0) > 0
  return (
    <DropdownMenu>
      {/* Its picture is the way to its wardrobe, which on a narrow screen is also where it is looked after. */}
      {agent.hatched ? (
        <button
          type="button"
          aria-label={waiting ? `${name}'s wardrobe: a box is waiting` : `${name}'s wardrobe`}
          title={waiting ? `${name} found a box` : `${name}'s wardrobe`}
          onClick={() => openWardrobe(true)}
          className="relative shrink-0 rounded-xl p-1 outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <AgentFace agent={agent} className="size-7" still />
          {waiting ? (
            <span
              aria-hidden
              className="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-amber-400 ring-2 ring-background"
            />
          ) : null}
        </button>
      ) : (
        <span className="p-1">
          <AgentFace agent={agent} className="size-7" still />
        </span>
      )}
      <DropdownMenuTrigger
        aria-label={tabbed ? `${name}: another Dood` : `${name}: pages and other Doods`}
        title={tabbed ? "Another Dood" : undefined}
        className="flex min-w-0 items-center gap-2 rounded-xl py-1 pr-2 pl-1.5 outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40 aria-expanded:bg-accent"
      >
        <span className="flex min-w-0 text-[0.9375rem]">
          <span className="truncate font-semibold">{name}</span>
          {/* A long name gives way to the page, which is said nowhere else in the strip. */}
          {page === "chat" ? null : (
            <span className="shrink-0 whitespace-pre text-muted-foreground md:hidden">
              {" · "}
              {tabs.find(([id]) => id === page)?.[1]}
            </span>
          )}
        </span>
        <CaretDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-76">
        {tabbed ? null : (
          <>
            <DropdownMenuGroup aria-label={`${name}'s pages`}>
              {tabs.map(([id, label]) => (
                <DropdownMenuItem
                  key={id}
                  aria-current={id === page ? "page" : undefined}
                  onClick={() => open(id)}
                >
                  <span className="flex-1">{label}</span>
                  {id === page ? <CheckIcon className="size-4" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Doods in {workspace.name}</DropdownMenuLabel>
          {(agents ?? [agent]).map((entry) => (
            <DropdownMenuItem
              key={entry.id}
              onClick={() => navigate({ to: "/a/$agentId", params: { agentId: entry.id } })}
            >
              <AgentFace agent={entry} className="size-7" still />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{entry.name ?? "New Dood"}</span>
                {entry.tagline ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {entry.tagline}
                  </span>
                ) : null}
              </span>
              {entry.id === agent.id ? <CheckIcon className="size-4" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The strip across the top of an agent's pages: which agent this is, its tabs, and at its end
 * who is here, its side chats, the way into its settings, and the switch for its panel. It is the same on every
 * tab, so that changing tab changes only what is under it. On a narrow screen it is one row, and
 * the tabs are in the menu on the agent's name. There the chat is where the agent's other pages
 * are gone to from, so on those the row starts with the way back to it.
 */
export function AgentStrip({
  agentId,
  agent,
  workspace,
  page,
  sidebarOpen,
  onShowSidebar,
  onOpenSheet,
}: {
  /** The agent whose pages these are. The address says so before the agent itself is here. */
  agentId: string
  /** That agent. Until it is here its name holds its place, and the tabs already work. */
  agent: AgentSummary | undefined
  workspace: WorkspaceSummary
  page: AgentTab
  /** Whether the sidebar is beside this on a wide screen. */
  sidebarOpen: boolean
  onShowSidebar: () => void
  /** Opens the sidebar as a sheet, on a narrow screen. */
  onOpenSheet: () => void
}) {
  const { chatId } = useParams({ strict: false })
  const { side } = useSearch({ strict: false })
  const navigate = useNavigate()
  const { open: openSettings } = useSettings()
  const [wanted, setPanel] = useAtom(agentPanelOpenAtom)
  // A side chat beside the main chat is where the panel would be.
  const panel = wanted && side === undefined
  // Shares the layout's query, so this never fetches on its own.
  const { data: state } = useQuery(agentQuery(agentId))
  useEffect(() => {
    if (chatId !== undefined) lastChat.set(agentId, chatId)
  }, [agentId, chatId])
  const back = lastChat.get(agentId)
  const open = useOpenTab(agentId, back)

  const team = workspace.kind === "team"
  const here = useHere(team ? workspace.id : undefined)
  const people = usePeople(team ? workspace : undefined)
  const present =
    chatId === undefined
      ? []
      : whoIs(here, (place) => place.agentId === agentId && place.chatId === chatId).flatMap(
          (id) => people.get(id) ?? [],
        )
  const name = agent?.name ?? "New Dood"
  // A call is held in the chat on screen where that is one the person talks in, and otherwise
  // in the Dood's main chat.
  const onScreen = state?.chats.find((chat) => chat.id === chatId)
  const callIn = (onScreen?.kind === "chat" ? onScreen : mainChatOf(state?.chats))?.id

  return (
    <header className="flex h-12 shrink-0 items-center gap-x-1.5 px-2.5 md:h-13 md:px-3">
      {page === "chat" ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Doods"
          title="Doods"
          className="text-muted-foreground md:hidden"
          onClick={onOpenSheet}
        >
          <ListIcon />
        </Button>
      ) : (
        // The agents are still a swipe from the left away, and in the menu on the name.
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
      {sidebarOpen ? null : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Show the sidebar"
          title="Show the sidebar"
          className="hidden text-muted-foreground md:inline-flex"
          onClick={onShowSidebar}
        >
          <SidebarSimpleIcon />
        </Button>
      )}
      <div className="flex h-full min-w-0 items-center">
        {agent === undefined ? (
          <div data-loading aria-busy="true" className="flex items-center gap-2 py-1 pr-2 pl-1">
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="h-3 w-20 rounded-full" />
          </div>
        ) : (
          <AgentSwitcher agent={agent} workspace={workspace} page={page} back={back} />
        )}
      </div>
      <nav
        aria-label={agent === undefined ? "Pages" : `${name}'s pages`}
        className="hidden md:ml-1.5 md:flex"
      >
        {/* One control with the open page raised in it, as there is no rule for a line to sit on. */}
        <div className="flex items-center gap-0.5 rounded-[0.625rem] bg-muted p-[3px]">
          {back === undefined ? (
            <Link
              to="/a/$agentId"
              params={{ agentId }}
              // Every page of the agent is under this address, and none but the chat is this tab.
              activeOptions={{ exact: true }}
              aria-current={page === "chat" ? "page" : undefined}
              className={tab}
            >
              Chat
            </Link>
          ) : (
            <Link
              to="/a/$agentId/c/$chatId"
              params={{ agentId, chatId: back }}
              aria-current={page === "chat" ? "page" : undefined}
              className={tab}
            >
              Chat
            </Link>
          )}
          <Link
            to="/a/$agentId/library"
            params={{ agentId }}
            search={{}}
            aria-current={page === "library" ? "page" : undefined}
            className={tab}
          >
            Library
          </Link>
          <Link
            to="/a/$agentId/automations"
            params={{ agentId }}
            aria-current={page === "automations" ? "page" : undefined}
            className={tab}
          >
            Automations
          </Link>
        </div>
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {page === "chat" && present.length > 0 ? (
          <span className="pr-1.5">
            <FaceStack people={present} className="size-6.5" max={4} />
          </span>
        ) : null}
        {agent === undefined ? null : (
          <>
            <SideChats agent={agent} workspace={workspace} state={state} />
            {callIn === undefined || !agent.hatched ? null : (
              <CallStripButton agent={agent} chatId={callIn} />
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${name}'s settings`}
              title={`${name}'s settings`}
              className="text-muted-foreground"
              onClick={() => openSettings({ at: "agent", agentId })}
            >
              <SlidersHorizontalIcon />
            </Button>
          </>
        )}
        {/* The panel is only ever beside a page where there is room for both. */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={panel ? `Hide ${name}'s panel` : `Show ${name}'s panel`}
          aria-pressed={panel}
          title={panel ? `Hide ${name}` : `Show ${name}`}
          className={cn(
            "hidden xl:inline-flex",
            panel ? "text-foreground" : "text-muted-foreground",
          )}
          onClick={() => {
            setPanel(!panel)
            // The side chat makes way for the panel.
            if (side !== undefined && chatId !== undefined) {
              void navigate({
                to: "/a/$agentId/c/$chatId",
                params: { agentId, chatId },
              })
            }
          }}
        >
          <SidebarSimpleIcon className="-scale-x-100" />
        </Button>
      </div>
    </header>
  )
}

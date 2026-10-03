import type { AgentState } from "@durable-computer/client"
import type { AgentSummary, ChatSummary } from "@durable-computer/protocol"
import {
  ArchiveIcon,
  ChatCircleIcon,
  ClockIcon,
  DesktopIcon,
  FolderIcon,
  GearIcon,
  LightningIcon,
  ListIcon,
  PlugsIcon,
  MoonIcon,
  ShieldCheckIcon,
  NotePencilIcon,
  PlusIcon,
  SignOutIcon,
  SunIcon,
  UserCircleIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router"
import { and, eq, useLiveQuery } from "@tanstack/react-db"
import { useAtom } from "jotai"
import { type ReactNode, useEffect, useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
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
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { chatListOpenAtom } from "@/lib/atoms"
import { authClient } from "@/lib/auth-client"
import { client } from "@/lib/client"
import { agentsCollection, chatsCollection } from "@/lib/collections"
import { currentTheme, setTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"

function RailButton({
  label,
  active,
  children,
  ...props
}: { label: string; active?: boolean; children: ReactNode } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={label}
            className={cn(
              "rounded-full text-muted-foreground",
              active && "bg-accent text-foreground",
            )}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function AgentSwitcher({ agent }: { agent: AgentSummary }) {
  const navigate = useNavigate()
  const { data: agents } = useLiveQuery({ query: (q) => q.from({ agent: agentsCollection }) })
  const create = async () => {
    const created = await client.createAgent()
    await agentsCollection.utils.refetch()
    await navigate({ to: "/a/$agentId", params: { agentId: created.id } })
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch agent"
        className="rounded-full outline-none ring-ring/40 focus-visible:ring-3"
      >
        <AgentFace agent={agent} className="size-10" still />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Your agents</DropdownMenuLabel>
          {(agents ?? []).map((other) => (
            <DropdownMenuItem
              key={other.id}
              onClick={() => navigate({ to: "/a/$agentId", params: { agentId: other.id } })}
            >
              <AgentFace agent={other} className="size-6" still />
              <span className="truncate">{other.name ?? "New agent"}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={create}>
          <PlusIcon /> New agent
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })

/** Matches for a search across everything said in the agent's chats. */
function SearchResults({
  agentId,
  query,
  onNavigate,
}: {
  agentId: string
  query: string
  onNavigate?: () => void
}) {
  // Wait for a pause in typing: each search reads the transcripts.
  const [settled, setSettled] = useState(query)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(query), 250)
    return () => clearTimeout(timer)
  }, [query])
  const { data, isError } = useQuery({
    queryKey: ["agents", agentId, "search", settled],
    queryFn: () => client.agent(agentId).search(settled),
    staleTime: 10_000,
  })
  return (
    <div
      role="region"
      aria-label="Search results"
      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3"
    >
      {isError ? (
        <p className="px-3 py-2 text-sm text-destructive">The search did not work. Try again.</p>
      ) : data === undefined || settled !== query ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
      ) : data.hits.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">Nothing matches.</p>
      ) : (
        <>
          {data.partial ? (
            <p className="px-3 pt-1 pb-2 text-xs text-muted-foreground">
              Nothing has all of those words. These come closest.
            </p>
          ) : null}
          {data.hits.map((hit) => (
            <Link
              key={`${hit.chatId}/${hit.messageId}`}
              to="/a/$agentId/c/$chatId"
              params={{ agentId, chatId: hit.chatId }}
              onClick={onNavigate}
              className="flex flex-col gap-0.5 rounded-lg px-3 py-2 text-sm hover:bg-accent"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium">{hit.chatTitle}</span>
                {hit.at === null ? null : (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {day.format(hit.at)}
                  </span>
                )}
              </span>
              <span className="line-clamp-3 text-xs text-muted-foreground">{hit.snippet}</span>
            </Link>
          ))}
        </>
      )}
      {data !== undefined && !data.complete && data.hits.length > 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          There may be more. Add a word to narrow it down.
        </p>
      ) : null}
    </div>
  )
}

const CHAT_LIST_KEY = "dc-chat-list"

/** Starts a chat with the agent and opens it. */
function useNewChat(agentId: string, onNavigate?: () => void) {
  const navigate = useNavigate()
  return async () => {
    const chat = await client.agent(agentId).createChat()
    await chatsCollection(agentId).utils.refetch()
    onNavigate?.()
    await navigate({ to: "/a/$agentId/c/$chatId", params: { agentId, chatId: chat.id } })
  }
}

function ChatList({ agentId, onNavigate }: { agentId: string; onNavigate?: () => void }) {
  const navigate = useNavigate()
  const { chatId: activeChatId } = useParams({ strict: false })
  const collection = chatsCollection(agentId)
  const { data: chats } = useLiveQuery({
    query: (q) =>
      q
        .from({ chat: collection })
        // Scheduled runs have their own chats; those are reached from the automations page.
        .where(({ chat }) => and(eq(chat.archived, false), eq(chat.kind, "chat")))
        .orderBy(({ chat }) => chat.updatedAt, "desc"),
  })

  const [query, setQuery] = useState("")
  const searching = query.trim().length >= 2

  const create = useNewChat(agentId, onNavigate)
  const archive = async (chat: ChatSummary) => {
    collection.update(chat.id, (draft) => {
      draft.archived = true
    })
    if (chat.id === activeChatId) await navigate({ to: "/a/$agentId", params: { agentId } })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-sm font-medium">Chats</h2>
        <Button variant="ghost" size="icon-sm" onClick={create} aria-label="New chat">
          <NotePencilIcon />
        </Button>
      </div>
      <div className="px-3 pb-2">
        <Input
          type="search"
          aria-label="Search chats"
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 text-sm"
        />
      </div>
      {searching ? (
        <SearchResults agentId={agentId} query={query.trim()} onNavigate={onNavigate} />
      ) : null}
      <nav
        hidden={searching}
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3"
      >
        {(chats ?? []).map((chat) => (
          <div key={chat.id} className="group/chat relative">
            <Link
              to="/a/$agentId/c/$chatId"
              params={{ agentId, chatId: chat.id }}
              onClick={onNavigate}
              className={cn(
                "block truncate rounded-lg py-2 pr-9 pl-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                chat.id === activeChatId && "bg-accent text-foreground",
              )}
            >
              {chat.title}
            </Link>
            <button
              type="button"
              aria-label={`Archive ${chat.title}`}
              onClick={() => archive(chat)}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/chat:opacity-100"
            >
              <ArchiveIcon className="size-4" />
            </button>
          </div>
        ))}
        {chats !== undefined && chats.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">No chats yet.</p>
        ) : null}
      </nav>
    </div>
  )
}

function ThemeToggle() {
  const [theme, setCurrent] = useState<"light" | "dark">("dark")
  useEffect(() => setCurrent(currentTheme()), [])
  const next = theme === "dark" ? "light" : "dark"
  return (
    <RailButton
      label={`Switch to ${next} theme`}
      onClick={() => {
        setTheme(next)
        setCurrent(next)
      }}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </RailButton>
  )
}

/** The frame around an agent: a rail of destinations, its chat list, and the current page. */
export function AppShell({ state, children }: { state: AgentState; children: ReactNode }) {
  const { agent } = state
  const navigate = useNavigate()
  const [listOpen, setListOpen] = useAtom(chatListOpenAtom)
  // The chat list stays the way it was left.
  useEffect(() => {
    try {
      if (localStorage.getItem(CHAT_LIST_KEY) === "open") setListOpen(true)
    } catch {
      // Storage can be unavailable; the list then starts closed.
    }
  }, [setListOpen])
  const toggleList = () =>
    setListOpen((open) => {
      try {
        localStorage.setItem(CHAT_LIST_KEY, open ? "closed" : "open")
      } catch {
        // The choice then lasts for this page only.
      }
      return !open
    })
  const newChat = useNewChat(agent.id)
  const [sheetOpen, setSheetOpen] = useState(false)
  const page = useLocation({
    select: (location) =>
      location.pathname.endsWith("/profile")
        ? "profile"
        : location.pathname.endsWith("/automations")
          ? "automations"
          : location.pathname.endsWith("/skills")
            ? "skills"
            : location.pathname.endsWith("/computers")
              ? "computers"
              : location.pathname.endsWith("/library")
                ? "library"
                : location.pathname.endsWith("/connectors")
                  ? "connectors"
                  : location.pathname.endsWith("/permissions")
                    ? "permissions"
                    : location.pathname.endsWith("/settings")
                      ? "settings"
                      : "chat",
  })
  const profile = page === "profile"

  const signOut = async () => {
    await authClient.signOut()
    await navigate({ to: "/login" })
  }

  return (
    <div className="flex h-dvh min-h-0">
      <aside className="hidden w-16 shrink-0 flex-col items-center gap-2 border-r bg-rail py-3 md:flex">
        <AgentSwitcher agent={agent} />
        <div className="mt-3 flex flex-col items-center gap-1">
          <RailButton
            label={listOpen ? "Hide chats" : "Show chats"}
            active={listOpen && page === "chat"}
            onClick={toggleList}
          >
            <ChatCircleIcon />
          </RailButton>
          <RailButton
            label="Library"
            active={page === "library"}
            onClick={() => navigate({ to: "/a/$agentId/library", params: { agentId: agent.id } })}
          >
            <FolderIcon />
          </RailButton>
          <RailButton
            label="Automations"
            active={page === "automations"}
            onClick={() =>
              navigate({ to: "/a/$agentId/automations", params: { agentId: agent.id } })
            }
          >
            <ClockIcon />
          </RailButton>
          <RailButton
            label="Skills"
            active={page === "skills"}
            onClick={() => navigate({ to: "/a/$agentId/skills", params: { agentId: agent.id } })}
          >
            <LightningIcon />
          </RailButton>
          <RailButton
            label="Connectors"
            active={page === "connectors"}
            onClick={() =>
              navigate({ to: "/a/$agentId/connectors", params: { agentId: agent.id } })
            }
          >
            <PlugsIcon />
          </RailButton>
          <RailButton
            label="Computers"
            active={page === "computers"}
            onClick={() => navigate({ to: "/a/$agentId/computers", params: { agentId: agent.id } })}
          >
            <DesktopIcon />
          </RailButton>
          <RailButton
            label="Permissions"
            active={page === "permissions"}
            onClick={() =>
              navigate({ to: "/a/$agentId/permissions", params: { agentId: agent.id } })
            }
          >
            <ShieldCheckIcon />
          </RailButton>
          <RailButton
            label="Identity and memory"
            active={profile}
            onClick={() => navigate({ to: "/a/$agentId/profile", params: { agentId: agent.id } })}
          >
            <UserCircleIcon />
          </RailButton>
        </div>
        <div className="mt-auto flex flex-col items-center gap-1">
          {/* For the account, so it sits with signing out, apart from the agent's own pages. */}
          <RailButton
            label="Settings"
            active={page === "settings"}
            onClick={() => navigate({ to: "/a/$agentId/settings", params: { agentId: agent.id } })}
          >
            <GearIcon />
          </RailButton>
          <ThemeToggle />
          <RailButton label="Sign out" onClick={signOut}>
            <SignOutIcon />
          </RailButton>
        </div>
      </aside>

      {listOpen ? (
        <aside className="hidden w-72 shrink-0 border-r bg-rail/60 md:block">
          <ChatList agentId={agent.id} />
        </aside>
      ) : null}

      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="absolute top-3 left-3 z-20 md:hidden">
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            onClick={() => setSheetOpen(true)}
          >
            <ListIcon /> Chats
          </Button>
        </div>
        {/* On a wide screen the list is beside the chat when it is open, and behind this when not. */}
        {listOpen || page !== "chat" ? null : (
          <div className="absolute top-3 left-3 z-20 hidden items-center gap-1.5 md:flex">
            <Button variant="secondary" size="sm" className="rounded-full" onClick={toggleList}>
              <ListIcon /> Chats
            </Button>
            <Button
              variant="secondary"
              size="icon-sm"
              className="rounded-full"
              aria-label="New chat"
              title="New chat"
              onClick={() => void newChat()}
            >
              <NotePencilIcon />
            </Button>
          </div>
        )}
        {children}
      </main>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="left" className="flex w-80 flex-col p-0">
          <SheetTitle className="sr-only">Chats</SheetTitle>
          <div className="flex items-center gap-3 border-b p-4 pr-12">
            <AgentSwitcher agent={agent} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{agent.name ?? "New agent"}</p>
              {agent.tagline ? (
                <p className="truncate text-xs text-muted-foreground">{agent.tagline}</p>
              ) : null}
            </div>
          </div>
          {/* The agent's pages, two to a row so the chats below keep most of the sheet. */}
          <nav aria-label="Pages" className="grid grid-cols-2 gap-1 border-b p-2">
            {(
              [
                // Short enough for half a sheet. Its page is still titled in full.
                ["profile", "Identity", <UserCircleIcon key="i" />],
                ["library", "Library", <FolderIcon key="i" />],
                ["automations", "Automations", <ClockIcon key="i" />],
                ["skills", "Skills", <LightningIcon key="i" />],
                ["connectors", "Connectors", <PlugsIcon key="i" />],
                ["computers", "Computers", <DesktopIcon key="i" />],
                ["permissions", "Permissions", <ShieldCheckIcon key="i" />],
                ["settings", "Settings", <GearIcon key="i" />],
              ] as const
            ).map(([path, label, icon]) => (
              <Link
                key={path}
                to={`/a/$agentId/${path}`}
                params={{ agentId: agent.id }}
                onClick={() => setSheetOpen(false)}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 [&_svg]:size-4 [&_svg]:shrink-0",
                  page === path && "bg-accent text-foreground",
                )}
              >
                {icon}
                <span className="truncate">{label}</span>
              </Link>
            ))}
          </nav>
          <div className="min-h-0 flex-1">
            <ChatList agentId={agent.id} onNavigate={() => setSheetOpen(false)} />
          </div>
          <div className="border-t p-3">
            <Button variant="ghost" size="sm" onClick={signOut}>
              <SignOutIcon /> Sign out
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

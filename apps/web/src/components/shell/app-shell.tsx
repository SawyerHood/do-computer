import type { AgentState } from "@durable-computer/client"
import type { AgentSummary, ChatSummary } from "@durable-computer/protocol"
import {
  ArchiveIcon,
  ChatCircleIcon,
  ClockIcon,
  DesktopIcon,
  FolderIcon,
  LightningIcon,
  ListIcon,
  MoonIcon,
  NotePencilIcon,
  PlusIcon,
  SignOutIcon,
  SunIcon,
  UserCircleIcon,
} from "@phosphor-icons/react"
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router"
import { and, eq, useLiveQuery } from "@tanstack/react-db"
import { useAtom } from "jotai"
import { type ReactNode, useEffect, useState } from "react"
import { AgentAvatar } from "@/components/agent-avatar"
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
        <AgentAvatar avatar={agent.avatar} seed={agent.id} className="size-10" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Your agents</DropdownMenuLabel>
          {(agents ?? []).map((other) => (
            <DropdownMenuItem
              key={other.id}
              onClick={() => navigate({ to: "/a/$agentId", params: { agentId: other.id } })}
            >
              <AgentAvatar avatar={other.avatar} seed={other.id} className="size-6" />
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

  const create = async () => {
    const chat = await client.agent(agentId).createChat()
    await collection.utils.refetch()
    onNavigate?.()
    await navigate({ to: "/a/$agentId/c/$chatId", params: { agentId, chatId: chat.id } })
  }
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
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
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
            onClick={() => setListOpen((open) => !open)}
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
            label="Computers"
            active={page === "computers"}
            onClick={() => navigate({ to: "/a/$agentId/computers", params: { agentId: agent.id } })}
          >
            <DesktopIcon />
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
        {children}
      </main>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="left" className="flex w-80 flex-col p-0">
          <SheetTitle className="sr-only">Chats</SheetTitle>
          <div className="flex items-center gap-3 border-b p-4">
            <AgentSwitcher agent={agent} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{agent.name ?? "New agent"}</p>
              <Link
                to="/a/$agentId/profile"
                params={{ agentId: agent.id }}
                onClick={() => setSheetOpen(false)}
                className="text-xs text-muted-foreground underline underline-offset-3"
              >
                Identity and memory
              </Link>
              <Link
                to="/a/$agentId/automations"
                params={{ agentId: agent.id }}
                onClick={() => setSheetOpen(false)}
                className="ml-3 text-xs text-muted-foreground underline underline-offset-3"
              >
                Automations
              </Link>
              <Link
                to="/a/$agentId/library"
                params={{ agentId: agent.id }}
                onClick={() => setSheetOpen(false)}
                className="ml-3 text-xs text-muted-foreground underline underline-offset-3"
              >
                Library
              </Link>
              <Link
                to="/a/$agentId/skills"
                params={{ agentId: agent.id }}
                onClick={() => setSheetOpen(false)}
                className="ml-3 text-xs text-muted-foreground underline underline-offset-3"
              >
                Skills
              </Link>
              <Link
                to="/a/$agentId/computers"
                params={{ agentId: agent.id }}
                onClick={() => setSheetOpen(false)}
                className="ml-3 text-xs text-muted-foreground underline underline-offset-3"
              >
                Computers
              </Link>
            </div>
          </div>
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

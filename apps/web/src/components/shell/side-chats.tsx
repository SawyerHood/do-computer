import type { AgentState } from "@do-computer/client"
import type { AgentSummary, ChatSummary, Person, WorkspaceSummary } from "@do-computer/protocol"
import { ChatsIcon, PlusIcon } from "@phosphor-icons/react"
import { useParams, useSearch } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { isAtWork } from "@/components/chat/subagents"
import { FaceStack } from "@/components/people"
import { Badge } from "@/components/ui/badge"
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
import { Spinner } from "@/components/ui/spinner"
import { chatKey, liveChatAtom } from "@/lib/atoms"
import { mainChatOf, sideChatsOf, useNewSideChat, useOpenSideChat } from "@/lib/chats"
import { cn } from "@/lib/utils"
import { useHere, usePeople, whoIs } from "@/lib/workspaces"
import { ago } from "./agent-list.tsx"

/**
 * One side chat in the menu: its title, who else is in it, and at the end either a spinner while
 * there is work going on in it or when it was last used. Never both.
 */
function SideChatItem({
  agentId,
  chat,
  onScreen,
  subagentsAtWork,
  people,
  now,
  onOpen,
}: {
  agentId: string
  chat: ChatSummary
  /** It is the chat in the middle, or the one beside it. */
  onScreen: boolean
  /** How many sub-agents started in this chat are at work. */
  subagentsAtWork: number
  /** Teammates who have it open. */
  people: Person[]
  now: number
  onOpen: () => void
}) {
  // Whether the agent is at work in it is only known for a chat on screen, which is followed.
  const live = useAtomValue(liveChatAtom(chatKey(agentId, chat.id)))
  const working = subagentsAtWork > 0 || (onScreen && live.loaded && live.state.busy)
  return (
    <DropdownMenuItem onClick={onOpen} className="font-normal">
      <span className={cn("min-w-0 flex-1 truncate", onScreen && "font-medium")}>{chat.title}</span>
      <FaceStack people={people} className="size-[1.125rem]" />
      <span className="flex min-w-6 shrink-0 items-center justify-end gap-1 text-xs text-muted-foreground">
        {working ? (
          <>
            <Spinner aria-label="Working" className="size-3" />
            {subagentsAtWork > 0 ? subagentsAtWork : null}
          </>
        ) : (
          ago(chat.updatedAt, now)
        )}
      </span>
    </DropdownMenuItem>
  )
}

/**
 * The way to an agent's side chats, from its strip. The sidebar lists agents and nothing else,
 * and choosing one opens its main chat; its other conversations are the agent's own business, so
 * they are kept here, with its other things.
 */
export function SideChats({
  agent,
  workspace,
  state,
}: {
  agent: AgentSummary
  workspace: WorkspaceSummary
  state: AgentState | undefined
}) {
  const { chatId } = useParams({ strict: false })
  const { side } = useSearch({ strict: false })
  const main = mainChatOf(state?.chats)
  const chats = sideChatsOf(state?.chats)
  const open = useOpenSideChat(agent.id, main?.id)
  const create = useNewSideChat(agent.id, main?.id)
  const team = workspace.kind === "team"
  const here = useHere(team ? workspace.id : undefined)
  const people = usePeople(team ? workspace : undefined)
  const name = agent.name ?? "New Dood"
  const now = Date.now()

  const subagents = (state?.chats ?? []).filter((chat) => chat.kind === "subagent")
  // Someone reading a sub-agent's chat counts as being in the chat it was started in.
  const parentOf = new Map(subagents.map((subagent) => [subagent.id, subagent.parentId]))
  const atWork = (chat: ChatSummary) =>
    subagents.filter((subagent) => subagent.parentId === chat.id && isAtWork(subagent.status))
      .length
  const onScreen = (chat: ChatSummary) => chat.id === chatId || chat.id === String(side)
  const working = chats.some((chat) => atWork(chat) > 0)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${name}'s side chats`}
        title={`${name}'s side chats`}
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "gap-1.5 px-2 text-[0.8125rem] text-muted-foreground",
              chats.some(onScreen) && "bg-accent text-foreground",
            )}
          />
        }
      >
        {working ? <Spinner aria-label="Working" /> : <ChatsIcon />}
        <span className="hidden lg:inline">Side chats</span>
        {chats.length === 0 ? null : (
          <Badge
            variant="secondary"
            className="h-4.5 min-w-4.5 rounded-full px-1 text-[0.6875rem] font-semibold"
          >
            {chats.length}
          </Badge>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="end"
        className="max-h-[min(28rem,var(--available-height))] w-80"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Side chats with {name}</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => void create()}
            className="text-primary dark:text-[oklch(0.78_0.09_195)]"
          >
            <PlusIcon /> New side chat
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {chats.length === 0 ? (
          <p className="px-3 pt-1 pb-2 text-xs text-muted-foreground">
            None yet. Start one to keep something out of the main chat, or to ask for something
            while {name} is busy there.
          </p>
        ) : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup className="[--face-ring:var(--popover)]">
              {chats.map((chat) => (
                <SideChatItem
                  key={chat.id}
                  agentId={agent.id}
                  chat={chat}
                  onScreen={onScreen(chat)}
                  subagentsAtWork={atWork(chat)}
                  people={whoIs(
                    here,
                    (place) =>
                      place.agentId === agent.id &&
                      place.chatId !== null &&
                      (parentOf.get(place.chatId) ?? place.chatId) === chat.id,
                  ).flatMap((id) => people.get(id) ?? [])}
                  now={now}
                  onOpen={() => void open(chat.id)}
                />
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

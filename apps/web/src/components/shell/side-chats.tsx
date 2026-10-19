import type { AgentState } from "@do-computer/client"
import type { AgentSummary, ChatSummary, Person, WorkspaceSummary } from "@do-computer/protocol"
import { ChatsIcon, PlusIcon } from "@phosphor-icons/react"
import { useParams, useSearch } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { isAtWork } from "@/components/chat/subagents"
import { FaceStack } from "@/components/people"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
 * The way to an agent's side chats, from the menu on its name. The sidebar lists agents and
 * nothing else, and choosing one opens its main chat; its other conversations are the agent's
 * own business, so they are kept here, with its other things: a row of that menu, which opens
 * into them.
 */
export function SideChats({
  agent,
  workspace,
  state,
  onDone,
}: {
  agent: AgentSummary
  workspace: WorkspaceSummary
  state: AgentState | undefined
  /** A chat was opened or started, and the menu this is in has nothing more to do. */
  onDone: () => void
}) {
  const { chatId } = useParams({ strict: false })
  const { side } = useSearch({ strict: false })
  const main = mainChatOf(state?.chats)
  const chats = sideChatsOf(state?.chats)
  const open = useOpenSideChat(agent.id, main?.id)
  const starting = useNewSideChat(agent.id, main?.id)
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
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        aria-label={`${name}'s side chats`}
        className={cn(chats.some(onScreen) && "font-medium")}
      >
        {working ? <Spinner aria-label="Working" /> : <ChatsIcon />}
        <span className="flex-1">Side chats</span>
        {chats.length === 0 ? null : (
          <span className="text-xs text-muted-foreground tabular-nums">{chats.length}</span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[min(28rem,var(--available-height))] w-80 max-w-(--available-width)">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Side chats with {name}</DropdownMenuLabel>
          {/* The menu stays while the chat is started, and says so. It goes once the chat is open. */}
          <DropdownMenuItem
            closeOnClick={false}
            disabled={starting.creating}
            aria-busy={starting.creating}
            onClick={() => void starting.create().then((made) => made && onDone())}
            className="text-primary dark:text-[oklch(0.78_0.09_195)]"
          >
            {starting.creating ? <Spinner /> : <PlusIcon />}
            {starting.creating ? "Starting a side chat…" : "New side chat"}
          </DropdownMenuItem>
          {starting.error === undefined ? null : (
            <p role="alert" className="px-3 pb-1.5 text-xs text-destructive">
              {starting.error}
            </p>
          )}
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
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

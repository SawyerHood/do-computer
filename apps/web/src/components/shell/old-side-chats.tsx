import type { AgentState } from "@do-computer/client"
import type { AgentSummary } from "@do-computer/protocol"
import { ArchiveIcon } from "@phosphor-icons/react"
import { useNavigate, useParams } from "@tanstack/react-router"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { sideChatsOf } from "@/lib/chats"
import { cn } from "@/lib/utils"
import { ago } from "./agent-list.tsx"

/**
 * The way to an agent's old side chats, from the menu on its name, where it has any. A Dood is
 * talked to in its main chat alone; the side chats from before that are kept, archived, and are
 * read from here. Nothing new is started here.
 */
export function OldSideChats({
  agent,
  state,
}: {
  agent: AgentSummary
  state: AgentState | undefined
}) {
  const { chatId } = useParams({ strict: false })
  const navigate = useNavigate()
  const chats = sideChatsOf(state?.chats)
  const name = agent.name ?? "New Dood"
  const now = Date.now()
  if (chats.length === 0) return null
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        aria-label={`${name}'s old side chats`}
        className={cn(chats.some((chat) => chat.id === chatId) && "font-medium")}
      >
        <ArchiveIcon />
        <span className="flex-1">Old side chats</span>
        <span className="text-xs text-muted-foreground tabular-nums">{chats.length}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[min(28rem,var(--available-height))] w-80 max-w-(--available-width)">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            Side chats with {name}, from before everything went to its main chat. Kept to read.
          </DropdownMenuLabel>
          {chats.map((chat) => (
            <DropdownMenuItem
              key={chat.id}
              className="font-normal"
              onClick={() =>
                void navigate({
                  to: "/a/$agentId/c/$chatId",
                  params: { agentId: agent.id, chatId: chat.id },
                })
              }
            >
              <span className={cn("min-w-0 flex-1 truncate", chat.id === chatId && "font-medium")}>
                {chat.title}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {ago(chat.updatedAt, now)}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

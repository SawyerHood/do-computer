import { createPortal } from "react-dom"
import type { AgentSummary, ChatSummary } from "@do-computer/protocol"
import { ArchiveIcon, CaretLeftIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { AgentFace } from "@/components/agent-avatar"
import { buttonVariants } from "@/components/ui/button"
import { stripStartAtom } from "@/lib/atoms"
import { cn } from "@/lib/utils"

/** What floats in the row the Dood's name is in, drawn as the name is: a thing of its own. */
export const FLOATS = "bg-popover shadow-raised"

/** The way back to the main chat, afloat at the start of that row, from a chat that has the middle. */
export function MainChatLink({ agentId, mainId }: { agentId: string; mainId: string }) {
  return (
    <Link
      to="/a/$agentId/c/$chatId"
      params={{ agentId, chatId: mainId }}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1 rounded-full pr-3 pl-2 text-[0.8125rem] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 max-sm:px-2",
        FLOATS,
      )}
    >
      <CaretLeftIcon className="size-3.5" />
      {/* On a narrow screen the arrow alone is shown, and the words are still its name. */}
      <span className="max-sm:sr-only">Main chat</span>
    </Link>
  )
}

/**
 * What an old side chat floats in the row the agent's name is in: the way back to the main chat.
 * Which side chat it is, the name itself says.
 */
export function OldSideChatBar({ agent, main }: { agent: AgentSummary; main: ChatSummary }) {
  const start = useAtomValue(stripStartAtom)
  if (start === null) return null
  return createPortal(<MainChatLink agentId={agent.id} mainId={main.id} />, start)
}

/**
 * Where the message box would be, in an old side chat: side chats are from before a Dood was
 * talked to in its main chat alone. They are kept, to read, and the main chat is where to talk.
 */
export function OldSideChatFoot({ agent, main }: { agent: AgentSummary; main: ChatSummary }) {
  const name = agent.name ?? "your Dood"
  return (
    <div className="mx-auto flex w-full max-w-[45rem] items-center gap-3 px-4 pt-1 pb-5 text-sm text-muted-foreground">
      <span className="relative shrink-0">
        <AgentFace agent={agent} className="size-8" still />
        <ArchiveIcon
          aria-hidden
          className="absolute -right-1 -bottom-1 size-4 rounded-full bg-background p-0.5"
        />
      </span>
      <p className="min-w-0 flex-1">
        An old side chat, kept to read. Everything with {name} now happens in its main chat.
      </p>
      <Link
        to="/a/$agentId/c/$chatId"
        params={{ agentId: agent.id, chatId: main.id }}
        // A link, in the clothes of a button: it leads somewhere.
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "font-normal text-foreground",
        )}
      >
        Back to the main chat
      </Link>
    </div>
  )
}

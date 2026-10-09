import { type AgentSummary, type ChatSummary, continuesMain } from "@durable-computer/protocol"
import {
  ArchiveIcon,
  ArrowsOutSimpleIcon,
  CaretLeftIcon,
  ChatsIcon,
  SidebarSimpleIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouteContext } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { useMemo } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { TranscriptPlaceholder } from "@/components/placeholders"
import { ResizeHandle } from "@/components/shell/resize-handle"
import { Button } from "@/components/ui/button"
import { chatKey } from "@/lib/atoms"
import { useArchiveSideChat } from "@/lib/chats"
import { client } from "@/lib/client"
import { workspaceModelsKey } from "@/lib/collections"
import { DOC_PANEL_LEAVES, sideChatColumn } from "@/lib/columns"
import { useChat } from "@/lib/use-chat"
import { useWide } from "@/lib/use-wide"
import { TeamContext, usePeople, useWorkspaceOfAgent } from "@/lib/workspaces"
import { Composer } from "./composer.tsx"
import { AgentIdContext } from "./sent-file.tsx"
import { Transcript } from "./transcript.tsx"

/** A link that looks like one of the small buttons it sits among. */
const iconLink =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 [&_svg]:size-4"

/**
 * What an empty side chat says, where the main chat would have the agent's hello. `carried` is
 * for one that continues the main chat: the agent has what was said there in front of it.
 */
export function SideChatWelcome({ agent, carried }: { agent: AgentSummary; carried: boolean }) {
  const name = agent.name ?? "Your agent"
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <ChatsIcon className="size-7 text-muted-foreground" />
      <p className="max-w-xs text-sm text-muted-foreground">
        {carried
          ? `A side chat keeps its own conversation. ${name} picks up from the main chat, which stays as it was.`
          : `A side chat keeps its own conversation. ${name} brings what it remembers, and the main chat stays as it was.`}
      </p>
    </div>
  )
}

/**
 * The line under the agent's strip while a side chat has the middle: it says that this is a
 * side chat, which one, and leads back to the main chat.
 */
export function SideChatBar({
  agent,
  chat,
  main,
}: {
  agent: AgentSummary
  chat: ChatSummary
  main: ChatSummary
}) {
  const wide = useWide()
  const archive = useArchiveSideChat(agent.id, main.id)
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-rail/30 pr-2 pl-1.5 text-sm">
      <Link
        to="/a/$agentId/c/$chatId"
        params={{ agentId: agent.id, chatId: main.id }}
        className="flex h-7 shrink-0 items-center gap-1 rounded-lg pr-2.5 pl-1.5 text-[0.8125rem] font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <CaretLeftIcon className="size-3.5" />
        Main chat
      </Link>
      <span className="hidden shrink-0 text-muted-foreground sm:inline">Side chat</span>
      <span className="min-w-0 flex-1 truncate font-medium">{chat.title}</span>
      {wide ? (
        <Link
          to="/a/$agentId/c/$chatId"
          params={{ agentId: agent.id, chatId: main.id }}
          search={{ side: Number(chat.id) }}
          aria-label="Put it beside the main chat"
          title="Put it beside the main chat"
          className={iconLink}
        >
          <SidebarSimpleIcon className="-scale-x-100" />
        </Link>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Archive ${chat.title}`}
        title="Archive this side chat"
        className="text-muted-foreground"
        onClick={() => void archive(chat.id)}
      >
        <ArchiveIcon />
      </Button>
    </div>
  )
}

/**
 * A side chat, beside the main chat: in the place the agent's panel has, and as wide as it is
 * dragged. The main chat stays where it is, to its left.
 */
export function SideChat({
  agent,
  chat,
  mainId,
}: {
  agent: AgentSummary
  chat: ChatSummary
  /** The chat it is beside. */
  mainId: string
}) {
  const { live, state, earlier, send, sendError, retry, stop, attach } = useChat(agent.id, chat.id)
  const width = useAtomValue(sideChatColumn.width)
  const archive = useArchiveSideChat(agent.id, mainId)
  const name = agent.name ?? "New agent"

  // In a team the transcript says who said what.
  const { me } = useRouteContext({ from: "/_app" })
  const workspace = useWorkspaceOfAgent(agent.id)
  const team = workspace?.kind === "team" ? workspace : undefined
  const people = usePeople(team)
  const teamContext = useMemo(
    () => (team === undefined ? undefined : { meId: me.user.id, people }),
    [team, me.user.id, people],
  )
  const { data: models } = useQuery({
    queryKey: workspaceModelsKey(agent.workspaceId),
    queryFn: () => client.models(agent.workspaceId),
    staleTime: Number.POSITIVE_INFINITY,
  })

  return (
    <aside
      aria-label={`Side chat: ${chat.title}`}
      className="relative flex shrink-0 flex-col border-l bg-rail/40"
      style={{ width, maxWidth: `calc(100% - ${DOC_PANEL_LEAVES})` }}
    >
      <ResizeHandle column={sideChatColumn} edge="left" label="Resize the side chat" />
      <header className="flex h-13 shrink-0 items-center gap-0.5 border-b pr-2 pl-3">
        <AgentFace agent={agent} className="size-7" still />
        <div className="min-w-0 flex-1 px-2 leading-tight">
          <p className="truncate text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
            Side chat with {name}
          </p>
          <h2 className="truncate text-sm font-medium">{chat.title}</h2>
        </div>
        {live.status === "reconnecting" ? (
          <span className="pr-1 text-xs text-muted-foreground">reconnecting…</span>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Archive ${chat.title}`}
          title="Archive this side chat"
          className="text-muted-foreground"
          onClick={() => void archive(chat.id)}
        >
          <ArchiveIcon />
        </Button>
        <Link
          to="/a/$agentId/c/$chatId"
          params={{ agentId: agent.id, chatId: chat.id }}
          aria-label="Give it the whole chat"
          title="Give it the whole chat"
          className={iconLink}
        >
          <ArrowsOutSimpleIcon />
        </Link>
        <Link
          to="/a/$agentId/c/$chatId"
          params={{ agentId: agent.id, chatId: mainId }}
          aria-label="Close the side chat"
          title="Close the side chat"
          className={iconLink}
        >
          <XIcon />
        </Link>
      </header>
      <div className="min-h-0 flex-1">
        <AgentIdContext value={agent.id}>
          <TeamContext value={teamContext}>
            <Transcript
              state={state}
              chatId={chat.id}
              onRetry={retry}
              empty={
                live.loaded ? (
                  <SideChatWelcome agent={agent} carried={continuesMain(state.messages)} />
                ) : (
                  <TranscriptPlaceholder />
                )
              }
              before={
                earlier.has ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-center text-muted-foreground"
                    disabled={earlier.loading}
                    onClick={earlier.load}
                  >
                    {earlier.loading ? "Loading…" : "Show earlier messages"}
                  </Button>
                ) : null
              }
            />
          </TeamContext>
        </AgentIdContext>
      </div>
      {/* What the agent is waiting on is above the main chat's box, whichever chat asked. */}
      <Composer
        draftKey={chatKey(agent.id, chat.id)}
        placeholder={`Message ${name} in this side chat`}
        busy={live.state.busy}
        queued={state.queued}
        onSend={send}
        error={sendError}
        onStop={stop}
        sees={models?.find((model) => model.id === agent.model)?.images === true}
        agentName={name}
        onAttach={attach}
      />
    </aside>
  )
}

import type { AgentState } from "@durable-computer/client"
import type {
  AgentSummary,
  ChatSummary,
  NoticePart,
  SubagentStatus,
  ToolPart,
} from "@durable-computer/protocol"
import {
  CaretRightIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  StopCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useMemo } from "react"
import { AgentAvatar, AgentFace } from "@/components/agent-avatar"
import { useAgentsById } from "@/components/computer-requests"
import { client } from "@/lib/client"
import { agentKey } from "@/lib/collections"
import { cn } from "@/lib/utils"
import { Markdown } from "./markdown.tsx"

const WORDS: Record<SubagentStatus, string> = {
  working: "Answering",
  waiting: "Waiting for your OK",
  done: "Answered",
  stopped: "Stopped",
  failed: "Did not answer",
}

/** How a conversation with another agent is getting on, in a word or two. */
export const threadWords = (status: SubagentStatus | undefined) => WORDS[status ?? "done"]

/**
 * Another agent's creature, small and still. One that is not on the list any more, such as one
 * that was deleted, is drawn from its id alone, so it still has a face of its own.
 */
export function PeerFace({
  agent,
  agentId,
  className,
}: {
  agent: AgentSummary | undefined
  agentId: string
  className?: string
}) {
  return agent === undefined ? (
    <AgentAvatar avatar={null} seed={agentId} className={className} quiet still />
  ) : (
    <AgentFace agent={agent} className={className} quiet still />
  )
}

function StatusMark({ status }: { status: SubagentStatus | undefined }) {
  const tone = "size-4 shrink-0 text-muted-foreground"
  switch (status) {
    case "working":
      return <CircleNotchIcon className={cn(tone, "animate-spin")} />
    case "waiting":
      return <span className="mx-1 size-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
    case "stopped":
      return <StopCircleIcon className={tone} />
    case "failed":
      return <WarningCircleIcon className="size-4 shrink-0 text-destructive" />
    default:
      return <CheckCircleIcon className={tone} />
  }
}

/** The conversations other agents have had with this one, newest first. */
export function useThreads(agentId: string): ChatSummary[] {
  const { data } = useQuery<AgentState>({
    queryKey: agentKey(agentId),
    queryFn: () => client.agent(agentId).state(),
  })
  return useMemo(
    () =>
      (data?.chats ?? [])
        .filter((chat) => chat.kind === "agent" && !chat.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [data],
  )
}

/** Conversations with other agents as a list: each opens to be read. */
export function ThreadRows({ agentId, threads }: { agentId: string; threads: ChatSummary[] }) {
  const agents = useAgentsById()
  return (
    <ul aria-label="From other agents" className="flex flex-col gap-0.5">
      {threads.map((thread) => {
        const peerId = thread.peer?.agentId ?? ""
        const peer = agents.get(peerId)
        return (
          <li key={thread.id}>
            <Link
              to="/a/$agentId/c/$chatId"
              params={{ agentId, chatId: thread.id }}
              className="flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-1.5 outline-none hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <PeerFace agent={peer} agentId={peerId} className="size-8" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{thread.title}</span>
                <span
                  className={cn(
                    "block truncate text-xs text-muted-foreground",
                    thread.status === "waiting" && "text-foreground",
                  )}
                >
                  {peer?.name ?? thread.peer?.name ?? "An agent"} ·{" "}
                  {threadWords(thread.status).toLowerCase()}
                </span>
              </span>
              <StatusMark status={thread.status} />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Where the agent wrote to another agent, in its message: a way into what the two said. */
export function AgentMessageChip({ part }: { part: ToolPart }) {
  const agents = useAgentsById()
  const { agentId, name, chatId } = part.details as {
    agentId: string
    name: string
    chatId: string
  }
  const peer = agents.get(agentId)
  return (
    <Link
      to="/a/$agentId/c/$chatId"
      params={{ agentId, chatId }}
      className="flex w-fit max-w-full items-center gap-2 rounded-2xl border bg-surface py-1.5 pr-2.5 pl-2 text-sm outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <PeerFace agent={peer} agentId={agentId} className="size-6" />
      <span className="shrink-0 text-xs text-muted-foreground">Asked</span>
      <span className="truncate font-medium">{peer?.name ?? name}</span>
      <CaretRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
    </Link>
  )
}

/** Another agent's reply, in the chat the message was sent from. What it said is folded away. */
export function AgentWord({ part }: { part: NoticePart }) {
  const agents = useAgentsById()
  const peer = part.agentId === undefined ? undefined : agents.get(part.agentId)
  const name = <span className="font-medium text-foreground">{peer?.name ?? part.text}</span>
  return (
    <div className="border-l-2 py-0.5 pl-3 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {part.agentId === undefined ? null : (
          <PeerFace agent={peer} agentId={part.agentId} className="size-5" />
        )}
        <span>
          {name}{" "}
          {part.outcome === "stopped"
            ? "was stopped before it answered"
            : part.outcome === "failed"
              ? "could not answer"
              : "replied"}
        </span>
        {part.agentId === undefined || part.chatId === undefined ? null : (
          <Link
            to="/a/$agentId/c/$chatId"
            params={{ agentId: part.agentId, chatId: part.chatId }}
            className="underline underline-offset-3 hover:text-foreground"
          >
            Open their conversation
          </Link>
        )}
      </div>
      {part.detail === undefined ? null : (
        <details className="mt-1">
          <summary className="cursor-default">
            {part.outcome === "failed" ? "What went wrong" : "What it said"}
          </summary>
          <div className="mt-1.5 rounded-xl bg-surface px-3 py-2 text-foreground">
            <Markdown text={part.detail} />
          </div>
        </details>
      )}
    </div>
  )
}

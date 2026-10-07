import type { AgentState } from "@durable-computer/client"
import type { ChatSummary, NoticePart, SubagentStatus, ToolPart } from "@durable-computer/protocol"
import {
  CaretRightIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  StopCircleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { useContext, useMemo } from "react"
import { AgentAvatar } from "@/components/agent-avatar"
import { client } from "@/lib/client"
import { agentKey } from "@/lib/collections"
import { IDLE, type MascotMood, mascotMoodAtom } from "@/lib/mascot"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"
import { Markdown } from "./markdown.tsx"
import { AgentIdContext } from "./sent-file.tsx"

/**
 * What a sub-agent's creature grows from. It has no look of its own on record: its shape and
 * color come from which sub-agent it is, so it is the same creature wherever it is drawn.
 */
export const subagentSeed = (agentId: string, chatId: string) => `${agentId}/sub/${chatId}`

const WORDS: Record<SubagentStatus, string> = {
  working: "Working",
  waiting: "Waiting for your OK",
  done: "Reported back",
  stopped: "Stopped",
  failed: "Did not finish",
}

/** How a sub-agent is getting on, in a word or two. */
export const subagentWords = (status: SubagentStatus | undefined) => WORDS[status ?? "done"]

export const isAtWork = (status: SubagentStatus | undefined) =>
  status === "working" || status === "waiting"

const MOODS: Partial<Record<SubagentStatus, MascotMood>> = {
  working: { state: "thinking" },
  waiting: { state: "waiting" },
  failed: { state: "error" },
}

/** A sub-agent's creature, small. It moves while it is at work and holds still once it is not. */
export function SubagentFace({
  agentId,
  chatId,
  status,
  className,
}: {
  agentId: string
  chatId: string
  status: SubagentStatus | undefined
  className?: string
}) {
  return (
    <AgentAvatar
      avatar={null}
      seed={subagentSeed(agentId, chatId)}
      className={className}
      mood={MOODS[status ?? "done"] ?? IDLE}
      quiet
      still={!isAtWork(status)}
    />
  )
}

/** A sub-agent's creature, large, doing what its chat on screen says it is doing. */
export function SubagentHero({
  agentId,
  chatId,
  className,
}: {
  agentId: string
  chatId: string
  className?: string
}) {
  const seed = subagentSeed(agentId, chatId)
  const mood = useAtomValue(mascotMoodAtom(seed))
  return <AgentAvatar avatar={null} seed={seed} className={className} mood={mood} />
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

/** The agent's chats, from the query the whole page shares. */
function useChats(agentId: string): ChatSummary[] {
  const { data } = useQuery<AgentState>({
    queryKey: agentKey(agentId),
    queryFn: () => client.agent(agentId).state(),
  })
  return data?.chats ?? []
}

/** The sub-agents started in one chat, oldest first. */
export function useSubagents(agentId: string, parentId: string): ChatSummary[] {
  const chats = useChats(agentId)
  return useMemo(
    () =>
      chats
        .filter((chat) => chat.kind === "subagent" && chat.parentId === parentId)
        .sort((a, b) => a.createdAt - b.createdAt),
    [chats, parentId],
  )
}

/** Stop a sub-agent. Its agent is told that it was stopped. */
export async function stopSubagent(agentId: string, chatId: string): Promise<void> {
  try {
    await client.agent(agentId).abort(chatId)
  } finally {
    await queryClient.invalidateQueries({ queryKey: agentKey(agentId) })
  }
}

/** A chat's sub-agents as a list: each opens its own chat, and one at work can be stopped. */
export function SubagentRows({
  agentId,
  subagents,
}: {
  agentId: string
  subagents: ChatSummary[]
}) {
  return (
    <ul aria-label="Sub-agents" className="flex flex-col gap-0.5">
      {subagents.map((subagent) => (
        <li key={subagent.id} className="flex items-center rounded-xl hover:bg-surface">
          <Link
            to="/a/$agentId/c/$chatId"
            params={{ agentId, chatId: subagent.id }}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 py-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <SubagentFace
              agentId={agentId}
              chatId={subagent.id}
              status={subagent.status}
              className="size-8"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{subagent.title}</span>
              <span
                className={cn(
                  "block truncate text-xs text-muted-foreground",
                  subagent.status === "waiting" && "text-foreground",
                )}
              >
                {subagentWords(subagent.status)}
              </span>
            </span>
            <StatusMark status={subagent.status} />
          </Link>
          {isAtWork(subagent.status) ? (
            <button
              type="button"
              aria-label={`Stop ${subagent.title}`}
              title="Stop"
              onClick={() => void stopSubagent(agentId, subagent.id)}
              className="mr-1.5 rounded-md p-1 text-muted-foreground outline-none hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/** A chat's sub-agents as small creatures standing by the agent's own. The newest few. */
export function SubagentBrood({
  agentId,
  subagents,
}: {
  agentId: string
  subagents: ChatSummary[]
}) {
  if (subagents.length === 0) return null
  return (
    <div className="-mt-3 flex justify-center gap-1">
      {subagents.slice(-5).map((subagent) => (
        <Link
          key={subagent.id}
          to="/a/$agentId/c/$chatId"
          params={{ agentId, chatId: subagent.id }}
          title={`${subagent.title}: ${subagentWords(subagent.status).toLowerCase()}`}
          aria-label={`Open ${subagent.title}`}
          className="rounded-xl p-0.5 outline-none hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <SubagentFace
            agentId={agentId}
            chatId={subagent.id}
            status={subagent.status}
            className="size-10"
          />
        </Link>
      ))}
    </div>
  )
}

/** Where the agent started a sub-agent, in its message: a way into the sub-agent's chat. */
export function SubagentChip({ part }: { part: ToolPart }) {
  const agentId = useContext(AgentIdContext)
  const chats = useChats(agentId ?? "")
  if (agentId === undefined) return null
  const { chatId, title } = part.details as { chatId: string; title: string }
  const status = chats.find((chat) => chat.id === chatId)?.status
  return (
    <Link
      to="/a/$agentId/c/$chatId"
      params={{ agentId, chatId }}
      className="flex w-fit max-w-full items-center gap-2 rounded-2xl border bg-surface py-1.5 pr-2.5 pl-2 text-sm outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <SubagentFace agentId={agentId} chatId={chatId} status={status} className="size-6" />
      <span className="truncate font-medium">{title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {subagentWords(status).toLowerCase()}
      </span>
      <CaretRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
    </Link>
  )
}

/** Word from a sub-agent in the chat that started it. What it reported is folded away. */
export function SubagentWord({ part }: { part: NoticePart }) {
  const agentId = useContext(AgentIdContext)
  if (agentId === undefined) return null
  const name = <span className="font-medium text-foreground">{part.text}</span>
  return (
    <div className="border-l-2 py-0.5 pl-3 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {part.chatId === undefined ? null : (
          <SubagentFace
            agentId={agentId}
            chatId={part.chatId}
            status={part.outcome === "failed" ? "failed" : "done"}
            className="size-5"
          />
        )}
        <span>
          {part.outcome === "stopped" ? (
            <>You stopped {name}</>
          ) : (
            <>
              {name} {part.outcome === "failed" ? "did not finish" : "reported back"}
            </>
          )}
        </span>
        {part.chatId === undefined ? null : (
          <Link
            to="/a/$agentId/c/$chatId"
            params={{ agentId, chatId: part.chatId }}
            className="underline underline-offset-3 hover:text-foreground"
          >
            Open its chat
          </Link>
        )}
      </div>
      {part.detail === undefined ? null : (
        <details className="mt-1">
          <summary className="cursor-default">
            {part.outcome === "failed" ? "What went wrong" : "What it reported"}
          </summary>
          <div className="mt-1.5 rounded-xl bg-surface px-3 py-2 text-foreground">
            <Markdown text={part.detail} />
          </div>
        </details>
      )}
    </div>
  )
}

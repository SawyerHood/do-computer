import type { AgentState } from "@durable-computer/client"
import type { AgentSummary, ChatSummary } from "@durable-computer/protocol"
import { ArrowSquareOutIcon, CaretLeftIcon, SlackLogoIcon, StopIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { agentKey } from "@/lib/collections"
import { cn } from "@/lib/utils"
import { StatusMark, threadWords } from "./agent-threads.tsx"
import { isAtWork } from "./subagents.tsx"

/** Where in Slack a thread is, in a word or two. */
export const slackPlace = (chat: ChatSummary) =>
  chat.slack?.direct === true
    ? "Direct message"
    : chat.slack?.channel
      ? `#${chat.slack.channel}`
      : "Slack"

/** The Slack mark where a face would be: a thread, or someone who is only known from Slack. */
export function SlackMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-[0.6rem] bg-secondary text-muted-foreground [&>svg]:size-[55%]",
        className,
      )}
    >
      <SlackLogoIcon />
    </span>
  )
}

/** The way to a thread in Slack itself, where its address is known. */
function OpenInSlack({ chat }: { chat: ChatSummary }) {
  const url = chat.slack?.url
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex shrink-0 items-center gap-1 rounded-sm text-[0.8125rem] font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40 dark:text-[oklch(0.78_0.09_195)]"
    >
      Open in Slack
      <ArrowSquareOutIcon className="size-3.5" />
    </a>
  )
}

/** The threads in Slack the agent has been spoken to in, newest first. */
export function useSlackThreads(agentId: string): ChatSummary[] {
  const { data } = useQuery<AgentState>({
    queryKey: agentKey(agentId),
    queryFn: () => client.agent(agentId).state(),
  })
  return useMemo(
    () =>
      (data?.chats ?? [])
        .filter((chat) => chat.kind === "slack" && !chat.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [data],
  )
}

/** Threads from Slack as a list: each opens to be read. */
export function SlackRows({
  agentId,
  threads,
  current,
}: {
  agentId: string
  threads: ChatSummary[]
  /** The thread that is open, if one is. */
  current?: string | undefined
}) {
  return (
    <ul aria-label="From Slack" className="flex flex-col gap-0.5">
      {threads.map((thread) => (
        <li key={thread.id}>
          <Link
            to="/a/$agentId/c/$chatId"
            params={{ agentId, chatId: thread.id }}
            aria-current={thread.id === current ? "page" : undefined}
            className={cn(
              "flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-1.5 outline-none hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/40",
              thread.id === current && "bg-surface",
            )}
          >
            <SlackMark />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{thread.title}</span>
              <span
                className={cn(
                  "block truncate text-xs text-muted-foreground",
                  thread.status === "waiting" && "text-foreground",
                )}
              >
                {slackPlace(thread)} · {threadWords(thread.status).toLowerCase()}
              </span>
            </span>
            <StatusMark status={thread.status} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * The line under the agent's strip while a thread from Slack has the middle: where the thread
 * is, how it is getting on, and the ways back to the main chat and out to Slack.
 */
export function SlackBar({
  agent,
  chat,
  main,
  onStop,
}: {
  agent: AgentSummary
  chat: ChatSummary
  main: ChatSummary | undefined
  onStop: () => void
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-rail/30 pr-3 pl-1.5 text-sm">
      {main === undefined ? null : (
        <Link
          to="/a/$agentId/c/$chatId"
          params={{ agentId: agent.id, chatId: main.id }}
          className="flex h-7 shrink-0 items-center gap-1 rounded-lg pr-2.5 pl-1.5 text-[0.8125rem] font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <CaretLeftIcon className="size-3.5" />
          Main chat
        </Link>
      )}
      <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
        <SlackLogoIcon className="size-3.5" />
        <span className="max-sm:hidden">{slackPlace(chat)}</span>
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{chat.title}</span>
      <span
        className={cn(
          "shrink-0 text-xs text-muted-foreground max-sm:hidden",
          chat.status === "waiting" && "text-foreground",
        )}
      >
        {threadWords(chat.status)}
      </span>
      {isAtWork(chat.status) ? (
        <Button
          variant="outline"
          size="xs"
          className="font-normal text-muted-foreground hover:text-destructive"
          onClick={onStop}
        >
          <StopIcon />
          Stop
        </Button>
      ) : null}
      <OpenInSlack chat={chat} />
    </div>
  )
}

/** Where the message box would be. A thread from Slack is written in there, and read here. */
export function SlackFoot({ chat }: { chat: ChatSummary }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-1 pb-5">
      <div className="flex items-center gap-2.5 rounded-2xl border border-dashed border-input px-4 py-3 text-sm text-muted-foreground">
        <SlackLogoIcon className="size-4 shrink-0" />
        <p className="min-w-0 flex-1">This conversation is in Slack. Reply there to carry it on.</p>
        <OpenInSlack chat={chat} />
      </div>
    </div>
  )
}

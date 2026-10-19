import type { AgentState } from "@do-computer/client"
import type { AgentSummary, ChatSummary } from "@do-computer/protocol"
import { ArrowSquareOutIcon, SlackLogoIcon, StopIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import { useMemo } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { stripEndAtom, stripStartAtom } from "@/lib/atoms"
import { client } from "@/lib/client"
import { agentKey } from "@/lib/collections"
import { cn } from "@/lib/utils"
import { StatusMark, threadWords } from "./agent-threads.tsx"
import { FLOATS, MainChatLink } from "./old-side-chat.tsx"
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
function OpenInSlack({ chat, short = false }: { chat: ChatSummary; short?: boolean }) {
  const url = chat.slack?.url
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      // Where it floats with little room, the arrow alone is shown, and the words are its name.
      aria-label="Open in Slack"
      title="Open in Slack"
      className="flex shrink-0 items-center gap-1 rounded-sm text-[0.8125rem] font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40 dark:text-[oklch(0.78_0.09_195)]"
    >
      <span className={cn(short && "max-md:hidden")}>Open in Slack</span>
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
 * What a thread from Slack that has the middle floats in the row the agent's name is in: the
 * way back to the main chat at the start, and at the end where the thread is, how it is getting
 * on, and the way out to Slack. Which thread it is, the name itself says.
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
  const start = useAtomValue(stripStartAtom)
  const end = useAtomValue(stripEndAtom)
  if (start === null || end === null) return null
  return (
    <>
      {main === undefined
        ? null
        : createPortal(<MainChatLink agentId={agent.id} mainId={main.id} />, start)}
      {createPortal(
        <div
          data-floats=""
          data-no-drag=""
          className={cn(
            "flex h-8 min-w-0 items-center gap-2 rounded-full pr-3 pl-2.5 text-sm",
            FLOATS,
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <SlackLogoIcon className="size-3.5 shrink-0" />
            <span className="truncate max-lg:hidden">{slackPlace(chat)}</span>
          </span>
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
          <OpenInSlack chat={chat} short />
        </div>,
        end,
      )}
    </>
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

import {
  chatActivity,
  type ChatMessage,
  type ChatState,
  describeChatError,
  foldFailures,
  isAgentMessage,
  isSentFile,
  isSiteShare,
  isVisual,
  sharedSite,
  chatUses,
  isJobStart,
  isUse,
  isShownPart,
  isSubagentStart,
  continuesMain,
  isVisibleMessage,
  type MessagePart,
} from "@durable-computer/protocol"
import {
  ArrowClockwiseIcon,
  ArrowsClockwiseIcon,
  CaretRightIcon,
  ClockIcon,
  DesktopIcon,
  KeyIcon,
  PlugsConnectedIcon,
  SlackLogoIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { useContext, useEffect, useMemo, useState } from "react"
import { useAgentsById } from "@/components/computer-requests"
import { PersonFace } from "@/components/people"
import { Badge } from "@/components/ui/badge"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Message, MessageContent } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller"
import { useSettings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { TeamContext } from "@/lib/workspaces"
import { Markdown } from "./markdown.tsx"

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
import { AgentMessageChip, AgentWord, PeerFace } from "./agent-threads.tsx"
import { SentFile } from "./sent-file.tsx"
import { SiteCard } from "./site-card.tsx"
import { VisualFrame } from "./visual.tsx"
import { SlackMark } from "./slack-threads.tsx"
import { CommandChip, CommandWord } from "./commands.tsx"
import { SubagentChip, SubagentWord } from "./subagents.tsx"
import { UsesContext, UseView } from "./uses.tsx"

function AssistantPart({ part }: { part: MessagePart }) {
  if (isSentFile(part)) return <SentFile part={part} />
  if (isVisual(part)) return <VisualFrame part={part} />
  if (isSiteShare(part)) return <SiteCard part={part} />
  if (isSubagentStart(part)) return <SubagentChip part={part} />
  if (isJobStart(part)) return <CommandChip part={part} />
  if (isUse(part)) return <UseView part={part} />
  if (isAgentMessage(part)) return <AgentMessageChip part={part} />
  switch (part.type) {
    case "text":
      return (
        // What the agent says is the page's own text, with nothing drawn around it.
        <Bubble variant="ghost">
          <BubbleContent className="px-1!">
            <Markdown text={part.text} />
          </BubbleContent>
        </Bubble>
      )
    case "notice":
      // Heads the report of a scheduled task.
      return (
        <Marker className="px-1">
          <MarkerIcon>
            <ClockIcon />
          </MarkerIcon>
          <MarkerContent>Scheduled: {part.text}</MarkerContent>
        </Marker>
      )
    default:
      return null
  }
}

/**
 * A reply that failed, as one plain sentence. What the provider answered is kept behind
 * "Details", for whoever wants it.
 */
function ReplyError({
  error,
  failures,
  onRetry,
}: {
  error: string | undefined
  /** How many times in a row it failed. */
  failures: number
  onRetry?: (() => void) | undefined
}) {
  const view = describeChatError(error)
  const { openAgent, openWorkspace } = useSettings()
  const [open, setOpen] = useState(false)
  const hint = [failures > 1 ? `Tried ${failures} times.` : undefined, view.hint]
    .filter((text) => text !== undefined)
    .join(" ")
  const hasDetails = view.detail !== undefined || view.facts.length > 0
  return (
    <div role="alert" className="flex gap-2 px-1 text-sm">
      <WarningCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{view.title}</div>
        {hint === "" ? null : <div className="text-muted-foreground">{hint}</div>}
        <Collapsible open={open} onOpenChange={setOpen}>
          {(onRetry !== undefined && view.retryable) || hasDetails || view.kind === "signIn" ? (
            <div className="mt-2 -ml-0.5 flex items-center gap-1.5">
              {/* The two ways out of a sign-in that is gone, each a click away. */}
              {view.kind === "signIn" ? (
                <>
                  <Button variant="outline" size="xs" onClick={() => openWorkspace("models")}>
                    Sign in again
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => openAgent("model")}>
                    Pick another model
                  </Button>
                </>
              ) : null}
              {onRetry !== undefined && view.retryable ? (
                <Button variant="outline" size="xs" onClick={onRetry}>
                  <ArrowClockwiseIcon data-icon="inline-start" />
                  Try again
                </Button>
              ) : null}
              {hasDetails ? (
                <CollapsibleTrigger
                  render={<Button variant="ghost" size="xs" className="text-muted-foreground" />}
                >
                  <CaretRightIcon
                    data-icon="inline-start"
                    className={cn("transition-transform", open && "rotate-90")}
                  />
                  Details
                </CollapsibleTrigger>
              ) : null}
            </div>
          ) : null}
          <CollapsibleContent>
            {view.facts.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {view.facts.map((fact) => (
                  <Badge
                    key={fact}
                    variant="secondary"
                    className="h-auto rounded-sm bg-muted px-1.5 py-0 font-mono text-[0.6875rem] font-normal text-muted-foreground"
                  >
                    {fact}
                  </Badge>
                ))}
              </div>
            ) : null}
            {view.detail === undefined ? null : (
              <pre className="mt-2 max-h-56 overflow-auto rounded-lg border bg-surface px-3 py-2.5 font-mono text-xs wrap-anywhere whitespace-pre-wrap text-muted-foreground">
                {view.detail}
              </pre>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  )
}

/** A message another agent sent, in its conversation with this one: its face, its name, its words. */
function FromAgent({
  message,
  sender,
}: {
  message: ChatMessage
  sender: { id: string; name: string }
}) {
  const agents = useAgentsById()
  const agent = agents.get(sender.id)
  return (
    <Message align="end">
      <PeerFace agent={agent} agentId={sender.id} className="size-7 self-end" />
      <MessageContent>
        <span className="-mb-1 flex gap-1.5 self-end pr-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{agent?.name ?? sender.name}</span>
          {message.createdAt === undefined ? null : clock.format(message.createdAt)}
        </span>
        {message.parts.map((part, index) =>
          part.type === "text" ? (
            <Bubble key={index} align="end" variant="secondary">
              <BubbleContent className="whitespace-pre-wrap text-[0.9375rem]">
                {part.text}
              </BubbleContent>
            </Bubble>
          ) : null,
        )}
      </MessageContent>
    </Message>
  )
}

/**
 * A message someone wrote in Slack, in the thread's conversation here: who wrote it and that it
 * came from there. Someone whose address in Slack is an account's here has their face. Anyone
 * else is known only from Slack, and the Slack mark stands where a face would be. Nothing else
 * differs between them.
 */
function FromSlack({
  message,
  sender,
}: {
  message: ChatMessage
  sender: { id: string; name: string }
}) {
  const team = useContext(TeamContext)
  const person =
    message.author === undefined
      ? undefined
      : (team?.people.get(message.author.id) ?? { ...message.author, image: null })
  return (
    <Message align="end">
      {person === undefined ? (
        <SlackMark className="size-7 self-end rounded-full" />
      ) : (
        <PersonFace person={person} className="size-7 self-end" />
      )}
      <MessageContent>
        <span className="-mb-1 flex items-center gap-1.5 self-end pr-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{sender.name}</span>
          {message.createdAt === undefined ? null : clock.format(message.createdAt)}
          <span className="flex items-center gap-1">
            <SlackLogoIcon className="size-3" />
            in Slack
          </span>
        </span>
        {message.parts.map((part, index) =>
          part.type === "text" ? (
            <Bubble key={index} align="end" variant="secondary">
              <BubbleContent className="whitespace-pre-wrap text-[0.9375rem]">
                {part.text}
              </BubbleContent>
            </Bubble>
          ) : part.type === "image" ? (
            <img
              key={index}
              src={`data:${part.mimeType};base64,${part.data}`}
              alt="Attached"
              className="max-h-64 self-end rounded-2xl"
            />
          ) : null,
        )}
      </MessageContent>
    </Message>
  )
}

function MessageView({
  message,
  failures,
  onRetry,
  asker,
}: {
  message: ChatMessage
  failures: number
  onRetry?: (() => void) | undefined
  asker?: string | undefined
}) {
  const team = useContext(TeamContext)
  if (message.role === "notice") {
    const part = message.parts[0]
    if (part?.type === "notice" && part.kind === "subagent") return <SubagentWord part={part} />
    if (part?.type === "notice" && part.kind === "agent") return <AgentWord part={part} />
    if (part?.type === "notice" && part.kind === "command") return <CommandWord part={part} />
    if (part?.type === "notice" && part.kind === "computer") {
      // The answer to the agent's asking to use a computer.
      return (
        <div className="flex items-center gap-2 border-l-2 py-0.5 pl-3 text-sm text-muted-foreground">
          <DesktopIcon className="size-4 shrink-0" />
          <span>
            {part.by ?? "Someone"} {part.approved ? "said yes to" : "said no to"} using{" "}
            <span className="font-mono font-medium text-foreground">{part.text}</span>
          </span>
        </div>
      )
    }
    if (part?.type === "notice" && part.kind === "secret") {
      // The answer to the agent's asking for secrets: which, and where they went. Never what.
      return (
        <div className="flex items-center gap-2 border-l-2 py-0.5 pl-3 text-sm text-muted-foreground">
          <KeyIcon className="size-4 shrink-0" />
          <span className="min-w-0 wrap-anywhere">
            {part.by ?? "Someone"} {part.approved ? "gave" : "chose not to give"}{" "}
            <span className="font-mono font-medium text-foreground">{part.detail}</span>
            {part.approved && part.text !== "" ? (
              <>
                , saved to <span className="font-mono">{part.text}</span>
              </>
            ) : null}
            {part.approved ? null : part.text === "" ? null : (
              <>
                {" "}
                for <span className="font-mono">{part.text}</span>
              </>
            )}
          </span>
        </div>
      )
    }
    if (part?.type === "notice" && part.kind === "connector") {
      // How a sign-in to a connector the agent asked for went.
      return (
        <div className="flex items-center gap-2 border-l-2 py-0.5 pl-3 text-sm text-muted-foreground">
          <PlugsConnectedIcon className="size-4 shrink-0" />
          <span className="min-w-0 wrap-anywhere">
            {part.by ?? "Someone"} {part.approved ? "connected" : "did not connect"}{" "}
            <span className="font-medium text-foreground">{part.text}</span>
            {part.detail ? `: ${part.detail}` : null}
          </span>
        </div>
      )
    }
    return (
      <Marker variant="separator">
        <MarkerIcon>
          <ArrowsClockwiseIcon />
        </MarkerIcon>
        <MarkerContent>
          {part?.type === "notice" && part.kind === "compaction"
            ? "Earlier messages were summarized"
            : part?.type === "notice" && part.kind === "branch"
              ? "Continues from the main chat"
              : "New context"}
        </MarkerContent>
      </Marker>
    )
  }
  if (message.role === "user" && message.agent !== undefined) {
    return <FromAgent message={message} sender={message.agent} />
  }
  if (message.role === "user" && message.slack !== undefined) {
    return <FromSlack message={message} sender={message.slack} />
  }
  if (message.role === "user" && asker !== undefined) {
    // In a sub-agent's chat this side is its agent's: what it was asked to do. The exception is
    // the user's answer to something it asked leave for.
    const text = message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
    const answered = /^(Approved|Not allowed): /.test(text)
    // In a team, anyone may have answered.
    const answerer =
      team !== undefined && message.author !== undefined && message.author.id !== team.meId
        ? message.author.name.split(" ")[0]
        : "You"
    return (
      <Message align="end">
        <MessageContent>
          <Bubble align="end" variant="secondary">
            <BubbleContent className="border-border whitespace-pre-wrap text-[0.9375rem]">
              <span className="mb-0.5 block text-xs text-muted-foreground">
                {answered ? `${answerer} answered` : `${asker} asked`}
              </span>
              {text}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  }
  if (message.role === "user") {
    // In a team, someone else's message is theirs to the eye: their face, their name, and not
    // the color of one's own.
    const other =
      team !== undefined && message.author !== undefined && message.author.id !== team.meId
        ? (team.people.get(message.author.id) ?? { ...message.author, image: null })
        : undefined
    return (
      <Message align="end">
        {other === undefined ? null : <PersonFace person={other} className="size-7 self-end" />}
        <MessageContent>
          {other === undefined ? null : (
            <span className="-mb-1 flex gap-1.5 self-end pr-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{other.name}</span>
              {message.createdAt === undefined ? null : clock.format(message.createdAt)}
            </span>
          )}
          {message.parts.map((part, index) =>
            part.type === "text" ? (
              <Bubble
                key={index}
                align="end"
                variant={other === undefined ? "tinted" : "secondary"}
              >
                <BubbleContent className="rounded-[1.125rem] px-4 py-2 text-base leading-[1.55] whitespace-pre-wrap">
                  {part.text}
                </BubbleContent>
              </Bubble>
            ) : part.type === "image" ? (
              <img
                key={index}
                src={`data:${part.mimeType};base64,${part.data}`}
                alt="Attached"
                className="max-h-64 self-end rounded-2xl"
              />
            ) : null,
          )}
        </MessageContent>
      </Message>
    )
  }
  return (
    <Message>
      <MessageContent>
        {message.parts
          .filter(isShownPart)
          // A site shared and then opened up in one answer is one card, which says how it stands.
          .filter(
            (part, index, shown) =>
              !isSiteShare(part) ||
              !shown
                .slice(0, index)
                .some(
                  (earlier) =>
                    isSiteShare(earlier) && sharedSite(earlier).id === sharedSite(part).id,
                ),
          )
          .map((part, index) => (
            <AssistantPart key={part.type === "tool" ? part.toolCallId : index} part={part} />
          ))}
        {message.status === "error" ? (
          <ReplyError error={message.error} failures={failures} onRetry={onRetry} />
        ) : null}
        {message.status === "aborted" ? (
          <Marker className="px-1">
            <MarkerContent>Stopped</MarkerContent>
          </Marker>
        ) : null}
      </MessageContent>
    </Message>
  )
}

/** Brings the end into view when the user sends something, wherever they had scrolled to. */
function FollowSends({ lastSent }: { lastSent: string | undefined }) {
  const { scrollToEnd } = useMessageScroller()
  useEffect(() => {
    if (lastSent !== undefined) scrollToEnd({ behavior: "smooth" })
  }, [lastSent, scrollToEnd])
  return null
}

/**
 * The message list. It rests at the newest message and follows it as it grows, the way a chat
 * does, unless the reader has scrolled up to look at something.
 */
export function Transcript({
  state,
  empty,
  before,
  onRetry,
  asker,
  chatId,
}: {
  state: ChatState
  /** The chat's id, for stopping the agent from the window of a screen it is using. */
  chatId?: string | undefined
  empty: React.ReactNode
  /** Shown above the first message, for reaching what came before it. */
  before?: React.ReactNode
  /** Have another go at a reply that failed. Offered on the last message, while nothing is running. */
  onRetry?: (() => void) | undefined
  /** In a sub-agent's chat: the agent that gave it its task, by name. */
  asker?: string | undefined
}) {
  // What the agent is doing, when its answer is not already being written on screen.
  const activity = chatActivity(state)
  const lastSent = state.messages.findLast((message) => message.role === "user")?.id
  // A side chat that continues the main one opens with the mark of where its own messages
  // begin. Until something is said in it, it is as empty as any new chat, and greets like one.
  const untouched = state.messages.length === (continuesMain(state.messages) ? 1 : 0)
  // The steps an agent takes on a screen are shown as one thing, where the first of them is.
  const uses = useMemo(() => {
    const all = chatUses(state)
    return { chatId, all, uses: new Map(all.map((use) => [use.id, use])) }
  }, [state, chatId])
  // A message whose every shown part is a later step of a use shows nothing, and leaves no gap.
  const shows = (message: ChatMessage) =>
    isVisibleMessage(message) &&
    (message.role !== "assistant" ||
      message.status === "error" ||
      message.status === "aborted" ||
      message.parts.some(
        (part) => isShownPart(part) && (!isUse(part) || uses.uses.has(part.toolCallId)),
      ))
  const shown = foldFailures((untouched ? [] : state.messages).filter(shows), state.busy)
  // While a step is under way, the window of the screen says what it is.
  const stepping = uses.all.some((use) => {
    const status = use.steps.at(-1)?.status
    return status === "pending" || status === "running"
  })
  return (
    <UsesContext value={uses}>
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <FollowSends lastSent={lastSent} />
        <MessageScroller>
          <MessageScrollerViewport>
            {/* A short chat sits at the bottom, next to the box the next message is typed in. */}
            <MessageScrollerContent className="mx-auto w-full max-w-[45rem] justify-end gap-6 px-4 pt-24 pb-6">
              {untouched && !state.busy ? empty : null}
              {before}
              {shown.map(({ message, failures }, index) => (
                <MessageScrollerItem key={message.id} messageId={message.id}>
                  <MessageView
                    message={message}
                    failures={failures}
                    onRetry={index === shown.length - 1 && !state.busy ? onRetry : undefined}
                    asker={asker}
                  />
                </MessageScrollerItem>
              ))}
              {activity === null || stepping ? null : (
                // The moving shine says it is working; a spinner beside it would say it twice.
                <Marker role="status" aria-live="polite" className="px-1">
                  <MarkerContent className="animate-shine truncate">{activity}…</MarkerContent>
                </Marker>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </UsesContext>
  )
}

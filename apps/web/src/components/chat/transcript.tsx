import {
  chatActivity,
  type ChatMessage,
  type ChatState,
  describeChatError,
  foldFailures,
  isSentFile,
  isShownPart,
  isVisibleMessage,
  type MessagePart,
} from "@durable-computer/protocol"
import {
  ArrowClockwiseIcon,
  ArrowsClockwiseIcon,
  CaretRightIcon,
  ClockIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
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
import { cn } from "@/lib/utils"
import { Markdown } from "./markdown.tsx"
import { SentFile } from "./sent-file.tsx"

function AssistantPart({ part }: { part: MessagePart }) {
  if (isSentFile(part)) return <SentFile part={part} />
  switch (part.type) {
    case "text":
      return (
        <Bubble variant="secondary">
          <BubbleContent>
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
        {(onRetry !== undefined && view.retryable) || hasDetails ? (
          <div className="mt-2 -ml-0.5 flex items-center gap-1.5">
            {onRetry !== undefined && view.retryable ? (
              <Button variant="outline" size="xs" onClick={onRetry}>
                <ArrowClockwiseIcon data-icon="inline-start" />
                Try again
              </Button>
            ) : null}
            {hasDetails ? (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              >
                <CaretRightIcon
                  data-icon="inline-start"
                  className={cn("transition-transform", open && "rotate-90")}
                />
                Details
              </Button>
            ) : null}
          </div>
        ) : null}
        {open ? (
          <>
            {view.facts.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {view.facts.map((fact) => (
                  <span
                    key={fact}
                    className="rounded-sm bg-muted px-1.5 font-mono text-[0.6875rem] text-muted-foreground"
                  >
                    {fact}
                  </span>
                ))}
              </div>
            ) : null}
            {view.detail === undefined ? null : (
              <pre className="mt-2 max-h-56 overflow-auto rounded-lg border bg-surface px-3 py-2.5 font-mono text-xs wrap-anywhere whitespace-pre-wrap text-muted-foreground">
                {view.detail}
              </pre>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}

function MessageView({
  message,
  failures,
  onRetry,
}: {
  message: ChatMessage
  failures: number
  onRetry?: (() => void) | undefined
}) {
  if (message.role === "notice") {
    const part = message.parts[0]
    return (
      <Marker variant="separator">
        <MarkerIcon>
          <ArrowsClockwiseIcon />
        </MarkerIcon>
        <MarkerContent>
          {part?.type === "notice" && part.kind === "compaction"
            ? "Earlier messages were summarized"
            : "New context"}
        </MarkerContent>
      </Marker>
    )
  }
  if (message.role === "user") {
    return (
      <Message align="end">
        <MessageContent>
          {message.parts.map((part, index) =>
            part.type === "text" ? (
              <Bubble key={index} align="end">
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
  return (
    <Message>
      <MessageContent>
        {message.parts.filter(isShownPart).map((part, index) => (
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
}: {
  state: ChatState
  empty: React.ReactNode
  /** Shown above the first message, for reaching what came before it. */
  before?: React.ReactNode
  /** Have another go at a reply that failed. Offered on the last message, while nothing is running. */
  onRetry?: () => void
}) {
  // What the agent is doing, when its answer is not already being written on screen.
  const activity = chatActivity(state)
  const lastSent = state.messages.findLast((message) => message.role === "user")?.id
  const shown = foldFailures(state.messages.filter(isVisibleMessage))
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <FollowSends lastSent={lastSent} />
      <MessageScroller>
        <MessageScrollerViewport>
          {/* A short chat sits at the bottom, next to the box the next message is typed in. */}
          <MessageScrollerContent className="mx-auto w-full max-w-3xl justify-end gap-5 px-4 pt-24 pb-6">
            {state.messages.length === 0 && !state.busy ? empty : null}
            {before}
            {shown.map(({ message, failures }, index) => (
              <MessageScrollerItem key={message.id} messageId={message.id}>
                <MessageView
                  message={message}
                  failures={failures}
                  onRetry={index === shown.length - 1 && !state.busy ? onRetry : undefined}
                />
              </MessageScrollerItem>
            ))}
            {activity === null ? null : (
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
  )
}

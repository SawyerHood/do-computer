import {
  chatActivity,
  type ChatMessage,
  type ChatState,
  isSentFile,
  isShownPart,
  isVisibleMessage,
  type MessagePart,
} from "@durable-computer/protocol"
import { ArrowsClockwiseIcon, ClockIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { useEffect } from "react"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
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

function MessageView({ message }: { message: ChatMessage }) {
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
          <Marker className="px-1 text-destructive">
            <MarkerIcon>
              <WarningCircleIcon />
            </MarkerIcon>
            <MarkerContent>
              {message.error ?? "Something went wrong generating this reply."}
            </MarkerContent>
          </Marker>
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
}: {
  state: ChatState
  empty: React.ReactNode
  /** Shown above the first message, for reaching what came before it. */
  before?: React.ReactNode
}) {
  // What the agent is doing, when its answer is not already being written on screen.
  const activity = chatActivity(state)
  const lastSent = state.messages.findLast((message) => message.role === "user")?.id
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <FollowSends lastSent={lastSent} />
      <MessageScroller>
        <MessageScrollerViewport>
          {/* A short chat sits at the bottom, next to the box the next message is typed in. */}
          <MessageScrollerContent className="mx-auto w-full max-w-3xl justify-end gap-5 px-4 pt-24 pb-6">
            {state.messages.length === 0 && !state.busy ? empty : null}
            {before}
            {state.messages.filter(isVisibleMessage).map((message) => (
              <MessageScrollerItem key={message.id} messageId={message.id}>
                <MessageView message={message} />
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

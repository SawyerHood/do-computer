import type { ChatMessage, ChatState, MessagePart } from "@durable-computer/protocol"
import {
  ArrowsClockwiseIcon,
  ClockIcon,
  LightbulbIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { useState } from "react"
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
} from "@/components/ui/message-scroller"
import { cn } from "@/lib/utils"
import { Markdown } from "./markdown.tsx"
import { ToolRow } from "./tool-row.tsx"

function Thinking({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-1.5 px-1">
      <Marker
        render={<button type="button" onClick={() => setOpen((value) => !value)} />}
        className="w-fit rounded-md hover:text-foreground"
        aria-expanded={open}
      >
        <MarkerIcon>
          <LightbulbIcon />
        </MarkerIcon>
        <MarkerContent className={cn(live && "animate-shine")}>
          {live ? "Thinking" : "Thought for a moment"}
        </MarkerContent>
      </Marker>
      {open ? (
        <p className="ml-6 whitespace-pre-wrap border-l pl-3 text-sm text-muted-foreground">
          {text}
        </p>
      ) : null}
    </div>
  )
}

function AssistantPart({ part, live }: { part: MessagePart; live: boolean }) {
  switch (part.type) {
    case "text":
      return (
        <Bubble variant="secondary">
          <BubbleContent>
            <Markdown text={part.text} />
          </BubbleContent>
        </Bubble>
      )
    case "thinking":
      return <Thinking text={part.text} live={live} />
    case "tool":
      return <ToolRow part={part} />
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
  const live = message.status === "streaming"
  return (
    <Message>
      <MessageContent>
        {message.parts.map((part, index) => (
          <AssistantPart
            key={part.type === "tool" ? part.toolCallId : index}
            part={part}
            live={live && index === message.parts.length - 1}
          />
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

/** The message list. Follows the newest message while the reader is at the end. */
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
  const last = state.messages.at(-1)
  // The agent is working but has not produced anything visible for this turn yet.
  const waiting = state.busy && (last === undefined || last.role === "user")
  // Sending pins the new message near the top, leaving the space below it for the reply.
  const anchor = state.messages.findLast((message) => message.role === "user")?.id
  return (
    <MessageScrollerProvider>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-5 px-4 pt-20 pb-6">
            {state.messages.length === 0 && !state.busy ? empty : null}
            {before}
            {state.messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.id === anchor}
              >
                <MessageView message={message} />
              </MessageScrollerItem>
            ))}
            {waiting ? (
              <Marker className="px-1">
                <MarkerContent className="animate-shine">Thinking</MarkerContent>
              </Marker>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

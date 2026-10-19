import {
  chatActivity,
  type ChatMessage,
  type ChatState,
  describeChatError,
  foldFailures,
  isAgentMessage,
  isMcpApp,
  isSentFile,
  isPinning,
  isSiteShare,
  isVisual,
  sharedSite,
  chatUses,
  isJobStart,
  isUse,
  isShownPart,
  isSubagentStart,
  continuesMain,
  type MessagePart,
  sentWords,
} from "@do-computer/protocol"
import {
  ArrowClockwiseIcon,
  ArrowsClockwiseIcon,
  CaretRightIcon,
  ClockIcon,
  DesktopIcon,
  KeyIcon,
  MicrophoneIcon,
  PaperclipIcon,
  PlugsConnectedIcon,
  ShieldCheckIcon,
  SlackLogoIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { type ReactNode, useContext, useEffect, useMemo, useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { CallInChat, CallRecord } from "@/components/call/call"
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
import { chatKey } from "@/lib/atoms"
import { keptLine } from "@/lib/passwords"
import { useSettings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { TeamContext, useListedAgent } from "@/lib/workspaces"
import { Markdown } from "./markdown.tsx"
import { McpAppFrame } from "./mcp-app.tsx"

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
import { AgentMessageChip, AgentWord, PeerFace } from "./agent-threads.tsx"
import { BusEvent } from "./bus-events.tsx"
import { AgentIdContext, DraftKeyContext, SentFile } from "./sent-file.tsx"
import { KeptLine } from "./sign-in.tsx"
import { PinCard } from "./pin-card.tsx"
import { SiteCard } from "./site-card.tsx"
import { VisualFrame } from "./visual.tsx"
import { SlackMark } from "./slack-threads.tsx"
import { CommandChip, CommandWord } from "./commands.tsx"
import { SubagentChip, SubagentWord } from "./subagents.tsx"
import { UsesContext, UseView } from "./uses.tsx"

/**
 * Whether a part of a message is shown here. A sign-in with a saved login is, and a payment
 * with a saved card: the tool calls a chat keeps a line of, once they carry where and with what.
 */
const isShown = (part: MessagePart) => isShownPart(part) || keptLine(part) !== undefined

function AssistantPart({ part, writing }: { part: MessagePart; writing: boolean }) {
  if (part.type === "tool" && keptLine(part) !== undefined) return <KeptLine part={part} />
  if (isMcpApp(part)) return <McpAppFrame part={part} />
  if (isSentFile(part)) return <SentFile part={part} />
  if (isVisual(part)) return <VisualFrame part={part} />
  if (isSiteShare(part)) return <SiteCard part={part} />
  if (isPinning(part)) return <PinCard part={part} />
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
            <Markdown text={part.text} writing={writing} />
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
  const { open: openSettings } = useSettings()
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
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => openSettings({ at: "workspace", section: "models" })}
                  >
                    Sign in again
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => openSettings({ at: "agent", section: "model" })}
                  >
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

const hasPictures = (message: ChatMessage) => message.parts.some((part) => part.type === "image")

/**
 * The words of a message someone sent, without the line that names its files for the agent.
 * The pictures are shown as themselves; any other file it named is shown by its name, under it.
 */
function SentText({
  text,
  pictures,
  children,
}: {
  text: string
  pictures: boolean
  children: (text: string) => ReactNode
}) {
  const shown = sentWords(text, pictures)
  return (
    <>
      {shown.text === "" ? null : children(shown.text)}
      {shown.files.length === 0 ? null : (
        <ul aria-label="Sent files" className="flex flex-wrap justify-end gap-1.5 self-end">
          {shown.files.map((name, index) => (
            <li
              key={index}
              className="flex max-w-64 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
            >
              <PaperclipIcon className="size-3.5 shrink-0" />
              <span className="truncate">{name}</span>
            </li>
          ))}
        </ul>
      )}
    </>
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
            <SentText key={index} text={part.text} pictures={hasPictures(message)}>
              {(text) => (
                <Bubble align="end" variant="secondary">
                  <BubbleContent className="whitespace-pre-wrap text-[0.9375rem]">
                    {text}
                  </BubbleContent>
                </Bubble>
              )}
            </SentText>
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

/** How long the word that a message was delivered stays before it leaves. */
const DELIVERED_STAYS_MS = 3000

/** How long after a message stopped being on its way the chat's copy of it is still taken for it. */
const JUST_SENT_MS = 3000

/**
 * Whether a message of one's own has reached the agent, said the way a message app says it:
 * "Sending" with a turning ring while it is on its way, which becomes "Delivered" with a check
 * once the agent has it, and leaves a few seconds later. It is in the space under the message
 * and takes none of its own, so nothing moves when it comes or goes.
 *
 * The chat's copy of a message is a new message here, so the one that is delivered is not the
 * one that was sending: it starts as that one looked, and changes from there.
 */
function Delivery({ delivered }: { delivered: boolean }) {
  const [phase, setPhase] = useState<"sending" | "delivered" | "leaving" | "gone">("sending")
  useEffect(() => {
    if (!delivered) return setPhase("sending")
    const arrive = setTimeout(() => setPhase("delivered"), 30)
    const leave = setTimeout(() => setPhase("leaving"), DELIVERED_STAYS_MS)
    const go = setTimeout(() => setPhase("gone"), DELIVERED_STAYS_MS + 400)
    return () => {
      clearTimeout(arrive)
      clearTimeout(leave)
      clearTimeout(go)
    }
  }, [delivered])
  if (phase === "gone") return null
  return (
    <span
      role="img"
      aria-label={delivered ? "Delivered" : "Sending"}
      title={delivered ? undefined : "Sent. It is read after the step under way."}
      data-delivery={delivered ? "delivered" : "sent"}
      data-phase={phase}
      className="delivery absolute top-full right-1 flex h-7 items-center gap-1.5 text-xs leading-none text-muted-foreground"
    >
      <span className="delivery-words grid justify-items-end">
        <span className="delivery-sending">Sending</span>
        <span className="delivery-delivered">Delivered</span>
      </span>
      <span className="relative size-3.5 shrink-0">
        <svg className="delivery-ring absolute inset-0 size-3.5" viewBox="0 0 14 14" fill="none">
          <circle
            cx="7"
            cy="7"
            r="5.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeDasharray="2.6 2.2"
            strokeLinecap="round"
          />
        </svg>
        <svg className="delivery-check absolute inset-0 size-3.5" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6.5" fill="currentColor" />
          <path
            className="delivery-tick"
            d="M4.2 7.2 6.2 9.1 9.9 5.2"
            stroke="var(--background)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </span>
  )
}

function MessageView({
  message,
  failures,
  onRetry,
  asker,
  delivery,
}: {
  message: ChatMessage
  failures: number
  onRetry?: (() => void) | undefined
  asker?: string | undefined
  /** For a message of the user's: whether the agent has it. Left out where that is not said. */
  delivery?: "sent" | "delivered" | undefined
}) {
  const team = useContext(TeamContext)
  if (message.role === "notice") {
    const part = message.parts[0]
    if (part?.type === "notice" && part.kind === "subagent") return <SubagentWord part={part} />
    if (part?.type === "notice" && part.kind === "agent") return <AgentWord part={part} />
    if (part?.type === "notice" && part.kind === "command") return <CommandWord part={part} />
    if (part?.type === "notice" && part.kind === "call") {
      return <CallRecord part={part} at={message.createdAt} />
    }
    if (part?.type === "notice" && part.kind === "computer") {
      // The answer to the agent's asking to use a computer.
      return (
        <div className="flex items-center gap-2 border-l-2 py-0.5 pl-3 text-sm text-muted-foreground">
          <DesktopIcon className="size-4 shrink-0" />
          <span>
            {part.by ?? "Someone"} {part.approved ? "said yes to" : "said no to"} using{" "}
            <span className="font-mono font-medium text-foreground">{part.text}</span>
            {part.detail ? `, ${part.detail}` : null}
          </span>
        </div>
      )
    }
    if (part?.type === "notice" && part.kind === "secret") {
      // The answer to the agent's asking for secrets: which, and where they went. Never what.
      // A login is told in words, "a login for github.com", where secrets are told by their names.
      const login = part.text === "" ? /^(a login for) (\S+)$/.exec(part.detail ?? "") : null
      return (
        <div className="flex items-center gap-2 border-l-2 py-0.5 pl-3 text-sm text-muted-foreground">
          <KeyIcon className="size-4 shrink-0" />
          <span className="min-w-0 wrap-anywhere">
            {part.by ?? "Someone"} {part.approved ? "gave" : "chose not to give"}{" "}
            {login === null ? (
              <span className="font-mono font-medium text-foreground">{part.detail}</span>
            ) : (
              <>
                {login[1]} <span className="font-medium text-foreground">{login[2]}</span>
              </>
            )}
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
    if (
      part?.type === "notice" &&
      (part.kind === "automation" || part.kind === "asked" || part.kind === "slack")
    ) {
      return <BusEvent part={part} />
    }
    if (part?.type === "notice" && part.kind === "approval") {
      // Someone's answer to what the agent asked leave for, where it was told of it as an event.
      return (
        <div className="flex items-center gap-2 border-l-2 py-0.5 pl-3 text-sm text-muted-foreground">
          <ShieldCheckIcon className="size-4 shrink-0" />
          <span className="min-w-0 wrap-anywhere">
            {part.by ?? "Someone"} {part.approved ? "allowed" : "said no to"}{" "}
            <span className="font-medium text-foreground">{part.text}</span>
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
              ? // The server says how much of the main chat it carries.
                part.text || "Continues from the main chat"
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
      // A message of one's own has a little more under it, where it says how it is getting on.
      <Message align="end" className={other === undefined ? "pb-1" : undefined}>
        {other === undefined ? null : <PersonFace person={other} className="size-7 self-end" />}
        <MessageContent className="relative">
          {other === undefined ? null : (
            <span className="-mb-1 flex gap-1.5 self-end pr-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{other.name}</span>
              {message.createdAt === undefined ? null : clock.format(message.createdAt)}
            </span>
          )}
          {message.spoken ? (
            // Said out loud, on a call, and handed on by the Dood's voice.
            <span className="-mb-1 flex items-center gap-1 self-end pr-1 text-xs text-muted-foreground">
              <MicrophoneIcon className="size-3.5" />
              Said on a call
            </span>
          ) : null}
          {message.parts.map((part, index) =>
            part.type === "text" ? (
              <SentText key={index} text={part.text} pictures={hasPictures(message)}>
                {(text) => (
                  <Bubble align="end" variant={other === undefined ? "plain" : "secondary"}>
                    <BubbleContent className="rounded-[1.125rem] px-4 py-2 text-base leading-[1.55] whitespace-pre-wrap">
                      {text}
                    </BubbleContent>
                  </Bubble>
                )}
              </SentText>
            ) : part.type === "image" ? (
              <img
                key={index}
                src={`data:${part.mimeType};base64,${part.data}`}
                alt="Attached"
                className="max-h-64 self-end rounded-2xl"
              />
            ) : null,
          )}
          {other !== undefined || delivery === undefined ? null : (
            <Delivery delivered={delivery === "delivered"} />
          )}
        </MessageContent>
      </Message>
    )
  }
  return (
    <Message>
      <MessageContent>
        {message.parts
          .filter(isShown)
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
            <AssistantPart
              key={part.type === "tool" ? part.toolCallId : index}
              part={part}
              writing={message.status === "streaming"}
            />
          ))}
        {message.notSent === undefined ? null : (
          // Its words were on screen as they were written; it says it did not go, and why.
          <div role="alert" className="flex items-start gap-1.5 px-1 text-sm text-destructive">
            <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 wrap-anywhere">Not sent: {message.notSent}</span>
          </div>
        )}
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
  undelivered,
}: {
  state: ChatState
  /**
   * The messages in it that have been sent and not yet given to the agent, by id. They are
   * marked as on their way, and one that is seen to reach it is marked as delivered for a moment.
   */
  undelivered?: ReadonlySet<string> | undefined
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
  // The end is brought into view by what has just been sent, and not again when the agent takes
  // it up: by then the reader may be looking at something else.
  const lastSent = state.messages.findLast(
    (message) => message.role === "user" && undelivered?.has(message.id) === true,
  )?.id
  // The newest message a person wrote here that the agent has.
  const newestDelivered =
    undelivered === undefined || asker !== undefined
      ? undefined
      : state.messages.findLast(
          (message) =>
            message.role === "user" &&
            message.agent === undefined &&
            message.slack === undefined &&
            !undelivered.has(message.id),
        )?.id
  // It is said to be delivered only if it was seen on its way here: a chat that is opened says
  // nothing of the messages it already had. A message that waited for the agent is gone from
  // what is being sent a moment before the chat has its own copy, so having just seen one on
  // its way counts too.
  const onTheirWay = undelivered?.size ?? 0
  const [seen, setSeen] = useState<{
    newest: string | undefined
    onTheirWay: number
    /** When the last of them stopped being on its way. */
    since: number | undefined
    arrived: string | undefined
  }>({ newest: newestDelivered, onTheirWay, since: undefined, arrived: undefined })
  if (seen.newest !== newestDelivered || seen.onTheirWay !== onTheirWay) {
    const now = Date.now()
    const watched =
      seen.onTheirWay > 0 || (seen.since !== undefined && now - seen.since < JUST_SENT_MS)
    setSeen({
      newest: newestDelivered,
      onTheirWay,
      since: seen.onTheirWay > 0 && onTheirWay === 0 ? now : seen.since,
      arrived:
        newestDelivered !== undefined && newestDelivered !== seen.newest && watched
          ? newestDelivered
          : seen.arrived,
    })
  }
  const lastDelivered = seen.arrived === newestDelivered ? newestDelivered : undefined
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
    // A send that failed says so.
    message.notSent !== undefined ||
    message.role !== "assistant" ||
    message.status === "error" ||
    message.status === "aborted" ||
    message.parts.some((part) => isShown(part) && (!isUse(part) || uses.uses.has(part.toolCallId)))
  const shown = foldFailures((untouched ? [] : state.messages).filter(shows), state.busy)
  // While a step is under way, the window of the screen says what it is.
  const stepping = uses.all.some((use) => {
    const status = use.steps.at(-1)?.status
    return status === "pending" || status === "running"
  })
  // A sign-in or a payment under way has its own line, which says more than what the agent is
  // doing would.
  const signingIn =
    state.messages
      .at(-1)
      ?.parts.some(
        (part) =>
          part.type === "tool" &&
          (part.status === "pending" || part.status === "running") &&
          keptLine(part) !== undefined,
      ) === true
  const agentId = useContext(AgentIdContext)
  // Whose work it is, beside the words for what it is doing.
  const working = useListedAgent(agentId)
  const draftKey =
    agentId === undefined || chatId === undefined ? undefined : chatKey(agentId, chatId)
  // The calls the chat already has the record of, so that one just ended is not also waited for.
  const recorded = useMemo(
    () =>
      new Set(
        state.messages.flatMap((message) =>
          message.parts.flatMap((part) =>
            part.type === "notice" && part.call !== undefined ? [part.call.id] : [],
          ),
        ),
      ),
    [state.messages],
  )
  return (
    <DraftKeyContext value={draftKey}>
      <UsesContext value={uses}>
        <MessageScrollerProvider autoScroll defaultScrollPosition="end">
          <FollowSends lastSent={lastSent} />
          <MessageScroller>
            <MessageScrollerViewport>
              {/* A short chat sits at the bottom, next to the box the next message is typed in. */}
              <MessageScrollerContent className="mx-auto w-full max-w-[45rem] justify-end gap-6 px-4 pt-[var(--chat-top,6rem)] pb-6">
                {untouched && !state.busy ? empty : null}
                {before}
                {shown.map(({ message, failures }, index) => (
                  <MessageScrollerItem key={message.id} messageId={message.id}>
                    <MessageView
                      message={message}
                      failures={failures}
                      onRetry={index === shown.length - 1 && !state.busy ? onRetry : undefined}
                      asker={asker}
                      delivery={
                        undelivered?.has(message.id) === true
                          ? "sent"
                          : message.id === lastDelivered
                            ? "delivered"
                            : undefined
                      }
                    />
                  </MessageScrollerItem>
                ))}
                {activity === null || stepping || signingIn ? null : (
                  // The moving shine says it is working; a spinner beside it would say it twice.
                  <Marker role="status" aria-live="polite" className="gap-2 px-1">
                    {working === undefined ? null : (
                      <AgentFace agent={working} className="size-5 shrink-0" still />
                    )}
                    <MarkerContent className="animate-shine truncate">{activity}…</MarkerContent>
                  </Marker>
                )}
                {agentId === undefined || chatId === undefined ? null : (
                  // A call that is on in this chat, or just over, is at the end of it.
                  <CallInChat agentId={agentId} chatId={chatId} recorded={recorded} />
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      </UsesContext>
    </DraftKeyContext>
  )
}

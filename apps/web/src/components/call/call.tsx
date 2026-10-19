import {
  type AgentSummary,
  avatarLook,
  callLength,
  type CallLine,
  type CallsState,
  type NoticePart,
} from "@do-computer/protocol"
import {
  ChatsIcon,
  CheckIcon,
  ClosedCaptioningIcon,
  MicrophoneIcon,
  MicrophoneSlashIcon,
  PhoneDisconnectIcon,
  PhoneIcon,
  WaveformIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { type CSSProperties, type ReactNode, useContext, useEffect, useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { useAgentsById } from "@/components/computer-requests"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  callAtom,
  callClock,
  callProblemAtom,
  callShownAtom,
  type CallView,
  callWordsAtom,
  callWrapUpAtom,
  endCall,
  setCallMuted,
  startCall,
} from "@/lib/call"
import { isSideChat } from "@/lib/chats"
import { client } from "@/lib/client"
import { agentQuery, callsKey } from "@/lib/collections"
import { besideWidthAtom } from "@/lib/columns"
import { cn } from "@/lib/utils"
import { AgentIdContext } from "../chat/sent-file.tsx"

/** Whether whoever is signed in can call an agent, and in which voice. Undefined until it is known. */
export function useCalls(agentId: string): CallsState | undefined {
  return useQuery({
    queryKey: callsKey(agentId),
    queryFn: () => client.agent(agentId).calls(),
    staleTime: 60_000,
  }).data
}

/** How long the call has lasted, as a clock that ticks. */
function useCallClock(startedAt: number | undefined): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt === undefined) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [startedAt])
  return callClock(startedAt, now)
}

/** What is going on, in a word or two. */
function phaseWords(call: CallView): string {
  if (call.phase === "starting") return "Waiting for your microphone"
  if (call.phase === "connecting") return "Connecting…"
  if (call.phase === "speaking") return "Talking"
  if (call.phase === "working") return "Working on it"
  return call.muted ? "You’re muted" : "Listening"
}

const clockTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })

/** The dot that says a call is live. */
function LiveDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("call-live size-2 shrink-0 rounded-full bg-emerald-500", className)}
    />
  )
}

/** Calls a Dood: the button under its name in its panel. Nothing where it cannot be called. */
export function CallButton({ agent, chatId }: { agent: AgentSummary; chatId: string }) {
  const calls = useCalls(agent.id)
  const call = useAtomValue(callAtom)
  if (calls?.available !== true) return null
  return (
    <Button
      variant="secondary"
      size="sm"
      // One call at a time: while one is on with another Dood, this one waits.
      disabled={call !== undefined}
      onClick={() => void startCall(agent, chatId)}
      className="mt-2.5 rounded-full bg-primary/12 px-4 font-medium text-primary hover:bg-primary/18 dark:text-[oklch(from_var(--agent-color)_0.8_c_h)]"
    >
      <PhoneIcon weight="fill" data-icon="inline-start" />
      Call
    </Button>
  )
}

/**
 * What a way to call a Dood needs to know, wherever it is drawn: whether it can be called at
 * all, whether a call with it is on, and whether one is on with anyone, which is one at a time.
 */
export function useCallButton(agent: AgentSummary): {
  available: boolean
  on: boolean
  busy: boolean
  start: (chatId: string) => void
} {
  const calls = useCalls(agent.id)
  const call = useAtomValue(callAtom)
  return {
    available: calls?.available === true,
    on: call?.agentId === agent.id,
    busy: call !== undefined,
    start: (chatId) => void startCall(agent, chatId),
  }
}

/**
 * The same, as the round button at the end of the message box, where sending is once there is
 * something to send. Nothing where the Dood cannot be called.
 */
export function CallComposerButton({ agent, chatId }: { agent: AgentSummary; chatId: string }) {
  const call = useCallButton(agent)
  if (!call.available || !agent.hatched) return null
  const name = agent.name ?? "your Dood"
  return (
    <Button
      type="button"
      size="icon"
      aria-label={call.on ? `On a call with ${name}` : `Call ${name}`}
      title={call.on ? "On a call" : `Call ${name}`}
      disabled={call.busy}
      onClick={() => call.start(chatId)}
      className={cn(
        "rounded-full",
        call.on && "bg-emerald-500/15 text-emerald-700 disabled:opacity-100 dark:text-emerald-300",
      )}
    >
      <WaveformIcon weight="bold" className="size-[1.125rem]" />
    </Button>
  )
}

/** A round button of a call, with what it does under it. */
function Control({
  label,
  on = false,
  hangUp = false,
  onClick,
  dark = false,
  children,
}: {
  label: string
  /** Pressed in: the microphone is muted. */
  on?: boolean
  hangUp?: boolean
  onClick: () => void
  /** On the call's own dark surface. */
  dark?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={hangUp ? undefined : on}
      className="group/control flex w-16 cursor-default flex-col items-center gap-1.5 text-[0.6875rem] text-muted-foreground outline-none"
    >
      <span
        className={cn(
          "grid size-11 place-items-center rounded-full transition-colors group-focus-visible/control:ring-3 group-focus-visible/control:ring-ring/40 [&_svg]:size-5",
          hangUp
            ? "w-15 bg-[oklch(0.6_0.2_25)] text-white group-hover/control:bg-[oklch(0.55_0.2_25)]"
            : on
              ? "bg-foreground text-background"
              : dark
                ? "bg-white/14 text-white group-hover/control:bg-white/22"
                : "bg-foreground/7 text-foreground group-hover/control:bg-foreground/12",
        )}
      >
        {children}
      </span>
      <span className={dark ? "text-white/70" : undefined}>{label}</span>
    </button>
  )
}

/**
 * The top of a Dood's panel while it is on a call: the call happens where its face is. Its
 * creature talks and listens, rings around it show who is speaking, and what is said is under it.
 */
export function CallFace({ call, face }: { call: CallView; face: ReactNode }) {
  const clock = useCallClock(call.startedAt)
  const [words, setWords] = useAtom(callWordsAtom)
  const setShown = useSetAtom(callShownAtom)
  // While the call is shown here, nothing else has to show it.
  useEffect(() => {
    setShown(true)
    return () => setShown(false)
  }, [setShown])
  const you = call.you.trim() || call.lines.findLast((line) => line.who === "you")?.text
  const dood = call.dood.trim() || call.lines.findLast((line) => line.who === "dood")?.text
  return (
    <div data-call={call.phase} className="flex w-full flex-col items-center">
      <p className="-mt-6 mb-2 flex items-center gap-2 self-start text-sm font-medium text-emerald-700 dark:text-emerald-400">
        <LiveDot />
        {call.startedAt === undefined ? "Calling" : "On a call"}
        {call.startedAt === undefined ? null : (
          <span className="font-normal text-muted-foreground tabular-nums">{clock}</span>
        )}
      </p>
      <div className="relative grid place-items-center">
        <span aria-hidden className="call-glow" />
        <span aria-hidden className="call-rings">
          <i />
          <i />
          <i />
        </span>
        <span className="relative">{face}</span>
      </div>
      <h2 className="mt-3 text-lg font-medium">{call.agentName}</h2>
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "text-sm text-muted-foreground",
          (call.phase === "speaking" || call.phase === "working") &&
            "font-medium text-primary dark:text-[oklch(from_var(--agent-color)_0.8_c_h)]",
        )}
      >
        {phaseWords(call)}
      </p>
      {words ? (
        <div className="mt-3 min-h-24 w-full rounded-xl bg-foreground/5 px-3.5 py-3 text-left text-sm leading-normal">
          <p className="mb-1 min-h-5 truncate text-[0.8125rem] text-muted-foreground">
            {you === undefined ? null : (
              <>
                <span className="font-semibold">You</span> {you}
              </>
            )}
          </p>
          <p className="line-clamp-4">
            {dood ??
              (call.startedAt === undefined ? (
                <span className="text-muted-foreground">Calling {call.agentName}…</span>
              ) : (
                <span className="text-muted-foreground">
                  Go ahead. {call.agentName} is listening.
                </span>
              ))}
          </p>
        </div>
      ) : null}
      <div className="mt-4 flex items-start justify-center gap-2">
        <Control
          label={call.muted ? "Unmute" : "Mute"}
          on={call.muted}
          onClick={() => setCallMuted(!call.muted)}
        >
          {call.muted ? <MicrophoneSlashIcon weight="fill" /> : <MicrophoneIcon />}
        </Control>
        <Control label="End" hangUp onClick={() => void endCall()}>
          <PhoneDisconnectIcon weight="fill" />
        </Control>
        <Control label={words ? "Hide words" : "Show words"} onClick={() => setWords(!words)}>
          <ClosedCaptioningIcon weight={words ? "fill" : "regular"} />
        </Control>
      </div>
    </div>
  )
}

/**
 * A call that is not being shown where its Dood is: a card in the corner of the window, on any
 * page. The call belongs to the app and not to the page it was started on.
 */
export function CallCard() {
  const call = useAtomValue(callAtom)
  const shown = useAtomValue(callShownAtom)
  const agents = useAgentsById()
  const clock = useCallClock(call?.startedAt)
  const words = useAtomValue(callWordsAtom)
  const [problem, setProblem] = useAtom(callProblemAtom)
  // A document beside the chat has that corner: the card sits to its left, so that it is not
  // over the top of it.
  const beside = useAtomValue(besideWidthAtom)
  const clear: CSSProperties = beside === 0 ? {} : { right: beside + 10 }
  if (call === undefined) {
    // A call that could not be started, or that ended by itself, says why, wherever the person is.
    if (problem === undefined) return null
    return (
      <section
        role="alert"
        aria-label="About the call"
        style={clear}
        className="fixed top-[4.25rem] right-4 z-40 flex w-72 items-start gap-3 rounded-2xl bg-card p-3.5 text-sm shadow-float"
      >
        <PhoneDisconnectIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 leading-snug wrap-anywhere">{problem.text}</p>
        <Button
          variant="outline"
          size="xs"
          className="font-normal"
          onClick={() => setProblem(undefined)}
        >
          OK
        </Button>
      </section>
    )
  }
  if (shown) return null
  const agent = agents.get(call.agentId)
  const color = agent === undefined ? undefined : avatarLook(agent.avatar, agent.id).color
  const said =
    call.dood.trim() ||
    call.lines.findLast((line) => line.who === "dood")?.text ||
    (call.startedAt === undefined ? `Calling ${call.agentName}…` : "Go ahead.")
  return (
    <section
      aria-label={`Call with ${call.agentName}`}
      data-call={call.phase}
      // Its Dood's color, whichever Dood's page is open.
      style={
        { ...clear, ...(color === undefined ? {} : { "--agent-color": color }) } as CSSProperties
      }
      // Under the strip, where it is clear of the box messages are typed in.
      className="fixed top-[4.25rem] right-4 z-40 w-72 rounded-2xl bg-[oklch(from_var(--agent-color)_0.26_0.045_h)] p-3 text-white shadow-float ring-1 ring-white/10"
    >
      <div className="flex items-center gap-2.5">
        <Link
          to="/a/$agentId/c/$chatId"
          params={{ agentId: call.agentId, chatId: call.chatId }}
          aria-label={`Back to ${call.agentName}`}
          title={`Back to ${call.agentName}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-white/40"
        >
          {agent === undefined ? null : (
            <AgentFace agent={agent} className="size-12 shrink-0" quiet />
          )}
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[0.9375rem] font-medium">{call.agentName}</span>
            <span
              role="status"
              className="block truncate text-[0.8125rem] text-white/65 tabular-nums"
            >
              {call.startedAt === undefined ? "" : `${clock} · `}
              {phaseWords(call)}
            </span>
          </span>
        </Link>
      </div>
      {words ? (
        <p className="mt-2 line-clamp-2 min-h-10 px-0.5 text-[0.8125rem] leading-snug text-white/85">
          {said}
        </p>
      ) : null}
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          aria-pressed={call.muted}
          aria-label={call.muted ? "Unmute" : "Mute"}
          title={call.muted ? "Unmute" : "Mute"}
          onClick={() => setCallMuted(!call.muted)}
          className={cn(
            "grid h-9 flex-1 cursor-default place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-white/40 [&_svg]:size-[1.125rem]",
            call.muted
              ? "bg-white text-[oklch(from_var(--agent-color)_0.26_0.045_h)]"
              : "bg-white/14 hover:bg-white/22",
          )}
        >
          {call.muted ? <MicrophoneSlashIcon weight="fill" /> : <MicrophoneIcon />}
        </button>
        <button
          type="button"
          aria-label="End the call"
          title="End the call"
          onClick={() => void endCall()}
          className="grid h-9 flex-1 cursor-default place-items-center rounded-full bg-[oklch(0.6_0.2_25)] outline-none hover:bg-[oklch(0.55_0.2_25)] focus-visible:ring-3 focus-visible:ring-white/40 [&_svg]:size-5"
        >
          <PhoneDisconnectIcon weight="fill" />
        </button>
      </div>
    </section>
  )
}

/**
 * Opens the old side chat a call from before did its work in, to read. Undefined where there is
 * no such chat: on every call since, the work was done in the main chat and its sub-agents.
 */
function useCallChat(agentId: string | undefined, chatId: string | undefined) {
  const { data } = useQuery({ ...agentQuery(agentId ?? ""), enabled: agentId !== undefined })
  const navigate = useNavigate()
  if (agentId === undefined || chatId === undefined) return undefined
  const chat = data?.chats.find((one) => one.id === chatId)
  return isSideChat(chat)
    ? () => void navigate({ to: "/a/$agentId/c/$chatId", params: { agentId, chatId } })
    : undefined
}

/** What was said, as rows: who, and their words. */
function Said({
  lines,
  name,
}: {
  lines: readonly (CallLine & { going?: boolean })[]
  name: string
}) {
  return (
    <ul className="flex flex-col gap-1.5 text-sm leading-normal">
      {lines.map((line, index) => (
        <li key={index} className="grid grid-cols-[3.75rem_1fr] gap-2">
          <span className="truncate pt-0.5 text-xs font-medium text-muted-foreground">
            {line.who === "you" ? "You" : name}
          </span>
          <span className={cn("min-w-0 wrap-anywhere", line.who === "you" && "text-foreground/75")}>
            {line.text}
            {line.going ? (
              <span
                aria-hidden
                className="ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-primary align-middle"
              />
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * A call as its chat shows it while it lasts: what is being said, and what was handed on to the
 * Dood, with what the Dood is doing about it. That is in the main chat too, where the call is
 * held, and what takes longer goes to a sub-agent, as any work does.
 */
export function LiveCall({ call }: { call: CallView }) {
  const clock = useCallClock(call.startedAt)
  const lines: (CallLine & { going?: boolean })[] = [
    ...call.lines.slice(-8),
    ...(call.you.trim() === ""
      ? []
      : [{ who: "you" as const, text: call.you.trim(), going: true }]),
    ...(call.dood.trim() === ""
      ? []
      : [{ who: "dood" as const, text: call.dood.trim(), going: true }]),
  ]
  const working = call.works.filter((work) => !work.done)
  return (
    <section
      aria-label="The call"
      className="overflow-hidden rounded-2xl bg-card shadow-raised ring-1 ring-emerald-500/60 [box-shadow:0_0_0_5px_color-mix(in_oklch,var(--color-emerald-500)_14%,transparent)]"
    >
      <header className="flex items-center gap-2.5 px-4 py-2.5 text-sm">
        <LiveDot />
        <span className="font-medium">
          {call.startedAt === undefined
            ? `Calling ${call.agentName}…`
            : `On a call with ${call.agentName}`}
        </span>
        {call.startedAt === undefined ? null : (
          <span className="ml-auto text-[0.8125rem] text-muted-foreground tabular-nums">
            {clock}
          </span>
        )}
      </header>
      {lines.length === 0 && working.length === 0 ? null : (
        <div className="flex flex-col gap-2 border-t px-4 pt-2.5 pb-3">
          <Said lines={lines} name={call.agentName} />
          {working.map((work) => (
            <p
              key={work.id}
              role="status"
              className="ml-[4.25rem] flex items-center gap-2 self-start rounded-lg bg-primary/10 py-1 pr-3 pl-2 text-[0.8125rem] text-primary dark:text-[oklch(from_var(--agent-color)_0.8_c_h)]"
            >
              <Spinner className="size-3.5" />
              {work.step ?? `Handed to ${call.agentName}`}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}

/** A call that was held in the chat, once it is over: how long, what came of it, what was said. */
export function CallRecord({ part, at }: { part: NoticePart; at?: number | undefined }) {
  const [open, setOpen] = useState(false)
  const agentId = useContext(AgentIdContext)
  const agents = useAgentsById()
  const name = (agentId === undefined ? undefined : agents.get(agentId)?.name) ?? "Your Dood"
  const call = part.call
  const openWork = useCallChat(agentId, call?.chatId)
  if (call === undefined) return null
  return (
    <section aria-label="A call" className="overflow-hidden rounded-2xl bg-card shadow-raised">
      <header className="flex items-center gap-2.5 px-4 py-2.5 text-sm">
        <PhoneIcon className="size-4 text-muted-foreground" />
        <span className="font-medium">Call with {name}</span>
        <span className="ml-auto text-[0.8125rem] text-muted-foreground tabular-nums">
          {callLength(call.seconds)}
          {at === undefined ? null : ` · ${clockTime.format(at)}`}
        </span>
      </header>
      {call.summary.length === 0 ? null : (
        <ul className="flex flex-col gap-1 border-t px-4 pt-2.5 pb-1 text-sm leading-normal">
          {call.summary.map((line, index) => (
            <li key={index} className="flex gap-2.5">
              <CheckIcon aria-hidden className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 wrap-anywhere">{line}</span>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <div className="border-t px-4 pt-2.5 pb-1">
          <Said lines={call.lines} name={name} />
        </div>
      ) : null}
      <footer
        className={cn(
          "flex flex-wrap items-center gap-2 px-3 pb-3",
          call.summary.length === 0 && !open ? "border-t pt-2.5" : "pt-2",
        )}
      >
        {call.lines.length === 0 ? (
          <p className="px-1 text-[0.8125rem] text-muted-foreground">Nothing was said.</p>
        ) : (
          <Button
            variant="outline"
            size="xs"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="font-normal"
          >
            {open ? "Hide what was said" : "Show what was said"}
          </Button>
        )}
        {openWork === undefined ? null : (
          // What the Dood did for a call from before is in that call's old side chat.
          <Button variant="outline" size="xs" onClick={openWork} className="font-normal">
            <ChatsIcon data-icon="inline-start" />
            Open its side chat
          </Button>
        )}
      </footer>
    </section>
  )
}

/**
 * What a chat shows of the call that is on in it, or that has just ended in it: the live card
 * while it lasts, and a line while its record is being written.
 */
export function CallInChat({
  agentId,
  chatId,
  recorded,
}: {
  agentId: string
  chatId: string
  /** The ids of the calls whose records the chat already has. */
  recorded: ReadonlySet<string>
}) {
  const call = useAtomValue(callAtom)
  const [wrapUp, setWrapUp] = useAtom(callWrapUpAtom)
  const mine = wrapUp?.agentId === agentId && wrapUp.chatId === chatId ? wrapUp : undefined
  const written = mine !== undefined && recorded.has(mine.callId)
  // Its record is in the chat: the line that stood in for it has done its work.
  useEffect(() => {
    if (written) setWrapUp(undefined)
  }, [written, setWrapUp])
  if (call?.agentId === agentId && call.chatId === chatId) return <LiveCall call={call} />
  if (mine === undefined || written) return null
  return (
    <p role="status" className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
      <Spinner className="size-3.5" />
      The call is over. Writing it up…
    </p>
  )
}

import {
  avatarLook,
  type LiveView,
  type ShotPoint,
  spanOf,
  type ToolPart,
  type Use,
  type UseStep,
  useWords,
} from "@durable-computer/protocol"
import {
  ArrowsOutSimpleIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CheckIcon,
  GlobeIcon,
  MonitorIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
} from "@phosphor-icons/react"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import { useAgentsById } from "@/components/computer-requests"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { client } from "@/lib/client"
import { askAgain, endUse, holdUse, useLiveView } from "@/lib/use-live-view"
import { cn } from "@/lib/utils"
import { AgentIdContext } from "./sent-file.tsx"

/** The uses of the chat on screen, by the id of the call each begins with, and the chat's own id. */
export const UsesContext = createContext<{ chatId: string | undefined; uses: Map<string, Use> }>({
  chatId: undefined,
  uses: new Map(),
})

/** The agent whose chat is on screen. A use is only ever shown in one. */
const useAgentId = () => useContext(AgentIdContext) ?? ""

/** The use that is open large, by its id. One at a time, whichever of its pictures was clicked. */
const largeUseAtom = atom<string | null>(null)
/** The uses someone stopped. A screen counts as in use a while longer; a stopped one is not shown as such. */
const stoppedUsesAtom = atom<ReadonlySet<string>>(new Set<string>())

/** The shape of a screen whose size is not known yet. */
const UNKNOWN_SHAPE = 16 / 10
/** From this width a use opens large in a dialog. Narrower, its steps unfold under it. */
const ROOMY = "(min-width: 40rem)"

/**
 * Whether the agent is on the screen or browser of a use, and how that looks now. A use that
 * the chat no longer says is going may still be: the screen stays the agent's for a while after
 * its last step, so the last use of a chat is asked about once, and watched while it is.
 */
function useWatched(use: Use, seen: boolean) {
  const agentId = useAgentId()
  const stopped = useAtomValue(stoppedUsesAtom).has(use.id)
  const peek = useLiveView(agentId, use.computer.id, use.what, false)
  const { id } = use.computer
  const count = use.steps.length
  // Asked about again at each new step: what was last heard may be from before it.
  useEffect(() => {
    if (id !== undefined) askAgain(agentId, id, use.what)
  }, [agentId, id, use.what, count])
  const over = peek !== undefined && !peek.active
  const watching = seen && !stopped && (use.going || (use.last && !over))
  const view = useLiveView(agentId, use.computer.id, use.what, watching)
  return { agentId, view, live: !stopped && (use.going || (use.last && view?.active === true)) }
}

/** Stops the agent, as the chat's own stop does, and takes the use for ended at once. */
function useStop(use: Use) {
  const agentId = useAgentId()
  const { chatId } = useContext(UsesContext)
  const setStopped = useSetAtom(stoppedUsesAtom)
  return (chat: string | undefined = chatId) => {
    setStopped((before) => new Set(before).add(use.id))
    if (use.computer.id !== undefined) endUse(agentId, use.computer.id, use.what)
    if (chat !== undefined)
      void client
        .agent(agentId)
        .abort(chat)
        .catch(() => {})
  }
}

function useSeen<T extends Element>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (ref.current === null) return
    const observer = new IntersectionObserver((entries) => setSeen(entries.at(-1)!.isIntersecting))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return [ref, seen] as const
}

/** How long ago `since` was, kept up to the second while it is on screen. */
function Clock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  return <span className="tabular-nums"> · {spanOf(Math.max(0, now - since))}</span>
}

/**
 * The agent's pointer, drawn over a picture that does not have it in it: an arrow in the
 * agent's colour with its name. It glides to where it goes next, and ripples at each click.
 */
function Pointer({
  at,
  size,
  name,
  color,
  clicks,
  held,
}: {
  at: ShotPoint
  size: { width: number; height: number }
  name: string | undefined
  color: string
  clicks?: number | undefined
  held?: boolean | undefined
}) {
  const far = at.x / size.width > 0.78
  const low = at.y / size.height > 0.88
  return (
    <span
      data-pointer
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-10 transition-[left,top,opacity] duration-700 ease-[cubic-bezier(.3,.1,.2,1)]",
        held && "opacity-55",
      )}
      style={{ left: `${(at.x / size.width) * 100}%`, top: `${(at.y / size.height) * 100}%` }}
    >
      {clicks === undefined || clicks === 0 ? null : (
        // Made anew at each click, so that each one ripples.
        <span
          key={clicks}
          data-ripple
          className="use-ripple absolute -top-4 -left-4 size-8 rounded-full border-2 opacity-0"
          style={{
            borderColor: color,
            background: `color-mix(in srgb, ${color} 25%, transparent)`,
          }}
        />
      )}
      <svg
        width="18"
        height="20"
        viewBox="0 0 18 20"
        className="block drop-shadow-[0_1px_2px_rgb(0_0_0/.5)]"
      >
        <path
          d="M1 1l5.2 16 2.6-6.4L15.5 8z"
          fill={color}
          stroke="#fff"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      {name === undefined ? null : (
        <span
          className={cn(
            "absolute rounded-full px-1.5 text-[11px] leading-[1.5] font-semibold whitespace-nowrap text-white shadow-sm",
            // Its name goes to whichever side of the pointer has room for it.
            low ? "bottom-full" : "top-[15px]",
            far ? "right-full" : "left-[13px]",
            !low && !far && "rounded-tl-sm",
          )}
          style={{ background: color }}
        >
          {name}
          {held ? " · waiting" : ""}
        </span>
      )}
    </span>
  )
}

/** The last picture kept of a use, for before the first live one arrives. */
const keptOf = (use: Use) => use.steps.findLast((step) => step.shot !== undefined)

/**
 * The screen or page as it is now, with the agent's pointer over it. Its shape is known before
 * its picture is, so that nothing moves when the picture comes.
 */
function LivePicture({
  use,
  view,
  small = false,
  className,
}: {
  use: Use
  view: LiveView | undefined
  /** A thumbnail: too small for a pointer to mean anything. */
  small?: boolean
  className?: string
}) {
  const agentId = useAgentId()
  const me = useAgentsById().get(agentId)
  const kept = keptOf(use)
  const shot = view?.shot
  const width = shot?.width ?? kept?.width
  const height = shot?.height ?? kept?.height
  const src =
    shot !== undefined
      ? `data:${shot.mimeType};base64,${shot.data}`
      : kept?.shot !== undefined
        ? client.agent(agentId).shotUrl(kept.shot)
        : undefined
  const pointer = shot !== undefined ? view?.pointer : kept?.pointer
  return (
    <span
      className={cn("relative block w-full overflow-hidden bg-muted", className)}
      style={{ aspectRatio: width && height ? `${width} / ${height}` : UNKNOWN_SHAPE }}
    >
      {src === undefined ? null : (
        <img
          src={src}
          alt={`${use.what === "screen" ? "The screen of" : "A browser on"} ${use.computer.name}`}
          draggable={false}
          className={cn(
            "block size-full transition-[filter]",
            view?.held && "brightness-80 saturate-50",
          )}
        />
      )}
      {small || pointer === undefined || !width || !height ? null : (
        <Pointer
          at={pointer}
          size={{ width, height }}
          name={view?.agent?.name ?? me?.name ?? undefined}
          color={view?.agent?.color ?? avatarLook(me?.avatar, agentId).color}
          clicks={view?.clicks}
          held={view?.held}
        />
      )}
      {view?.held && !small ? (
        <span className="absolute top-1/2 left-1/2 z-10 flex -translate-1/2 items-center gap-1.5 rounded-full bg-black/70 px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap text-white">
          <PauseIcon weight="fill" className="size-3.5" />
          Paused
        </span>
      ) : null}
    </span>
  )
}

const UseIcon = ({ use, className }: { use: Use; className?: string }) =>
  use.what === "screen" ? (
    <MonitorIcon className={className} />
  ) : (
    <GlobeIcon className={className} />
  )

/** What the agent is doing there, in a few words: what the screen itself says, else its last step. */
const sayOf = (use: Use, view: LiveView | undefined) =>
  view?.say ?? use.steps.at(-1)?.say ?? "Getting started"

/** The address of the page in front, without what every address begins with. */
const pageOf = (use: Use, view: LiveView | undefined) =>
  (view?.url ?? use.steps.findLast((step) => step.url !== undefined)?.url)?.replace(
    /^https?:\/\//,
    "",
  )

/**
 * What on a screen the agent is at: the window it is working in, behind whatever is in front,
 * or the whole screen.
 */
const screenOf = (use: Use, view: LiveView | undefined) =>
  (view?.active ? view.title : use.steps.findLast((step) => step.shot !== undefined)?.title) ??
  "The screen"

/** The steps so far, and the one under way. */
function StepList({ use, view, live }: { use: Use; view: LiveView | undefined; live: boolean }) {
  const end = useRef<HTMLLIElement>(null)
  const count = use.steps.length
  // The newest step is kept in view. Nothing is handed back to React: a newer browser answers
  // scrollIntoView with a promise, which React would take for something to call on the way out.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" })
  }, [count])
  return (
    <ol aria-label="Steps so far" className="flex flex-col gap-px">
      {use.steps.map((step, index) => {
        const now = live && index === count - 1
        const going = step.status === "pending" || step.status === "running"
        return (
          <li
            key={step.toolCallId}
            ref={index === count - 1 ? end : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13.5px] text-muted-foreground",
              now && "bg-surface text-foreground",
            )}
          >
            <span className="grid w-3.5 shrink-0 place-items-center">
              {going ? <Spinner className="size-3" /> : <CheckIcon className="size-3" />}
            </span>
            <span className="truncate">{now && going ? sayOf(use, view) : step.say}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Pause, or carry on. */
function HoldButton({
  use,
  view,
  words = false,
}: {
  use: Use
  view: LiveView | undefined
  words?: boolean
}) {
  const agentId = useAgentId()
  const held = view?.held === true
  const label = held ? "Carry on" : "Pause"
  const computerId = use.computer.id
  return (
    <Button
      variant={words ? "outline" : "ghost"}
      size={words ? "sm" : "icon-sm"}
      disabled={computerId === undefined}
      aria-label={words ? undefined : label}
      title={words ? undefined : label}
      onClick={() => {
        if (computerId !== undefined)
          void holdUse(agentId, computerId, use.what, !held).catch(() => {})
      }}
    >
      {held ? <PlayIcon /> : <PauseIcon />}
      {words ? label : null}
    </Button>
  )
}

/** The use, large: the picture with the steps so far beside it. */
function UseLarge({ use, view, live }: { use: Use; view: LiveView | undefined; live: boolean }) {
  const [large, setLarge] = useAtom(largeUseAtom)
  const stop = useStop(use)
  const page = pageOf(use, view)
  return (
    <Dialog open={large === use.id} onOpenChange={(open) => setLarge(open ? use.id : null)}>
      <DialogContent className="flex max-h-[calc(100dvh-2.5rem)] w-full max-w-[calc(100%-2.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[70rem] md:flex-row">
        <div className="grid min-h-0 min-w-0 flex-1 items-center bg-black">
          <LivePicture use={use} view={view} />
        </div>
        <div className="flex min-h-0 shrink-0 flex-col border-t md:w-68 md:border-t-0 md:border-l">
          <div className="border-b py-3 pr-12 pl-4">
            <DialogTitle className="text-[15px] font-semibold">{use.computer.name}</DialogTitle>
            <DialogDescription className="truncate text-[13px]">
              {use.what === "screen" ? screenOf(use, view) : (page ?? "A browser")}
              {use.startedAt !== undefined && live ? <Clock since={use.startedAt} /> : null}
            </DialogDescription>
          </div>
          <div className="max-h-[32rem] min-h-0 flex-1 overflow-auto p-2">
            <StepList use={use} view={view} live={live} />
          </div>
          {live ? (
            <div className="flex gap-2 border-t p-3">
              <HoldButton use={use} view={view} words />
              <Button variant="outline" size="sm" onClick={() => stop()}>
                <StopIcon />
                Stop
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The little window in the chat while the agent is at it. */
function UseWindow({ use, view }: { use: Use; view: LiveView | undefined }) {
  const setLarge = useSetAtom(largeUseAtom)
  const stop = useStop(use)
  const [unfolded, setUnfolded] = useState(false)
  const held = view?.held === true
  const page = pageOf(use, view)
  // On a phone there is no room for a dialog with two sides: the steps unfold under the picture.
  const open = () => (matchMedia(ROOMY).matches ? setLarge(use.id) : setUnfolded((was) => !was))
  return (
    <div
      data-use={use.what}
      className="w-full max-w-[520px] overflow-hidden rounded-2xl border bg-surface"
    >
      <div className="flex h-10 items-center gap-2 pr-1.5 pl-3 text-[13px]">
        <UseIcon use={use} className="size-[15px] shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          <b className="font-medium">{use.computer.name}</b>
          <span className="text-muted-foreground">
            {" · "}
            {use.what === "screen" ? (
              "the screen"
            ) : (
              <span className="font-mono text-[11.5px]">{page ?? "a browser"}</span>
            )}
            {use.startedAt === undefined ? null : <Clock since={use.startedAt} />}
          </span>
        </span>
        <HoldButton use={use} view={view} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="max-sm:hidden"
          aria-label="Open it large"
          title="Open it large"
          onClick={() => setLarge(use.id)}
        >
          <ArrowsOutSimpleIcon />
        </Button>
        <Button variant="outline" size="sm" onClick={() => stop()}>
          Stop
        </Button>
      </div>
      <button
        type="button"
        aria-label="Open it large"
        className="block w-full cursor-zoom-in border-y outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        onClick={open}
      >
        <LivePicture use={use} view={view} />
      </button>
      <div
        role="status"
        className="flex min-h-9 items-center gap-2 py-1.5 pr-2 pl-3 text-[13px] text-muted-foreground"
      >
        {held ? (
          <PauseIcon className="size-3.5 shrink-0" />
        ) : (
          <Spinner className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{sayOf(use, view)}</span>
        {held ? <HoldButton use={use} view={view} words /> : null}
      </div>
      {unfolded ? (
        <div className="max-h-56 overflow-auto border-t p-2 sm:hidden">
          <StepList use={use} view={view} live />
        </div>
      ) : null}
    </div>
  )
}

/** One picture of the film: how a step ended, with the pointer where the agent left it. */
function Frame({ step, pointer, eager }: { step: UseStep; pointer: boolean; eager?: boolean }) {
  const agentId = useAgentId()
  const me = useAgentsById().get(agentId)
  const { width, height } = step
  return (
    <span
      className="relative block w-full overflow-hidden bg-muted"
      style={{ aspectRatio: width && height ? `${width} / ${height}` : UNKNOWN_SHAPE }}
    >
      {step.shot === undefined ? (
        pointer ? (
          <span className="absolute inset-0 grid place-items-center px-6 text-center text-[13px] text-muted-foreground">
            No picture was taken at this step.
          </span>
        ) : null
      ) : (
        <img
          src={client.agent(agentId).shotUrl(step.shot)}
          alt={pointer ? step.say : ""}
          loading={eager ? "eager" : "lazy"}
          draggable={false}
          className="block size-full"
        />
      )}
      {pointer && step.shot !== undefined && step.pointer !== undefined && width && height ? (
        <Pointer
          at={step.pointer}
          size={{ width, height }}
          name={me?.name ?? undefined}
          color={avatarLook(me?.avatar, agentId).color}
        />
      ) : null}
    </span>
  )
}

/** Word that a use ended, which unfolds into what was done: the picture kept at each step. */
function UseEnded({ use }: { use: Use }) {
  const agentId = useAgentId()
  const name = useAgentsById().get(agentId)?.name ?? "It"
  const [at, setAt] = useState(0)
  const count = use.steps.length
  const step = use.steps[Math.min(at, count - 1)]
  const [computer, rest] =
    use.what === "screen" ? [useWords(use), ""] : ["a browser", ` on ${use.computer.name}`]
  return (
    <Collapsible
      data-use-ended={use.what}
      className="border-l-2 py-0.5 pl-3 text-sm text-muted-foreground"
    >
      <div className="flex items-start gap-2">
        <span className="grid h-[1.5em] shrink-0 content-center">
          <CheckCircleIcon className="size-4" />
        </span>
        <span>
          {name} used <b className="font-medium text-foreground">{computer}</b>
          {rest}
          {/* Under a second is no time worth telling. */}
          {use.ms === undefined || use.ms < 1_000 ? "" : ` for ${spanOf(use.ms)}`} · {count}{" "}
          {count === 1 ? "step" : "steps"}
        </span>
      </div>
      <CollapsibleTrigger className="group/more mt-1 -ml-2 inline-flex h-7 cursor-default items-center gap-1.5 rounded-lg px-2 text-[13.5px] outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40">
        <CaretRightIcon className="size-3 transition-transform group-data-panel-open/more:rotate-90" />
        What it did
      </CollapsibleTrigger>
      <CollapsibleContent>
        {step === undefined ? null : (
          <div className="mt-2 w-full max-w-[520px] overflow-hidden rounded-2xl border bg-surface">
            <Frame step={step} pointer eager />
            <div className="flex items-center gap-2 border-t px-3 py-2 text-[13px]">
              <b className="shrink-0 font-medium text-foreground">
                {Math.min(at, count - 1) + 1} of {count}
              </b>
              <span className="min-w-0 flex-1 truncate">{step.say}</span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto px-2.5 pt-0.5 pb-2.5">
              {use.steps.map((each, index) => (
                <button
                  key={each.toolCallId}
                  type="button"
                  title={each.say}
                  aria-label={`Step ${index + 1}: ${each.say}`}
                  aria-current={each === step ? "step" : undefined}
                  onClick={() => setAt(index)}
                  className={cn(
                    "w-19 flex-none overflow-hidden rounded-md border opacity-65 outline-none hover:opacity-100 focus-visible:opacity-100",
                    each === step && "opacity-100 ring-2 ring-primary",
                  )}
                >
                  <Frame step={each} pointer={false} />
                </button>
              ))}
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

/** A use where it began in the transcript: the screen while the agent is at it, and word of it after. */
export function UseView({ part }: { part: ToolPart }) {
  const use = useContext(UsesContext).uses.get(part.toolCallId)
  // The other steps of a use are in the one thing shown where it began.
  return use === undefined ? null : <UseShown use={use} />
}

function UseShown({ use }: { use: Use }) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  const large = useAtomValue(largeUseAtom) === use.id
  const { view, live } = useWatched(use, seen || large)
  return (
    <div ref={ref}>
      {live ? <UseWindow use={use} view={view} /> : <UseEnded use={use} />}
      <UseLarge use={use} view={view} live={live} />
    </div>
  )
}

/** In the agent's panel: the screen or browser the agent is on now, small. Clicking opens it large. */
export function UseNow({ use, chatId }: { use: Use; chatId: string | undefined }) {
  const setLarge = useSetAtom(largeUseAtom)
  const { view, live } = useWatched(use, true)
  const stop = useStop(use)
  if (!live) return null
  return (
    <section aria-label={`On ${use.computer.name} now`} className="shrink-0 border-t">
      <h3 className="px-5 pt-4 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        On {use.computer.name} now
      </h3>
      <div className="flex items-center gap-2.5 px-2.5 pb-3">
        <button
          type="button"
          aria-label="Open it large"
          title="Open it large"
          onClick={() => setLarge(use.id)}
          className="flex min-w-0 flex-1 cursor-default items-center gap-2.5 rounded-lg p-2 text-left outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <span className="w-16 flex-none overflow-hidden rounded-md border">
            <LivePicture use={use} view={view} small />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm">
              {use.what === "screen" ? screenOf(use, view) : "A browser"}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {view?.held ? "Paused" : sayOf(use, view)}
            </span>
          </span>
        </button>
        <Button variant="outline" size="sm" onClick={() => stop(chatId)}>
          Stop
        </Button>
      </div>
    </section>
  )
}

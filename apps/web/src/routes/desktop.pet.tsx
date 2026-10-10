import type { AgentSummary, ApprovalsState } from "@durable-computer/protocol"
import { CheckIcon, HandPalmIcon, WarningIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { atom, useAtomValue } from "jotai"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { AgentAvatar } from "@/components/agent-avatar"
import { chatKey, liveChatAtom } from "@/lib/atoms"
import { client } from "@/lib/client"
import {
  agentQuery,
  agentsQuery,
  approvalsKey,
  catchUpAgent,
  refreshAgent,
} from "@/lib/collections"
import { lastAgent } from "@/lib/last-agent"
import { cheerMascot, feedMascot, leadPointer, type MascotMood } from "@/lib/mascot"
import {
  chatsToFollow,
  type FollowedChat,
  hearTyping,
  PET_BOX,
  type PetBridge,
  petBridge,
  petEndings,
  type PetMemory,
  petMemory,
  petNow,
  type PetPlace,
  type PetSaying,
} from "@/lib/pet"
import { holdChat } from "@/lib/use-live-chat"
import { cn } from "@/lib/utils"

/**
 * An agent's companion: its creature on its own, with a line beside it about what the agent is
 * doing. The desktop app shows this page in a small window with nothing behind it, kept over
 * its owner's other windows. It is outside the signed-in pages, which would send whoever is
 * not signed in to sign in: here they are shown nothing until they have.
 */
export const Route = createFileRoute("/desktop/pet")({
  ssr: false,
  head: () => ({ meta: [{ title: "Companion · Do Computer" }] }),
  component: PetPage,
})

/** How often it is asked who is signed in: while nobody is, and while somebody is. */
const ASK_AGAIN_MS = 15_000
const SIGNED_IN_MS = 2 * 60_000
/** How long what it says of a run that ended stays up. */
const DONE_MS = 20_000
const ERROR_MS = 45_000
/** How long it looks pleased, or troubled, once a run has ended. */
const PLEASED_MS = 1_800
const TROUBLED_MS = 8_000
/** How long it keeps listening after the last key. */
const LISTEN_MS = 2_500
/** It dozes off when the pointer has not moved for this long. */
const DOZE_MS = 4 * 60_000
/** How far the pointer must move with the button down before the creature is being carried. */
const CARRY_PX = 5

const DEFAULT_PLACE: PetPlace = { x: "right", y: "bottom" }

function PetPage() {
  const bridge = petBridge()
  useEffect(() => {
    document.documentElement.classList.add("pet")
    return () => document.documentElement.classList.remove("pet")
  }, [])

  const [chosen, setChosen] = useState(
    () => bridge?.agent ?? new URLSearchParams(window.location.search).get("agent") ?? lastAgent(),
  )
  const [place, setPlace] = useState(bridge?.place ?? DEFAULT_PLACE)
  /** When the pointer last moved: what a creature that has nothing to do stays awake for. */
  const stirred = useRef(Date.now())
  useEffect(() => {
    bridge?.onAgent(setChosen)
    bridge?.onPlace(setPlace)
    bridge?.onPointer((at) => {
      stirred.current = Date.now()
      leadPointer(at.x, at.y)
    })
    if (bridge !== undefined) return
    // In a browser the page sees the pointer only while it is over it.
    const stir = () => {
      stirred.current = Date.now()
    }
    window.addEventListener("pointermove", stir, { passive: true })
    return () => window.removeEventListener("pointermove", stir)
  }, [bridge])

  // Nobody signed in has no agents to show. They may sign in, or out, at any moment, in
  // another window: who is signed in is asked now and then, which costs the agents nothing.
  const me = useQuery({
    queryKey: ["pet", "me"],
    queryFn: () => client.me(),
    retry: false,
    refetchInterval: (query) => (query.state.status === "success" ? SIGNED_IN_MS : ASK_AGAIN_MS),
    // With nobody signed in there is nothing to show, and the app hides the window. A page
    // that is not showing is the one that has to keep asking.
    refetchIntervalInBackground: true,
  })
  const signedIn = me.isSuccess
  const { data: agents } = useQuery({ ...agentsQuery, enabled: signedIn })
  const agent = signedIn ? (agents?.find((entry) => entry.id === chosen) ?? agents?.[0]) : undefined
  const agentId = agent?.id
  useEffect(() => {
    if (agentId === undefined) bridge?.areas([])
    else bridge?.showing(agentId)
  }, [bridge, agentId])

  if (agent === undefined) return null
  return <Pet key={agent.id} agent={agent} bridge={bridge} place={place} stirred={stirred} />
}

/** The chats that are followed for an agent, each held for as long as it is one of them. */
function useFollowed(agentId: string): FollowedChat[] {
  const { data: state } = useQuery(agentQuery(agentId))
  const chats = useMemo(() => chatsToFollow(state?.chats ?? [], Date.now()), [state?.chats])
  const ids = chats.map((chat) => chat.id).join(" ")

  // A chat that stays among them keeps its stream when the others change.
  const held = useRef(new Map<string, () => void>())
  useEffect(() => {
    const wanted = new Set(ids === "" ? [] : ids.split(" "))
    for (const id of wanted) {
      if (!held.current.has(id)) held.current.set(id, holdChat(agentId, id))
    }
    for (const [id, release] of held.current) {
      if (wanted.has(id)) continue
      release()
      held.current.delete(id)
    }
  }, [agentId, ids])
  useEffect(() => {
    const all = held.current
    return () => {
      for (const release of all.values()) release()
      all.clear()
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the chats are named by their ids
  const lives = useAtomValue(
    useMemo(
      () =>
        atom((get) =>
          (ids === "" ? [] : ids.split(" ")).map((id) => get(liveChatAtom(chatKey(agentId, id)))),
        ),
      [agentId, ids],
    ),
  )
  return chats.flatMap((chat, index) => {
    const live = lives[index]
    return live === undefined ? [] : [{ chat, state: live.state, loaded: live.loaded }]
  })
}

function Pet({
  agent,
  bridge,
  place,
  stirred,
}: {
  agent: AgentSummary
  bridge: PetBridge | undefined
  place: PetPlace
  stirred: React.RefObject<number>
}) {
  const agentId = agent.id

  // Kept fresh from its event stream, as its pages in the app are.
  useEffect(() => {
    let back = false
    const subscription = client.agent(agentId).watch((event) => {
      if (event.type === "changed") refreshAgent(agentId, event.what)
      if (event.type === "ready") {
        catchUpAgent(agentId, back)
        back = true
      }
    })
    return () => subscription.close()
  }, [agentId])

  const followed = useFollowed(agentId)
  const { data: approvals } = useQuery<ApprovalsState>({
    queryKey: approvalsKey(agentId),
    queryFn: () => client.agent(agentId).approvals(),
  })
  const now = petNow(followed, approvals?.pending ?? [])

  // A run that was going in one of its chats has stopped: it says how that went, for a while.
  const [ending, setEnding] = useState<PetSaying>()
  const [flash, setFlash] = useState<"done" | "error">()
  const memory = useRef<PetMemory>(undefined)
  useEffect(() => {
    memory.current ??= petMemory(Date.now())
    const said = petEndings(followed, memory.current)
    if (said === undefined) return
    setEnding(said)
    setFlash(said.kind === "error" ? "error" : "done")
  })
  useEffect(() => {
    if (ending === undefined) return
    const timer = setTimeout(
      () => setEnding(undefined),
      ending.kind === "error" ? ERROR_MS : DONE_MS,
    )
    return () => clearTimeout(timer)
  }, [ending])
  useEffect(() => {
    if (flash === undefined) return
    const timer = setTimeout(
      () => setFlash(undefined),
      flash === "error" ? TROUBLED_MS : PLEASED_MS,
    )
    return () => clearTimeout(timer)
  }, [flash])

  // Its owner is typing to it in the app: it leans in, and dips a little at every key.
  const [listening, setListening] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = hearTyping(agentId, () => {
      feedMascot(agentId, "key")
      stirred.current = Date.now()
      setListening(true)
      clearTimeout(timer)
      timer = setTimeout(() => setListening(false), LISTEN_MS)
    })
    return () => {
      stop()
      clearTimeout(timer)
    }
  }, [agentId, stirred])

  // Nothing to do and nobody about: it dozes until the pointer moves again.
  const quiet = now.saying === undefined && flash === undefined && !listening
  const [dozing, setDozing] = useState(false)
  useEffect(() => {
    if (!quiet) return setDozing(false)
    const look = setInterval(() => setDozing(Date.now() - stirred.current > DOZE_MS), 1_000)
    return () => clearInterval(look)
  }, [quiet, stirred])

  let mood: MascotMood = now.mood
  if (now.saying === undefined) {
    if (flash !== undefined) mood = { state: flash }
    else if (listening) mood = { state: "listening" }
    else mood = { state: dozing ? "asleep" : "idle" }
  }
  // What it is doing now is said before how the last thing went.
  const saying = now.saying ?? ending

  // Picked up with the button down and carried: the app moves the window with the pointer.
  const press = useRef<{ x: number; y: number }>(undefined)
  const carried = useRef(false)
  const drop = () => {
    press.current = undefined
    if (!carried.current) return
    carried.current = false
    bridge?.drag(false)
    cheerMascot(agentId)
  }

  // The app is told which parts of the window are something, whenever they change.
  const creature = useRef<HTMLDivElement>(null)
  const bubble = useRef<HTMLButtonElement>(null)
  const told = useRef("")
  useLayoutEffect(() => {
    const rects = [creature.current, bubble.current].flatMap((part) =>
      part === null
        ? []
        : [
            {
              x: part.offsetLeft,
              y: part.offsetTop,
              width: part.offsetWidth,
              height: part.offsetHeight,
            },
          ],
    )
    const key = JSON.stringify(rects)
    if (key === told.current) return
    told.current = key
    bridge?.areas(rects)
  })

  const box = bridge?.box ?? PET_BOX
  return (
    <main
      data-pet={agentId}
      data-place={`${place.y} ${place.x}`}
      className={cn(
        "fixed inset-0 flex select-none",
        place.y === "bottom" ? "flex-col-reverse" : "flex-col",
        place.x === "right" ? "items-end" : "items-start",
      )}
    >
      <div
        ref={creature}
        role="group"
        aria-label={agent.name ?? "New agent"}
        style={{ width: box, height: box }}
        className="relative flex shrink-0 items-center justify-center"
        onPointerDown={(event) => {
          if (event.button === 0) press.current = { x: event.screenX, y: event.screenY }
        }}
        onPointerMove={(event) => {
          const from = press.current
          if (from === undefined) return
          // The button was let go where the page could not see it.
          if (event.buttons === 0) return drop()
          const moved = Math.hypot(event.screenX - from.x, event.screenY - from.y)
          if (carried.current || moved < CARRY_PX) return
          carried.current = true
          bridge?.drag(true)
        }}
        onPointerUp={drop}
        onPointerCancel={drop}
        onDoubleClick={() => bridge?.open(agentId)}
        onContextMenu={(event) => {
          event.preventDefault()
          bridge?.menu()
        }}
      >
        <AgentAvatar
          avatar={agent.avatar}
          seed={agentId}
          outfit={agent.outfit}
          mood={mood}
          hatched={agent.hatched}
          // It is on the desktop all day. At rest it is drawn half as often, which costs half.
          slow={mood.state === "idle" || mood.state === "asleep"}
          pettable
          className="size-[80%]"
        />
      </div>
      {saying === undefined ? null : (
        <Saying
          // A new kind of thing to say comes up afresh. What it is doing changes in place.
          key={saying.kind}
          ref={bubble}
          saying={saying}
          place={place}
          onOpen={() => {
            bridge?.open(agentId, saying.chatId)
            setEnding(undefined)
          }}
        />
      )}
    </main>
  )
}

const CAPTION: Record<PetSaying["kind"], string> = {
  working: "Working",
  waiting: "Needs your OK",
  done: "Done",
  error: "Ran into a problem",
}

/** What it says, in a bubble on the side of it the window has room on. Clicking it opens the chat. */
function Saying({
  ref,
  saying,
  place,
  onOpen,
}: {
  ref: React.Ref<HTMLButtonElement>
  saying: PetSaying
  place: PetPlace
  onOpen: () => void
}) {
  return (
    <button
      ref={ref}
      type="button"
      data-saying={saying.kind}
      onClick={onOpen}
      style={{ "--from": place.y === "bottom" ? "6px" : "-6px" } as React.CSSProperties}
      className={cn(
        "pet-saying relative mx-3 flex max-w-[calc(100%-1.5rem)] cursor-pointer flex-col gap-0.5 rounded-xl border bg-popover px-3 py-2 text-left text-[0.8125rem] leading-snug text-popover-foreground shadow-md outline-none",
        place.y === "bottom" ? "-mb-1 mt-2 origin-bottom" : "-mt-1 mb-2 origin-top",
      )}
    >
      <span
        role="status"
        className={cn(
          "flex items-center gap-1.5 text-[0.6875rem] font-medium tracking-wide uppercase",
          saying.kind === "error"
            ? "text-destructive"
            : saying.kind === "working"
              ? "text-muted-foreground"
              : "text-primary",
        )}
      >
        {saying.kind === "working" ? (
          <span aria-hidden className="pet-dots flex gap-0.5">
            <i className="size-1 bg-current" />
            <i className="size-1 bg-current" />
            <i className="size-1 bg-current" />
          </span>
        ) : saying.kind === "done" ? (
          <CheckIcon aria-hidden weight="bold" className="size-3" />
        ) : saying.kind === "waiting" ? (
          <HandPalmIcon aria-hidden weight="bold" className="size-3" />
        ) : (
          <WarningIcon aria-hidden weight="bold" className="size-3" />
        )}
        <span className="truncate">
          {CAPTION[saying.kind]}
          {saying.where === undefined ? "" : ` · ${saying.where}`}
        </span>
      </span>
      <span className="line-clamp-3 break-words">{saying.text}</span>
      {/* Its corner points at the creature. */}
      <span
        aria-hidden
        className={cn(
          "absolute size-2.5 rotate-45 bg-popover",
          place.y === "bottom"
            ? "-bottom-[5.5px] border-r border-b"
            : "-top-[5.5px] border-t border-l",
          place.x === "right" ? "right-16" : "left-16",
        )}
      />
    </button>
  )
}

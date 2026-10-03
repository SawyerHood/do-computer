import type { Orb } from "@durable-computer/mascot"
import { type AgentSummary, type Avatar, avatarLook, avatarSvg } from "@durable-computer/protocol"
import { useAtomValue } from "jotai"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  IDLE,
  isDark,
  loadMascot,
  type MascotMood,
  mascotMoodAtom,
  prefersCalm,
  showing,
} from "@/lib/mascot"
import { cn } from "@/lib/utils"

/**
 * An agent's creature: grown from its seed, in its color, and acting out what the agent is doing.
 * It is drawn live where the browser can; until that has loaded, and where it cannot, a still
 * picture of a plain creature in the same color stands in.
 */
export function AgentAvatar({
  avatar,
  seed,
  className,
  mood = IDLE,
  hatched = true,
  hatching = false,
  onHatched,
  quiet = false,
}: {
  avatar: Avatar | null | undefined
  /** The agent's id: what the creature grows from unless it was given a seed of its own. */
  seed: string
  className?: string
  /** What it is doing. Idle when left out. */
  mood?: MascotMood
  /** False while it is still in its egg. */
  hatched?: boolean
  /** Play the hatch. Going back to false while it plays skips to its end. */
  hatching?: boolean
  /** Called once the hatch is over, skipped, or could not be drawn at all. */
  onHatched?: () => void
  /** One among many: drawn at a lower frame rate, and it does not follow the pointer. */
  quiet?: boolean
}) {
  const look = useMemo(() => avatarLook(avatar, seed), [avatar, seed])
  const still = useMemo(
    () => `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvg(avatar, seed))}`,
    [avatar, seed],
  )
  const canvas = useRef<HTMLCanvasElement>(null)
  const [orb, setOrb] = useState<Orb | null>()
  const done = useRef(onHatched)
  done.current = onHatched
  // What it starts as. Later changes go through the effects below, not through a new creature.
  const first = useRef({ look, hatched, quiet })

  useEffect(() => {
    let created: Orb | undefined
    let hide: (() => void) | undefined
    let gone = false
    void loadMascot().then((core) => {
      if (gone) return
      if (core === null || canvas.current === null) return setOrb(null)
      const start = first.current
      created = core.createOrb(canvas.current, {
        seed: start.look.seed,
        color: start.look.color,
        dark: isDark(),
        reduced: prefersCalm(),
        notice: !start.quiet,
        slow: start.quiet,
      })
      if (!start.hatched) created.setState("egg")
      hide = showing(seed, created)
      setOrb(created)
    })
    return () => {
      gone = true
      hide?.()
      created?.dispose()
    }
  }, [seed])

  useEffect(() => {
    orb?.setSeed(look.seed)
    orb?.setColor(look.color)
  }, [orb, look])

  useEffect(() => {
    if (orb === undefined) return
    if (hatching) {
      // Nothing to watch where it cannot be drawn: it is simply out.
      if (orb === null) done.current?.()
      else orb.hatch({ onDone: () => done.current?.() })
    } else if (orb?.getState() === "hatching") {
      orb.skipHatch()
    }
  }, [orb, hatching])

  useEffect(() => {
    if (orb === undefined || orb === null || hatching || orb.getState() === "hatching") return
    if (hatched) orb.setState(mood.state, mood.variant)
    else orb.setState("egg")
  }, [orb, hatched, hatching, mood.state, mood.variant])

  return (
    <span
      role="img"
      aria-label="Agent avatar"
      data-mood={hatched ? mood.state : "egg"}
      className={cn("relative inline-block size-8 shrink-0", className)}
    >
      {orb ? null : <img src={still} alt="" className="absolute inset-0 size-full" />}
      {/* Drawn a little past its box: the creature keeps room around itself for hops and rings. */}
      <canvas
        ref={canvas}
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-[-12%] left-[-12%] size-[124%] max-w-none",
          !orb && "invisible",
        )}
      />
    </span>
  )
}

/** An agent as it is right now: in its egg until it has hatched, and doing what its chat says. */
export function AgentFace({
  agent,
  className,
  quiet,
}: {
  agent: Pick<AgentSummary, "id" | "avatar" | "hatched">
  className?: string
  quiet?: boolean
}) {
  const mood = useAtomValue(mascotMoodAtom(agent.id))
  return (
    <AgentAvatar
      avatar={agent.avatar}
      seed={agent.id}
      className={className}
      mood={mood}
      hatched={agent.hatched}
      quiet={quiet}
    />
  )
}

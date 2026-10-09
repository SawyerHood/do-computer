import type { MascotCore, Orb } from "@durable-computer/mascot"
import {
  type AgentSummary,
  type Avatar,
  avatarLook,
  avatarSvg,
  type Outfit,
} from "@durable-computer/protocol"
import { useAtomValue } from "jotai"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  dressMascot,
  IDLE,
  isDark,
  loadMascot,
  type MascotMood,
  mascotMoodAtom,
  prefersCalm,
  showing,
  whenMascotLoads,
} from "@/lib/mascot"
import { type Heart, usePetting } from "@/lib/use-petting"
import { cn } from "@/lib/utils"

/**
 * An agent's creature: grown from its seed, in its color, and acting out what the agent is doing.
 * It is drawn live where the browser can; until that has loaded, and where it cannot, a still
 * picture of a plain creature in the same color stands in.
 */
export function AgentAvatar({
  avatar,
  seed,
  outfit,
  className,
  mood = IDLE,
  hatched = true,
  hatching = false,
  onHatched,
  quiet = false,
  still = false,
  pettable = false,
}: {
  avatar: Avatar | null | undefined
  /** The agent's id: what the creature grows from unless it was given a seed of its own. */
  seed: string
  /** What it has on. The picture that stands in for it wears nothing. */
  outfit?: Outfit | null
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
  /** A picture of it, holding still: drawn once, and again only when its look changes. */
  still?: boolean
  /** It can be petted: patted with a click or a tap, and stroked by rubbing the pointer on it. */
  pettable?: boolean
}) {
  const petting = usePetting(seed)
  // While it hatches it is busy with that, and a click there skips the hatch.
  const canPet = pettable && !hatching
  const look = useMemo(() => avatarLook(avatar, seed), [avatar, seed])
  const standIn = useMemo(
    () => `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvg(avatar, seed))}`,
    [avatar, seed],
  )
  const canvas = useRef<HTMLCanvasElement>(null)
  const [orb, setOrb] = useState<Orb | null>()
  const done = useRef(onHatched)
  done.current = onHatched
  // What it starts as. Later changes go through the effects below, not through a new creature.
  const first = useRef({ look, hatched, quiet: quiet || still })

  useEffect(() => {
    let created: Orb | undefined
    let hide: (() => void) | undefined
    let gone = false
    const draw = (core: MascotCore | null) => {
      if (gone || created !== undefined) return
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
    }
    void loadMascot().then(draw)
    // Where it could not be drawn at first, it is as soon as it can be.
    const forget = whenMascotLoads(draw)
    return () => {
      gone = true
      forget()
      hide?.()
      created?.dispose()
    }
  }, [seed])

  useEffect(() => {
    orb?.setSeed(look.seed)
    orb?.setColor(look.color)
  }, [orb, look])

  // Named by what it is and not by which object says so, since each answer brings a new object.
  const wearing = JSON.stringify(outfit ?? {})
  useEffect(() => {
    if (orb) dressMascot(orb, JSON.parse(wearing) as Outfit)
  }, [orb, wearing])

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
    if (!hatched) orb.setState("egg")
    else if (still) orb.setState("idle")
    else orb.setState(mood.state, mood.variant)
  }, [orb, hatched, hatching, still, mood.state, mood.variant])

  // A picture of it: it is let move for a moment, to take up its pose, and then held there.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new look, a hatch or a change of clothes is drawn again
  useEffect(() => {
    if (orb === undefined || orb === null) return
    orb.paused = false
    if (!still) return
    const timer = setTimeout(() => {
      orb.paused = true
    }, 350)
    return () => clearTimeout(timer)
  }, [orb, still, look, hatched, wearing])

  return (
    <span
      role="img"
      aria-label="Agent avatar"
      data-mood={!hatched ? "egg" : still ? "idle" : mood.state}
      className={cn(
        "relative inline-block size-8 shrink-0",
        canPet && "cursor-grab touch-none select-none active:cursor-grabbing",
        className,
      )}
      {...(canPet ? petting.handlers : undefined)}
    >
      {orb ? null : <img src={standIn} alt="" className="absolute inset-0 size-full" />}
      {/* Drawn a little past its box: the creature keeps room around itself for hops and rings. */}
      <canvas
        ref={canvas}
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-[-12%] left-[-12%] size-[124%] max-w-none",
          !orb && "invisible",
        )}
      />
      {petting.hearts.map((heart) => (
        <PetHeart key={heart.id} heart={heart} gone={petting.gone} />
      ))}
    </span>
  )
}

/** A little heart, in the creature's own blocky style, that rises from the hand and fades. */
export function PetHeart({ heart, gone }: { heart: Heart; gone: (id: number) => void }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 7 6"
      shapeRendering="crispEdges"
      className="pet-heart pointer-events-none absolute w-[10%] min-w-3.5"
      style={
        {
          left: `${heart.x * 100}%`,
          top: `${heart.y * 100}%`,
          "--drift": heart.drift,
        } as React.CSSProperties
      }
      onAnimationEnd={() => gone(heart.id)}
    >
      <path fill="#ff6b8e" d="M1 0h2v1h1V0h2v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z" />
      <path fill="#ffd0db" d="M1 1h1v1H1z" />
    </svg>
  )
}

/** An agent as it is right now: in its egg until it has hatched, and doing what its chat says. */
export function AgentFace({
  agent,
  className,
  quiet,
  still,
  pettable,
}: {
  agent: Pick<AgentSummary, "id" | "avatar" | "hatched" | "outfit">
  className?: string
  quiet?: boolean
  still?: boolean
  pettable?: boolean
}) {
  const mood = useAtomValue(mascotMoodAtom(agent.id))
  return (
    <AgentAvatar
      avatar={agent.avatar}
      seed={agent.id}
      outfit={agent.outfit}
      className={className}
      mood={mood}
      hatched={agent.hatched}
      quiet={quiet}
      still={still}
      pettable={pettable}
    />
  )
}

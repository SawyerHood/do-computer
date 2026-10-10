import {
  type AgentSummary,
  type CreatureState,
  topTreat,
  type TreatKind,
  TREATS_PER_BOX,
} from "@durable-computer/protocol"
import { useSetAtom } from "jotai"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { PetHeart } from "@/components/agent-avatar"
import { creatureWindowAtom, feedCreature, useCreature } from "@/lib/creature"
import { biteMascot, cheerMascot, offerMascot, prefersCalm } from "@/lib/mascot"
import type { Heart } from "@/lib/use-petting"
import { cn } from "@/lib/utils"
import { CRUMB, Pixels } from "./pixels.tsx"

/** How far a treat is moved before that is carrying it and not a press. */
const CARRIED_PX = 8
/** How many bites a treat is eaten in, and how long each takes. */
const BITES = 3
const BITE_MS = 300
/** How much of a treat is left after each bite. */
const LEFT = [1, 0.8, 0.55, 0.3]

type Held = { kind: TreatKind; x: number; y: number; eating: boolean; bites: number }
type Crumb = { id: number; x: number; y: number; dx: number; dy: number; color: string }

/**
 * Giving the creature a treat: carried from its pile to its mouth with the pointer, or sent there
 * by pressing the pile. It opens its mouth as the treat comes near, eats it in a few bites, and
 * is pleased. `box` is the element the creature is drawn in, which is how its mouth is found.
 */
function useTreats(
  agentId: string,
  creature: CreatureState | undefined,
  box: React.RefObject<HTMLElement | null>,
) {
  const [held, setHeld] = useState<Held | null>(null)
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [hearts, setHearts] = useState<Heart[]>([])
  const carry = useRef({ x: 0, y: 0, moved: false, near: false, pointer: 0 })
  const count = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer)
      offerMascot(agentId, false)
    },
    [agentId],
  )

  /** Where its mouth is on the page, and how near counts as at it. */
  const mouth = useCallback(() => {
    const rect = box.current?.getBoundingClientRect()
    if (rect === undefined || rect.width === 0) return undefined
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height * 0.7,
      reach: rect.width * 0.6,
    }
  }, [box])
  const at = (x: number, y: number) => {
    const to = mouth()
    return to !== undefined && Math.hypot(x - to.x, y - to.y) < to.reach
  }

  const eat = (kind: TreatKind, from: { x: number; y: number }) => {
    const to = mouth()
    if (to === undefined) return setHeld(null)
    void feedCreature(agentId)
    offerMascot(agentId, true)
    // Drawn where it was let go, and then sent to the mouth, so that it is seen to travel.
    setHeld({ kind, ...from, eating: true, bites: 0 })
    const later = (run: () => void, ms: number) => timers.current.push(setTimeout(run, ms))
    later(() => setHeld((treat) => (treat === null ? treat : { ...treat, x: to.x, y: to.y })), 20)
    for (let bite = 1; bite <= BITES; bite++) {
      later(() => {
        biteMascot(agentId)
        setHeld((treat) => (treat === null ? treat : { ...treat, bites: bite }))
        if (prefersCalm()) return
        setCrumbs((all) => [
          ...all,
          ...[0, 1, 2, 3].map((): Crumb => {
            const angle = Math.random() * Math.PI
            return {
              id: count.current++,
              x: to.x,
              y: to.y,
              dx: Math.round(Math.cos(angle) * 34),
              dy: Math.round(Math.sin(angle) * 18 + 26),
              color: CRUMB[kind],
            }
          }),
        ])
      }, bite * BITE_MS)
    }
    later(
      () => {
        setHeld(null)
        cheerMascot(agentId)
        setHearts((all) => [
          ...all,
          ...[0.3, 0.52, 0.72].map((x, index): Heart => {
            const id = count.current++
            return { id, x, y: 0.3 - 0.06 * (index % 2), drift: index - 1 }
          }),
        ])
      },
      (BITES + 0.8) * BITE_MS,
    )
  }

  const busy = held !== null
  const carrying = held !== null && !held.eating
  const none = creature === undefined || creature.treats <= 0
  /** What the pointer does with the treat it picked up. */
  const hand = {
    move: (event: PointerEvent) => {
      if (held === null || held.eating) return
      const from = carry.current
      if (Math.abs(event.clientX - from.x) + Math.abs(event.clientY - from.y) > CARRIED_PX) {
        from.moved = true
      }
      const near = at(event.clientX, event.clientY)
      if (near !== from.near) {
        from.near = near
        offerMascot(agentId, near)
      }
      setHeld({ ...held, x: event.clientX, y: event.clientY })
    },
    up: (event: PointerEvent) => {
      if (held === null || held.eating) return
      const from = { x: event.clientX, y: event.clientY }
      // Let go on the creature, it is eaten. Pressed and not carried, it goes there by itself.
      if (at(from.x, from.y) || !carry.current.moved) return eat(held.kind, from)
      offerMascot(agentId, false)
      setHeld(null)
    },
    cancel: () => {
      if (held === null || held.eating) return
      offerMascot(agentId, false)
      setHeld(null)
    },
  }
  const heard = useRef(hand)
  heard.current = hand
  // The treat is followed from the window, and not from the pile it was taken from. A treat
  // earned while one is carried makes the pile anew, and the pointer's capture goes with the old
  // one: the pile then never heard the treat let go, and it hung where it was for good.
  useEffect(() => {
    if (!carrying) return
    const own = (event: PointerEvent) => event.pointerId === carry.current.pointer
    const move = (event: PointerEvent) => (own(event) ? heard.current.move(event) : undefined)
    const up = (event: PointerEvent) => (own(event) ? heard.current.up(event) : undefined)
    const cancel = (event: PointerEvent) => (own(event) ? heard.current.cancel() : undefined)
    // A window that is left with the button down is not told when it comes up.
    const left = () => heard.current.cancel()
    window.addEventListener("pointermove", move, true)
    window.addEventListener("pointerup", up, true)
    window.addEventListener("pointercancel", cancel, true)
    window.addEventListener("blur", left)
    return () => {
      window.removeEventListener("pointermove", move, true)
      window.removeEventListener("pointerup", up, true)
      window.removeEventListener("pointercancel", cancel, true)
      window.removeEventListener("blur", left)
    }
  }, [carrying])

  const handlers = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (busy || none || creature === undefined || event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      carry.current = {
        x: event.clientX,
        y: event.clientY,
        moved: false,
        near: false,
        pointer: event.pointerId,
      }
      const kind = topTreat(agentId, creature)
      setHeld({ kind, x: event.clientX, y: event.clientY, eating: false, bites: 0 })
    },
    // The pointer's own press is handled above; this is the keyboard's.
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      if (event.detail !== 0 || busy || none || creature === undefined) return
      const rect = event.currentTarget.getBoundingClientRect()
      eat(topTreat(agentId, creature), {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      })
    },
  }
  return {
    held,
    crumbs,
    hearts,
    handlers,
    crumbGone: (id: number) => setCrumbs((all) => all.filter((crumb) => crumb.id !== id)),
    heartGone: useCallback(
      (id: number) => setHearts((all) => all.filter((heart) => heart.id !== id)),
      [],
    ),
  }
}

/**
 * The creature with what it is looked after with: its treats at one corner and its next box at
 * the other. The treats are given by carrying one onto it or by pressing them; the box fills as
 * it is given treats, and once full is pressed to open. Wraps the creature's own drawing.
 */
export function CreatureCare({
  agent,
  children,
  className,
}: {
  agent: Pick<AgentSummary, "id" | "name" | "hatched">
  /** The creature, drawn however whoever shows it wants it. */
  children: ReactNode
  className?: string
}) {
  const creature = useCreature(agent.id, agent.hatched)
  const box = useRef<HTMLSpanElement>(null)
  const treats = useTreats(agent.id, creature, box)
  const setWindow = useSetAtom(creatureWindowAtom)
  const name = agent.name ?? "it"
  const count = creature?.treats ?? 0
  const boxes = creature?.boxes ?? 0
  const left = TREATS_PER_BOX - (creature?.joy ?? 0)
  const { held } = treats
  return (
    <span ref={box} className={cn("relative inline-block", className)}>
      {children}
      {creature === undefined || !agent.hatched ? null : (
        <>
          <button
            type="button"
            aria-label={
              count === 0
                ? `${name} has no treats`
                : `Give ${name} a treat: ${count} ${count === 1 ? "treat" : "treats"}`
            }
            aria-disabled={count === 0}
            // It eats one treat at a time: the next waits until this one is gone.
            aria-busy={held !== null}
            title={
              count === 0
                ? `No treats. ${name} earns one each time it answers.`
                : "Carry a treat onto it, or press"
            }
            // A new pile when another treat lands on it, so that it is seen to land.
            key={creature.fed + count}
            className={cn(
              "creature-pile absolute -bottom-2 -left-10 grid size-11 touch-none place-items-center rounded-xl outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/40",
              count === 0 ? "cursor-default" : "cursor-grab hover:bg-accent active:cursor-grabbing",
            )}
            {...treats.handlers}
          >
            <Pixels
              art={topTreat(agent.id, creature)}
              className={cn("w-7.5", count === 0 && "opacity-25 grayscale")}
            />
            {count === 0 ? null : (
              <span className="absolute top-0 right-0 grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 text-[0.625rem] leading-none font-bold text-background">
                {count}
              </span>
            )}
          </button>
          <button
            type="button"
            aria-label={
              boxes > 0
                ? `Open ${name}'s box`
                : `${left} more ${left === 1 ? "treat" : "treats"} until ${name}'s next box`
            }
            aria-disabled={boxes === 0}
            title={
              boxes > 0
                ? `${name} found a box. Press to open it.`
                : `${left} more ${left === 1 ? "treat" : "treats"} until ${name}'s next box`
            }
            onClick={() => (boxes > 0 ? setWindow("box") : undefined)}
            className={cn(
              "absolute -right-10 -bottom-2 grid size-11 place-items-center rounded-xl outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/40",
              boxes > 0 ? "creature-box-ready hover:bg-accent" : "cursor-default",
            )}
          >
            <span className="relative block w-8.5">
              <Pixels art="box" className="w-full opacity-30 grayscale" />
              {/* The same picture in its colors, as much of it from the bottom as it has been filled. */}
              <span
                className="creature-fill absolute inset-x-0 bottom-0 overflow-hidden"
                style={{
                  height: `${boxes > 0 ? 100 : (100 * (creature.joy ?? 0)) / TREATS_PER_BOX}%`,
                }}
              >
                <Pixels art="box" className="absolute bottom-0 left-0 w-full" />
              </span>
            </span>
            {boxes > 1 ? (
              <span className="absolute top-0 right-0 grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 text-[0.625rem] leading-none font-bold text-background">
                {boxes}
              </span>
            ) : boxes === 1 ? (
              <Pixels art="spark" className="creature-twinkle absolute top-0.5 right-0.5 w-2.5" />
            ) : null}
          </button>
        </>
      )}
      {treats.hearts.map((heart) => (
        <PetHeart key={heart.id} heart={heart} gone={treats.heartGone} />
      ))}
      {held === null && treats.crumbs.length === 0
        ? null
        : createPortal(
            <>
              {held === null ? null : (
                <span
                  aria-hidden
                  className={cn(
                    "creature-treat pointer-events-none fixed z-[70] block w-10",
                    held.eating && "creature-treat-eaten",
                  )}
                  style={{
                    left: held.x,
                    top: held.y,
                    transform: `translate(-50%, -50%) scale(${LEFT[held.bites] ?? 0.3})`,
                  }}
                >
                  <Pixels art={held.kind} className="w-full" />
                </span>
              )}
              {treats.crumbs.map((crumb) => (
                <span
                  key={crumb.id}
                  aria-hidden
                  className="creature-crumb pointer-events-none fixed z-[70] block size-1"
                  style={
                    {
                      left: crumb.x,
                      top: crumb.y,
                      background: crumb.color,
                      "--dx": `${crumb.dx}px`,
                      "--dy": `${crumb.dy}px`,
                    } as React.CSSProperties
                  }
                  onAnimationEnd={() => treats.crumbGone(crumb.id)}
                />
              ))}
            </>,
            document.body,
          )}
    </span>
  )
}

import { useCallback, useRef, useState } from "react"
import { petMascot } from "./mascot.ts"

/** A heart that rises from where the hand is. Its place is in fractions of the creature's box. */
export type Heart = { id: number; x: number; y: number; drift: number }

/** How far from the middle of its box the creature reaches: its body, without the air around it. */
const BODY = 0.44
/** How far the pointer must rub across it, in box widths, before that counts as petting. */
const RUB = 0.9
/** How far the pointer travels for each stroke, in box widths. */
const STROKE = 0.14
/** A hand that rests this long has stopped stroking. */
const REST_MS = 450
const HEART_EVERY_MS = 380
const HEARTS = 8

/**
 * Petting a creature: a click or a tap pats it, and rubbing the pointer back and forth across it
 * strokes it. A pointer that only passes over it on its way elsewhere does nothing, since one
 * pass is shorter than the rub it takes.
 */
export function usePetting(agentId: string) {
  const [hearts, setHearts] = useState<Heart[]>([])
  const hand = useRef({
    x: 0,
    y: 0,
    at: 0,
    /** How far it has rubbed without resting, and how far since the last stroke. */
    rubbed: 0,
    owed: 0,
    pressed: false,
    petting: false,
    heartAt: 0,
    hearts: 0,
  })

  /** Where the pointer is on the creature, or undefined when it is beside it. */
  const place = (event: React.PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0) return undefined
    const x = (event.clientX - box.left) / box.width - 0.5
    const y = (event.clientY - box.top) / box.height - 0.5
    return Math.hypot(x, y) > BODY ? undefined : { x, y, width: box.width }
  }

  const stroke = (at: { x: number; y: number }, time: number, amount?: number) => {
    const state = hand.current
    petMascot(agentId, at.x / BODY, amount)
    if (time - state.heartAt < HEART_EVERY_MS) return
    state.heartAt = time
    const id = state.hearts++
    const drift = (id % 2 === 0 ? 1 : -1) * (0.5 + Math.random())
    setHearts((all) => [...all.slice(1 - HEARTS), { id, x: at.x + 0.5, y: at.y + 0.5, drift }])
  }

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const at = place(event)
    if (at === undefined) return
    Object.assign(hand.current, {
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
      owed: 0,
      pressed: true,
      petting: true,
    })
    stroke(at, event.timeStamp, 0.75)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const state = hand.current
    const at = place(event)
    if (at === undefined) return
    if (event.timeStamp - state.at > REST_MS) {
      Object.assign(state, { rubbed: 0, owed: 0, petting: state.pressed })
    } else {
      const moved = Math.hypot(event.clientX - state.x, event.clientY - state.y) / at.width
      state.rubbed += moved
      state.owed += moved
    }
    Object.assign(state, { x: event.clientX, y: event.clientY, at: event.timeStamp })
    if (!state.petting && state.rubbed >= RUB) Object.assign(state, { petting: true, owed: STROKE })
    if (!state.petting || state.owed < STROKE) return
    state.owed = 0
    stroke(at, event.timeStamp)
  }

  const lift = () => {
    hand.current.pressed = false
  }
  const onPointerLeave = () => {
    Object.assign(hand.current, { at: 0, rubbed: 0, owed: 0, pressed: false, petting: false })
  }

  const gone = useCallback(
    (id: number) => setHearts((all) => all.filter((heart) => heart.id !== id)),
    [],
  )
  return {
    hearts,
    gone,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: lift,
      onPointerCancel: lift,
      onPointerLeave,
    },
  }
}

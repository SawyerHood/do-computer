/**
 * Petting a creature, for any `Avatar` of an agent.
 *
 *   const petting = usePetting(agent.id)
 *   <View {...petting.props} style={{ width: size, height: size }}>
 *     <Avatar avatar={agent.avatar} seed={agent.id} size={size} />
 *     {petting.hearts}
 *   </View>
 *
 * Spread `props` on a view that is exactly the creature's box (the same width and height as the
 * `Avatar` in it) and put `hearts` in it after the creature. A tap pats it and a finger drawn
 * across it strokes it; hearts rise from where the finger is, with a light tap of haptics. It
 * reaches every live drawing of that agent's creature on screen, as a word of its answer does,
 * so the `Avatar` needs nothing passed to it. A touch beside its body is let through to whatever
 * is under it. Inside a page that scrolls, a stroke up or down is taken by the page: stroke
 * across.
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { GestureResponderEvent, LayoutChangeEvent, ViewProps } from "react-native"
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import Svg, { Path } from "react-native-svg"
import { petMascot } from "@/ui/avatar"
import { haptic } from "@/ui/haptics"

/** A heart that rises from where the hand is. Its place is in fractions of the creature's box. */
export type Heart = { id: number; x: number; y: number; drift: number }

/** How far from the middle of its box the creature reaches: its body, without the air around it. */
const BODY = 0.44
/** How far the finger travels for each stroke, in box widths. */
const STROKE = 0.14
const HEART_EVERY_MS = 380
const HEARTS = 8
/** How long a heart takes to rise and fade. */
const RISE_MS = 900

/** A little heart, in the creature's own blocky style, that rises from the hand and fades. */
function PetHeart({ heart, box, gone }: { heart: Heart; box: number; gone: (id: number) => void }) {
  const { id, drift } = heart
  const side = Math.max(14, box * 0.1)
  const rise = box * 0.36
  const along = useSharedValue(0)
  useEffect(() => {
    along.value = withTiming(1, { duration: RISE_MS, easing: Easing.out(Easing.quad) })
    const timer = setTimeout(() => gone(id), RISE_MS + 80)
    return () => clearTimeout(timer)
  }, [along, gone, id])
  const style = useAnimatedStyle(() => {
    const t = along.value
    return {
      opacity: t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85,
      transform: [
        { translateX: drift * side * 0.6 * t },
        { translateY: -rise * t },
        { scale: 0.6 + 0.4 * Math.min(1, t * 4) },
      ],
    }
  })
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: heart.x * box - side / 2,
          top: heart.y * box - side,
          width: side,
          opacity: 0,
        },
        style,
      ]}
    >
      <Svg width={side} height={(side * 6) / 7} viewBox="0 0 7 6">
        <Path fill="#ff6b8e" d="M1 0h2v1h1V0h2v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z" />
        <Path fill="#ffd0db" d="M1 1h1v1H1z" />
      </Svg>
    </Animated.View>
  )
}

/** The hearts over a creature whose box is `box` points wide. Put it in that box, after the creature. */
export function Hearts({
  hearts,
  box,
  gone,
}: {
  hearts: readonly Heart[]
  box: number
  gone: (id: number) => void
}) {
  if (box <= 0) return null
  return hearts.map((heart) => <PetHeart key={heart.id} heart={heart} box={box} gone={gone} />)
}

/** See the top of this file. */
export function usePetting(agentId: string): { props: ViewProps; hearts: ReactNode } {
  const [hearts, setHearts] = useState<Heart[]>([])
  const [box, setBox] = useState(0)
  const hand = useRef({ x: 0, y: 0, owed: 0, heartAt: 0, hearts: 0, width: 0 })

  const gone = useCallback(
    (id: number) => setHearts((all) => all.filter((heart) => heart.id !== id)),
    [],
  )

  const props = useMemo((): ViewProps => {
    /** Where the finger is on the creature, or undefined when it is beside it. */
    const place = (event: GestureResponderEvent) => {
      const width = hand.current.width
      if (width === 0) return undefined
      const x = event.nativeEvent.locationX / width - 0.5
      const y = event.nativeEvent.locationY / width - 0.5
      return Math.hypot(x, y) > BODY ? undefined : { x, y }
    }
    const stroke = (at: { x: number; y: number }, time: number, amount?: number) => {
      const state = hand.current
      petMascot(agentId, at.x / BODY, amount)
      if (time - state.heartAt < HEART_EVERY_MS) return
      state.heartAt = time
      haptic.light()
      const id = state.hearts++
      const drift = (id % 2 === 0 ? 1 : -1) * (0.5 + Math.random())
      setHearts((all) => [...all.slice(1 - HEARTS), { id, x: at.x + 0.5, y: at.y + 0.5, drift }])
    }
    return {
      // The box itself is what is touched, so that the finger's place is measured from its corner.
      pointerEvents: "box-only",
      onLayout: (event: LayoutChangeEvent) => {
        hand.current.width = event.nativeEvent.layout.width
        setBox(event.nativeEvent.layout.width)
      },
      onStartShouldSetResponder: (event) => place(event) !== undefined,
      onResponderGrant: (event) => {
        const at = place(event)
        if (at === undefined) return
        Object.assign(hand.current, {
          x: event.nativeEvent.pageX,
          y: event.nativeEvent.pageY,
          owed: 0,
        })
        stroke(at, Date.now(), 0.75)
      },
      onResponderMove: (event) => {
        const state = hand.current
        const at = place(event)
        if (at === undefined || state.width === 0) return
        const { pageX, pageY } = event.nativeEvent
        state.owed += Math.hypot(pageX - state.x, pageY - state.y) / state.width
        state.x = pageX
        state.y = pageY
        if (state.owed < STROKE) return
        state.owed = 0
        stroke(at, Date.now())
      },
      // A stroke is not given up to a button or a row behind it. A page that scrolls takes it anyway.
      onResponderTerminationRequest: () => false,
    }
  }, [agentId])

  return { props, hearts: <Hearts hearts={hearts} box={box} gone={gone} /> }
}

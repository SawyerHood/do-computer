import {
  type AgentSummary,
  type CreatureState,
  topTreat,
  type TreatKind,
} from "@durable-computer/protocol"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { View } from "react-native"
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { Avatar, biteMascot, cheerMascot, offerMascot } from "@/ui/avatar"
import { haptic } from "@/ui/haptics"
import { type Heart, Hearts, usePetting } from "./petting"
import { CRUMB, Pixels } from "./pixels"
import { useCare } from "./state"

/** How many bites a treat is eaten in, and how long each takes. */
const BITES = 3
const BITE_MS = 300
/** How much of a treat is left after each bite. */
const LEFT = [1, 0.8, 0.55, 0.3]
/** How long a treat takes to reach the mouth, and a crumb to fall. */
const TRAVEL_MS = 260
const CRUMB_MS = 520
/** Where its mouth is, down its box. */
const MOUTH = 0.7

/** Where a treat sets out from, measured from the creature's mouth in points. */
export type From = { dx: number; dy: number }
type Held = { kind: TreatKind; from: From; bites: number }
type Crumb = { id: number; dx: number; dy: number; color: string }

/** A treat on its way to the mouth, and smaller with every bite taken of it. */
function Treat({ held, side }: { held: Held; side: number }) {
  const along = useSharedValue(0)
  const left = useSharedValue(1)
  const { dx, dy } = held.from
  useEffect(() => {
    along.value = withTiming(1, { duration: TRAVEL_MS, easing: Easing.out(Easing.cubic) })
  }, [along])
  useEffect(() => {
    left.value = withTiming(LEFT[held.bites] ?? 0.3, { duration: 90 })
  }, [left, held.bites])
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: dx * (1 - along.value) },
      { translateY: dy * (1 - along.value) },
      { scale: left.value },
    ],
  }))
  return (
    <Animated.View style={[{ position: "absolute", left: -side / 2, top: -side / 2 }, style]}>
      <Pixels art={held.kind} size={side} />
    </Animated.View>
  )
}

/** A crumb that flies from the mouth and falls. */
function CrumbBit({ crumb, gone }: { crumb: Crumb; gone: (id: number) => void }) {
  const { id, dx, dy } = crumb
  const along = useSharedValue(0)
  useEffect(() => {
    along.value = withTiming(1, { duration: CRUMB_MS, easing: Easing.out(Easing.quad) })
    const timer = setTimeout(() => gone(id), CRUMB_MS + 60)
    return () => clearTimeout(timer)
  }, [along, gone, id])
  const style = useAnimatedStyle(() => ({
    opacity: 1 - along.value * along.value,
    transform: [{ translateX: dx * along.value }, { translateY: dy * along.value * along.value }],
  }))
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: -2,
          top: -2,
          width: 4,
          height: 4,
          backgroundColor: crumb.color,
        },
        style,
      ]}
    />
  )
}

/**
 * An agent's creature as it is looked after: live, wearing what it has on, stroked with a finger
 * (see `petting.tsx`), and fed. `give` sends the next treat to its mouth from wherever the treats
 * are kept on the page: it opens its mouth, eats it in a few bites with crumbs, and is pleased.
 * There is always another treat, and it eats one at a time (`busy`). `stage` is the creature in a
 * box `size` points square, to be put on the page.
 */
export function useCreatureStage({
  agent,
  creature,
  size,
}: {
  agent: Pick<AgentSummary, "id" | "avatar" | "hatched" | "outfit"> | undefined
  /** What it has and wears, once heard from. Until then it wears what the list of agents says. */
  creature: CreatureState | undefined
  size: number
}): {
  stage: ReactNode
  /** The treat it is handed next, once that is known. */
  kind: TreatKind | undefined
  busy: boolean
  give: (from: From) => void
} {
  const agentId = agent?.id ?? ""
  const petting = usePetting(agentId)
  const care = useCare(agentId)
  const calm = useReducedMotion()
  const [held, setHeld] = useState<Held | null>(null)
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [hearts, setHearts] = useState<Heart[]>([])
  const count = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer)
      offerMascot(agentId, false)
    },
    [agentId],
  )
  const crumbGone = useCallback(
    (id: number) => setCrumbs((all) => all.filter((crumb) => crumb.id !== id)),
    [],
  )
  const heartGone = useCallback(
    (id: number) => setHearts((all) => all.filter((heart) => heart.id !== id)),
    [],
  )

  const kind = creature === undefined ? undefined : topTreat(agentId, creature)
  const give = (from: From) => {
    if (held !== null || kind === undefined) return
    haptic.tap()
    void care.feed()
    offerMascot(agentId, true)
    setHeld({ kind, from, bites: 0 })
    const later = (run: () => void, ms: number) => timers.current.push(setTimeout(run, ms))
    for (let bite = 1; bite <= BITES; bite++) {
      later(() => {
        biteMascot(agentId)
        haptic.light()
        setHeld((treat) => (treat === null ? treat : { ...treat, bites: bite }))
        if (calm) return
        setCrumbs((all) => [
          ...all,
          ...[0, 1, 2, 3].map((): Crumb => {
            const angle = Math.random() * Math.PI
            return {
              id: count.current++,
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

  const stage = (
    <View style={{ width: size, height: size }}>
      <View {...petting.props} style={{ width: size, height: size }}>
        {/* Not drawn until it is known whose it is: a creature is reached by its agent's id. */}
        {agent === undefined ? null : (
          <Avatar
            avatar={agent.avatar}
            seed={agent.id}
            outfit={creature?.outfit ?? agent.outfit}
            size={size}
            hatched={agent.hatched}
          />
        )}
        {petting.hearts}
      </View>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0 }}>
        <Hearts hearts={hearts} box={size} gone={heartGone} />
      </View>
      {/* Everything here is placed from its mouth. */}
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: size / 2, top: size * MOUTH }}
      >
        {held === null ? null : (
          <Treat held={held} side={Math.min(44, Math.max(28, size * 0.22))} />
        )}
        {crumbs.map((crumb) => (
          <CrumbBit key={crumb.id} crumb={crumb} gone={crumbGone} />
        ))}
      </View>
    </View>
  )
  return { stage, kind, busy: held !== null, give }
}

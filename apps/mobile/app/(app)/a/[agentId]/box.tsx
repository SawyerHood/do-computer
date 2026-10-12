import type { Gift, Orb } from "@do-computer/mascot"
import {
  type Outfit,
  RARITIES,
  rarityOf,
  WEAR_ITEMS,
  type WearItem,
  wearItem,
} from "@do-computer/protocol"
import { LinearGradient } from "expo-linear-gradient"
import { useLocalSearchParams, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, Pressable, useWindowDimensions, View } from "react-native"
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Pixels } from "@/creature/pixels"
import { SLOT_NAMES, useCare, useCreature } from "@/creature/state"
import { useAgentLive, useAgentSummary } from "@/lib/queries"
import { errorText, haptic, Icon, Text } from "@/ui"
import { Avatar, cheerMascot, mascotWardrobe } from "@/ui/avatar"

/**
 * The night the box is opened in. It is dark whatever the phone's own look is, so these are its
 * own colors and not the theme's.
 */
const NIGHT = ["#1f3d70", "#14213f", "#0a0e1a"] as const
const WHITE = "#ffffff"
const DIM = "rgba(255, 255, 255, 0.72)"
const GLASS = "rgba(255, 255, 255, 0.14)"
const DEEP = "#14213f"

/** When the box jolts after it starts to open, in seconds: the drawing code's own timing. */
const FIRST_JOLT = 0.3
const JOLT_EVERY = 0.42
/** How long what was inside hangs in the light before the creature is shown with it on. */
const HANG_MS = 1500

/** The colors of the rarities from the commonest up to a thing's own: the box steps through them. */
const tiersTo = (item: WearItem) =>
  RARITIES.slice(0, RARITIES.findIndex((rarity) => rarity.id === item.rarity) + 1).map(
    (rarity) => rarity.color,
  )

/** Beams of the rarity's color behind what was found, turning slowly. */
function Rays({ color, side }: { color: string; side: number }) {
  const calm = useReducedMotion()
  const turn = useSharedValue(0)
  const seen = useSharedValue(0)
  useEffect(() => {
    seen.value = withTiming(1, { duration: 500 })
    if (!calm)
      turn.value = withRepeat(withTiming(1, { duration: 48_000, easing: Easing.linear }), -1)
  }, [calm, seen, turn])
  const style = useAnimatedStyle(() => ({
    opacity: seen.value,
    transform: [{ rotate: `${turn.value * 360}deg` }],
  }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          width: side,
          height: side,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      {Array.from({ length: 12 }, (_, index) => (
        <LinearGradient
          // biome-ignore lint/suspicious/noArrayIndexKey: twelve beams that never change places
          key={index}
          colors={["transparent", color, color, "transparent"]}
          locations={[0, 0.35, 0.65, 1]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{
            position: "absolute",
            width: side,
            height: side * 0.085,
            opacity: 0.2,
            transform: [{ rotate: `${index * 15}deg` }],
          }}
        />
      ))}
    </Animated.View>
  )
}

/**
 * A box being opened, over everything. It waits to be pressed; pressed, it rattles while the
 * agent is asked what is inside, and then opens on it, on the creature's own stage: the rarer the
 * thing, the longer it takes. What was inside hangs in the light, and then the creature is shown
 * with it on. It can be put on there and then, or kept for later. Where the creature cannot be
 * drawn, a picture of a box stands in and what was inside is simply said.
 */
export default function BoxPage() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const window = useWindowDimensions()
  const calm = useReducedMotion()
  const agent = useAgentSummary(agentId)
  useAgentLive(agentId)
  const creature = useCreature(agentId)
  const care = useCare(agentId)
  const [stage, setStage] = useState<"shut" | "opening" | "burst" | "shown">("shut")
  const [found, setFound] = useState<WearItem>()
  const [problem, setProblem] = useState<string>()
  /** Whether the creature has been shown with what was found on it, after the box. */
  const [revealed, setRevealed] = useState(false)
  /** Whether there is a box on the creature's stage: undefined until that is known. */
  const [boxed, setBoxed] = useState<boolean>()
  /** Whether the stage has had time to draw the box, and can be looked at. */
  const [ready, setReady] = useState(false)
  const orb = useRef<Orb | null>(null)
  /** What the creature is shown in once the box is open: what it had on, and the new thing. */
  const wearing = useRef<Outfit>({})
  const gift = useRef<Gift | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const later = (run: () => void, ms: number) => timers.current.push(setTimeout(run, ms))
  const forget = () => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current = []
  }
  /** Set once the page has been left: nothing more is played. */
  const left = useRef(false)
  /** Whether a box is in the middle of opening: started, and what was inside not shown yet. */
  const opening = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the page is left
  useEffect(
    () => () => {
      left.current = true
      forget()
    },
    [],
  )

  /** Take the box off the stage, and let the creature be drawn again. */
  const unwrap = () => {
    try {
      gift.current?.dispose()
    } catch {
      // The creature it was on has gone already, and the box with it.
    }
    gift.current = null
  }
  const pop = () => setStage("burst")
  const shown = () => {
    opening.current = false
    haptic.done()
    setStage("shown")
    const item = wearing.current
    later(
      () => {
        // The box goes and the creature is dressed in the same breath, before it is drawn again.
        unwrap()
        if (orb.current !== null) mascotWardrobe()?.dress(orb.current, item)
        setRevealed(true)
        cheerMascot(agentId)
      },
      gift.current === null ? 0 : calm ? 600 : HANG_MS,
    )
  }
  const heard = useRef({ pop, shown })
  heard.current = { pop, shown }

  /** Put a box on the creature's stage, in the creature's place. */
  const wrap = useCallback((on: Orb) => {
    try {
      gift.current =
        mascotWardrobe()?.unwrap(on, {
          onPop: () => {
            haptic.heavy()
            heard.current.pop()
          },
          onShown: () => heard.current.shown(),
        }) ?? null
    } catch {
      gift.current = null
    }
    setBoxed(gift.current !== null)
    // Shown a moment later, once the box has been drawn in the creature's place.
    setTimeout(() => setReady(true), 150)
  }, [])
  // A stage that never comes is not waited for: the picture of a box stands in.
  useEffect(() => {
    const timer = setTimeout(() => setBoxed((known) => known ?? false), 2_500)
    return () => clearTimeout(timer)
  }, [])
  const onOrb = useCallback(
    (next: Orb | null) => {
      orb.current = next
      if (next !== null) {
        // Once the creature has been set up as its agent's, as on the web: a box is put on a
        // creature that is finished.
        setTimeout(() => {
          if (orb.current === next && !left.current) wrap(next)
        }, 0)
        return
      }
      // It is gone, or could not be drawn: the box goes with it.
      try {
        gift.current?.dispose()
      } catch {
        // It went with the creature.
      }
      gift.current = null
      if (left.current) return
      setBoxed(false)
      // One that was in the middle of opening is open, and that is that.
      if (opening.current) {
        heard.current.pop()
        heard.current.shown()
      }
    },
    [wrap],
  )

  const close = () => (router.canGoBack() ? router.back() : router.replace(`/a/${agentId}`))
  const press = async () => {
    if (stage !== "shut") return
    setStage("opening")
    setProblem(undefined)
    haptic.tap()
    gift.current?.shake()
    try {
      const id = await care.open()
      // Closed while it was being asked for: the thing is in the wardrobe, and nothing is played.
      if (left.current) return
      // A thing this app has not heard of yet is still a thing: it is named, and not drawn.
      const item = wearItem(id) ?? { id, slot: "hat", name: "Something new", rarity: "common" }
      setFound(item)
      wearing.current = { ...creature?.outfit, [item.slot]: item.id }
      const box = gift.current
      if (box === null) {
        // No box to play it on: it is open, and that is that.
        heard.current.pop()
        heard.current.shown()
        return
      }
      const tiers = tiersTo(item)
      // A tap in the hand at each jolt. With less motion asked for it does not jolt: it is open.
      if (!calm) {
        tiers.forEach((_, index) => {
          later(() => haptic.medium(), (FIRST_JOLT + index * JOLT_EVERY) * 1000)
        })
      }
      opening.current = true
      try {
        box.open({ id: item.id, tiers })
      } catch {
        // It is open all the same, and what was inside is the creature's: only the show is lost.
        forget()
        heard.current.pop()
        heard.current.shown()
      }
    } catch (error) {
      if (left.current) return
      opening.current = false
      gift.current?.calm()
      haptic.fail()
      setStage("shut")
      setProblem(errorText(error, "The box would not open."))
    }
  }
  const again = () => {
    forget()
    setFound(undefined)
    setRevealed(false)
    setStage("shut")
    opening.current = false
    // The new box takes the place of anything still on the stage, on a creature with nothing on.
    if (orb.current === null) return
    mascotWardrobe()?.strip(orb.current)
    wrap(orb.current)
  }

  const name = agent?.name ?? "It"
  const rarity = found === undefined ? undefined : rarityOf(found.rarity)
  const side = Math.min(260, window.width - 96)
  const open = stage === "burst" || stage === "shown"
  // What it wears once it is shown: what it had on, and the new thing over it. Under the box it
  // wears nothing, as on the web: the box is on its stage in its place.
  const outfit = revealed ? wearing.current : undefined

  return (
    <View style={{ flex: 1, backgroundColor: NIGHT[2] }}>
      <StatusBar style="light" />
      <LinearGradient
        colors={NIGHT}
        locations={[0, 0.5, 1]}
        style={{ position: "absolute", inset: 0 }}
      />
      <View style={{ flex: 1, paddingTop: insets.top + 64, alignItems: "center" }}>
        <View
          style={{
            width: side,
            height: side,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 24,
          }}
        >
          {open && rarity !== undefined ? <Rays color={rarity.color} side={side * 2.1} /> : null}
          {agent === undefined ? (
            <ActivityIndicator color={WHITE} />
          ) : (
            // Kept out of sight until the box is on its stage, so that the creature is not seen first.
            <View style={{ opacity: (boxed === true && ready) || revealed ? 1 : 0 }}>
              <Avatar
                avatar={agent.avatar}
                seed={agent.id}
                outfit={outfit}
                size={side}
                onOrb={onOrb}
              />
            </View>
          )}
          {boxed === false && !revealed ? (
            <View pointerEvents="none" style={{ position: "absolute" }}>
              <Pixels art="box" size={side * 0.56} />
            </View>
          ) : null}
          {stage === "shut" && boxed !== undefined ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open the box"
              onPress={() => void press()}
              style={{ position: "absolute", inset: 0 }}
            />
          ) : null}
        </View>

        {stage === "shown" && found !== undefined && rarity !== undefined ? (
          <Animated.View
            entering={FadeIn.duration(350)}
            style={{ alignItems: "center", marginTop: 20, paddingHorizontal: 24 }}
          >
            <View
              style={{
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 4,
                backgroundColor: rarity.color,
              }}
            >
              <Text variant="footnote" weight="700" color={WHITE} style={{ letterSpacing: 0.8 }}>
                {rarity.label.toUpperCase()}
              </Text>
            </View>
            <Text
              variant="largeTitle"
              color={WHITE}
              accessibilityRole="header"
              style={{ marginTop: 10, textAlign: "center" }}
            >
              {found.name}
            </Text>
            <Text variant="callout" color={DIM} style={{ marginTop: 4 }}>
              {SLOT_NAMES[found.slot].one} · {creature?.owned.length ?? 0} of {WEAR_ITEMS.length}{" "}
              found
            </Text>
          </Animated.View>
        ) : (
          <View style={{ alignItems: "center", marginTop: 20, paddingHorizontal: 24 }}>
            <Text variant="title2" color={WHITE} accessibilityRole="header">
              {name} found a box
            </Text>
            <Text variant="callout" color={DIM} style={{ marginTop: 4, textAlign: "center" }}>
              {problem ?? (stage === "shut" ? "Press it to open." : "…")}
            </Text>
          </View>
        )}
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 20, gap: 10 }}>
        {stage === "shown" && found !== undefined ? (
          <Animated.View entering={FadeIn.duration(350)} style={{ gap: 10 }}>
            <Choice
              title="Wear it"
              fill={WHITE}
              ink={DEEP}
              onPress={() => {
                haptic.tap()
                void care.wear({ ...creature?.outfit, [found.slot]: found.id })
                close()
              }}
            />
            <Choice title="Keep it for later" fill={GLASS} ink={WHITE} onPress={close} />
            {(creature?.boxes ?? 0) > 0 ? (
              <Choice
                title={`Open another · ${creature?.boxes} waiting`}
                ink={DIM}
                onPress={again}
              />
            ) : null}
          </Animated.View>
        ) : problem !== undefined ? (
          <Choice title="Close" fill={GLASS} ink={WHITE} onPress={close} />
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={8}
        onPress={close}
        style={({ pressed }) => ({
          position: "absolute",
          top: insets.top + 8,
          left: 16,
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: GLASS,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Icon name="close" size={18} color={WHITE} weight="semibold" />
      </Pressable>
    </View>
  )
}

/** One of the things to do with what was found: a wide button in the night's own colors. */
function Choice({
  title,
  fill,
  ink,
  onPress,
}: {
  title: string
  /** Left out for words alone. */
  fill?: string
  ink: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({
        height: fill === undefined ? 40 : 52,
        borderRadius: 26,
        borderCurve: "continuous",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: fill,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text variant={fill === undefined ? "callout" : "headline"} color={ink}>
        {title}
      </Text>
    </Pressable>
  )
}

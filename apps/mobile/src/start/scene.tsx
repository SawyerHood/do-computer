import { Image } from "expo-image"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { AccessibilityInfo, Pressable, StyleSheet, useWindowDimensions, View } from "react-native"
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller"
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  type SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useTheme } from "@/lib/theme"
import { Glass, Text } from "@/ui"
import { ISLAND } from "./island"

/** The night the first run opens on: what is behind the pictures, and beside them on a wide window. */
export const NIGHT = "#05071a"
/** How long a card takes to go, before the next one comes. */
export const CARD_MS = 230
/** The creature's picture is drawn this much wider than its box (see `SPILL` in the kit's avatar). */
const SPILL = 1.24
/** The least box whose picture is a whole number of points across: 25 of them make 31. */
const WHOLE = 25
/** How much of the size the scene would draw the egg at it is drawn here. */
const SMALLER = 0.85
/** How much of a keyboard's height the island moves up by, to stay in sight over the card. */
const LIFT = 0.3
/** As many letters as any line has: all of it has been said. */
const ALL = Number.MAX_SAFE_INTEGER

const PICTURES = {
  night: require("../../assets/start/island-night.png") as number,
  sunrise: require("../../assets/start/island-sunrise.png") as number,
  day: require("../../assets/start/island-day.png") as number,
}

/** Where a creature stands on the island at this window's size: its box, to put an `Avatar` in. */
export function useStanding(stance: { ground: number; egg: number } = ISLAND.stance) {
  const { width, height } = useWindowDimensions()
  // Its picture is a little under what makes the egg the size the scene drew it for, since what
  // comes out of it is larger and a phone has a camera at the top; and no wider than a narrow
  // window has room for.
  const picture = Math.min((SMALLER * ISLAND.egg * height) / stance.egg, width * 0.95)
  // Its box is one whose picture, wider by the spill, is a whole number of points across: on a
  // part of a point its square pixels are drawn in stripes.
  const size = Math.max(WHOLE, Math.round(picture / SPILL / WHOLE) * WHOLE)
  return {
    size,
    left: Math.round(width / 2 - size / 2),
    top: Math.round(
      ISLAND.ground.y * height - size * SPILL * stance.ground + (size * SPILL - size) / 2,
    ),
    /** How far down the window the grass under it is. */
    ground: Math.round(ISLAND.ground.y * height),
  }
}

/**
 * The sky and the island of the first run, behind everything: still pictures of the web's own
 * scene (scripts/island.mjs draws them), one over another, so that the night gives way to the
 * sunrise and the sunrise to the day. `light` runs from 0, the night, through 1, the sunrise,
 * to 2, the day. What stands on the island is its children, and moves up with it out of a
 * keyboard's way.
 */
export function Sky({ light, children }: { light: SharedValue<number>; children?: ReactNode }) {
  const { width, height } = useWindowDimensions()
  const keyboard = useReanimatedKeyboardAnimation()
  // The pictures are as tall as the window, and whatever width that makes them: a phone is
  // their shape, and a wide window has the night beside them.
  const wide = (ISLAND.width / ISLAND.height) * height
  const frame = {
    position: "absolute",
    top: 0,
    left: (width - wide) / 2,
    width: wide,
    height,
  } as const
  const lifted = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboard.height.value * LIFT }],
  }))
  const sunrise = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, light.value)) }))
  const day = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, light.value - 1)) }))
  return (
    <Animated.View style={[StyleSheet.absoluteFill, lifted]} pointerEvents="box-none">
      <View style={frame} pointerEvents="none">
        <Image
          source={PICTURES.night}
          style={StyleSheet.absoluteFill}
          contentFit="fill"
          accessible={false}
        />
        <Animated.View style={[StyleSheet.absoluteFill, sunrise]}>
          <Image
            source={PICTURES.sunrise}
            style={StyleSheet.absoluteFill}
            contentFit="fill"
            accessible={false}
          />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, day]}>
          <Image
            source={PICTURES.day}
            style={StyleSheet.absoluteFill}
            contentFit="fill"
            accessible={false}
          />
        </Animated.View>
      </View>
      {children}
    </Animated.View>
  )
}

/**
 * Words written out as they are said. Each time `key` changes they start again; once they have
 * been said, a change to them under the same key is shown whole. Someone who asked their phone
 * for less motion is shown them whole from the start.
 */
export function useTyped(text: string, key: string, on: boolean, each: (count: number) => void) {
  const [calm, setCalm] = useState(false)
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setCalm, () => {})
  }, [])
  const [at, setAt] = useState({ key, count: 0 })
  // Under a new key nothing has been said yet, from the first moment it is the key.
  const count = at.key === key ? at.count : calm ? ALL : 0
  const said = count >= text.length
  const heard = useRef(each)
  heard.current = each
  useEffect(() => {
    if (!on || said) return
    const timer = setTimeout(
      () => {
        const next = count + 1
        heard.current(next)
        setAt({ key, count: next >= text.length ? ALL : next })
      },
      /[.,!?:]/.test(text[count - 1] ?? "") ? 190 : 24,
    )
    return () => clearTimeout(timer)
  }, [on, said, count, text, key])
  return {
    shown: said ? text : text.slice(0, count),
    said,
    finish: () => setAt({ key, count: ALL }),
  }
}

/**
 * What stays at the foot of the scene: what the egg says, in a bubble of glass, and under it the
 * card that asks for something, which comes up from the foot and goes back down. Both keep clear
 * of the keyboard. `card` is null between cards; `id` names the card, so a new one comes up anew.
 */
export function Dock({
  tag,
  swatch,
  words,
  shown,
  onHurry,
  id,
  card,
}: {
  /** Who is speaking: "The egg", or its name. */
  tag: string
  swatch: string
  /** All that is being said, and as much of it as has been said so far. */
  words: string
  shown: string
  /** A tap on the bubble says the rest at once. */
  onHurry: () => void
  id: string
  card: ReactNode | null
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const keyboard = useReanimatedKeyboardAnimation()
  const lifted = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboard.height.value }],
  }))
  // What was said has been read by the time something is typed, and the egg needs the room.
  const quiet = useAnimatedStyle(() => ({ opacity: 1 - keyboard.progress.value }))
  return (
    <Animated.View style={[styles.dock, lifted]} pointerEvents="box-none">
      {words === "" ? null : (
        <Animated.View
          key={`says-${id}`}
          entering={FadeIn.duration(260)}
          exiting={FadeOut.duration(CARD_MS)}
          style={{ width: "100%" }}
        >
          <Animated.View style={quiet}>
            <Pressable
              accessibilityRole="text"
              accessibilityLabel={`${tag}: ${words}`}
              onPress={onHurry}
              style={styles.bubble}
            >
              <Glass
                tint={theme.card}
                style={{ borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, gap: 4 }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: swatch }} />
                  <Text variant="footnote" tone="ink2" weight="600">
                    {tag}
                  </Text>
                </View>
                {/* What is still to be said takes up its room unseen, so the bubble does not grow. */}
                <Text accessible={false}>
                  {shown}
                  <Text color="transparent">{words.slice(shown.length)}</Text>
                </Text>
              </Glass>
            </Pressable>
          </Animated.View>
        </Animated.View>
      )}
      {card === null ? (
        <View style={{ height: insets.bottom + 12 }} />
      ) : (
        <Animated.View
          key={`card-${id}`}
          entering={SlideInDown.duration(340)}
          exiting={SlideOutDown.duration(CARD_MS)}
          style={styles.sheet}
        >
          <Glass
            tint={theme.card}
            style={{
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              paddingTop: 10,
              paddingBottom: insets.bottom + 14,
            }}
          >
            <View style={[styles.grabber, { backgroundColor: theme.ink3 }]} />
            {card}
          </Glass>
        </Animated.View>
      )}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  dock: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center" },
  bubble: {
    width: "100%",
    maxWidth: 560,
    paddingHorizontal: 16,
    paddingBottom: 12,
    alignSelf: "center",
  },
  sheet: { width: "100%", maxWidth: 600 },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: "center", marginBottom: 12 },
})

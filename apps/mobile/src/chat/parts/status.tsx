import { LinearGradient } from "expo-linear-gradient"
import { memo, useEffect, useState } from "react"
import { View } from "react-native"
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated"
import { useTheme } from "@/lib/theme"
import { Text } from "@/ui"

/** How wide the band of light that crosses the words is. */
const BAND = 90

/**
 * What the agent is doing, as one line with a shine moving across it. The moving shine says it
 * is working; a spinner beside it would say it twice.
 */
export const StatusLine = memo(function StatusLine({ activity }: { activity: string }) {
  const theme = useTheme()
  const [width, setWidth] = useState(0)
  const at = useSharedValue(0)
  useEffect(() => {
    at.value = 0
    at.value = withRepeat(withTiming(1, { duration: 1_700, easing: Easing.linear }), -1)
    return () => cancelAnimation(at)
  }, [at])
  const shine = useAnimatedStyle(() => ({
    transform: [{ translateX: -BAND + at.value * (width + BAND * 2) }],
  }))
  // The page's own color, from nothing to nearly all of it and back: it dims the words it is over.
  const clear = `${theme.page}00`
  const veil = `${theme.page}c8`
  return (
    <View
      role="status"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${activity}…`}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ alignSelf: "flex-start", maxWidth: "100%", overflow: "hidden", paddingVertical: 2 }}
    >
      <Text variant="subhead" tone="ink2" weight="500" numberOfLines={1}>
        {activity}…
      </Text>
      <Animated.View
        pointerEvents="none"
        style={[{ position: "absolute", top: 0, bottom: 0, left: 0, width: BAND }, shine]}
      >
        <LinearGradient
          colors={[clear, veil, clear]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  )
})

import type { ReactNode } from "react"
import { Pressable, View } from "react-native"
import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable"
import { useTheme } from "@/lib/theme"
import { haptic } from "./haptics"
import { Icon, type IconName } from "./icon"
import { Text } from "./text"

export type SwipeAction = {
  title: string
  icon: IconName
  /** `tint`, `grey` or `red`, or a color of its own. */
  color: "tint" | "grey" | "red" | (string & {})
  onPress: () => void
}

const WIDTH = 74

/**
 * A row that slides aside to show what can be done with it. The actions are at its trailing
 * edge, the last one nearest the edge, as Mail's are. Everything they do is also in the row's
 * own page or menu, for someone who does not swipe.
 */
export function SwipeRow({ actions, children }: { actions: SwipeAction[]; children: ReactNode }) {
  const theme = useTheme()
  if (actions.length === 0) return <>{children}</>
  const fill = (color: SwipeAction["color"]) =>
    color === "tint"
      ? theme.tint
      : color === "grey"
        ? "#8b949a"
        : color === "red"
          ? theme.red
          : color
  return (
    <Swipeable
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      onSwipeableWillOpen={() => haptic.light()}
      renderRightActions={(_progress, _translation, methods: SwipeableMethods) => (
        <View style={{ flexDirection: "row" }}>
          {actions.map((action) => (
            <Pressable
              key={action.title}
              accessibilityRole="button"
              accessibilityLabel={action.title}
              onPress={() => {
                methods.close()
                action.onPress()
              }}
              style={{
                width: WIDTH,
                backgroundColor: fill(action.color),
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <Icon name={action.icon} size={20} color="#fff" weight="semibold" />
              <Text variant="caption" weight="600" color="#fff" numberOfLines={1}>
                {action.title}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    >
      {children}
    </Swipeable>
  )
}

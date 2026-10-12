import type { ReactNode } from "react"
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from "react-native"
import { useTheme } from "@/lib/theme"
import { Icon, type IconName } from "./icon"
import { Text } from "./text"

/**
 * A button. `filled` is the one thing to do on a screen, `grey` is another, `line` is on a white
 * card, and `plain` is words alone. `color` gives a filled one an agent's accent.
 */
export function Button({
  title,
  onPress,
  kind = "filled",
  size = "large",
  icon,
  color,
  onColor,
  destructive = false,
  busy = false,
  disabled = false,
  style,
  children,
  accessibilityLabel,
  testID,
}: {
  title?: string
  onPress?: () => void
  kind?: "filled" | "grey" | "line" | "plain"
  size?: "large" | "medium" | "small"
  icon?: IconName
  color?: string
  onColor?: string
  destructive?: boolean
  busy?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
  children?: ReactNode
  accessibilityLabel?: string
  testID?: string
}) {
  const theme = useTheme()
  const height = size === "large" ? 50 : size === "medium" ? 40 : 34
  const fill =
    kind === "filled"
      ? (color ?? theme.tint)
      : kind === "grey"
        ? theme.fill
        : kind === "line"
          ? theme.card
          : "transparent"
  const ink = destructive
    ? kind === "filled"
      ? "#fff"
      : theme.red
    : kind === "filled"
      ? (onColor ?? (color === undefined ? theme.onTint : "#fff"))
      : kind === "plain"
        ? (color ?? theme.tint)
        : theme.ink
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      testID={testID}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height,
          borderRadius: height / 2,
          borderCurve: "continuous",
          paddingHorizontal: size === "large" ? 20 : 14,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          backgroundColor: destructive && kind === "filled" ? theme.red : fill,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
        kind === "line" ? { borderWidth: 1, borderColor: theme.sep } : null,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <>
          {icon === undefined ? null : (
            <Icon name={icon} size={size === "large" ? 19 : 16} color={ink} weight="semibold" />
          )}
          {title === undefined ? null : (
            <Text
              variant={size === "large" ? "headline" : "subhead"}
              weight="600"
              color={ink}
              numberOfLines={1}
            >
              {title}
            </Text>
          )}
          {children}
        </>
      )}
    </Pressable>
  )
}

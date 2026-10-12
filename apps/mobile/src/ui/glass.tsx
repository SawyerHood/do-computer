import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect"
import type { ReactNode } from "react"
import { Platform, Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native"
import { useTheme } from "@/lib/theme"
import { Icon, type IconName } from "./icon"

/** Whether this phone draws the system's glass: iOS 26 and later. */
export const hasGlass = Platform.OS === "ios" && isLiquidGlassAvailable()

/**
 * A surface that floats over the page: the system's glass where there is any, and elsewhere a
 * card with a hairline and a soft shadow, which is what glass is standing in for.
 */
export function Glass({
  children,
  style,
  interactive = false,
  tint,
}: {
  children?: ReactNode
  style?: StyleProp<ViewStyle>
  /** It answers a touch, as a button's glass does. */
  interactive?: boolean
  tint?: string
}) {
  const theme = useTheme()
  if (hasGlass) {
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive={interactive}
        tintColor={tint}
        style={style}
      >
        {children}
      </GlassView>
    )
  }
  return (
    <View
      style={[
        {
          backgroundColor: tint ?? theme.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.sep,
          shadowColor: "#000",
          shadowOpacity: theme.dark ? 0.4 : 0.1,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

/** A round glass button with one symbol in it, 44 points across, as a bar's buttons are. */
export function GlassButton({
  icon,
  onPress,
  label,
  size = 44,
  color,
  badge,
  testID,
}: {
  icon: IconName
  onPress?: () => void
  /** What it does, for someone who cannot see the symbol. */
  label: string
  size?: number
  color?: string
  /** A small count at its corner. */
  badge?: ReactNode
  testID?: string
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      testID={testID}
    >
      <Glass
        interactive
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon
          name={icon}
          size={Math.round(size * 0.48)}
          color={color ?? theme.ink}
          weight="medium"
        />
      </Glass>
      {badge}
    </Pressable>
  )
}

import type { ReactNode } from "react"
import { Pressable, useWindowDimensions, View } from "react-native"
import { radius, useTheme } from "@/lib/theme"
import { Glass, Icon, Text } from "@/ui"

/**
 * What is in the middle of a chat's bar: a creature, whose chat it is, and a word under that
 * for what is going on in it. One that leads somewhere (the agent's page) has a small arrow.
 */
export function ChatTitle({
  face,
  title,
  subtitle,
  strong = false,
  label,
  onPress,
}: {
  face?: ReactNode
  title: string
  subtitle?: string | undefined
  /** The word under the title is one to notice: something waits for the reader. */
  strong?: boolean
  /** What pressing it does, for someone who cannot see it. */
  label?: string
  onPress?: (() => void) | undefined
}) {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const content = (
    <Glass
      interactive={onPress !== undefined}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 44,
        maxWidth: Math.max(160, width - 190),
        borderRadius: radius.pill,
        paddingLeft: face === undefined ? 16 : 6,
        paddingRight: onPress === undefined ? 16 : 10,
      }}
    >
      {face}
      <View style={{ flexShrink: 1 }}>
        <Text variant="headline" numberOfLines={1}>
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text
            variant="caption"
            tone={strong ? "ink" : "ink2"}
            numberOfLines={1}
            accessibilityLiveRegion="polite"
          >
            {subtitle}
          </Text>
        )}
      </View>
      {onPress === undefined ? null : (
        <Icon name="chevronRight" size={11} color={theme.ink3} weight="bold" />
      )}
    </Glass>
  )
  if (onPress === undefined) return content
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      onPress={onPress}
      hitSlop={4}
    >
      {content}
    </Pressable>
  )
}

import type { ReactNode } from "react"
import { ScrollView, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Text } from "@/components/ui"
import { space, useTheme } from "@/lib/theme"

/** A scrolling tab screen with a title, an optional line under it, and an optional action. */
export function Screen({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
}) {
  const theme = useTheme()
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.canvas }}>
      <ScrollView
        contentContainerStyle={{ padding: space(5), gap: space(4), paddingBottom: space(10) }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(3) }}>
          <View style={{ flex: 1, gap: space(1) }}>
            <Text size={24} weight="600" accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? (
              <Text tone="muted" size={14}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {action}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  )
}

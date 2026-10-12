import { Stack } from "expo-router"
import { Pressable, View } from "react-native"
import { useTheme } from "@/lib/theme"
import { Icon } from "./icon"
import type { HeaderItem } from "./header-types"
import { Menu } from "./menu"
import { Text } from "./text"

/**
 * The buttons at one end of a screen's bar. Here they are plain views in the header; on iOS
 * they are the bar's own buttons (see header.ios.tsx). Put it anywhere in a screen's page.
 */
export function HeaderItems({
  items,
  placement = "right",
}: {
  items: HeaderItem[]
  placement?: "left" | "right"
}) {
  const theme = useTheme()
  const shown = items.filter((item) => item.hidden !== true)
  const render = () => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
      {shown.map((item) => {
        const face =
          item.text !== undefined ? (
            <Text weight={item.prominent ? "600" : "400"} tone="tint">
              {item.text}
            </Text>
          ) : (
            <Icon name={item.icon ?? "more"} size={22} color={theme.tint} weight="medium" />
          )
        return item.menu !== undefined ? (
          <Menu key={item.label} items={item.menu} title={item.label}>
            <View accessibilityLabel={item.label}>{face}</View>
          </Menu>
        ) : (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            disabled={item.disabled}
            onPress={item.onPress}
            hitSlop={8}
            style={{ opacity: item.disabled ? 0.4 : 1 }}
          >
            {face}
          </Pressable>
        )
      })}
    </View>
  )
  return (
    <Stack.Screen
      options={placement === "left" ? { headerLeft: render } : { headerRight: render }}
    />
  )
}

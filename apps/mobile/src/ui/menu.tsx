import { useState } from "react"
import { Modal, Pressable, View } from "react-native"
import { radius, useTheme } from "@/lib/theme"
import { Icon } from "./icon"
import type { MenuItem, MenuProps } from "./menu-types"
import { Text } from "./text"

const flat = (items: MenuItem[]): MenuItem[] =>
  items.flatMap((item) => (item.children === undefined ? [item] : flat(item.children)))

/**
 * A menu on whatever is inside it. On iOS it is the system's own (see menu.ios.tsx). Here, where
 * there is none, it is a short list over the page.
 */
export function Menu({ items, children, longPress = false, title, style, testID }: MenuProps) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const show = () => setOpen(true)
  return (
    <>
      <Pressable
        // A menu kept under a long press is around a row that is a button already, and a
        // button inside a button is two things by the same name to whoever asks for one.
        accessibilityRole={longPress ? undefined : "button"}
        accessibilityHint="Opens a menu"
        testID={testID}
        style={style}
        onPress={longPress ? undefined : show}
        onLongPress={longPress ? show : undefined}
      >
        {children}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          accessibilityLabel="Close the menu"
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: theme.scrim, justifyContent: "center", padding: 32 }}
        >
          <View
            accessibilityRole="menu"
            accessibilityLabel={title}
            style={{
              backgroundColor: theme.card,
              borderRadius: radius.md,
              overflow: "hidden",
              maxWidth: 320,
              alignSelf: "center",
              minWidth: 240,
            }}
          >
            {flat(items).map((item) => (
              <Pressable
                key={item.title}
                accessibilityRole="menuitem"
                accessibilityState={{ disabled: item.disabled, checked: item.checked }}
                disabled={item.disabled}
                onPress={() => {
                  setOpen(false)
                  item.onPress?.()
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  opacity: item.disabled ? 0.4 : 1,
                }}
              >
                <Text style={{ flex: 1 }} tone={item.destructive ? "red" : "ink"}>
                  {item.title}
                </Text>
                {item.checked ? (
                  <Icon name="check" size={18} color={theme.tint} weight="semibold" />
                ) : null}
                {item.icon === undefined ? null : (
                  <Icon
                    name={item.icon}
                    size={18}
                    color={item.destructive ? theme.red : theme.ink2}
                  />
                )}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

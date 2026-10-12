import { type MenuAction, MenuView } from "@expo/ui/community/menu"
import { Children, cloneElement, isValidElement, type ReactElement, useMemo } from "react"
import { ActionSheetIOS, Pressable, View } from "react-native"
import { haptic } from "./haptics"
import { ICONS } from "./icons"
import type { MenuItem, MenuProps } from "./menu-types"

/** The system's own menu on whatever is inside it: a pull-down on a tap, or a context menu on a hold. */
export function Menu({ items, children, longPress = false, title, style, testID }: MenuProps) {
  const { actions, handlers } = useMemo(() => {
    const handlers = new Map<string, () => void>()
    let next = 0
    const convert = (item: MenuItem): MenuAction => {
      const id = `m${next++}`
      if (item.onPress !== undefined) handlers.set(id, item.onPress)
      return {
        id,
        title: item.title,
        image: item.icon === undefined ? undefined : ICONS[item.icon][0],
        state: item.checked === undefined ? undefined : item.checked ? "on" : "off",
        attributes: { destructive: item.destructive, disabled: item.disabled },
        subactions: item.children?.map(convert),
        displayInline: item.inline,
      }
    }
    return { actions: items.map(convert), handlers }
  }, [items])
  // A context menu is on a row, which is as wide as the room it is given. The system's own
  // menu view lets what it holds be only as wide as its words, and puts it in a view of its
  // own, which hides it from whoever reads the screen aloud. So a hold on a row brings the
  // system's sheet of actions up from the foot instead, and the row itself is left as it is.
  if (longPress) {
    const open = () => {
      const offered = flat(items).filter((item) => !item.disabled)
      if (offered.length === 0) return
      haptic.medium()
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options: [...offered.map((item) => item.title), "Cancel"],
          cancelButtonIndex: offered.length,
          destructiveButtonIndex: offered.flatMap((item, at) => (item.destructive ? [at] : [])),
        },
        (chosen) => offered[chosen]?.onPress?.(),
      )
    }
    const only = Children.count(children) === 1 && isValidElement(children) ? children : undefined
    return (
      <View style={style} testID={testID}>
        {only === undefined ? (
          <Pressable onLongPress={open} delayLongPress={350}>
            {children}
          </Pressable>
        ) : (
          cloneElement(
            only as ReactElement<{ onLongPress?: () => void; delayLongPress?: number }>,
            {
              onLongPress: open,
              delayLongPress: 350,
            },
          )
        )}
      </View>
    )
  }
  return (
    <MenuView
      title={title}
      actions={actions}
      onPressAction={(event) => handlers.get(event.nativeEvent.event)?.()}
      style={style}
      testID={testID}
    >
      {children}
    </MenuView>
  )
}

const flat = (items: MenuItem[]): MenuItem[] =>
  items.flatMap((item) => (item.children === undefined ? [item] : flat(item.children)))

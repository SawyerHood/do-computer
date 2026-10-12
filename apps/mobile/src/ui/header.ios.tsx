import { Stack } from "expo-router"
import { ICONS } from "./icons"
import type { HeaderItem } from "./header-types"
import type { MenuItem } from "./menu-types"

function entries(items: MenuItem[], path = "m") {
  return items.map((item, at) => {
    const key = `${path}${at}`
    const icon = item.icon === undefined ? undefined : ICONS[item.icon][0]
    if (item.children !== undefined) {
      return (
        <Stack.Toolbar.Menu key={key} title={item.title} icon={icon} inline={item.inline}>
          {entries(item.children, `${key}-`)}
        </Stack.Toolbar.Menu>
      )
    }
    return (
      <Stack.Toolbar.MenuAction
        key={key}
        icon={icon}
        destructive={item.destructive}
        disabled={item.disabled}
        isOn={item.checked}
        onPress={item.onPress}
      >
        {item.title}
      </Stack.Toolbar.MenuAction>
    )
  })
}

/**
 * The buttons at one end of a screen's bar, as the bar's own: glass on iOS 26, with the
 * system's pull-down menus. Put it anywhere in a screen's page.
 */
export function HeaderItems({
  items,
  placement = "right",
}: {
  items: HeaderItem[]
  placement?: "left" | "right"
}) {
  return (
    <Stack.Toolbar placement={placement}>
      {items.map((item) => {
        const icon =
          item.text !== undefined || item.icon === undefined ? undefined : ICONS[item.icon][0]
        if (item.menu !== undefined) {
          return (
            <Stack.Toolbar.Menu
              key={item.label}
              icon={icon}
              title={item.text}
              accessibilityLabel={item.label}
              hidden={item.hidden}
            >
              {entries(item.menu)}
            </Stack.Toolbar.Menu>
          )
        }
        return (
          <Stack.Toolbar.Button
            key={item.label}
            icon={icon}
            variant={item.prominent ? "prominent" : "plain"}
            disabled={item.disabled}
            hidden={item.hidden}
            accessibilityLabel={item.label}
            onPress={item.onPress}
          >
            {item.text}
          </Stack.Toolbar.Button>
        )
      })}
    </Stack.Toolbar>
  )
}

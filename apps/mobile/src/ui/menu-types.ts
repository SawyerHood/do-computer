import type { ReactNode } from "react"
import type { StyleProp, ViewStyle } from "react-native"
import type { IconName } from "./icons"

/** One thing a menu offers. `children` makes it a group: a submenu, or `inline` a section. */
export type MenuItem = {
  title: string
  icon?: IconName
  onPress?: () => void
  destructive?: boolean
  disabled?: boolean
  /** A tick beside it, for the one of several that is chosen. */
  checked?: boolean
  children?: MenuItem[]
  inline?: boolean
}

export type MenuProps = {
  items: MenuItem[]
  children: ReactNode
  /** Opened by pressing and holding, as a context menu is, and not by a tap. */
  longPress?: boolean
  title?: string
  style?: StyleProp<ViewStyle>
  testID?: string
}

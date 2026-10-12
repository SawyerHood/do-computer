import type { IconName } from "./icons"
import type { MenuItem } from "./menu-types"

/**
 * One thing in a screen's bar. With `menu` it opens one; otherwise it does `onPress`. `text`
 * shows words where a symbol would be, for "Done" and "Save".
 */
export type HeaderItem = {
  icon?: IconName
  /** What it does, for someone who cannot see the symbol. */
  label: string
  text?: string
  onPress?: () => void
  menu?: MenuItem[]
  /** The one thing to do on the screen: drawn filled. */
  prominent?: boolean
  disabled?: boolean
  hidden?: boolean
}

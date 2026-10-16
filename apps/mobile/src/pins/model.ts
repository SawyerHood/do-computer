// What the phone works out from what is pinned to a Dood: what pressing a file's pin does, and
// how the pins are offered as a menu. Nothing here draws or asks the server.
import { type LibraryFile, type Pin, type PinnedEntry, pinOf } from "@do-computer/protocol"
import { KIND_ICON, kindOf } from "@/library/model"
import type { IconName } from "@/ui/icons"
import type { MenuItem } from "@/ui/menu-types"

/** How a file's pin stands, and the words and symbol of the press that changes it. */
export type PinChoice = {
  pinned: boolean
  /** The file the pin is kept under, which is what is unpinned: it may be of the same place. */
  fileId: string
  /** For a menu, which says whose pin it is: "Pin to Juniper", "Unpin from Juniper". */
  title: string
  /** For a swipe, where there is room for one word. */
  short: "Pin" | "Unpin"
  icon: IconName
}

/**
 * What pressing a file's pin would do: pin it to the Dood, or take its pin off. A file from
 * before files had a place cannot be pinned, and has none.
 */
export function pinChoice(
  pins: readonly Pin[] | undefined,
  file: { id: string; path?: string | undefined },
  name: string,
): PinChoice | undefined {
  if (file.path === undefined) return undefined
  const mine = pinOf(pins, { id: file.id, path: file.path })
  return mine === undefined
    ? { pinned: false, fileId: file.id, title: `Pin to ${name}`, short: "Pin", icon: "pin" }
    : {
        pinned: true,
        fileId: mine.fileId,
        title: `Unpin from ${name}`,
        short: "Unpin",
        icon: "pinSlash",
      }
}

/**
 * The pins as the items of a menu, each opening its file. A pin whose file is gone is listed,
 * saying so, and cannot be pressed. Where the system has no menus within menus the items are
 * listed among the rest, so each says what it does.
 */
export function pinnedMenuItems(
  entries: readonly PinnedEntry<LibraryFile>[],
  nested: boolean,
  open: (file: LibraryFile) => void,
): MenuItem[] {
  return entries.map(({ file, title }) =>
    file === undefined
      ? { title: `${title} (no longer in the library)`, icon: "doc", disabled: true }
      : {
          title: nested ? title : `Open ${title}`,
          icon: KIND_ICON[kindOf(file)],
          onPress: () => open(file),
        },
  )
}

import type { LibraryFile, SiteSummary } from "@do-computer/protocol"
import type { ReactNode } from "react"
import { Platform, View } from "react-native"
import { formatBytes } from "@/lib/files"
import { useTheme } from "@/lib/theme"
import { Icon, Menu, type MenuItem, Row, type SwipeAction, SwipeRow, Text } from "@/ui"
import { formatWhen, KIND_ICON, kindOf, type FolderEntry } from "./model"

/** The mark on something shared with a link: a globe if anyone can open it, a link if not. */
export function SharedMark({ site }: { site: Pick<SiteSummary, "public"> | undefined }) {
  const theme = useTheme()
  if (site === undefined) return null
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={
        site.public ? "Shared with anyone who has the link" : "Shared with a link"
      }
    >
      <Icon name={site.public ? "globe" : "link"} size={15} color={theme.tint} weight="medium" />
    </View>
  )
}

/** The mark on a file that is pinned to the Dood whose library this is. */
export function PinnedMark({ name }: { name: string }) {
  const theme = useTheme()
  return (
    <View accessibilityRole="image" accessibilityLabel={`Pinned to ${name}`}>
      <Icon name="pin" size={15} color={theme.amber} weight="medium" />
    </View>
  )
}

/**
 * A row with everything that can be done to it: aside under a swipe, and in a menu. On iOS the
 * menu is the system's, under a hold. Elsewhere a hold is not something a row can be given
 * without losing its tap, so the same menu is behind three dots at the row's end.
 */
export function Acted({
  name,
  menu,
  swipe,
  children,
}: {
  name: string
  menu: MenuItem[]
  swipe: SwipeAction[]
  children: (more: ReactNode) => ReactNode
}) {
  const theme = useTheme()
  const more =
    Platform.OS === "ios" || menu.length === 0 ? null : (
      <Menu items={menu} title={`More for ${name}`}>
        <View accessibilityLabel={`More for ${name}`} style={{ padding: 6 }}>
          <Icon name="more" size={20} color={theme.ink2} weight="medium" />
        </View>
      </Menu>
    )
  const row = <View style={{ backgroundColor: theme.card }}>{children(more)}</View>
  return (
    <SwipeRow actions={swipe}>
      {Platform.OS === "ios" && menu.length > 0 ? (
        <Menu items={menu} longPress title={name}>
          {row}
        </Menu>
      ) : (
        row
      )}
    </SwipeRow>
  )
}

/** A folder, as the Files app lists one: its symbol in the tint, its name, how much is inside. */
export function FolderRow({
  folder,
  site,
  menu = [],
  swipe = [],
  onPress,
}: {
  folder: FolderEntry
  site?: SiteSummary | undefined
  menu?: MenuItem[]
  swipe?: SwipeAction[]
  onPress: () => void
}) {
  const theme = useTheme()
  return (
    <Acted name={folder.name} menu={menu} swipe={swipe}>
      {(more) => (
        <Row
          lead={<Icon name="folder" size={26} color={theme.tint} weight="regular" />}
          title={folder.name}
          accessibilityLabel={`The folder ${folder.name}, ${folder.count} inside`}
          tail={
            <>
              <SharedMark site={site} />
              <Text tone="ink2">{folder.count}</Text>
              {more}
            </>
          }
          go
          onPress={onPress}
        />
      )}
    </Acted>
  )
}

/** A file: a symbol for its kind, its name, and under it how big, who made it and when. */
export function FileRow({
  file,
  title,
  by,
  site,
  pinnedTo,
  menu = [],
  swipe = [],
  onPress,
}: {
  file: LibraryFile
  /** What to call it where its name is not enough: its whole path among search results. */
  title?: string
  /** Who last changed it. */
  by?: string
  site?: SiteSummary | undefined
  /** The name of the Dood it is pinned to, when it is. */
  pinnedTo?: string | undefined
  menu?: MenuItem[]
  swipe?: SwipeAction[]
  onPress: () => void
}) {
  const theme = useTheme()
  const line = [formatBytes(file.size), by, formatWhen(file.updatedAt)].filter(Boolean).join(" · ")
  return (
    <Acted name={file.name} menu={menu} swipe={swipe}>
      {(more) => (
        <Row
          lead={
            <Icon name={KIND_ICON[kindOf(file)]} size={26} color={theme.ink2} weight="regular" />
          }
          title={title ?? file.name}
          subtitle={line}
          accessibilityLabel={`${title ?? file.name}${pinnedTo === undefined ? "" : ", pinned"}, ${line}`}
          tail={
            <>
              {pinnedTo === undefined ? null : <PinnedMark name={pinnedTo} />}
              <SharedMark site={site} />
              {more}
            </>
          }
          onPress={onPress}
        />
      )}
    </Acted>
  )
}

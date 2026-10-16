import {
  type LibraryFile,
  type PinnedEntry,
  pageShownAt,
  pinnedEntries,
} from "@do-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { Pressable, StyleSheet, View } from "react-native"
import { useTheme } from "@/lib/theme"
import { dirOf, formatWhen, KIND_ICON, kindOf, withPictures } from "@/library/model"
import { PageView } from "@/library/page-view"
import { Acted } from "@/library/rows"
import { textKey } from "@/library/use-document"
import { useLibrary } from "@/library/use-library"
import { Button, Icon, Row, Section, Text } from "@/ui"
import { Markdown } from "@/ui/markdown"
import { PIN_COLOR, usePinning } from "./pins"

/** How long a pin says that it has just changed, as the web's does. */
const FRESH_MS = 4_000
/** How tall the first pin is drawn, when it is drawn as what it is. */
const SMALL_HEIGHT = 180

/** Whether what a pin shows changed a moment ago, while it was being looked at. */
function useJustChanged(at: number): boolean {
  const [fresh, setFresh] = useState(false)
  const seen = useRef(at)
  useEffect(() => {
    if (seen.current === at) return
    seen.current = at
    setFresh(true)
    const timer = setTimeout(() => setFresh(false), FRESH_MS)
    return () => clearTimeout(timer)
  }, [at])
  return fresh
}

/** Whether a file can be drawn small, as the web draws the first pin: a page, a document, a picture. */
const drawsSmall = (file: LibraryFile) => {
  const kind = kindOf(file)
  return kind === "page" || kind === "markdown" || kind === "image"
}

/** When what a file shows last changed: a page is as new as what is beside it. */
const shownAt = (files: readonly LibraryFile[], file: LibraryFile) =>
  kindOf(file) === "page" ? pageShownAt(files, file) : file.updatedAt

/**
 * What is pinned to a Dood, on its page under its face, as the web has it under the face in
 * the Dood's panel: the first drawn small as what it is and kept current, the rest by name.
 * Each opens in the library. A pin slides aside, or is held, to be taken off. With nothing
 * pinned there is no section.
 */
export function PinnedSection({ agentId, name }: { agentId: string; name: string }) {
  const router = useRouter()
  const { pins, unpin } = usePinning(agentId)
  const library = useLibrary(agentId)
  const listing = library.listing.data
  if (pins === undefined || pins.length === 0 || listing === undefined) return null
  const entries = pinnedEntries(pins, listing.files)
  const open = (file: LibraryFile) => router.push(`/a/${agentId}/library/${file.id}`)
  return (
    <Section
      title="Pinned"
      action={
        <Text variant="footnote" tone="ink2">
          {pins.length}
        </Text>
      }
      footer={`Pinned for everyone who uses ${name}. Pin a file from its menu in the library.`}
    >
      {entries.map((entry, at) =>
        entry.file === undefined ? (
          <Gone
            key={entry.pin.fileId}
            title={entry.title}
            onUnpin={() => unpin(entry.pin.fileId)}
          />
        ) : (
          <Pinned
            key={entry.pin.fileId}
            agentId={agentId}
            entry={entry as PinnedEntry<LibraryFile> & { file: LibraryFile }}
            files={listing.files}
            view={listing.view}
            large={at === 0 && drawsSmall(entry.file)}
            onOpen={open}
            onUnpin={() => unpin(entry.pin.fileId)}
          />
        ),
      )}
    </Section>
  )
}

/** A pin whose file was deleted. It stays, saying so, until it is taken off: the file can be brought back. */
function Gone({ title, onUnpin }: { title: string; onUnpin: () => void }) {
  const theme = useTheme()
  return (
    <Row
      lead={<Icon name="doc" size={24} color={theme.ink3} weight="regular" />}
      title={
        <Text tone="ink2" numberOfLines={1}>
          {title}
        </Text>
      }
      subtitle="No longer in the library"
      tail={
        <Button
          kind="plain"
          size="small"
          title="Unpin"
          accessibilityLabel={`Unpin ${title}`}
          onPress={onUnpin}
        />
      }
    />
  )
}

/** One thing that is pinned: drawn small over its row when it is the first and can be. */
function Pinned({
  agentId,
  entry,
  files,
  view,
  large,
  onOpen,
  onUnpin,
}: {
  agentId: string
  entry: PinnedEntry<LibraryFile> & { file: LibraryFile }
  files: readonly LibraryFile[]
  view: string
  large: boolean
  onOpen: (file: LibraryFile) => void
  onUnpin: () => void
}) {
  const theme = useTheme()
  const { file, title } = entry
  const at = shownAt(files, file)
  const fresh = useJustChanged(at)
  const folder = dirOf(file.path)
  const when = fresh ? "Just changed" : formatWhen(at)
  return (
    <Acted
      name={title}
      menu={[
        { title: "Open", icon: "doc", onPress: () => onOpen(file) },
        { title: "Unpin", icon: "pinSlash", onPress: onUnpin },
      ]}
      swipe={[{ title: "Unpin", icon: "pinSlash", color: PIN_COLOR, onPress: onUnpin }]}
    >
      {(more) => (
        <View>
          {large ? (
            <Pressable
              accessibilityRole="imagebutton"
              accessibilityLabel={`Open ${title}`}
              onPress={() => onOpen(file)}
              style={({ pressed }) => ({
                height: SMALL_HEIGHT,
                overflow: "hidden",
                backgroundColor: theme.page,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: theme.sep,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              {/* Only to be looked at: a press anywhere on it opens the file itself. */}
              <View pointerEvents="none" style={{ flex: 1 }}>
                <Small agentId={agentId} file={file} files={files} view={view} at={at} />
              </View>
            </Pressable>
          ) : null}
          <Row
            lead={
              <Icon name={KIND_ICON[kindOf(file)]} size={24} color={theme.ink2} weight="regular" />
            }
            title={title}
            subtitle={
              <Text variant="subhead" tone={fresh ? "tint" : "ink2"} numberOfLines={1}>
                {[folder, when].filter((part) => part !== "").join(" · ")}
              </Text>
            }
            accessibilityLabel={`${title}, ${when}`}
            tail={more}
            go
            onPress={() => onOpen(file)}
          />
        </View>
      )}
    </Acted>
  )
}

/** A pinned file drawn as what it is, at the size of the page it is on: a page, a document, a picture. */
function Small({
  agentId,
  file,
  files,
  view,
  at,
}: {
  agentId: string
  file: LibraryFile
  files: readonly LibraryFile[]
  view: string
  at: number
}) {
  const library = useLibrary(agentId)
  const kind = kindOf(file)
  const url = library.api.libraryViewUrl(view, file.path)
  const { data: text } = useQuery({
    queryKey: textKey(agentId, file.id, file.rev),
    queryFn: () => library.api.libraryText(file.id, file.rev),
    // A revision's content never changes.
    staleTime: Number.POSITIVE_INFINITY,
    enabled: kind === "markdown",
  })
  const shown = useMemo(
    () =>
      text === undefined
        ? undefined
        : withPictures(text, dirOf(file.path), new Set(files.map((each) => each.path)), (path) =>
            library.api.libraryViewUrl(view, path),
          ),
    [text, file.path, files, library.api, view],
  )
  if (kind === "image") {
    return (
      <Image
        source={{ uri: `${url}?v=${file.rev}` }}
        accessible={false}
        contentFit="cover"
        contentPosition="top"
        style={{ flex: 1 }}
      />
    )
  }
  if (kind === "markdown") {
    return shown === undefined ? null : (
      <View style={{ paddingHorizontal: 18, paddingTop: 12 }}>
        <Markdown text={shown} selectable={false} />
      </View>
    )
  }
  // A page is loaded again whenever it or anything beside it changes, so it shows what is there.
  return <PageView key={at} uri={`${url}?v=${at}`} title={file.name} />
}

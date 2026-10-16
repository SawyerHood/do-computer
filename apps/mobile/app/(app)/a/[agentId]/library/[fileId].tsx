import { type LibraryFile, resolveLink } from "@do-computer/protocol"
import { Image } from "expo-image"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import { useMemo, useState } from "react"
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Text as NativeText,
  useWindowDimensions,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Film } from "@/chat/parts/film"
import { Sound } from "@/chat/parts/sound"
import { formatBytes } from "@/lib/files"
import { authHeaders } from "@/lib/session"
import { mono, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Conflict, Editor } from "@/library/editor"
import { dirOf, kindOf, parseCsv, siteOfFile, withPictures } from "@/library/model"
import { PageView } from "@/library/page-view"
import { SAVE_WORDS, useDocument } from "@/library/use-document"
import { useLibrary, useLibraryActions } from "@/library/use-library"
import { usePinOf } from "@/pins/pins"
import {
  Button,
  Empty,
  errorText,
  Glass,
  HeaderItems,
  Icon,
  type MenuItem,
  Screen,
  Segmented,
  Text,
} from "@/ui"
import { Markdown } from "@/ui/markdown"

type Mode = "read" | "edit"

/** Pictures the file's own address serves as pictures. Any other kind is served as a download there. */
const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

const BROWSER =
  Platform.OS === "ios"
    ? "Open in Safari"
    : Platform.OS === "web"
      ? "Open in a new tab"
      : "Open in the browser"

/**
 * One file of the library, shown as what it is: a document to read and edit, a page, a
 * picture, a film or a sound to play, a PDF, text, or for anything else its name and a way to
 * get it.
 */
export default function Document() {
  const params = useLocalSearchParams<{ agentId: string; fileId: string; mode?: string }>()
  const library = useLibrary(params.agentId)
  const file = library.files.find((each) => each.id === params.fileId)
  if (file === undefined || library.view === undefined) {
    return (
      <Screen page>
        <Stack.Screen options={{ title: "" }} />
        {library.listing.data !== undefined ? (
          <Empty title="This file is no longer in the library." />
        ) : library.listing.error ? (
          <Empty title="This file could not be read. Try again.">
            {errorText(library.listing.error)}
          </Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 48 }} />
        )}
      </Screen>
    )
  }
  return (
    // A different file is a different edit: nothing typed carries over.
    <Opened
      key={file.id}
      agentId={params.agentId}
      file={file}
      view={library.view}
      startEditing={params.mode === "edit"}
    />
  )
}

function Opened({
  agentId,
  file,
  view,
  startEditing,
}: {
  agentId: string
  file: LibraryFile
  view: string
  startEditing: boolean
}) {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const window = useWindowDimensions()
  const { auth } = useSession()
  const library = useLibrary(agentId)
  const actions = useLibraryActions(agentId)
  const pin = usePinOf(agentId)(file)
  const kind = kindOf(file)
  const written = kind === "markdown" || kind === "page" || kind === "text" || kind === "csv"
  const [mode, setMode] = useState<Mode>(startEditing && written ? "edit" : "read")
  const [reloads, setReloads] = useState(0)
  const document = useDocument(agentId, file, written)
  const site = siteOfFile(library.sites.data, file.path)
  const editing = written && mode === "edit"
  const home = `/a/${agentId}/library` as const
  const { files, api } = library

  // A page shows what is beside it, so it is as new as the newest file in its top folder.
  const stamp = useMemo(() => {
    const top = file.path.includes("/") ? `${file.path.split("/")[0]}/` : ""
    return Math.max(
      ...files.filter((each) => each.path.startsWith(top)).map((each) => each.updatedAt),
    )
  }, [files, file.path])
  const viewUrl = api.libraryViewUrl(view, file.path)

  const words = SAVE_WORDS[document.state]
  const folder = dirOf(file.path)
  const under = [folder, folder === "" ? words : words.charAt(0).toLowerCase() + words.slice(1)]
    .filter((part) => part !== "")
    .join(" · ")

  const leaveEdit = () => {
    Keyboard.dismiss()
    setMode("read")
  }
  /** A link in a document: to another file of the library, which opens here, or to anywhere else. */
  const follow = (href: string) => {
    const path = resolveLink(folder, href)
    const target = path === undefined ? undefined : files.find((each) => each.path === path)
    if (target === undefined) return false
    router.push(`${home}/${target.id}`)
    return true
  }
  /** The document with its own pictures at addresses that show them: the library's view of each. */
  const shown = useMemo(
    () =>
      kind !== "markdown" || document.text === undefined
        ? ""
        : withPictures(document.text, folder, new Set(files.map((each) => each.path)), (path) =>
            api.libraryViewUrl(view, path),
          ),
    [kind, document.text, folder, files, api, view],
  )

  const menu: MenuItem[] = [
    { title: "Rename or move", icon: "pencil", onPress: () => void actions.renameOrMove(file) },
    { title: "Download", icon: "download", onPress: () => actions.download(file) },
    ...(kind === "page"
      ? [
          {
            title: "Page",
            inline: true,
            children: [
              {
                title: "Reload",
                icon: "refresh" as const,
                onPress: () => setReloads((count) => count + 1),
              },
              {
                title: BROWSER,
                icon: "arrowUpRight" as const,
                onPress: () => void WebBrowser.openBrowserAsync(viewUrl),
              },
            ],
          },
        ]
      : []),
    {
      title: "Delete",
      icon: "trash",
      destructive: true,
      onPress: () => void actions.remove(file).then((gone) => (gone ? router.back() : undefined)),
    },
  ]

  const unread = document.failed ? (
    <View style={{ alignItems: "center" }}>
      <Empty title="This file could not be read. Try again." />
      <Button kind="grey" size="medium" title="Try again" onPress={document.retry} />
    </View>
  ) : (
    <ActivityIndicator style={{ marginTop: 48 }} />
  )

  let body
  if (kind === "image") {
    // The four kinds the file's own address serves as pictures go with the session; the rest,
    // and everything in a browser, come from the view address, which needs none.
    const source =
      Platform.OS !== "web" && INLINE.has(file.contentType)
        ? { uri: api.libraryFileUrl(file.id, file.rev), headers: authHeaders(auth) }
        : { uri: `${viewUrl}?v=${file.rev}` }
    body = (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        maximumZoomScale={5}
        minimumZoomScale={1}
        centerContent
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1, backgroundColor: theme.bg }}
      >
        <Image
          source={source}
          accessibilityLabel={file.name}
          contentFit="contain"
          style={{
            width: window.width,
            height: Math.max(240, window.height - insets.top - insets.bottom - 150),
          }}
        />
      </ScrollView>
    )
  } else if (kind === "film" || kind === "sound") {
    const Player = kind === "film" ? Film : Sound
    const address = (view: string) => `${api.libraryViewUrl(view, file.path)}?v=${file.rev}`
    body = (
      <Screen page>
        <View style={{ alignItems: "center", paddingHorizontal: 16, paddingTop: 24 }}>
          <Player
            // The same file changed is another thing to play.
            key={file.rev}
            src={address(view)}
            name={file.name}
            // The address stops working after some hours, and the library gives the one that
            // works now.
            onStale={async () => {
              const fresh = (await library.listing.refetch()).data?.view
              return fresh === undefined ? undefined : address(fresh)
            }}
            way={{
              label: Platform.OS === "web" ? "Download" : "Open in…",
              onPress: () => actions.download(file),
            }}
            width={window.width - 32}
          />
        </View>
      </Screen>
    )
  } else if (kind === "pdf" && Platform.OS === "ios") {
    body = <PageView uri={`${viewUrl}?v=${file.rev}`} title={file.name} />
  } else if (kind === "other" || kind === "pdf") {
    body = (
      <Screen page>
        <View style={{ alignItems: "center", gap: 10, paddingHorizontal: 32, paddingTop: 72 }}>
          <Icon name="doc" size={44} color={theme.ink3} />
          <Text variant="headline" style={{ textAlign: "center" }}>
            {file.name}
          </Text>
          <Text variant="subhead" tone="ink2" style={{ textAlign: "center" }}>
            {formatBytes(file.size)} · This kind of file cannot be shown here yet.
          </Text>
          <Button
            kind="grey"
            size="medium"
            icon="download"
            title={Platform.OS === "web" ? "Download" : "Open in…"}
            onPress={() => actions.download(file)}
            style={{ marginTop: 8 }}
          />
        </View>
      </Screen>
    )
  } else if (kind === "page" && mode === "read") {
    body = <PageView key={`${stamp}-${reloads}`} uri={`${viewUrl}?v=${stamp}`} title={file.name} />
  } else if (document.text === undefined) {
    body = <Screen page>{unread}</Screen>
  } else if (editing) {
    body = (
      <Screen
        page
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 0 }}
      >
        {document.state === "conflict" ? (
          <Conflict
            agentName={library.agentName}
            onTheirs={document.takeTheirs}
            onMine={document.keepMine}
          />
        ) : document.state === "error" ? (
          <View
            style={{ flexDirection: "row", alignItems: "center", marginHorizontal: 20, gap: 8 }}
          >
            <Text variant="subhead" tone="red" style={{ flex: 1 }}>
              Could not save
            </Text>
            <Button kind="plain" size="small" title="Try again" onPress={document.saveNow} />
          </View>
        ) : null}
        <Editor
          text={document.text}
          onChange={document.edit}
          markdown={kind === "markdown"}
          label={`Edit ${file.name}`}
          autoFocus
        />
      </Screen>
    )
  } else if (kind === "markdown") {
    body = (
      <Screen
        page
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 130 }}
      >
        <Markdown text={shown} selectable onLink={follow} />
      </Screen>
    )
  } else if (kind === "csv") {
    const rows = parseCsv(document.text)
    body = (
      <Screen page contentContainerStyle={{ paddingBottom: 130 }}>
        <ScrollView horizontal contentContainerStyle={{ paddingHorizontal: 16 }}>
          <View accessibilityLabel={file.name}>
            {rows.map((row, at) => (
              <View
                key={at}
                style={{
                  flexDirection: "row",
                  borderBottomWidth: at === 0 ? 1 : 0.5,
                  borderBottomColor: theme.sep,
                }}
              >
                {row.map((cell, column) => (
                  <Text
                    key={column}
                    variant="footnote"
                    tone={at === 0 ? "ink2" : "ink"}
                    weight={at === 0 ? "600" : undefined}
                    numberOfLines={2}
                    selectable
                    style={{ width: 132, paddingVertical: 9, paddingRight: 12 }}
                  >
                    {cell}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </Screen>
    )
  } else {
    body = (
      <Screen
        page
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 130 }}
      >
        <NativeText
          selectable
          style={{ color: theme.ink, fontFamily: mono, fontSize: 13, lineHeight: 20 }}
        >
          {document.text}
        </NativeText>
      </Screen>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.page }}>
      <Stack.Screen
        options={{
          title: file.name,
          headerTitle: () => (
            <View style={{ alignItems: "center", maxWidth: 220 }}>
              <Text variant="headline" numberOfLines={1}>
                {file.name}
              </Text>
              {under === "" ? null : (
                <Text
                  variant="caption"
                  tone={
                    document.state === "conflict" || document.state === "error" ? "red" : "ink2"
                  }
                  numberOfLines={1}
                  accessibilityLiveRegion="polite"
                >
                  {under}
                </Text>
              )}
            </View>
          ),
        }}
      />
      <HeaderItems
        items={
          editing
            ? [{ text: "Done", label: "Done", prominent: true, onPress: leaveEdit }]
            : [{ icon: "more", label: "More", menu }]
        }
      />
      {actions.element}
      {body}
      <View
        pointerEvents="box-none"
        style={{
          // While something is being written the bar is away, as the keyboard has its place: "Done" leaves.
          display: editing ? "none" : "flex",
          position: "absolute",
          left: 16,
          right: 16,
          bottom: Math.max(insets.bottom, 12) + 4,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {written ? (
          <Glass style={{ borderRadius: 22, padding: 5, width: 176 }}>
            <Segmented
              label="How to show it"
              value={mode}
              onChange={(next) => (next === "read" ? leaveEdit() : setMode("edit"))}
              options={
                kind === "page"
                  ? [
                      { value: "read", label: "Page" },
                      { value: "edit", label: "Source" },
                    ]
                  : [
                      { value: "read", label: "Read" },
                      { value: "edit", label: "Edit" },
                    ]
              }
            />
          </Glass>
        ) : (
          <View />
        )}
        <Glass
          style={{
            borderRadius: 22,
            height: 44,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 4,
          }}
        >
          {pin.menu.length === 0 ? null : (
            // Pinned to the Dood this file was opened from, as the web's document bar pins it.
            // Filled in its color while it is pinned, so the bar says how it stands.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={pin.menu[0]?.title}
              accessibilityState={{ selected: pin.pinned }}
              hitSlop={4}
              onPress={pin.toggle}
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
            >
              <Icon
                name={pin.pinned ? "pinFill" : "pin"}
                size={21}
                color={pin.pinned ? theme.amber : theme.ink}
                weight="medium"
              />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="History"
            hitSlop={4}
            onPress={() => router.push(`${home}/versions?fileId=${file.id}`)}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="history" size={21} color={theme.ink} weight="medium" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={site === undefined ? "Share" : "Shared with a link"}
            hitSlop={4}
            onPress={() => actions.shareFile(file)}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Icon
              name="share"
              size={21}
              color={site === undefined ? theme.ink : theme.tint}
              weight="medium"
            />
          </Pressable>
        </Glass>
      </View>
    </View>
  )
}

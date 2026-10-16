import type { LibraryFile } from "@do-computer/protocol"
import * as DocumentPicker from "expo-document-picker"
import * as ImagePicker from "expo-image-picker"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, Platform, View } from "react-native"
import { useTheme } from "@/lib/theme"
import {
  contentsOf,
  type FolderEntry,
  foldersOf,
  matching,
  nameOf,
  dirOf,
  siteOfFile,
  siteOfFolder,
  tidyPath,
} from "@/library/model"
import { FileRow, FolderRow } from "@/library/rows"
import { type Picked, useLibrary, useLibraryActions } from "@/library/use-library"
import { usePinOf } from "@/pins/pins"
import {
  Empty,
  errorText,
  Field,
  HeaderItems,
  type MenuItem,
  Row,
  Screen,
  Section,
  type SwipeAction,
  tell,
  Text,
} from "@/ui"

/** The names of several agents as a phrase: "Juniper, Moss and Otto". */
const listed = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

/**
 * The library's files and folders, as the Files app lists them: the top level, or with `?path=`
 * one folder, which is pushed over the one it is in. At the top it also lists what is shared
 * with a link and leads to what was recently deleted.
 */
export default function Library() {
  const theme = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ agentId: string; path?: string }>()
  const agentId = params.agentId
  const dir = tidyPath(params.path ?? "")
  const top = dir === ""
  const library = useLibrary(agentId)
  const actions = useLibraryActions(agentId)
  const pinOf = usePinOf(agentId)
  const [search, setSearch] = useState("")
  const [refreshing, setRefreshing] = useState(false)

  const { files, deleted, by } = library
  const sites = library.sites.data
  const wanted = search.trim()
  const here = contentsOf(files, dir)
  const found = wanted === "" ? [] : matching(files, wanted)
  const folders = foldersOf(files)
  const home = `/a/${agentId}/library` as const

  const refresh = async () => {
    setRefreshing(true)
    await Promise.all([library.listing.refetch(), library.sites.refetch()])
    setRefreshing(false)
  }

  const open = (file: LibraryFile) => router.push(`${home}/${file.id}`)
  const openFolder = (path: string) => router.push(`${home}?path=${encodeURIComponent(path)}`)

  const fileMenu = (file: LibraryFile): MenuItem[] => [
    { title: "Open", icon: "doc", onPress: () => open(file) },
    // Pinned to the Dood this library was opened from, as the web pins from a file's own bar.
    ...pinOf(file).menu,
    { title: "Share…", icon: "share", onPress: () => actions.shareFile(file) },
    { title: "Rename", icon: "pencil", onPress: () => void actions.rename(file) },
    {
      title: "Move to…",
      icon: "move",
      // Where the system has no menus within menus the folders are listed with the rest.
      children: folders
        .filter((folder) => folder !== dirOf(file.path))
        .map((folder) => ({
          title:
            Platform.OS === "ios"
              ? folder === ""
                ? "Library"
                : folder
              : `Move to ${folder === "" ? "the top of the library" : folder}`,
          icon: "folder" as const,
          onPress: () => void actions.moveInto(file, folder),
        })),
    },
    { title: "Download", icon: "download", onPress: () => actions.download(file) },
    { title: "Delete", icon: "trash", destructive: true, onPress: () => void actions.remove(file) },
  ]
  const fileSwipe = (file: LibraryFile): SwipeAction[] => [
    ...pinOf(file).swipe,
    { title: "Share", icon: "share", color: "tint", onPress: () => actions.shareFile(file) },
    { title: "Rename", icon: "pencil", color: "grey", onPress: () => void actions.rename(file) },
    { title: "Delete", icon: "trash", color: "red", onPress: () => void actions.remove(file) },
  ]
  const folderMenu = (folder: FolderEntry): MenuItem[] => [
    { title: "Open", icon: "folder", onPress: () => openFolder(folder.path) },
    { title: "Share…", icon: "share", onPress: () => actions.share(folder.path) },
  ]

  const upload = async (pick: () => Promise<Picked[]>) => {
    try {
      await actions.upload(dir, await pick())
    } catch (error) {
      tell("That could not be uploaded", errorText(error))
    }
  }
  const fromPhotos = () =>
    upload(async () => {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsMultipleSelection: true,
        quality: 1,
      })
      return result.canceled ? [] : result.assets.map(photo)
    })
  const fromCamera = () =>
    upload(async () => {
      const allowed = await ImagePicker.requestCameraPermissionsAsync()
      if (!allowed.granted) {
        tell("The camera is not allowed", "Allow it in Settings to take a photo.")
        return []
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.9 })
      return result.canceled ? [] : result.assets.map(photo)
    })
  const fromFiles = () =>
    upload(async () => {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      })
      return result.canceled
        ? []
        : result.assets.map((asset) => ({
            uri: asset.uri,
            name: asset.name,
            type: asset.mimeType ?? "",
          }))
    })

  const add: MenuItem[] = [
    { title: "New document", icon: "compose", onPress: () => void actions.newDocument(dir) },
    {
      title: "Upload",
      inline: true,
      children: [
        { title: "Upload from Photos", icon: "photo", onPress: () => void fromPhotos() },
        { title: "Upload files", icon: "folder", onPress: () => void fromFiles() },
        { title: "Take a photo", icon: "camera", onPress: () => void fromCamera() },
      ],
    },
  ]
  const more: MenuItem[] = [
    ...(top
      ? []
      : [
          {
            title: "Share this folder…",
            icon: "share" as const,
            onPress: () => actions.share(dir),
          },
        ]),
    {
      title: deleted.length === 0 ? "Recently deleted" : `Recently deleted · ${deleted.length}`,
      icon: "trash",
      onPress: () => router.push(`${home}/deleted`),
    },
  ]

  const sharers = library.sharers.map((agent) => agent.name ?? "A Dood")
  const whose =
    sharers.length > 1
      ? `${library.workspaceName} · ${listed(sharers)} share it`
      : `${library.workspaceName} · kept here whatever happens to a computer`

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: top ? "Library" : nameOf(dir), headerLargeTitle: top }} />
      {Platform.OS === "ios" ? (
        <Stack.SearchBar
          placeholder="Filter files"
          placement="integrated"
          onChangeText={(event) => setSearch(event.nativeEvent.text)}
          onCancelButtonPress={() => setSearch("")}
        />
      ) : null}
      <HeaderItems
        items={[
          { icon: "plus", label: "Add", menu: add, disabled: actions.busy },
          { icon: "more", label: "More", menu: more },
        ]}
      />
      {actions.element}

      {top ? (
        <Text variant="subhead" tone="ink2" style={{ marginHorizontal: 20, marginBottom: 14 }}>
          {whose}
        </Text>
      ) : null}
      {Platform.OS === "ios" ? null : (
        <Section>
          <Field
            placeholder="Filter files"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </Section>
      )}
      {actions.busy ? (
        <View accessibilityLabel="Working" style={{ paddingBottom: 12 }}>
          <ActivityIndicator />
        </View>
      ) : null}

      {library.listing.data === undefined ? (
        library.listing.error ? (
          <Empty title="The library could not be loaded">
            {errorText(library.listing.error, "Check your connection and pull down to try again.")}
          </Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 48 }} />
        )
      ) : wanted !== "" ? (
        found.length === 0 ? (
          <Empty title="Nothing matches." />
        ) : (
          <Section>
            {found.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                title={file.path}
                by={by(file.updatedBy, file)}
                site={siteOfFile(sites, file.path)}
                pinnedTo={pinOf(file).pinned ? library.agentName : undefined}
                menu={fileMenu(file)}
                swipe={fileSwipe(file)}
                onPress={() => open(file)}
              />
            ))}
          </Section>
        )
      ) : (
        <>
          {here.folders.length + here.files.length === 0 ? (
            <Empty title="Nothing here yet.">
              {top
                ? "Documents and files made by the Doods of this workspace, and ones you have given them."
                : undefined}
            </Empty>
          ) : (
            <Section>
              {here.folders.map((folder) => (
                <FolderRow
                  key={folder.path}
                  folder={folder}
                  site={siteOfFolder(sites, folder.path)}
                  menu={folderMenu(folder)}
                  swipe={[
                    {
                      title: "Share",
                      icon: "share",
                      color: "tint",
                      onPress: () => actions.share(folder.path),
                    },
                  ]}
                  onPress={() => openFolder(folder.path)}
                />
              ))}
              {here.files.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  by={by(file.updatedBy, file)}
                  site={siteOfFile(sites, file.path)}
                  pinnedTo={pinOf(file).pinned ? library.agentName : undefined}
                  menu={fileMenu(file)}
                  swipe={fileSwipe(file)}
                  onPress={() => open(file)}
                />
              ))}
            </Section>
          )}
          {top ? (
            <>
              <Section title="Shared with a link">
                {(sites ?? []).map((site) => {
                  const gone = !files.some(
                    (file) => file.path === site.path || file.path.startsWith(`${site.path}/`),
                  )
                  const who = site.public ? "Anyone with the link" : library.audience.long
                  return (
                    <Row
                      key={site.id}
                      icon={site.public ? ["globe", theme.tint] : ["people", theme.ink2]}
                      title={site.title}
                      subtitle={gone ? `${who} · no longer in the library` : who}
                      accessibilityLabel={`Sharing of ${site.title}`}
                      go
                      onPress={() => actions.share(site.path)}
                    />
                  )
                })}
              </Section>
              <Section>
                {deleted.length === 0 ? null : (
                  <Row
                    icon={["trash", theme.ink2]}
                    title="Recently deleted"
                    value={deleted.length}
                    go
                    onPress={() => router.push(`${home}/deleted`)}
                  />
                )}
              </Section>
            </>
          ) : null}
        </>
      )}
    </Screen>
  )
}

/** A photo or a film from Photos or the camera, as something to upload. Not every one has a name. */
const photo = (asset: ImagePicker.ImagePickerAsset, at: number): Picked => {
  const type = asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg")
  const ending = type
    .slice(type.indexOf("/") + 1)
    .replace("jpeg", "jpg")
    .replace("quicktime", "mov")
  return {
    uri: asset.uri,
    name:
      asset.fileName ??
      `${asset.type === "video" ? "video" : "photo"}-${Date.now()}-${at + 1}.${ending}`,
    type,
  }
}

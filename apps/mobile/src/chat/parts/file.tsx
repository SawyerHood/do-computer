import type { LibraryFile, SiteSummary, ToolPart } from "@do-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import { memo, useState } from "react"
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native"
import { formatBytes, openLibraryFile } from "@/lib/files"
import { keys } from "@/lib/queries"
import { authHeaders } from "@/lib/session"
import { radius, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { errorText, haptic, tell, Text } from "@/ui"
import { fileIcon, isPreviewable, isViewable, siteOfFile } from "./logic"
import { Card, ChipIcon, RoundButton, useChatScope } from "./shared"

/** What of an agent's library is shared with a link. The event socket keeps it current. */
export function useSites(agentId: string): SiteSummary[] | undefined {
  const { client } = useSession()
  return useQuery({
    queryKey: keys.sites(agentId),
    queryFn: () => client.agent(agentId).sites(),
  }).data
}

/**
 * A file the agent delivered, shown as the file: a preview when it is a picture, a way into the
 * library when it is something that can be shown there, and a download and a share either way.
 */
export const SentFile = memo(function SentFile({ part }: { part: ToolPart }) {
  const file = part.details as unknown as LibraryFile
  const { agentId } = useChatScope()
  const session = useSession()
  const router = useRouter()
  const theme = useTheme()
  const [busy, setBusy] = useState(false)
  // The picture's own shape, once it has loaded; until then a shape most pictures are near.
  const [ratio, setRatio] = useState(4 / 3)
  const viewable = isViewable(file)
  // Shared with a link, or the way to share it. One from before files had a place has none.
  const site = siteOfFile(useSites(agentId), file.path ?? "")

  /** Hand it to the share sheet, where it can be saved or opened in another app. */
  const download = () => {
    if (busy) return
    setBusy(true)
    openLibraryFile(session, agentId, file)
      .catch((error: unknown) => tell("It could not be downloaded", errorText(error)))
      .finally(() => setBusy(false))
  }
  const open = () => {
    haptic.tap()
    if (viewable) router.push(`/a/${agentId}/library/${file.id}`)
    else download()
  }

  return (
    <View style={{ gap: 8, alignSelf: "flex-start", maxWidth: "100%" }}>
      {isPreviewable(file) ? (
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel={file.name}
          accessibilityHint={viewable ? "Opens it in the library" : "Downloads it"}
          onPress={open}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          <Image
            source={{
              uri: session.client.agent(agentId).libraryFileUrl(file.id, file.rev),
              headers: authHeaders(session.auth),
            }}
            contentFit="cover"
            transition={150}
            onLoad={(event) => {
              const { width, height } = event.source
              if (width > 0 && height > 0) setRatio(Math.min(3, Math.max(0.6, width / height)))
            }}
            style={{
              width: Math.min(320 * ratio, 320),
              aspectRatio: ratio,
              maxWidth: "100%",
              borderRadius: radius.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.sep,
              backgroundColor: theme.fill,
            }}
          />
        </Pressable>
      ) : null}
      <Card style={{ flexDirection: "row", alignItems: "center", paddingRight: 10, gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${file.name}, ${formatBytes(file.size)}`}
          accessibilityHint={viewable ? "Open in the library" : "Download"}
          onPress={open}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            padding: 10,
            flexShrink: 1,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <ChipIcon icon={fileIcon(file)} />
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text variant="subhead" weight="600" numberOfLines={1}>
              {file.name}
            </Text>
            <Text variant="footnote" tone="ink2">
              {formatBytes(file.size)}
            </Text>
          </View>
        </Pressable>
        {busy ? (
          <View style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator accessibilityLabel="Downloading" />
          </View>
        ) : (
          <RoundButton icon="download" label={`Download ${file.name}`} onPress={download} />
        )}
        {file.path === undefined ? null : (
          <RoundButton
            icon={site === undefined ? "share" : site.public ? "globe" : "lock"}
            label={site === undefined ? `Share ${file.name}` : `${file.name} is shared with a link`}
            onPress={() => router.push(`/a/${agentId}/library/share?fileId=${file.id}`)}
          />
        )}
      </Card>
    </View>
  )
})

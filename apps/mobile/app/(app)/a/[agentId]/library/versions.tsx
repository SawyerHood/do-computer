import type { LibraryFile, LibraryVersion } from "@do-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, Text as NativeText, View } from "react-native"
import { formatBytes } from "@/lib/files"
import { keys } from "@/lib/queries"
import { mono, useTheme } from "@/lib/theme"
import { formatFull, kindOf } from "@/library/model"
import { textKey } from "@/library/use-document"
import { useLibrary } from "@/library/use-library"
import {
  Button,
  confirm,
  Empty,
  errorText,
  haptic,
  Icon,
  Row,
  Screen,
  Section,
  tell,
  Text,
} from "@/ui"
import { Markdown } from "@/ui/markdown"

/** The name the versions of a file are kept under. */
const versionsKey = (agentId: string, fileId: string) =>
  ["agents", agentId, "library-versions", fileId] as const

/**
 * The versions of a file that are still kept: the one it is now, ticked, and each earlier one
 * with when it was written and by whom. Choosing one shows it, with the way to put it back.
 */
export default function Versions() {
  const theme = useTheme()
  const { agentId, fileId } = useLocalSearchParams<{ agentId: string; fileId: string }>()
  const library = useLibrary(agentId)
  const file = library.files.find((each) => each.id === fileId)
  const [showing, setShowing] = useState<LibraryVersion>()
  const versions = useQuery({
    queryKey: [...versionsKey(agentId, fileId), file?.rev ?? 0],
    queryFn: () => library.api.libraryVersions(fileId),
    enabled: file !== undefined,
  })
  const who = (by: "agent" | "user") => (by === "agent" ? library.agentName : "You")

  if (file === undefined) {
    return (
      <Screen>
        {library.listing.data === undefined && !library.listing.error ? (
          <ActivityIndicator style={{ marginTop: 48 }} />
        ) : (
          <Empty title="This file is no longer in the library." />
        )}
      </Screen>
    )
  }
  if (showing !== undefined) {
    return (
      <Version
        agentId={agentId}
        file={file}
        version={showing}
        who={who(showing.by)}
        onBack={() => setShowing(undefined)}
      />
    )
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: "Versions" }} />
      <Section
        footer={
          versions.data !== undefined && versions.data.length === 0
            ? "It has not been changed since it was made."
            : undefined
        }
      >
        <Row
          title="Current"
          subtitle={`${who(file.updatedBy)} · ${formatFull(file.updatedAt)}`}
          tail={<Icon name="check" size={18} color={theme.tint} weight="semibold" />}
          accessibilityLabel="Current"
        />
        {(versions.data ?? []).map((version) => (
          <Row
            key={version.rev}
            title={formatFull(version.at)}
            subtitle={`${who(version.by)} · ${formatBytes(version.size)}`}
            accessibilityLabel={`The version of ${formatFull(version.at)}, by ${who(version.by)}`}
            go
            onPress={() => setShowing(version)}
          />
        ))}
      </Section>
      {versions.data !== undefined ? null : versions.error ? (
        <Empty title="The versions could not be loaded">{errorText(versions.error)}</Empty>
      ) : (
        <ActivityIndicator />
      )}
    </Screen>
  )
}

/** One earlier version, to read and not to change, with the way to put the file back to it. */
function Version({
  agentId,
  file,
  version,
  who,
  onBack,
}: {
  agentId: string
  file: LibraryFile
  version: LibraryVersion
  who: string
  onBack: () => void
}) {
  const theme = useTheme()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { api } = useLibrary(agentId)
  const [busy, setBusy] = useState(false)
  const kind = kindOf({ name: file.name, size: version.size })
  const written = kind === "markdown" || kind === "page" || kind === "text" || kind === "csv"
  const text = useQuery({
    queryKey: textKey(agentId, file.id, version.rev),
    queryFn: () => api.libraryText(file.id, version.rev),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: written,
  })

  const putBack = async () => {
    const sure = await confirm({
      title: "Put back this version?",
      message: "The file goes back to what it was then. What it is now is kept as a version.",
      action: "Put back this version",
      destructive: false,
    })
    if (!sure) return
    setBusy(true)
    try {
      await api.revertLibraryFile(file.id, version.rev)
      haptic.done()
      await queryClient.invalidateQueries({ queryKey: keys.library(agentId) })
      void queryClient.invalidateQueries({ queryKey: versionsKey(agentId, file.id) })
      router.back()
    } catch (error) {
      haptic.fail()
      tell("It could not be put back", errorText(error))
      setBusy(false)
    }
  }

  return (
    <Screen page contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16 }}>
      <Stack.Screen options={{ title: formatFull(version.at) }} />
      <View style={{ gap: 12, marginBottom: 20 }}>
        {/* The way back to the list is in the page: the sheet's own bar only closes it. */}
        <Button
          kind="plain"
          size="small"
          icon="chevronLeft"
          title="Versions"
          accessibilityLabel="Back to the versions"
          onPress={onBack}
          style={{ alignSelf: "flex-start", paddingHorizontal: 0 }}
        />
        <Text variant="subhead" tone="ink2">
          {who} · {formatFull(version.at)} · {formatBytes(version.size)}
        </Text>
        <Button
          title="Put back this version"
          icon="restore"
          busy={busy}
          onPress={() => void putBack()}
        />
      </View>
      {!written ? (
        <Text tone="ink2">This kind of file cannot be shown here yet.</Text>
      ) : text.data === undefined ? (
        text.error ? (
          <Text tone="ink2">This file could not be read. Try again.</Text>
        ) : (
          <ActivityIndicator style={{ marginTop: 24 }} />
        )
      ) : kind === "markdown" ? (
        <Markdown text={text.data} selectable />
      ) : (
        <NativeText
          selectable
          style={{ color: theme.ink, fontFamily: mono, fontSize: 13, lineHeight: 20 }}
        >
          {text.data}
        </NativeText>
      )}
    </Screen>
  )
}

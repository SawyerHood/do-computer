import { Stack, useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { useTheme } from "@/lib/theme"
import { formatWhen } from "@/library/model"
import { useLibrary, useLibraryActions } from "@/library/use-library"
import { Button, Empty, errorText, Row, Screen, Section, SwipeRow } from "@/ui"

/**
 * The files deleted from the library lately, which can still be brought back: who deleted each
 * and when, and Restore on every one.
 */
export default function Deleted() {
  const theme = useTheme()
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const library = useLibrary(agentId)
  const actions = useLibraryActions(agentId)
  const [refreshing, setRefreshing] = useState(false)
  const [restoring, setRestoring] = useState<string>()

  const refresh = async () => {
    setRefreshing(true)
    await library.listing.refetch()
    setRefreshing(false)
  }
  const restore = async (file: { id: string; name: string }) => {
    setRestoring(file.id)
    await actions.restore(file)
    setRestoring(undefined)
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: "Recently deleted" }} />
      {library.listing.data === undefined ? (
        library.listing.error ? (
          <Empty title="The library could not be loaded">{errorText(library.listing.error)}</Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 48 }} />
        )
      ) : library.deleted.length === 0 ? (
        <Empty title="Nothing here yet.">
          A file deleted from the library can be restored from here for a while.
        </Empty>
      ) : (
        <Section footer="A deleted file can be restored for a while. It goes back to where it was.">
          {library.deleted.map((file) => (
            <SwipeRow
              key={file.id}
              actions={[
                {
                  title: "Restore",
                  icon: "restore",
                  color: "tint",
                  onPress: () => void restore(file),
                },
              ]}
            >
              <View style={{ backgroundColor: theme.card }}>
                <Row
                  title={file.path}
                  subtitle={`${file.deletedBy === "agent" ? "by an agent" : "by you"} · ${formatWhen(file.deletedAt)}`}
                  tail={
                    <Button
                      kind="plain"
                      size="small"
                      title="Restore"
                      accessibilityLabel={`Restore ${file.name}`}
                      busy={restoring === file.id}
                      onPress={() => void restore(file)}
                    />
                  }
                />
              </View>
            </SwipeRow>
          ))}
        </Section>
      )}
    </Screen>
  )
}

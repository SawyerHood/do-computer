import type { LibraryFile } from "@do-computer/protocol"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator } from "react-native"
import { pick } from "@/lib/attach"
import { useTheme } from "@/lib/theme"
import { contentsOf, dirOf, matching, nameOf } from "@/library/model"
import { FileRow, FolderRow } from "@/library/rows"
import { useLibrary } from "@/library/use-library"
import { Empty, errorText, Field, haptic, HeaderItems, Icon, Row, Screen, Section } from "@/ui"

/**
 * Choose a file of the library to go with the message being written in a chat (`?chatId=`).
 * Folders open in place; the file chosen waits with the chat's message, and this closes.
 */
export default function Pick() {
  const theme = useTheme()
  const router = useRouter()
  const { agentId, chatId } = useLocalSearchParams<{ agentId: string; chatId?: string }>()
  const library = useLibrary(agentId)
  const [dir, setDir] = useState("")
  const [search, setSearch] = useState("")

  const wanted = search.trim()
  const here = contentsOf(library.files, dir)
  const found = wanted === "" ? [] : matching(library.files, wanted)
  const choose = (file: LibraryFile) => {
    if (chatId !== undefined && chatId !== "") pick(chatId, file)
    haptic.tap()
    router.back()
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: dir === "" ? "From the library" : nameOf(dir) }} />
      <HeaderItems
        placement="left"
        items={[{ text: "Cancel", label: "Cancel", onPress: () => router.back() }]}
      />
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
      {library.listing.data === undefined ? (
        library.listing.error ? (
          <Empty title="The library could not be loaded">{errorText(library.listing.error)}</Empty>
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
                by={library.by(file.updatedBy, file)}
                onPress={() => choose(file)}
              />
            ))}
          </Section>
        )
      ) : (
        <>
          {dir === "" ? null : (
            <Section>
              <Row
                lead={<Icon name="chevronLeft" size={18} color={theme.tint} weight="semibold" />}
                title={dirOf(dir) === "" ? "Library" : nameOf(dirOf(dir))}
                tone="tint"
                accessibilityLabel={`Back to ${dirOf(dir) === "" ? "the library" : nameOf(dirOf(dir))}`}
                onPress={() => setDir(dirOf(dir))}
              />
            </Section>
          )}
          {here.folders.length + here.files.length === 0 ? (
            <Empty title="Nothing here yet." />
          ) : (
            <Section>
              {here.folders.map((folder) => (
                <FolderRow key={folder.path} folder={folder} onPress={() => setDir(folder.path)} />
              ))}
              {here.files.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  by={library.by(file.updatedBy, file)}
                  onPress={() => choose(file)}
                />
              ))}
            </Section>
          )}
        </>
      )}
    </Screen>
  )
}

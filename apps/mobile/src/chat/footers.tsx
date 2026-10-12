import type { Person } from "@durable-computer/protocol"
import { type ReactNode, useState } from "react"
import { TextInput, View } from "react-native"
import { radius, useTheme } from "@/lib/theme"
import { Button, Faces, Glass, Text } from "@/ui"
import { names } from "./chats"

/**
 * Where the message box would be in a chat that is read here and not written in: who does
 * write in it, and the way back to where the reader can say something.
 */
export function ReadOnlyFoot({
  face,
  words,
  action,
}: {
  face?: ReactNode
  words: string
  action?: { title: string; onPress: () => void } | undefined
}) {
  return (
    <Glass
      style={{
        borderRadius: radius.lg,
        borderCurve: "continuous",
        padding: 14,
        gap: 10,
        alignItems: "center",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "stretch" }}>
        {face}
        <Text variant="footnote" tone="ink2" style={{ flex: 1 }}>
          {words}
        </Text>
      </View>
      {action === undefined ? null : (
        <Button
          title={action.title}
          kind="grey"
          size="medium"
          style={{ alignSelf: "stretch" }}
          onPress={action.onPress}
        />
      )}
    </Glass>
  )
}

/** Who else in the team is writing in this chat right now. */
export function TypingLine({ people }: { people: readonly Person[] }) {
  const theme = useTheme()
  if (people.length === 0) return null
  return (
    <View
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 }}
    >
      <Faces people={people} size={18} ring={theme.bg} />
      <Text variant="caption" tone="ink2">
        {names(people)} {people.length === 1 ? "is" : "are"} typing…
      </Text>
    </View>
  )
}

/** A small field to give a chat another name, where the system has no prompt to ask with. */
export function RenameBar({
  title,
  onSave,
  onCancel,
}: {
  title: string
  onSave: (title: string) => void
  onCancel: () => void
}) {
  const theme = useTheme()
  const [value, setValue] = useState(title)
  const save = () => (value.trim() === "" ? onCancel() : onSave(value.trim()))
  return (
    <Glass
      style={{
        borderRadius: radius.lg,
        padding: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      }}
    >
      <TextInput
        accessibilityLabel="Chat title"
        autoFocus
        value={value}
        onChangeText={setValue}
        onSubmitEditing={save}
        returnKeyType="done"
        selectionColor={theme.tint}
        style={{
          flex: 1,
          height: 36,
          paddingHorizontal: 10,
          color: theme.ink,
          fontSize: 16,
          backgroundColor: theme.fill,
          borderRadius: radius.sm,
        }}
      />
      <Button title="Cancel" kind="plain" size="small" onPress={onCancel} />
      <Button title="Save" size="small" onPress={save} />
    </Glass>
  )
}

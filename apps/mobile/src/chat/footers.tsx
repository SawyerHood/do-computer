import type { Person } from "@do-computer/protocol"
import type { ReactNode } from "react"
import { View } from "react-native"
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

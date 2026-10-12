import { type ReactNode, useCallback, useRef, useState } from "react"
import { Alert, Modal, Platform, Pressable, TextInput, View } from "react-native"
import { radius, useTheme } from "@/lib/theme"
import { Button, Text } from "@/ui"

type Ask = {
  title: string
  message?: string
  /** What is in the field to begin with. */
  value?: string
  /** The words of the button that goes ahead: "Create", "Rename". */
  action: string
  /** What the field is for, for someone who cannot see the title. */
  label?: string
}

/**
 * Ask for a line of text: a name for a new document, or a new name for an old one. On iOS it
 * is the system's own alert with a field in it. Elsewhere there is none, so `element` (which
 * the screen must draw somewhere) is a small card over the page that asks the same.
 * Resolves with what was typed, or undefined if they thought better of it.
 */
export function usePrompt(): [
  ask: (options: Ask) => Promise<string | undefined>,
  element: ReactNode,
] {
  const theme = useTheme()
  const [asking, setAsking] = useState<Ask>()
  const [typed, setTyped] = useState("")
  const answer = useRef<(value: string | undefined) => void>(undefined)

  const ask = useCallback((options: Ask) => {
    if (Platform.OS === "ios") {
      return new Promise<string | undefined>((resolve) => {
        Alert.prompt(
          options.title,
          options.message,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(undefined) },
            { text: options.action, onPress: (value?: string) => resolve(value ?? "") },
          ],
          "plain-text",
          options.value ?? "",
        )
      })
    }
    return new Promise<string | undefined>((resolve) => {
      answer.current?.(undefined)
      answer.current = resolve
      setTyped(options.value ?? "")
      setAsking(options)
    })
  }, [])

  const settle = (value: string | undefined) => {
    answer.current?.(value)
    answer.current = undefined
    setAsking(undefined)
  }

  const element =
    asking === undefined ? null : (
      <Modal visible transparent animationType="fade" onRequestClose={() => settle(undefined)}>
        <Pressable
          accessibilityLabel="Cancel"
          onPress={() => settle(undefined)}
          style={{ flex: 1, backgroundColor: theme.scrim, justifyContent: "center", padding: 32 }}
        >
          <Pressable
            accessibilityRole="alert"
            accessibilityLabel={asking.title}
            onPress={() => {}}
            style={{
              backgroundColor: theme.card,
              borderRadius: radius.md,
              padding: 20,
              gap: 12,
              width: "100%",
              maxWidth: 360,
              alignSelf: "center",
            }}
          >
            <Text variant="headline">{asking.title}</Text>
            {asking.message === undefined ? null : (
              <Text variant="subhead" tone="ink2">
                {asking.message}
              </Text>
            )}
            <TextInput
              accessibilityLabel={asking.label ?? asking.title}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              value={typed}
              onChangeText={setTyped}
              onSubmitEditing={() => settle(typed)}
              selectionColor={theme.tint}
              style={{
                color: theme.ink,
                fontSize: 17,
                backgroundColor: theme.fill,
                borderRadius: radius.sm,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            />
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
              <Button kind="grey" size="medium" title="Cancel" onPress={() => settle(undefined)} />
              <Button size="medium" title={asking.action} onPress={() => settle(typed)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    )

  return [ask, element]
}

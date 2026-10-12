import { useRef, useState } from "react"
import { InputAccessoryView, Platform, Pressable, TextInput, View } from "react-native"
import { mono, useTheme } from "@/lib/theme"
import { Button, Glass, haptic, Icon, Text } from "@/ui"
import { applyFormat, FORMATS, type Selection } from "./model"

const ACCESSORY = "library-format"

/** The row of buttons that write Markdown's common marks around what is chosen. */
function FormatBar({ onFormat }: { onFormat: (before: string, after: string) => void }) {
  const theme = useTheme()
  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
      <Glass
        style={{
          flexDirection: "row",
          borderRadius: 22,
          height: 44,
          alignItems: "center",
          paddingHorizontal: 6,
        }}
      >
        {FORMATS.map(([icon, title, before, after]) => (
          <Pressable
            key={title}
            accessibilityRole="button"
            accessibilityLabel={title}
            onPress={() => {
              haptic.tap()
              onFormat(before, after)
            }}
            style={({ pressed }) => ({
              flex: 1,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Icon name={icon} size={19} color={theme.ink} weight="semibold" />
          </Pressable>
        ))}
      </Glass>
    </View>
  )
}

/**
 * A plain text editor in a mono face, as tall as what is in it: the page it is on scrolls.
 * With `markdown` it has the format buttons, riding on the keyboard on iOS and above the field
 * elsewhere.
 */
export function Editor({
  text,
  onChange,
  markdown,
  label,
  autoFocus = false,
}: {
  text: string
  onChange: (text: string) => void
  markdown: boolean
  label: string
  autoFocus?: boolean
}) {
  const theme = useTheme()
  const field = useRef<TextInput>(null)
  const chosen = useRef<Selection>({ start: text.length, end: text.length })
  // Only set for the moment after a format button, to leave what was wrapped chosen.
  const [forced, setForced] = useState<Selection>()

  const format = (before: string, after: string) => {
    const next = applyFormat(text, chosen.current, before, after)
    chosen.current = next.selection
    onChange(next.text)
    setForced(next.selection)
    field.current?.focus()
  }

  const bar = markdown ? <FormatBar onFormat={format} /> : null
  return (
    <View style={{ flex: 1 }}>
      {Platform.OS === "ios" ? null : bar}
      <TextInput
        ref={field}
        accessibilityLabel={label}
        multiline
        scrollEnabled={false}
        autoFocus={autoFocus}
        autoCapitalize={markdown ? "sentences" : "none"}
        autoCorrect={markdown}
        spellCheck={markdown}
        value={text}
        onChangeText={onChange}
        selection={forced}
        onSelectionChange={(event) => {
          chosen.current = event.nativeEvent.selection
          if (forced !== undefined) setForced(undefined)
        }}
        inputAccessoryViewID={Platform.OS === "ios" && markdown ? ACCESSORY : undefined}
        selectionColor={theme.tint}
        placeholder="Write something"
        placeholderTextColor={theme.ink3}
        style={[
          // A browser draws a ring of its own round a field that is being typed in.
          Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null,
          {
            flex: 1,
            minHeight: 420,
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: 120,
            color: theme.ink,
            fontFamily: mono,
            fontSize: 14,
            lineHeight: 21,
            textAlignVertical: "top",
          },
        ]}
      />
      {Platform.OS === "ios" && markdown ? (
        <InputAccessoryView nativeID={ACCESSORY} backgroundColor="transparent">
          {bar}
        </InputAccessoryView>
      ) : null}
    </View>
  )
}

/** The words that say a file changed underneath an edit, and the two ways to settle it. */
export function Conflict({
  agentName,
  onTheirs,
  onMine,
}: {
  agentName: string
  onTheirs: () => void
  onMine: () => void
}) {
  const theme = useTheme()
  return (
    <View
      accessibilityRole="alert"
      style={{
        marginHorizontal: 16,
        marginBottom: 8,
        padding: 14,
        gap: 10,
        borderRadius: 16,
        backgroundColor: theme.fill,
      }}
    >
      <Text variant="subhead">
        {agentName} changed this file while you were editing it. Your changes are not saved.
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          kind="line"
          size="medium"
          title="Show theirs"
          onPress={onTheirs}
          style={{ flex: 1 }}
        />
        <Button size="medium" title="Keep mine" onPress={onMine} style={{ flex: 1 }} />
      </View>
    </View>
  )
}

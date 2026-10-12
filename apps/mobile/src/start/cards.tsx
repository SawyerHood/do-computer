import { AVATAR_COLORS, type AvatarColorId, type ModelOption } from "@do-computer/protocol"
import { useState } from "react"
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import { useTheme } from "@/lib/theme"
import { Button, haptic, Icon, Row, Section, Text } from "@/ui"

/** The names "Suggest a name" goes through, in turn: the web's own. */
const SUGGESTIONS = [
  "Pip",
  "Mochi",
  "Juniper",
  "Biscuit",
  "Tarn",
  "Wren",
  "Sorrel",
  "Nori",
  "Pebble",
]
/** As many models as the card lists. The rest are in the agent's settings. */
const SHOWN = 6
/** As many as are listed where none is suggested. */
const UNSUGGESTED = 4

export const hexOf = (id: AvatarColorId) => AVATAR_COLORS.find((color) => color.id === id)!.hex

/** What went wrong, under what was asked. */
export function Problem({ said }: { said: string | undefined }) {
  if (said === undefined) return null
  return (
    <Text variant="subhead" tone="red" accessibilityRole="alert">
      {said}
    </Text>
  )
}

/**
 * What to call it, and its color: a field with "Suggest a name" in it, the eight colors, which
 * the egg takes at once, and a button in the one chosen.
 */
export function Naming({
  color,
  busy,
  error,
  onColor,
  onNamed,
}: {
  color: AvatarColorId
  busy: boolean
  error: string | undefined
  onColor: (color: AvatarColorId) => void
  onNamed: (name: string) => void
}) {
  const theme = useTheme()
  const [name, setName] = useState("")
  const [suggested, setSuggested] = useState(0)
  const hex = hexOf(color)
  return (
    <View style={styles.card}>
      <View style={[styles.field, { backgroundColor: theme.fill }]}>
        <TextInput
          accessibilityLabel="A name for it"
          placeholder="A name for it"
          placeholderTextColor={theme.ink3}
          selectionColor={hex}
          maxLength={40}
          autoCorrect={false}
          spellCheck={false}
          autoCapitalize="words"
          returnKeyType="done"
          value={name}
          onChangeText={setName}
          onSubmitEditing={() => name.trim() !== "" && onNamed(name.trim())}
          // A browser's field is as wide as it likes unless told it may be narrower.
          style={{
            flex: 1,
            minWidth: 0,
            color: theme.ink,
            fontSize: 20,
            fontWeight: "600",
            padding: 0,
            minHeight: 28,
          }}
        />
        <Button
          kind="line"
          size="small"
          icon="spark"
          title="Suggest"
          accessibilityLabel="Suggest a name"
          onPress={() => {
            haptic.tap()
            setName(SUGGESTIONS[suggested % SUGGESTIONS.length]!)
            setSuggested(suggested + 1)
          }}
        />
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel="Color" style={styles.swatches}>
        {AVATAR_COLORS.map((entry) => {
          const chosen = entry.id === color
          return (
            <Pressable
              key={entry.id}
              accessibilityRole="radio"
              accessibilityLabel={entry.label}
              accessibilityState={{ checked: chosen }}
              hitSlop={4}
              onPress={() => {
                haptic.tap()
                onColor(entry.id)
              }}
              style={[styles.ring, { borderColor: chosen ? entry.hex : "transparent" }]}
            >
              <View style={[styles.swatch, { backgroundColor: entry.hex }]} />
            </Pressable>
          )
        })}
      </View>
      <Problem said={error} />
      <Button
        title="That’s your name"
        color={hex}
        busy={busy}
        disabled={name.trim() === ""}
        onPress={() => onNamed(name.trim())}
      />
    </View>
  )
}

/** The few models worth a line each: the suggested ones, where there are any. */
export function few(models: readonly ModelOption[], keep: string): ModelOption[] {
  if (models.length <= SHOWN) return [...models]
  const suggested = models.filter((model) => model.recommended === true)
  const shown = (suggested.length === 0 ? models.slice(0, UNSUGGESTED) : suggested).slice(0, SHOWN)
  // The one it is set to is never left out of what it can be set to.
  const kept = models.find((model) => model.id === keep)
  return kept === undefined || shown.includes(kept) ? shown : [kept, ...shown.slice(0, SHOWN - 1)]
}

/** What a model is called, without the maker's name that a catalog of many makers puts first. */
const called = (model: ModelOption) => model.name.replace(/^[^:]{1,24}:\s+/, "")

/** Where a model comes from, said under its name where they do not all come from one place. */
const source = (model: ModelOption) =>
  model.signIn === undefined
    ? "Built in"
    : model.signIn.subscription
      ? "On your subscription"
      : "On your key"

/**
 * What the agent thinks with, asked while it is still in its egg: one of the few models worth
 * suggesting, the one it was made with chosen already. Signing in to a provider of one's own is
 * in the agent's settings, not here.
 */
export function Thinking({
  models,
  current,
  color,
  busy,
  error,
  onChosen,
}: {
  models: readonly ModelOption[]
  /** The model it was made with. */
  current: string
  color: AvatarColorId
  busy: boolean
  error: string | undefined
  onChosen: (model: string) => void
}) {
  const { height } = useWindowDimensions()
  const listed = few(models, current)
  const [chosen, setChosen] = useState(current)
  const picked = listed.find((model) => model.id === chosen) ?? listed[0]
  const mixed = new Set(listed.map(source)).size > 1
  const hex = hexOf(color)
  return (
    <View style={{ gap: 14 }}>
      <ScrollView
        style={{ maxHeight: Math.round(height * 0.34) }}
        keyboardShouldPersistTaps="handled"
      >
        <View accessibilityRole="radiogroup" accessibilityLabel="What it thinks with">
          <Section>
            {listed.map((model) => (
              <Row
                key={model.id}
                title={called(model)}
                subtitle={mixed ? source(model) : undefined}
                tail={
                  model.id === picked?.id ? (
                    <Icon name="check" size={18} color={hex} weight="semibold" />
                  ) : undefined
                }
                onPress={() => {
                  haptic.tap()
                  setChosen(model.id)
                }}
              />
            ))}
          </Section>
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        <Problem said={error} />
        <Button
          title={picked === undefined ? "Choose one" : `Use ${called(picked)}`}
          color={hex}
          busy={busy}
          disabled={picked === undefined}
          onPress={() => picked !== undefined && onChosen(picked.id)}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 16, gap: 16 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 18,
    borderCurve: "continuous",
    paddingLeft: 16,
    paddingRight: 8,
    height: 52,
  },
  swatches: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 2 },
  ring: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2.5,
    alignItems: "center",
    justifyContent: "center",
  },
  swatch: { width: 30, height: 30, borderRadius: 15 },
})

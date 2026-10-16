import {
  cardNameFor,
  cardToSend,
  groupedCardNumber,
  groupedExpiry,
  MAX_CARD_HOLDER_CHARS,
  MAX_LOGIN_NAME_CHARS,
  MAX_POSTAL_CODE_CHARS,
  NO_CARD,
  type TypedCard,
} from "@do-computer/protocol"
import { useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { mono } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { cardsKey } from "@/passwords/keys"
import { errorText, Field, haptic, HeaderItems, Screen, Section, Text } from "@/ui"

/**
 * A card typed for the workspace, as the web app's window for one has it. There is no box for
 * its security code, which is never kept. Each box is named to the system for what it is, so
 * that the phone's own saved cards can fill it in. A number typed here is held until it is
 * sent, and goes with the screen: it is sent from here and not through the query cache, which
 * keeps what it is given for minutes. There is no screen to change a card: one is removed and
 * added again.
 */
export default function AddCard() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const api = useSession().client.workspace(workspaceId)
  const [typed, setTyped] = useState<TypedCard>(NO_CARD)
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)

  const box = (key: keyof TypedCard, shown = (value: string) => value) => ({
    editable: !busy,
    value: typed[key],
    onChangeText: (text: string) => {
      setProblem(undefined)
      setTyped((current) => ({ ...current, [key]: shown(text) }))
    },
  })

  const save = async () => {
    // What cannot be saved is said here, before anything is sent.
    const sent = cardToSend(typed)
    if ("problem" in sent) {
      haptic.fail()
      return setProblem(sent.problem)
    }
    setBusy(true)
    setProblem(undefined)
    try {
      await api.saveCard(sent.card)
      setTyped(NO_CARD)
      haptic.done()
      await queryClient.invalidateQueries({ queryKey: cardsKey(workspaceId) })
      if (router.canGoBack()) router.back()
      else router.replace(`/settings/w/${encodeURIComponent(workspaceId)}/passwords` as never)
    } catch (error) {
      haptic.fail()
      setProblem(errorText(error, "That did not work. Try again."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "Add a card" }} />
      <HeaderItems
        items={[
          {
            label: "Save",
            text: busy ? "Saving…" : "Save",
            prominent: true,
            disabled: busy,
            onPress: () => void save(),
          },
        ]}
      />
      <Text variant="subhead" tone="ink2" style={{ marginHorizontal: 32, marginBottom: 14 }}>
        A Dood of this workspace can pay with it on websites, once someone says it may. It is never
        shown the number, and neither is anyone else once it is saved.
      </Text>

      <Section footer="There is no box for the security code, since it is never kept. Whoever says the card may be used types it then.">
        <Field
          label="Card number"
          placeholder="1234 1234 1234 1234"
          autoFocus
          keyboardType="number-pad"
          textContentType="creditCardNumber"
          autoComplete="cc-number"
          autoCorrect={false}
          spellCheck={false}
          // Nineteen digits in groups of four, with their spaces.
          maxLength={23}
          style={{ fontFamily: mono, letterSpacing: 0 }}
          {...box("number", groupedCardNumber)}
        />
        <Field
          label="Expires"
          placeholder="MM/YY"
          keyboardType="number-pad"
          textContentType="creditCardExpiration"
          autoComplete="cc-exp"
          autoCorrect={false}
          maxLength={5}
          style={{ fontFamily: mono, letterSpacing: 0 }}
          {...box("expires", groupedExpiry)}
        />
        <Field
          label="Postal code"
          placeholder="Optional"
          textContentType="postalCode"
          autoComplete="postal-code"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={MAX_POSTAL_CODE_CHARS}
          {...box("postalCode")}
        />
      </Section>

      <Section footer="A card made for this with a spending limit is the safer one to save.">
        <Field
          label="Name on card"
          accessibilityLabel="Name on the card"
          placeholder="Optional"
          textContentType="creditCardName"
          autoComplete="cc-name"
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={MAX_CARD_HOLDER_CHARS}
          {...box("holder")}
        />
        <Field
          label="Name"
          // Left empty, it is called what the server would call it, which is shown.
          placeholder={cardNameFor(typed.number)}
          textContentType="none"
          autoComplete="off"
          maxLength={MAX_LOGIN_NAME_CHARS}
          {...box("name")}
        />
      </Section>

      {problem === undefined ? null : (
        <Text
          variant="footnote"
          tone="red"
          accessibilityRole="alert"
          style={{ marginHorizontal: 32, marginBottom: 14 }}
        >
          {problem}
        </Text>
      )}
    </Screen>
  )
}

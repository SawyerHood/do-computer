import type { InviteResult } from "@durable-computer/protocol"
import * as Clipboard from "expo-clipboard"
import { useState } from "react"
import { Platform, Pressable, TextInput, View } from "react-native"
import { radius, useTheme } from "@/lib/theme"
import { Button, haptic, Icon, Row, Section, Text } from "@/ui"

/** "1 person", "3 people". */
export const count = (many: number, one: string, more: string) =>
  `${many} ${many === 1 ? one : more}`

export const INVITE_ROLES = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
] as const

const isEmail = (entry: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry)

/** Everyone entered, counting what is still being typed. */
export const entered = (who: string[], typed: string) => [
  ...new Set([...who, ...typed.split(/[\s,;]+/).filter(Boolean)]),
]

/**
 * A row for the people to invite: each an email address or a GitHub username, shown as a chip
 * once it is entered. Whatever is still being typed counts too (see `entered`), so nothing is
 * lost on Send. It is not made a chip when the field is left, as the web app does: that moved
 * the button under the finger that was pressing it, and the press was lost.
 */
export function WhoInput({
  who,
  onChange,
  typed,
  onTyped,
  label,
  autoFocus = false,
}: {
  who: string[]
  onChange: (who: string[]) => void
  typed: string
  onTyped: (typed: string) => void
  label: string
  autoFocus?: boolean
}) {
  const theme = useTheme()
  const add = (text: string) => {
    const entries = text
      .split(/[\s,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
    onChange([...new Set([...who, ...entries])])
    onTyped("")
  }
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 11, minHeight: 50 }}>
      {who.map((entry) => (
        <View
          key={entry}
          style={{ flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "100%", backgroundColor: theme.fill, borderRadius: radius.pill, paddingLeft: 9, paddingRight: 4, paddingVertical: 4 }}
        >
          <Icon name={isEmail(entry) ? "mail" : "person"} size={14} color={theme.ink2} />
          <Text variant="subhead" numberOfLines={1} style={{ flexShrink: 1 }}>
            {isEmail(entry) ? entry : entry.replace(/^@/, "")}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${entry}`}
            hitSlop={8}
            onPress={() => {
              haptic.tap()
              onChange(who.filter((other) => other !== entry))
            }}
            style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="close" size={11} color={theme.ink2} weight="bold" />
          </Pressable>
        </View>
      ))}
      <TextInput
        accessibilityLabel={label}
        value={typed}
        placeholder={who.length === 0 ? "Email or @github-username" : ""}
        placeholderTextColor={theme.ink3}
        selectionColor={theme.tint}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        // A browser's email field takes the spaces out before they are seen, and a space ends an entry.
        keyboardType={Platform.OS === "web" ? "default" : "email-address"}
        returnKeyType="next"
        submitBehavior="submit"
        onChangeText={(value) => {
          // A comma or a space ends an entry, as does pasting several at once.
          if (/[\s,;]/.test(value)) add(value)
          else onTyped(value)
        }}
        onSubmitEditing={() => {
          if (typed.trim() !== "") add(typed)
        }}
        onKeyPress={(event) => {
          if (event.nativeEvent.key === "Backspace" && typed === "" && who.length > 0) {
            onChange(who.slice(0, -1))
          }
        }}
        style={{ flexGrow: 1, minWidth: 140, color: theme.ink, fontSize: 17, letterSpacing: -0.41, padding: 0, minHeight: 28 }}
      />
    </View>
  )
}

/** A button that puts a link on the clipboard and says so for a moment. */
export function CopyLink({ link, label }: { link: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      kind="grey"
      size="small"
      icon={copied ? "check" : "copy"}
      title={copied ? "Copied" : "Copy link"}
      accessibilityLabel={label}
      onPress={async () => {
        await Clipboard.setStringAsync(link).catch(() => {})
        haptic.done()
        setCopied(true)
        setTimeout(() => setCopied(false), 1_500)
      }}
    />
  )
}

/**
 * What came of inviting: for each person, whether they were written to, and the link to pass on.
 * A link is only ever shown here, when it is made.
 */
export function InviteOutcome({ result }: { result: InviteResult }) {
  return (
    <>
      <Section>
        {result.invitations.map((invitation) => (
          <Row
            key={invitation.id}
            title={invitation.email ?? `@${invitation.githubLogin}`}
            subtitle={
              invitation.emailed
                ? "An email is on its way. The link also works."
                : invitation.email === null
                  ? "It will be waiting when they sign in with GitHub. Or send them the link."
                  : "No email was sent from here. Send them the link."
            }
            tail={
              <CopyLink
                link={invitation.link}
                label={`Copy the link for ${invitation.email ?? invitation.githubLogin}`}
              />
            }
          />
        ))}
      </Section>
      {result.problems.map((problem) => (
        <Text
          key={problem.who}
          variant="footnote"
          tone="red"
          accessibilityRole="alert"
          style={{ marginHorizontal: 32, marginBottom: 10 }}
        >
          {problem.who}: {problem.error}
        </Text>
      ))}
    </>
  )
}

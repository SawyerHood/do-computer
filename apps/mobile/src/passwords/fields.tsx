import { MAX_LOGIN_SITES, withSite } from "@do-computer/protocol"
import { useRef, useState } from "react"
import { Pressable, TextInput, type TextInputProps, View } from "react-native"
import { mono, useTheme } from "@/lib/theme"
import { Field, Icon, Row, Section, Text } from "@/ui"

/**
 * A row a password is typed in: hidden as it goes in, with an eye to look at it while it is
 * still here. It is named a password to the system, so that the phone's own passwords can
 * fill it in; that a password saved here is a website's and not this app's is said by the
 * screen around it.
 */
export function PasswordField({
  label,
  value,
  onChangeText,
  editable = true,
  autoFocus = false,
  testID,
}: {
  label: string
  value: string
  onChangeText: (text: string) => void
  editable?: boolean
  autoFocus?: boolean
  testID?: string
}) {
  const theme = useTheme()
  const input = useRef<TextInput>(null)
  const [visible, setVisible] = useState(false)
  return (
    <Pressable
      accessible={false}
      onPress={() => input.current?.focus()}
      style={{
        minHeight: 50,
        paddingLeft: 16,
        paddingRight: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <Text style={{ minWidth: 96, flexShrink: 0 }} numberOfLines={1} accessible={false}>
        {label}
      </Text>
      <TextInput
        ref={input}
        accessibilityLabel={label}
        testID={testID}
        secureTextEntry={!visible}
        textContentType="password"
        autoComplete="current-password"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoFocus={autoFocus}
        editable={editable}
        value={value}
        onChangeText={onChangeText}
        placeholder="Required"
        placeholderTextColor={theme.ink3}
        selectionColor={theme.tint}
        style={{
          flex: 1,
          color: theme.ink,
          fontFamily: value === "" ? undefined : mono,
          fontSize: 17,
          padding: 0,
          minHeight: 24,
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
        accessibilityState={{ selected: visible }}
        onPress={() => setVisible(!visible)}
        hitSlop={6}
        style={{
          width: 36,
          height: 36,
          alignItems: "center",
          justifyContent: "center",
          opacity: visible ? 1 : 0.55,
        }}
      >
        <Icon name="eye" size={18} color={theme.ink2} />
      </Pressable>
    </Pressable>
  )
}

/**
 * Adding to the sites a login is for, from what is typed: its host, or why it cannot be. What
 * is not a site stays typed, to be put right; `loud` says so, and is for when it was meant to
 * be added, not when the box was merely left.
 */
export function useSiteAdder({
  sites,
  typed,
  onSites,
  onTyped,
  onProblem,
}: {
  sites: readonly string[]
  typed: string
  onSites: (sites: string[]) => void
  onTyped: (typed: string) => void
  onProblem: (problem: string | undefined) => void
}) {
  return (loud: boolean) => {
    if (typed.trim() === "") return
    const added = withSite(sites, typed)
    if ("problem" in added) {
      if (loud) onProblem(added.problem)
      return
    }
    onProblem(undefined)
    onSites(added.sites)
    onTyped("")
  }
}

/** What a box for a site is, wherever one is typed: an address, with nothing changed in it. */
export const SITE_INPUT: TextInputProps = {
  accessibilityLabel: "A site to add",
  placeholder: "example.com",
  keyboardType: "url",
  textContentType: "URL",
  autoComplete: "off",
  autoCapitalize: "none",
  autoCorrect: false,
  spellCheck: false,
  returnKeyType: "done",
  submitBehavior: "submit",
}

/**
 * The sites a login is used on, a row each, with a row to type another in. What is typed for
 * the next one is the form's to hold, so that saving can add it or refuse it. The one a Dood
 * asked about, where there is one, cannot be taken out.
 */
export function SitesSection({
  sites,
  typed,
  fixed,
  editable,
  onSites,
  onTyped,
  onProblem,
}: {
  sites: readonly string[]
  typed: string
  fixed?: string
  editable: boolean
  onSites: (sites: string[]) => void
  onTyped: (typed: string) => void
  onProblem: (problem: string | undefined) => void
}) {
  const theme = useTheme()
  const add = useSiteAdder({ sites, typed, onSites, onTyped, onProblem })
  const full = sites.length >= MAX_LOGIN_SITES
  return (
    <View accessibilityLabel="Used only on" accessibilityRole="list">
      <Section
        title="Used only on"
        footer="It is typed on these sites and the ones under them, such as app.example.com for example.com, and nowhere else."
      >
        {sites.map((site) => (
          <Row
            key={site}
            title={
              <Text numberOfLines={1} style={{ fontFamily: mono, fontSize: 16 }}>
                {site}
              </Text>
            }
            tail={
              site === fixed ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${site}`}
                  disabled={!editable}
                  hitSlop={8}
                  onPress={() => {
                    onProblem(undefined)
                    onSites(sites.filter((each) => each !== site))
                  }}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: theme.red,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <View
                    style={{ width: 10, height: 2, borderRadius: 1, backgroundColor: "#fff" }}
                  />
                </Pressable>
              )
            }
          />
        ))}
        {full && typed === "" ? null : (
          <Field
            {...SITE_INPUT}
            placeholder={sites.length === 0 ? "example.com" : "Add a site"}
            editable={editable}
            value={typed}
            onChangeText={(text) => {
              onProblem(undefined)
              onTyped(text)
            }}
            onSubmitEditing={() => add(true)}
            onBlur={() => add(false)}
            style={{ fontFamily: typed === "" ? undefined : mono, fontSize: 16 }}
          />
        )}
      </Section>
    </View>
  )
}

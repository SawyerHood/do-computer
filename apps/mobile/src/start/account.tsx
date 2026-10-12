import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from "react-native"
import Svg, { Path } from "react-native-svg"
import { sessionFor } from "@/lib/session"
import { useTheme } from "@/lib/theme"
import { Button, Field, haptic, Section, Text } from "@/ui"

/** What someone who is not signed in is offered, as the deployment's `/api/auth-methods` answers. */
export type FrontDoor = {
  google: boolean
  github: boolean
  /**
   * Whether an email and a password are a way in. Where they are not, a provider is. A
   * deployment from before there was a choice does not say, and takes them.
   */
  password?: boolean
  /** `waitlist`: anyone may make an account, and waits to be let in to the app itself. */
  signup: "open" | "invite" | "waitlist"
  /** Whether the deployment shows a landing page to someone who is not signed in. */
  landing?: boolean
  /** Whether a stranger may make an account. */
  open?: boolean
}

export type Provider = "google" | "github"

/** Where a browser build is served from under its deployment's address, such as `/__mobile`. */
const BASE = (process.env.EXPO_BASE_URL ?? "").replace(/\/+$/, "")

/**
 * Which sign-ins a deployment offers. It is asked of the deployment itself, which answers
 * anyone, so the buttons are only shown once it is known that they would work.
 */
export function useFrontDoor(server: string | undefined) {
  return useQuery({
    queryKey: ["auth-methods", server],
    enabled: server !== undefined,
    retry: false,
    queryFn: async (): Promise<FrontDoor> => {
      const answer = await fetch(`${server}/api/auth-methods`)
      if (!answer.ok) throw new Error("This address did not answer as Do Computer does.")
      return (await answer.json()) as FrontDoor
    },
  })
}

const GITHUB =
  "M8 .2a8 8 0 0 0-2.5 15.6c.4.1.5-.2.5-.4v-1.4c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.500 7.500 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.100 0 3.100-1.900 3.700-3.700 3.900.300.300.600.800.600 1.500v2.200c0 .200.100.500.600.400A8 8 0 0 0 8 .2z"

function GitHubMark({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 16 16">
      <Path fill={color} d={GITHUB} />
    </Svg>
  )
}

function GoogleMark() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path
        fill="#4285F4"
        d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.900h5.600a4.800 4.800 0 0 1-2.100 3.100v2.600h3.400c2-1.800 3.100-4.500 3.100-7.600z"
      />
      <Path
        fill="#34A853"
        d="M12 22.500c2.800 0 5.200-.900 6.900-2.500l-3.400-2.600c-.900.600-2.100 1-3.500 1-2.700 0-5-1.800-5.800-4.300H2.700v2.700A10.500 10.500 0 0 0 12 22.500z"
      />
      <Path
        fill="#FBBC05"
        d="M6.200 14.100a6.300 6.300 0 0 1 0-4V7.400H2.700a10.500 10.500 0 0 0 0 9.400z"
      />
      <Path
        fill="#EA4335"
        d="M12 5.700c1.500 0 2.900.500 4 1.500l3-3A10.500 10.500 0 0 0 2.700 7.400l3.500 2.700C7 7.500 9.300 5.700 12 5.700z"
      />
    </Svg>
  )
}

/** "Continue with …": GitHub's is dark and filled, Google's white with a hairline, as theirs are. */
function SocialButton({
  provider,
  busy,
  disabled,
  onPress,
}: {
  provider: Provider
  busy: boolean
  disabled: boolean
  onPress: () => void
}) {
  const theme = useTheme()
  const github = provider === "github"
  const fill = github ? theme.ink : "#ffffff"
  const ink = github ? theme.bg : "#16191a"
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={github ? "Continue with GitHub" : "Continue with Google"}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.social,
        { backgroundColor: fill, opacity: pressed ? 0.7 : disabled && !busy ? 0.5 : 1 },
        github ? null : { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.ink3 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <>
          {github ? <GitHubMark color={ink} /> : <GoogleMark />}
          <Text variant="headline" color={ink}>
            {github ? "Continue with GitHub" : "Continue with Google"}
          </Text>
        </>
      )}
    </Pressable>
  )
}

/**
 * The way in: the deployment's own sign-ins where it has any, then an email and a password.
 * It signs in or makes the account and says which it did; where to go then is its caller's to
 * decide. `server` is undefined while what was typed is not an address.
 */
export function AccountForm({
  server,
  mode,
  words,
  back,
  onDone,
}: {
  server: string | undefined
  mode: "sign-in" | "sign-up"
  /** What the name's row and the button say, which the sign-in page and the first run word differently. */
  words: { name: string; signIn: string; signUp: string }
  /** Where a browser comes back to from a provider: a path of this app. */
  back: string
  onDone: (how: "sign-in" | "sign-up", server: string) => void | Promise<void>
}) {
  const theme = useTheme()
  const { data: methods } = useFrontDoor(server)
  // A deployment can leave signing in to GitHub or Google, and take no passwords at all.
  const passwords = methods?.password !== false
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<"form" | Provider>()
  const signingUp = mode === "sign-up"

  const unreachable = (at: string) =>
    setError(
      `Could not reach ${at.replace(/^https?:\/\//, "")}. Check the address and your connection.`,
    )

  const submit = async () => {
    setError(undefined)
    if (server === undefined) {
      return setError("Enter the address of your deployment, such as agent.example.com.")
    }
    if (email.trim() === "" || password === "") return setError("Enter your email and password.")
    setBusy("form")
    try {
      const { auth } = sessionFor(server)
      const result = signingUp
        ? await auth.signUp.email({
            name: name.trim() || email.split("@")[0]!,
            email: email.trim(),
            password,
          })
        : await auth.signIn.email({ email: email.trim(), password })
      if (result.error) {
        haptic.fail()
        return setError(
          result.error.message ?? "That did not work. Check your details and try again.",
        )
      }
      await onDone(mode, server)
    } catch {
      unreachable(server)
    } finally {
      setBusy(undefined)
    }
  }

  const social = async (provider: Provider) => {
    setError(undefined)
    if (server === undefined) {
      return setError("Enter the address of your deployment, such as agent.example.com.")
    }
    setBusy(provider)
    try {
      const { auth } = sessionFor(server)
      // On a phone this opens the system's sign-in sheet and keeps the session when it shuts;
      // in a browser the page goes to the provider and comes back signed in.
      const result = await auth.signIn.social({
        provider,
        callbackURL: Platform.OS === "web" ? `${BASE}${back}` : "/",
      })
      if (result.error) {
        haptic.fail()
        return setError(result.error.message ?? "That sign-in could not be finished. Try again.")
      }
      if (Platform.OS === "web") return
      // Shutting the sheet without signing in is not something that went wrong.
      const session = await auth.getSession()
      if (session.data == null) return
      // Whether the account is new is for whoever asked to find out: it is signed in either way.
      await onDone("sign-in", server)
    } catch {
      unreachable(server)
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <View style={{ gap: 14 }}>
      {methods?.github || methods?.google ? (
        <View style={{ gap: 10, paddingHorizontal: 16 }}>
          {methods.github ? (
            <SocialButton
              provider="github"
              busy={busy === "github"}
              disabled={busy !== undefined}
              onPress={() => void social("github")}
            />
          ) : null}
          {methods.google ? (
            <SocialButton
              provider="google"
              busy={busy === "google"}
              disabled={busy !== undefined}
              onPress={() => void social("google")}
            />
          ) : null}
          {passwords ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 6 }}>
              <View
                style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.ink3 }}
              />
              <Text variant="footnote" tone="ink2">
                or
              </Text>
              <View
                style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.ink3 }}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      {passwords ? (
        <Section>
          {signingUp ? (
            <Field
              label={words.name}
              value={name}
              onChangeText={setName}
              textContentType="name"
              autoComplete="name"
              returnKeyType="next"
            />
          ) : null}
          <Field
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            returnKeyType="next"
          />
          <Field
            label="Password"
            placeholder={signingUp ? "At least 8 characters" : "Required"}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType={signingUp ? "newPassword" : "password"}
            autoComplete={signingUp ? "new-password" : "current-password"}
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
        </Section>
      ) : null}
      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        {error === undefined ? null : (
          <Text variant="subhead" tone="red" accessibilityRole="alert">
            {error}
          </Text>
        )}
        {passwords ? (
          <Button
            title={signingUp ? words.signUp : words.signIn}
            onPress={() => void submit()}
            busy={busy === "form"}
            disabled={busy !== undefined && busy !== "form"}
          />
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  social: {
    height: 50,
    borderRadius: 25,
    borderCurve: "continuous",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
})

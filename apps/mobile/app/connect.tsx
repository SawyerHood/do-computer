import { useRouter } from "expo-router"
import { useAtomValue } from "jotai"
import { useState } from "react"
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Button, ErrorText, Field, Text } from "@/components/ui"
import { normalizeServer, serverAtom, sessionFor, setServer } from "@/lib/session"
import { space, useTheme } from "@/lib/theme"

/**
 * Connect to a deployment and sign in. A device has to be told which deployment; a browser build
 * is served by one and already knows.
 */
export default function Connect() {
  const theme = useTheme()
  const router = useRouter()
  const connected = useAtomValue(serverAtom)
  const [address, setAddress] = useState(connected ?? "")
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const needsAddress = Platform.OS !== "web"

  const submit = async () => {
    setError(undefined)
    const server = needsAddress ? normalizeServer(address) : (connected ?? undefined)
    if (server === undefined)
      return setError("Enter the address of your deployment, such as agent.example.com.")
    setBusy(true)
    try {
      const { auth } = sessionFor(server)
      const result =
        mode === "sign-up"
          ? await auth.signUp.email({ name: name.trim() || email.split("@")[0]!, email, password })
          : await auth.signIn.email({ email, password })
      if (result.error) {
        return setError(
          result.error.message ?? "That did not work. Check your details and try again.",
        )
      }
      setServer(server)
      router.replace("/(app)")
    } catch {
      setError(`Could not reach ${server}. Check the address and your connection.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.canvas }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: space(6),
            gap: space(5),
          }}
        >
          <View style={{ gap: space(1.5) }}>
            <Text size={26} weight="600" accessibilityRole="header">
              {mode === "sign-up" ? "Create your account" : "Welcome back"}
            </Text>
            <Text tone="muted" size={14}>
              {mode === "sign-up"
                ? "Then meet your agent: it gets its own name, memory and computer."
                : "Sign in to pick up where you and your agent left off."}
            </Text>
          </View>
          {needsAddress ? (
            <Field
              label="Deployment address"
              value={address}
              onChangeText={setAddress}
              placeholder="agent.example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          ) : null}
          {mode === "sign-up" ? (
            <Field label="Name" value={name} onChangeText={setName} autoComplete="name" />
          ) : null}
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            onSubmitEditing={submit}
          />
          <ErrorText>{error}</ErrorText>
          <Button
            label={mode === "sign-up" ? "Create account" : "Sign in"}
            busy={busy}
            onPress={submit}
          />
          <Button
            variant="ghost"
            label={mode === "sign-up" ? "I already have an account" : "Create an account"}
            onPress={() => {
              setError(undefined)
              setMode(mode === "sign-up" ? "sign-in" : "sign-up")
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

import { ApiError } from "@do-computer/client"
import { useQueryClient } from "@tanstack/react-query"
import { Image } from "expo-image"
import { type Href, useLocalSearchParams, useRouter } from "expo-router"
import { useAtomValue, useStore } from "jotai"
import { useState } from "react"
import { Platform, View } from "react-native"
import { KeyboardAwareScrollView } from "react-native-keyboard-controller"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { DEFAULT_SERVER, normalizeServer, serverAtom, sessionFor, setServer } from "@/lib/session"
import { useTheme } from "@/lib/theme"
import { AccountForm, useFrontDoor } from "@/start/account"
import { nextAtom } from "@/start/met"
import { Button, Field, Section, Text } from "@/ui"

const ICON = require("../assets/icon.png") as number

/** An address as it is said: without its scheme. */
const host = (server: string) => server.replace(/^https?:\/\//, "")

/**
 * Sign in, or make an account. A phone talks to the deployment everyone uses unless it is told
 * of another at the foot of the page; a browser build is served by one and already knows.
 */
export default function Connect() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const store = useStore()
  const connected = useAtomValue(serverAtom)
  const next = useAtomValue(nextAtom)
  const native = Platform.OS !== "web"
  // What is typed has "https://" put before it. A server that is reached without it, as one on
  // the same machine is, keeps its scheme here, or the next sign-in would ask the wrong place.
  const [address, setAddress] = useState(() => {
    const known = connected ?? DEFAULT_SERVER
    return known.startsWith("https://") ? host(known) : known
  })
  const [changing, setChanging] = useState(false)
  // A page that sends someone here to make an account says so in the address.
  const asked = useLocalSearchParams<{ mode?: string }>()
  const [mode, setMode] = useState<"sign-in" | "sign-up">(
    asked.mode === "sign-up" ? "sign-up" : "sign-in",
  )
  const server = native ? normalizeServer(address) : (connected ?? undefined)
  const { data: methods } = useFrontDoor(server)
  const signingUp = mode === "sign-up"
  // Where the deployment says "coming soon", this page does not offer what that withheld.
  // Someone a page sent here to come back to it, as an invitation does, may still be new.
  const shut = !signingUp && methods?.landing === true && methods.open === false && next === null

  /** Signed in. Someone with no agent yet, or who is waiting to be let in, meets theirs first. */
  const landed = async (how: "sign-in" | "sign-up", at: string) => {
    setServer(at)
    // Whatever an earlier session left behind is not this person's.
    queryClient.clear()
    if (how === "sign-up") return router.replace("/welcome")
    const back = store.get(nextAtom)
    if (back !== null) {
      store.set(nextAtom, null)
      return router.replace(back as Href)
    }
    const { client } = sessionFor(at)
    const [me, agents] = await Promise.all([
      client.me(),
      // Someone on the waiting list has no agents to list, and is told so.
      client.listAgents().catch((error: unknown) => {
        if (error instanceof ApiError && error.code === "waitlisted") return []
        throw error
      }),
    ])
    router.replace(me.waiting === true || agents.length === 0 ? "/welcome" : "/(app)")
  }

  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + 56,
        paddingBottom: insets.bottom + 16,
        width: "100%",
        maxWidth: 520,
        alignSelf: "center",
      }}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
      <View style={{ paddingHorizontal: 24, paddingBottom: 24 }}>
        <Image
          source={ICON}
          accessible={false}
          style={{ width: 76, height: 76, borderRadius: 18, marginBottom: 22 }}
        />
        <Text variant="largeTitle" accessibilityRole="header">
          {signingUp ? "Create your account" : "Welcome back"}
        </Text>
        <Text tone="ink2" style={{ marginTop: 6 }}>
          {signingUp
            ? "Then meet your Dood: it gets its own name and memory, and a computer to work on."
            : "Sign in to pick up where you and your Dood left off."}
        </Text>
      </View>
      <AccountForm
        key={mode}
        server={server}
        mode={mode}
        words={{ name: "Name", signIn: "Sign in", signUp: "Create account" }}
        // Someone a provider signed in may be new: the first run sends on whoever is not.
        back={next ?? "/welcome"}
        onDone={landed}
      />
      <View style={{ paddingHorizontal: 24, paddingTop: 14, gap: 10, alignItems: "center" }}>
        {shut ? (
          <Text variant="subhead" tone="ink2" style={{ textAlign: "center" }}>
            <Text variant="subhead" weight="600">
              Do Computer is not open to everyone yet.
            </Text>{" "}
            If a team invited you, use the link in your invitation.
          </Text>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Text variant="callout">{signingUp ? "Already have an account?" : "New here?"}</Text>
            <Button
              kind="plain"
              size="small"
              title={signingUp ? "Sign in" : "Create an account"}
              onPress={() => setMode(signingUp ? "sign-in" : "sign-up")}
              style={{ paddingHorizontal: 0 }}
            />
          </View>
        )}
        {signingUp && methods?.signup === "invite" ? (
          <Text variant="footnote" tone="ink2" style={{ textAlign: "center" }}>
            This deployment is invite-only: after the first account, only people who have been
            invited can sign up.
          </Text>
        ) : null}
        {signingUp && methods?.signup === "waitlist" ? (
          <Text variant="footnote" tone="ink2" style={{ textAlign: "center" }}>
            New accounts join a waiting list.
          </Text>
        ) : null}
      </View>
      {native ? (
        <View style={{ flexGrow: 1, justifyContent: "flex-end", paddingTop: 28 }}>
          {changing ? (
            <Section footer="The address of your own deployment, such as agent.example.com.">
              <Field
                label="Server"
                accessibilityLabel="Deployment address"
                placeholder={host(DEFAULT_SERVER)}
                value={address}
                onChangeText={setAddress}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                autoFocus
                onBlur={() => {
                  // Left empty, it is the deployment everyone uses again.
                  if (address.trim() === "") setAddress(host(DEFAULT_SERVER))
                  const named = normalizeServer(address)
                  if (named === undefined) return
                  // Kept, so that the app talks to it the next time it is opened too.
                  setServer(named)
                  setChanging(false)
                }}
              />
            </Section>
          ) : (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <Text variant="footnote" tone="ink2">
                Server: {server === undefined ? address : host(server)} ·
              </Text>
              <Button
                kind="plain"
                size="small"
                title="Change"
                accessibilityLabel="Change server"
                onPress={() => setChanging(true)}
                style={{ paddingHorizontal: 0 }}
              />
            </View>
          )}
        </View>
      ) : null}
    </KeyboardAwareScrollView>
  )
}

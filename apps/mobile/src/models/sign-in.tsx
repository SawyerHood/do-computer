import type { ModelLogin, ModelLoginPrompt } from "@durable-computer/protocol"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { Stack, useRouter } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import { type ReactNode, useEffect, useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { mono, radius, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Button, Empty, Field, haptic, Row, Screen, Section, Text } from "@/ui"
import { providersKey, useProviders, useScope } from "./pages"
import { asked, endsAtAddress, pasted, signInWords, WAYS } from "./words"

/** Open a page of the provider's over the app, where the person signs in and then comes back. */
const openPage = (url: string) => void WebBrowser.openBrowserAsync(url).catch(() => {})

/** A line that says what is being waited for, with the wheel that says it is. */
function Waiting({ children }: { children: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 32, marginBottom: 22 }}>
      <ActivityIndicator />
      <Text variant="subhead" tone="ink2" style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  )
}

/** Small words between groups, set in from the edge as a group's footer is. */
function Note({ children, tone = "ink2" }: { children: ReactNode; tone?: "ink2" | "red" }) {
  return (
    <Text
      variant="footnote"
      tone={tone}
      accessibilityRole={tone === "red" ? "alert" : undefined}
      style={{ marginHorizontal: 32, marginBottom: 18 }}
    >
      {children}
    </Text>
  )
}

/** What is said under a field of a sign-in: where what goes in it comes from, or where it is kept. */
function help(prompt: ModelLoginPrompt, providerName: string): string | undefined {
  if (prompt.type !== "manual_code") {
    return prompt.type === "secret"
      ? "Kept on the server and never shown again. Agents never see it."
      : undefined
  }
  return endsAtAddress(prompt)
    ? "After you sign in, the page goes to an address that starts with localhost and does not load. That is expected. Copy the whole address from the address bar."
    : `${providerName}'s page shows it once you have signed in.`
}

/**
 * Signing a workspace (or the server) in to a provider, one way: a screen that follows the
 * provider's own steps as the server leads them. What there is to show changes as it goes, so
 * this draws whatever the sign-in says it is at: a choice, a page to open, a code to enter
 * there, something to type here. Leaving the screen stops the sign-in.
 */
export function SignInPage({
  workspaceId,
  providerId,
  type,
}: {
  workspaceId: string
  providerId: string
  type: string
}) {
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const scope = useScope(workspaceId)
  const providers = useProviders(workspaceId)
  const provider = providers.data?.find((each) => each.id === providerId)
  const method = provider?.methods.find((each) => each.type === type)
  const methodType = method?.type

  const [login, setLogin] = useState<ModelLogin>()
  const [failure, setFailure] = useState<string>()
  const [value, setValue] = useState("")
  const [copied, setCopied] = useState(false)
  /** Goes up to start the sign-in over. */
  const [attempt, setAttempt] = useState(0)
  /** Whether a choice of how was made, which starting over undoes. */
  const [chose, setChose] = useState(false)

  // Start it, then follow it: each answer from the server is held until there is something new.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` starts it over.
  useEffect(() => {
    if (methodType === undefined) return
    const api = client.workspace(workspaceId)
    let gone = false
    let current: ModelLogin | undefined
    setLogin(undefined)
    setFailure(undefined)
    setValue("")
    setChose(false)
    setCopied(false)
    void (async () => {
      try {
        current = await api.startModelLogin({ providerId, type: methodType })
        // Left while it was starting: it is stopped now that there is something to stop.
        if (gone) void api.cancelModelLogin(current.id).catch(() => {})
        while (!gone) {
          const next = current
          setLogin((shown) => (shown === undefined || next.rev >= shown.rev ? next : shown))
          if (current.status !== "waiting") return
          current = await api.modelLogin(current.id, { rev: current.rev, waitMs: 20_000 })
        }
      } catch (error) {
        if (!gone) setFailure(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      gone = true
      // Left before it was done: the server need not go on waiting for it.
      if (current?.status === "waiting") void api.cancelModelLogin(current.id).catch(() => {})
    }
  }, [client, workspaceId, providerId, methodType, attempt])

  const answer = useMutation({
    mutationFn: (input: { promptId: string; value: string }) => {
      if (login === undefined) throw new Error("The sign-in has not started.")
      return client.workspace(workspaceId).answerModelLogin(login.id, input)
    },
    onSuccess: (next) => {
      setValue("")
      setLogin((shown) => (shown === undefined || next.rev >= shown.rev ? next : shown))
    },
  })

  const done = login?.status === "done"
  useEffect(() => {
    if (!done) return
    haptic.done()
    // What the workspace's agents can run on has changed with it.
    void queryClient.invalidateQueries({ queryKey: providersKey(workspaceId) })
    void queryClient.invalidateQueries({ queryKey: ["models"] })
    // Back to the provider, which now says it is signed in to.
    if (router.canGoBack()) router.back()
    else {
      router.replace(
        `/settings/w/${encodeURIComponent(workspaceId)}/models/${encodeURIComponent(providerId)}`,
      )
    }
  }, [done, workspaceId, providerId, queryClient, router])

  if (scope === undefined || provider === undefined || method === undefined) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Sign in" }} />
        {providers.data === undefined || scope === undefined ? (
          <ActivityIndicator style={{ marginVertical: 32 }} />
        ) : (
          <Empty title="That way of signing in is not offered" />
        )}
      </Screen>
    )
  }

  const words = signInWords(scope, provider, method)
  const prompt = login?.prompt ?? null
  const problem = failure ?? (login?.status === "failed" ? (login.error ?? "It failed.") : undefined)
  const retry = () => {
    answer.reset()
    setAttempt((count) => count + 1)
  }
  const send = () => {
    if (prompt !== null && value.trim() !== "") answer.mutate({ promptId: prompt.id, value })
  }

  let body: ReactNode
  if (problem !== undefined) {
    body = (
      <>
        <Note tone="red">{problem}</Note>
        <View style={{ marginHorizontal: 16 }}>
          <Button title="Try again" onPress={retry} />
        </View>
      </>
    )
  } else if (login === undefined) {
    body = <Waiting>Starting…</Waiting>
  } else if (prompt?.type === "select") {
    body = (
      <>
        <Section title={prompt.message}>
          {(prompt.options ?? []).map((option) => {
            const way = WAYS[option.id] ?? { label: option.label, description: option.description }
            return (
              <Row
                key={option.id}
                title={way.label}
                subtitle={way.description}
                go
                disabled={answer.isPending}
                onPress={() => {
                  haptic.tap()
                  setChose(true)
                  answer.mutate({ promptId: prompt.id, value: option.id })
                }}
              />
            )
          })}
        </Section>
        {answer.isError ? <Note tone="red">{answer.error.message}</Note> : null}
      </>
    )
  } else {
    const { authUrl, deviceCode } = login
    const open =
      authUrl === null ? null : (
        <Row
          icon={["arrowUpRight", theme.blue]}
          title="Open the sign-in page"
          tone="tint"
          onPress={() => openPage(authUrl.url)}
        />
      )
    const field =
      prompt === null ? null : (
        <Field
          key={prompt.id}
          accessibilityLabel={pasted(prompt) ?? asked(prompt, words.title)}
          placeholder={prompt.placeholder}
          secureTextEntry={prompt.type === "secret"}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          editable={!answer.isPending}
          value={value}
          onChangeText={setValue}
          returnKeyType="done"
          onSubmitEditing={send}
          style={{ fontFamily: mono, fontSize: 15, letterSpacing: 0 }}
        />
      )
    const paste = (
      <Row
        title="Paste"
        tone="tint"
        disabled={answer.isPending}
        onPress={async () => {
          const text = await Clipboard.getStringAsync().catch(() => "")
          if (text === "") return
          haptic.tap()
          setValue(text.trim())
        }}
      />
    )
    body = (
      <>
        {open !== null && prompt !== null ? (
          <>
            <Section
              title={`1. Sign in at ${provider.name}`}
              footer={`${provider.name}'s page opens over this one. Sign in there and allow access.`}
            >
              {open}
            </Section>
            <Section
              title={`2. Paste ${(pasted(prompt) ?? "what it ends with").toLowerCase()}`}
              footer={help(prompt, provider.name)}
            >
              {field}
              {paste}
            </Section>
          </>
        ) : (
          <>
            {open === null ? null : <Section>{open}</Section>}
            {prompt === null ? null : (
              <Section
                title={prompt.type === "manual_code" ? pasted(prompt) : asked(prompt, words.title)}
                footer={help(prompt, provider.name)}
              >
                {field}
                {paste}
              </Section>
            )}
          </>
        )}
        {deviceCode === null ? null : (
          <>
            <View
              accessibilityLabel={`The code to enter: ${deviceCode.userCode}`}
              style={{
                marginHorizontal: 16,
                marginBottom: 12,
                paddingVertical: 22,
                alignItems: "center",
                borderRadius: radius.group,
                borderCurve: "continuous",
                backgroundColor: theme.card,
              }}
            >
              <Text
                selectable
                style={{ fontFamily: mono, fontSize: 32, lineHeight: 40, fontWeight: "600", letterSpacing: 4 }}
              >
                {deviceCode.userCode}
              </Text>
            </View>
            <Section>
              <Row
                icon={["copy", theme.ink2]}
                title={copied ? "Copied" : "Copy the code"}
                tone="tint"
                onPress={async () => {
                  if (!(await Clipboard.setStringAsync(deviceCode.userCode).catch(() => false))) return
                  haptic.done()
                  setCopied(true)
                }}
              />
              <Row
                icon={["arrowUpRight", theme.blue]}
                title="Open the page to enter it"
                tone="tint"
                onPress={() => openPage(deviceCode.verificationUri)}
              />
            </Section>
            <Waiting>Waiting for you to enter it there. This closes by itself.</Waiting>
          </>
        )}
        {login.notes.map((note) => (
          <Note key={note.message}>{note.message}</Note>
        ))}
        {prompt === null && deviceCode === null ? (
          <Waiting>{login.progress ?? "Working…"}</Waiting>
        ) : null}
        {answer.isError ? <Note tone="red">{answer.error.message}</Note> : null}
        <Note>{words.shared}</Note>
        <View style={{ marginHorizontal: 16, gap: 6 }}>
          {prompt === null ? null : (
            <Button
              title={answer.isPending ? "Checking…" : words.key ? "Use this key" : "Sign in"}
              busy={answer.isPending}
              disabled={value.trim() === ""}
              onPress={send}
            />
          )}
          {chose ? <Button kind="plain" title="Choose another way" onPress={retry} /> : null}
        </View>
      </>
    )
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: words.title }} />
      <Note>{words.description}</Note>
      {body}
    </Screen>
  )
}

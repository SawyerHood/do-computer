import { loginToSend, type SavedLogin } from "@do-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator } from "react-native"
import { useSession } from "@/lib/use-session"
import { PasswordField, SitesSection } from "@/passwords/fields"
import { loginsKey } from "@/passwords/keys"
import {
  confirm,
  Empty,
  errorText,
  Field,
  haptic,
  HeaderItems,
  Row,
  Screen,
  Section,
  Text,
} from "@/ui"

/**
 * What is done to a login here: one added, or one of them given a new password, or its name,
 * username and sites changed. The password is never shown, so it is never changed in place: it
 * is replaced.
 */
type What = "add" | "password" | "change"

/**
 * A login typed for the workspace, as the web app's window for one has it. Adding asks for all
 * of it; replacing its password asks for that alone; changing it asks for everything but the
 * password. A password typed here is held until it is sent, and goes with the screen. It is
 * sent from here and not through the query cache, which keeps what it is given for minutes.
 */
export default function LoginScreen() {
  const params = useLocalSearchParams<{ workspaceId: string; loginId?: string; what?: string }>()
  const { workspaceId } = params
  const { client } = useSession()
  const logins = useQuery<SavedLogin[]>({
    queryKey: loginsKey(workspaceId),
    queryFn: () => client.workspace(workspaceId).savedLogins(),
    enabled: params.loginId !== undefined,
  })
  if (params.loginId === undefined) return <LoginForm workspaceId={workspaceId} what="add" />
  const login = logins.data?.find((each) => each.id === params.loginId)
  if (login === undefined) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "" }} />
        {logins.data === undefined && !logins.isError ? (
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : (
          <Empty title="This login is gone.">Someone removed it, or it was never here.</Empty>
        )}
      </Screen>
    )
  }
  return (
    <LoginForm
      // A screen for another login starts empty of what was typed for the last.
      key={`${params.what}-${login.id}`}
      workspaceId={workspaceId}
      what={params.what === "password" ? "password" : "change"}
      login={login}
    />
  )
}

function LoginForm({
  workspaceId,
  what,
  login,
}: {
  workspaceId: string
  what: What
  login?: SavedLogin
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const api = useSession().client.workspace(workspaceId)
  const [name, setName] = useState(login?.name ?? "")
  const [username, setUsername] = useState(login?.username ?? "")
  const [password, setPassword] = useState("")
  const [sites, setSites] = useState<string[]>(login?.sites ?? [])
  const [site, setSite] = useState("")
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)

  const leave = () => {
    // Opened by its address alone, there is nothing under it to go back to.
    if (router.canGoBack()) router.back()
    else router.replace(`/settings/w/${encodeURIComponent(workspaceId)}/passwords` as never)
  }
  const typing =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setProblem(undefined)
      set(value)
    }

  const save = async () => {
    // What cannot be saved is said here, before anything is sent.
    const sent =
      what === "add"
        ? loginToSend({ name, username, password, sites, site })
        : what === "password"
          ? loginToSend({ password })
          : loginToSend({ name, username, sites, site })
    if ("problem" in sent) {
      haptic.fail()
      return setProblem(sent.problem)
    }
    setBusy(true)
    setProblem(undefined)
    try {
      if (what === "add") {
        const typed = sent.login as { name: string; username: string; password: string }
        await api.saveLogin({ ...typed, sites: sent.login.sites ?? [] })
      } else {
        await api.changeSavedLogin(login!.id, sent.login)
      }
      setPassword("")
      haptic.done()
      await queryClient.invalidateQueries({ queryKey: loginsKey(workspaceId) })
      leave()
    } catch (error) {
      haptic.fail()
      setProblem(errorText(error, "That did not work. Try again."))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (login === undefined) return
    const sure = await confirm({
      title: `Remove ${login.name}?`,
      message:
        "Its password is deleted, and no Dood of this workspace can sign in with it any more.",
      action: "Remove",
    })
    if (!sure) return
    setBusy(true)
    try {
      await api.removeSavedLogin(login.id)
      haptic.done()
      await queryClient.invalidateQueries({ queryKey: loginsKey(workspaceId) })
      leave()
    } catch (error) {
      haptic.fail()
      setProblem(errorText(error, "That did not work. Try again."))
    } finally {
      setBusy(false)
    }
  }

  const title =
    what === "add" ? "Add a login" : what === "password" ? "Replace the password" : login!.name
  const about =
    what === "add"
      ? "A Dood of this workspace can sign in with it on the sites you name. It is never shown the password, and neither is anyone else once it is saved."
      : what === "password"
        ? `The password kept for ${login!.username} is replaced by what you type. It is not shown again.`
        : undefined

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
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
      {about === undefined ? null : (
        <Text variant="subhead" tone="ink2" style={{ marginHorizontal: 32, marginBottom: 14 }}>
          {about}
        </Text>
      )}

      {what === "password" ? null : (
        <Section
          footer={
            what === "change"
              ? "Its password stays as it is."
              : "The name is what you and the Doods call it. A Dood asks for a login by its name."
          }
        >
          <Field
            label="Name"
            placeholder="GitHub"
            autoFocus={what === "add"}
            autoCorrect={false}
            textContentType="none"
            autoComplete="off"
            maxLength={60}
            editable={!busy}
            value={name}
            onChangeText={typing(setName)}
            returnKeyType="next"
          />
          <Field
            label="Username"
            accessibilityLabel="Username or email"
            placeholder="Username or email"
            // Named a username, so that the phone's own saved passwords can fill it in.
            textContentType="username"
            autoComplete="username"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            editable={!busy}
            value={username}
            onChangeText={typing(setUsername)}
          />
          {what === "add" ? (
            <PasswordField
              label="Password"
              editable={!busy}
              value={password}
              onChangeText={typing(setPassword)}
            />
          ) : null}
        </Section>
      )}

      {what === "password" ? (
        <Section>
          <PasswordField
            label="New password"
            autoFocus
            editable={!busy}
            value={password}
            onChangeText={typing(setPassword)}
          />
        </Section>
      ) : (
        <SitesSection
          sites={sites}
          typed={site}
          editable={!busy}
          onSites={typing(setSites)}
          onTyped={typing(setSite)}
          onProblem={setProblem}
        />
      )}

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

      {what === "change" ? (
        <Section>
          <Row
            title="Replace the password"
            tone="tint"
            disabled={busy}
            onPress={() =>
              router.push(
                `/settings/w/${encodeURIComponent(workspaceId)}/passwords/login?loginId=${encodeURIComponent(login!.id)}&what=password` as never,
              )
            }
          />
          <Row title="Remove" tone="red" disabled={busy} onPress={() => void remove()} />
        </Section>
      ) : null}
    </Screen>
  )
}

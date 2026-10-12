import { useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { Platform } from "react-native"
import { signIn } from "@/agent/connectors"
import { keys, useAgentLive } from "@/lib/queries"
import { useSession } from "@/lib/use-session"
import { errorText, Field, haptic, HeaderItems, Row, Screen, Section, tell } from "@/ui"

/** Whether what was typed is an address a connector can be at. */
const isAddress = (value: string): boolean => {
  try {
    return /^https?:$/.test(new URL(value.trim()).protocol)
  } catch {
    return false
  }
}

/**
 * Add a service by the address of its MCP server. One with a sign-in of its own sends the
 * person there next; one that issues a token takes it here.
 */
export default function AddConnector() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const router = useRouter()
  const { client } = useSession()
  const queryClient = useQueryClient()
  useAgentLive(agentId)
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")
  // For the few services whose sign-in does not let an app introduce itself.
  const [given, setGiven] = useState(false)
  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")
  const [adding, setAdding] = useState(false)

  const valid = name.trim() !== "" && isAddress(url)

  const add = async () => {
    if (!valid || adding) return
    setAdding(true)
    const refresh = () => queryClient.invalidateQueries({ queryKey: keys.connectors(agentId) })
    try {
      const result = await client.agent(agentId).addConnector({
        name: name.trim(),
        url: url.trim(),
        token: token || undefined,
        clientId: (given && clientId) || undefined,
        clientSecret: (given && clientSecret) || undefined,
      })
      void refresh()
      if (result.authorizationUrl) {
        await signIn(result.authorizationUrl)
        // In a browser the page has left for the service, and comes back to the connectors.
        if (Platform.OS === "web") return
        void refresh()
      } else {
        haptic.done()
      }
      router.back()
    } catch (error) {
      void refresh()
      tell("The connector could not be added", errorText(error))
    } finally {
      setAdding(false)
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "Add a connector" }} />
      <HeaderItems
        placement="left"
        items={[{ label: "Cancel", text: "Cancel", onPress: () => router.back() }]}
      />
      <HeaderItems
        items={[
          {
            label: "Add",
            text: adding ? "Connecting…" : "Add",
            prominent: true,
            disabled: !valid || adding,
            onPress: () => void add(),
          },
        ]}
      />

      <Section title="Name">
        <Field
          accessibilityLabel="Name"
          placeholder="Calendar"
          value={name}
          onChangeText={setName}
          maxLength={60}
          autoFocus
          returnKeyType="next"
        />
      </Section>
      <Section title="Server address">
        <Field
          accessibilityLabel="Server address"
          placeholder="https://mcp.example.com/mcp"
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Section>
      <Section
        title="Access token (optional)"
        footer="Leave empty for a service you sign in to. A token is kept on the server and never shown to the agent."
      >
        <Field
          accessibilityLabel="Access token (optional)"
          value={token}
          onChangeText={setToken}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
      </Section>
      <Section>
        <Row
          title="The service gave me a client ID"
          toggle={{
            value: given,
            onChange: (next) => {
              haptic.tap()
              setGiven(next)
            },
          }}
        />
        {given ? (
          <Field
            placeholder="Client ID"
            value={clientId}
            onChangeText={setClientId}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
          />
        ) : null}
        {given ? (
          <Field
            placeholder="Client secret"
            value={clientSecret}
            onChangeText={setClientSecret}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
          />
        ) : null}
      </Section>
    </Screen>
  )
}

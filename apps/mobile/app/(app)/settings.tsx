import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { Platform, Pressable, View } from "react-native"
import { Avatar } from "@/components/avatar"
import { Screen } from "@/components/screen"
import { Button, Card, Text } from "@/components/ui"
import { setAgentId, setServer } from "@/lib/session"
import { radius, space, useTheme } from "@/lib/theme"
import { keys, useAgent } from "@/lib/use-agent"
import { useSession } from "@/lib/use-session"

/** The agent's identity at a glance, switching between agents, and signing out. */
export default function Settings() {
  const theme = useTheme()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { server, auth, client } = useSession()
  const { agentId, agents, state } = useAgent()

  const create = async () => {
    const agent = await client.createAgent()
    await queryClient.invalidateQueries({ queryKey: keys.agents })
    setAgentId(agent.id)
  }
  const signOut = async () => {
    await auth.signOut()
    queryClient.clear()
    setAgentId(null)
    // A device forgets which deployment it was on; a browser build has only the one.
    if (Platform.OS !== "web") setServer(null)
    router.replace("/connect")
  }

  return (
    <Screen title="You" subtitle={server}>
      <Text weight="500">Your agents</Text>
      <View style={{ gap: space(2) }}>
        {agents.map((agent) => (
          <Pressable
            key={agent.id}
            accessibilityRole="button"
            accessibilityLabel={`Switch to ${agent.name ?? "New agent"}`}
            accessibilityState={{ selected: agent.id === agentId }}
            onPress={() => setAgentId(agent.id)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space(3),
              padding: space(3),
              borderRadius: radius.md,
              backgroundColor: theme.surface,
              borderWidth: 2,
              borderColor: agent.id === agentId ? theme.primary : "transparent",
            }}
          >
            <Avatar avatar={agent.avatar} seed={agent.id} size={40} hatched={agent.hatched} still />
            <View style={{ flex: 1 }}>
              <Text weight="500">{agent.name ?? "New agent"}</Text>
              {agent.tagline ? (
                <Text tone="muted" size={13} numberOfLines={1}>
                  {agent.tagline}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
      <Button variant="outline" label="New agent" onPress={create} />

      {state ? (
        <Card>
          <Text weight="500">What {state.agent.name ?? "your agent"} knows about you</Text>
          <Text tone={state.user ? "ink" : "muted"} size={14} selectable>
            {state.user || "Nothing saved yet."}
          </Text>
          <Text weight="500" style={{ marginTop: space(2) }}>
            Its notes
          </Text>
          <Text tone={state.memory ? "ink" : "muted"} size={14} selectable>
            {state.memory || "Nothing saved yet."}
          </Text>
          <Text tone="muted" size={12}>
            Edit these, its look and its personality in the web app.
          </Text>
        </Card>
      ) : null}

      <Button variant="danger" label="Sign out" onPress={signOut} />
    </Screen>
  )
}

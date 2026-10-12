import type { ConnectorSummary } from "@do-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, StyleSheet } from "react-native"
import { hostOf, originOf, signIn, STATUS, Words, WordsLink } from "@/agent/connectors"
import { keys, useAgentLive, useAgentSummary } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { confirm, Empty, errorText, haptic, Pill, Row, Screen, Section, tell, Text } from "@/ui"

/**
 * Services the agent can use through MCP: each one's tools become tools of the agent. Apps
 * (Composio) is offered until the agent has it, the agent's place in Slack is reached from
 * here, and another service is added on a page of its own.
 */
export default function Connectors() {
  const {
    agentId,
    connected,
    connector_error: failed,
  } = useLocalSearchParams<{
    agentId: string
    /** In a browser, coming back from a service: which connector was connected. */
    connected?: string
    /** Coming back from one that did not connect: why not. */
    connector_error?: string
  }>()
  const theme = useTheme()
  const router = useRouter()
  const { client, server } = useSession()
  const queryClient = useQueryClient()
  useAgentLive(agentId)
  const agent = useAgentSummary(agentId)
  const api = client.agent(agentId)
  const connectors = useQuery({
    queryKey: keys.connectors(agentId),
    queryFn: () => api.connectors(),
  })
  const slack = useQuery({ queryKey: keys.slack(agentId), queryFn: () => api.slack() })
  const [connecting, setConnecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const guide = `${server}/docs/apps`
  const name = agent?.name ?? "your agent"
  const app = slack.data?.app ?? null
  const justConnected = failed ? undefined : connectors.data?.find((each) => each.id === connected)

  const refresh = async () => {
    setRefreshing(true)
    await Promise.all([connectors.refetch(), slack.refetch()])
    setRefreshing(false)
  }

  const connectApps = async () => {
    if (connecting) return
    setConnecting(true)
    try {
      const result = await api.addConnector({ apps: true })
      void queryClient.invalidateQueries({ queryKey: keys.connectors(agentId) })
      if (result.authorizationUrl) await signIn(result.authorizationUrl)
      else haptic.done()
    } catch (error) {
      tell("Apps could not be connected", errorText(error))
    } finally {
      setConnecting(false)
      void queryClient.invalidateQueries({ queryKey: keys.connectors(agentId) })
    }
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: "Connectors" }} />
      <Text variant="footnote" tone="ink2" style={styles.intro}>
        Services your agent can use, such as a calendar or a task tracker, connected through MCP.
        Your agent uses them without asking first, with whatever access you grant.
      </Text>

      {failed ? (
        <Section>
          <Row icon={["warning", theme.red]} title={failed} numberOfLines={6} />
        </Section>
      ) : justConnected ? (
        <Section>
          <Row
            icon={["checkCircle", theme.green]}
            title={`${justConnected.name} is connected.`}
            numberOfLines={3}
          />
        </Section>
      ) : null}

      {connectors.data === undefined ? (
        connectors.error ? (
          <Empty title="The connectors could not be loaded">
            {errorText(connectors.error, "Check your connection and pull down to try again.")}
          </Empty>
        ) : (
          <ActivityIndicator style={{ marginVertical: 40 }} color={theme.ink2} />
        )
      ) : (
        <>
          {connectors.data.some((each) => each.kind === "apps") ? null : (
            <Section
              title="Your apps"
              footer={
                <Words>
                  You sign in with a Composio account, which is free to make, and then to each
                  service the first time it is needed. Your agent asks before it does anything in an
                  account of yours.{" "}
                  <WordsLink url={guide}>What you get and how to set it up</WordsLink>
                </Words>
              }
            >
              <Row
                title="Gmail, Google Calendar, Drive, Slack, Notion, GitHub and hundreds more, through Composio."
                numberOfLines={4}
              />
              <Row
                title={connecting ? "Connecting…" : "Connect apps"}
                tone="tint"
                busy={connecting}
                onPress={() => void connectApps()}
              />
            </Section>
          )}
          {connectors.data.map((connector) => (
            <Connector key={connector.id} agentId={agentId} connector={connector} guide={guide} />
          ))}
        </>
      )}

      <Section
        footer={
          app === null
            ? `Put ${name} in Slack as a bot of its own. Mention it in a channel or message it, and it answers there.`
            : `${name} is in ${app.team} as @${app.bot}.`
        }
      >
        <Row
          icon={["hash", "#611f69"]}
          title="Slack"
          tail={app === null ? undefined : <Pill label="In Slack" tone="good" />}
          value={app === null ? "Set up" : "Manage"}
          go
          accessibilityLabel={app === null ? "Set up Slack" : "Manage Slack"}
          onPress={() => router.push(`/a/${agentId}/slack`)}
        />
      </Section>

      <Section>
        <Row
          title="Add a connector"
          tone="tint"
          go
          onPress={() => router.push(`/a/${agentId}/connectors/add`)}
        />
      </Section>
    </Screen>
  )
}

/** One connector as a small group: what it is, how it stands, and what can be done with it. */
function Connector({
  agentId,
  connector,
  guide,
}: {
  agentId: string
  connector: ConnectorSummary
  /** The guide about Apps. */
  guide: string
}) {
  const theme = useTheme()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const api = client.agent(agentId)
  const key = keys.connectors(agentId)
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })
  const [busy, setBusy] = useState<"connect" | "remove">()
  const status = STATUS[connector.status]
  const apps = connector.kind === "apps"

  const reconnect = async () => {
    if (busy !== undefined) return
    setBusy("connect")
    try {
      const result = await api.reconnectConnector(connector.id)
      if (result.authorizationUrl) await signIn(result.authorizationUrl)
      else haptic.done()
    } catch (error) {
      tell(`${connector.name} could not be connected`, errorText(error))
    } finally {
      setBusy(undefined)
      void refresh()
    }
  }

  const setEnabled = async (enabled: boolean) => {
    haptic.tap()
    // Shown at once; asking again then confirms it or puts it back.
    queryClient.setQueryData<ConnectorSummary[]>(key, (kept) =>
      kept?.map((each) => (each.id === connector.id ? { ...each, enabled } : each)),
    )
    try {
      await api.setConnectorEnabled(connector.id, enabled)
    } catch (error) {
      tell(`${connector.name} could not be changed`, errorText(error))
    } finally {
      void refresh()
    }
  }

  const remove = async () => {
    if (busy !== undefined) return
    const sure = await confirm({
      title: `Remove ${connector.name}?`,
      message: "Your agent can no longer use it.",
      action: "Remove",
    })
    if (!sure) return
    setBusy("remove")
    try {
      await api.removeConnector(connector.id)
      haptic.done()
    } catch (error) {
      tell(`${connector.name} could not be removed`, errorText(error))
    } finally {
      setBusy(undefined)
      void refresh()
    }
  }

  const words =
    apps && connector.status === "connected" ? (
      <Words>
        Ask your agent for something in Gmail, your calendar, Slack, Notion, GitHub or any other
        service. The first time, it gives you a link to sign in to that service. It asks before it
        does anything in an account of yours. Your accounts are kept at{" "}
        <WordsLink url={originOf(connector.url)}>Composio</WordsLink>, where you can disconnect one.{" "}
        <WordsLink url={guide}>How Apps works</WordsLink>
      </Words>
    ) : apps && connector.status === "needs_auth" ? (
      <Words>
        Sign in with a Composio account, which is free to make. Your agent then reaches the services
        you connect there. <WordsLink url={guide}>How Apps works</WordsLink>
      </Words>
    ) : connector.status === "connected" ? (
      <Words>
        {connector.tools.length === 0
          ? "It offers no tools."
          : `${connector.tools.length} tools: ${connector.tools.map((tool) => tool.name).join(", ")}`}
      </Words>
    ) : connector.status === "needs_auth" ? (
      <Words>Sign in to the service to let your agent use it.</Words>
    ) : (
      <Words tone="red">{connector.error}</Words>
    )

  return (
    <Section footer={words}>
      <Row
        title={
          <Text tone={connector.enabled ? "ink" : "ink2"} weight="600" numberOfLines={1}>
            {connector.name}
          </Text>
        }
        subtitle={
          <Text variant="subhead" tone="ink2" numberOfLines={apps ? 2 : 1}>
            {apps ? "Your accounts on other services, through Composio" : hostOf(connector.url)}
          </Text>
        }
        tail={
          status.tone === "bad" ? (
            <Pill label={status.label} color={theme.red} />
          ) : (
            <Pill label={status.label} tone={status.tone} />
          )
        }
        testID={`connector-${connector.id}`}
      />
      <Row
        title={
          connector.status === "needs_auth"
            ? "Sign in"
            : connector.status === "connected"
              ? "Refresh"
              : "Try again"
        }
        tone="tint"
        bold={connector.status !== "connected"}
        busy={busy === "connect"}
        onPress={() => void reconnect()}
      />
      <Row
        title="In use"
        accessibilityLabel={`Use ${connector.name}`}
        toggle={{ value: connector.enabled, onChange: (next) => void setEnabled(next) }}
      />
      <Row
        title="Remove"
        accessibilityLabel={`Remove ${connector.name}`}
        tone="red"
        busy={busy === "remove"}
        onPress={() => void remove()}
      />
    </Section>
  )
}

const styles = StyleSheet.create({
  intro: { marginHorizontal: 32, marginBottom: 18 },
})

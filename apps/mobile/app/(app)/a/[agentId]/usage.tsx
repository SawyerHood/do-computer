import type { AgentUsage } from "@do-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { Stack, useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, StyleSheet } from "react-native"
import { dollars, tokens } from "@/agent/usage"
import { keys, useAgentLive } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Empty, errorText, Row, Screen, Section, Text } from "@/ui"

/** What the agent has spent on models. Read-only: it is a record, not a setting. */
export default function Usage() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const theme = useTheme()
  const { client } = useSession()
  useAgentLive(agentId)
  const usage = useQuery<AgentUsage>({
    queryKey: keys.usage(agentId),
    queryFn: () => client.agent(agentId).usage(),
  })
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    await usage.refetch()
    setRefreshing(false)
  }

  const data = usage.data
  const scheduled =
    data === undefined ? 0 : data.scheduled.inputTokens + data.scheduled.outputTokens
  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: "Usage" }} />
      <Text variant="footnote" tone="ink2" style={styles.intro}>
        What this agent's thinking has cost so far, across its chats and scheduled runs.
      </Text>
      {data === undefined ? (
        usage.error ? (
          <Empty title="The usage could not be loaded">
            {errorText(usage.error, "Check your connection and pull down to try again.")}
          </Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 60 }} color={theme.ink2} />
        )
      ) : data.total.inputTokens + data.total.outputTokens === 0 ? (
        <Empty title="Nothing yet." />
      ) : (
        <>
          <Section>
            <Row title="Cost" value={dollars(data.total.cost)} />
            <Row title="Read" value={tokens(data.total.inputTokens)} />
            <Row title="Written" value={tokens(data.total.outputTokens)} />
          </Section>
          <Section
            title="Usage by model"
            footer={
              scheduled > 0
                ? `Scheduled runs account for ${dollars(data.scheduled.cost)} of the cost and ${tokens(scheduled)} of the tokens.`
                : undefined
            }
          >
            {data.models.map((entry) => (
              <Row
                key={entry.model}
                title={entry.model}
                numberOfLines={2}
                subtitle={`${tokens(entry.inputTokens + entry.outputTokens)} tokens`}
                value={dollars(entry.cost)}
              />
            ))}
          </Section>
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  intro: { marginHorizontal: 32, marginBottom: 18 },
})

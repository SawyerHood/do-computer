import type { ApprovalRule, ApprovalsState, ApprovalSubject } from "@durable-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, StyleSheet } from "react-native"
import { keys, useAgentLive } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Choice, Empty, errorText, haptic, Row, Screen, Section, tell, Text } from "@/ui"

const CHOICES: { value: ApprovalRule; label: string }[] = [
  { value: "allow", label: "Allow" },
  { value: "ask", label: "Ask first" },
  { value: "deny", label: "Never" },
]

const GROUPS: { kind: ApprovalSubject["kind"]; title: string; empty?: string; footer?: string }[] =
  [
    {
      kind: "tool",
      title: "What it can do",
      footer:
        "With “Ask first” it stops, tells you what it wants to do, and waits for your answer in the chat. Scheduled runs follow the same rules, and wait the same way.",
    },
    { kind: "connector", title: "Connectors", empty: "No connectors yet." },
    { kind: "computer", title: "Your computers", empty: "No computers connected yet." },
  ]

/**
 * What the agent may do without asking. Everything is allowed until a rule here says otherwise:
 * each thing is a row with its rule at the end, which opens a menu to choose another.
 */
export default function Permissions() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const theme = useTheme()
  const { client } = useSession()
  const queryClient = useQueryClient()
  useAgentLive(agentId)
  const key = keys.approvals(agentId)
  const approvals = useQuery<ApprovalsState>({
    queryKey: key,
    queryFn: () => client.agent(agentId).approvals(),
  })
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    await approvals.refetch()
    setRefreshing(false)
  }

  /**
   * The rule is sent as it was chosen, as the web sends it. The server keeps only what differs
   * from a thing's own default, so choosing Allow for most things leaves no rule at all.
   */
  const change = async (subject: ApprovalSubject, rule: ApprovalRule) => {
    haptic.tap()
    // Shown at once; the server's answer replaces it, or asking again undoes it.
    queryClient.setQueryData<ApprovalsState>(key, (previous) =>
      previous === undefined
        ? previous
        : { ...previous, rules: { ...previous.rules, [subject.id]: rule } },
    )
    try {
      const next = await client.agent(agentId).setApprovalRules({ [subject.id]: rule })
      queryClient.setQueryData(key, next)
    } catch (error) {
      void queryClient.invalidateQueries({ queryKey: key })
      tell("The rule could not be changed", errorText(error))
    }
  }

  const state = approvals.data
  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: "Permissions" }} />
      <Text variant="footnote" tone="ink2" style={styles.intro}>
        Your agent acts without asking unless you say otherwise here. A few things that cost money
        or give it more reach start on “Ask first”.
      </Text>
      {state === undefined ? (
        approvals.error ? (
          <Empty title="The permissions could not be loaded">
            {errorText(approvals.error, "Check your connection and pull down to try again.")}
          </Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 60 }} color={theme.ink2} />
        )
      ) : (
        GROUPS.map((group) => {
          const subjects = state.subjects.filter((subject) => subject.kind === group.kind)
          return (
            <Section key={group.kind} title={group.title} footer={group.footer}>
              {subjects.length === 0 ? (
                <Row title={<Text tone="ink2">{group.empty}</Text>} />
              ) : (
                subjects.map((subject) => (
                  <Row
                    key={subject.id}
                    title={subject.label}
                    numberOfLines={2}
                    subtitle={subject.hint}
                    tail={
                      <Choice
                        label={subject.label}
                        value={state.rules[subject.id] ?? "allow"}
                        options={CHOICES}
                        onChange={(rule) => void change(subject, rule)}
                      />
                    }
                    testID={`subject-${subject.id}`}
                  />
                ))
              )}
            </Section>
          )
        })
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  intro: { marginHorizontal: 32, marginBottom: 18 },
})

import { Stack, useLocalSearchParams } from "expo-router"
import { useEffect, useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { useAgentPage, useSaveAgent } from "@/agent/agent"
import { Empty, errorText, Field, HeaderItems, Screen, Section, Text } from "@/ui"

type Form = { memory: string; user: string }

/**
 * What the agent has learned and keeps between chats, and what it has been told about who it
 * works for. Both are plain notes, one entry per line, that can be read and put right here.
 */
export default function AgentMemory() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const { state, query } = useAgentPage(agentId)
  const { save, saving } = useSaveAgent(agentId)
  const [form, setForm] = useState<Form>()

  const dirty =
    form !== undefined &&
    state !== undefined &&
    (form.memory !== state.memory || form.user !== state.user)
  useEffect(() => {
    if (!dirty && form !== undefined) setForm(undefined)
  }, [dirty, form])

  if (state === undefined) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Memory" }} />
        {query.error ? (
          <Empty title="This Dood could not be loaded">{errorText(query.error)}</Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 80 }} />
        )}
      </Screen>
    )
  }

  // What is on the page follows the agent, which writes here itself, until something is typed.
  const shown: Form = dirty ? form : { memory: state.memory, user: state.user }
  const over = shown.user.length > state.limits.user || shown.memory.length > state.limits.memory
  const submit = async () => {
    const next = await save({ memory: shown.memory, user: shown.user })
    if (next !== undefined) setForm(undefined)
  }
  const name = state.agent.name ?? "this Dood"

  return (
    <Screen>
      <Stack.Screen options={{ title: "Memory" }} />
      <HeaderItems
        items={[
          {
            label: "Save changes",
            text: saving ? "Saving…" : "Save",
            prominent: true,
            disabled: !dirty || over || saving,
            onPress: () => void submit(),
          },
        ]}
      />
      <Text variant="subhead" tone="ink2" style={{ marginHorizontal: 32, marginBottom: 18 }}>
        {`What ${name} has learned and keeps between chats, and what it has been told about who it works for.`}
      </Text>

      <Section
        title="Memory"
        footer={
          <Counted
            hint="The Dood's own long-term notes, also read in every conversation."
            length={shown.memory.length}
            limit={state.limits.memory}
          />
        }
      >
        <Field
          accessibilityLabel="Memory"
          multiline
          value={shown.memory}
          style={{ minHeight: 190 }}
          onChangeText={(memory) => setForm({ ...shown, memory })}
        />
      </Section>

      <Section
        title={state.team ? "About the team" : "About you"}
        footer={
          <Counted
            hint={
              state.team
                ? `What the Dood knows about ${state.team} and the people in it. It reads this in every conversation, one entry per line.`
                : "What the Dood knows about you. It reads this in every conversation, one entry per line."
            }
            length={shown.user.length}
            limit={state.limits.user}
          />
        }
      >
        <Field
          accessibilityLabel={state.team ? "About the team" : "About you"}
          multiline
          value={shown.user}
          style={{ minHeight: 140 }}
          onChangeText={(user) => setForm({ ...shown, user })}
        />
      </Section>
    </Screen>
  )
}

/** The words under a box of notes, and how much of its room is used: red once it is over. */
function Counted({ hint, length, limit }: { hint: string; length: number; limit: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <Text variant="footnote" tone="ink2" style={{ flex: 1 }}>
        {hint}
      </Text>
      <Text
        variant="footnote"
        tone={length > limit ? "red" : "ink2"}
        accessibilityLabel={`${length} of ${limit} characters`}
      >
        {length} / {limit}
      </Text>
    </View>
  )
}

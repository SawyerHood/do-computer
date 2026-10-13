import { nearestThinking, PAIRED_COMPUTER, type ThinkingLevel } from "@do-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { modelName, THINKING_LABELS, useAgentPage, useModels, useSaveAgent } from "@/agent/agent"
import { keys } from "@/lib/queries"
import { useSession } from "@/lib/use-session"
import { Empty, errorText, Pill, Row, Screen, Section, Segmented, Text } from "@/ui"

const MODEL_HINT = "Which model this Dood thinks with. Applies from its next reply."

/**
 * What the agent thinks with, what it does with a message that arrives while it is busy, and
 * the computers it can work on. A choice here is kept as soon as it is made.
 */
export default function AgentModel() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const router = useRouter()
  const { client } = useSession()
  const { state, query, workspace } = useAgentPage(agentId)
  const { save, saving } = useSaveAgent(agentId)
  const models = useModels(workspace?.id)
  const computers = useQuery({ queryKey: keys.computers, queryFn: () => client.listComputers() })
  const kinds = useQuery({
    queryKey: keys.computerKinds,
    queryFn: () => client.computerKinds(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  // Shown at once while the change is on its way, and put back if it does not take.
  const [pending, setPending] = useState<{
    thinking?: ThinkingLevel
    whenBusy?: "steer" | "queue"
  }>({})
  const [refreshing, setRefreshing] = useState(false)

  if (state === undefined) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Model and computers" }} />
        {query.error ? (
          <Empty title="This Dood could not be loaded">{errorText(query.error)}</Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 80 }} />
        )}
      </Screen>
    )
  }

  const chosen = models.data?.find((model) => model.id === state.agent.model)
  const levels = chosen?.thinking ?? []
  const thinking = nearestThinking(levels, pending.thinking ?? state.agent.thinking)
  const whenBusy = pending.whenBusy ?? state.whenBusy ?? "steer"
  const usable = (computers.data ?? []).filter((computer) => computer.agentIds.includes(agentId))

  const change = async (patch: { thinking?: ThinkingLevel; whenBusy?: "steer" | "queue" }) => {
    setPending(patch)
    await save(patch)
    setPending({})
  }
  const refresh = async () => {
    setRefreshing(true)
    await Promise.all([query.refetch(), computers.refetch(), models.refetch()])
    setRefreshing(false)
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: "Model and computers" }} />

      <Section
        title="Model"
        footer={
          chosen === undefined
            ? MODEL_HINT
            : levels.length === 0
              ? `${MODEL_HINT} This model does not think before it answers.`
              : levels.length === 1
                ? `${MODEL_HINT} This model always thinks this much.`
                : "Which model this Dood thinks with, and how long it thinks before it answers. More is slower and costs more. Applies from its next reply."
        }
      >
        <Row
          title="Model"
          value={modelName(models.data, state.agent.model)}
          go
          onPress={() => router.push(`/a/${agentId}/model-picker`)}
        />
        {levels.length === 0 || thinking === undefined ? null : (
          <View style={{ paddingHorizontal: 16, paddingTop: 11, paddingBottom: 13, gap: 8 }}>
            <Text>Thinking</Text>
            <Segmented
              label="Thinking"
              value={thinking}
              options={levels.map((level) => ({ value: level, label: THINKING_LABELS[level] }))}
              onChange={(level) => void change({ thinking: level })}
            />
          </View>
        )}
      </Section>

      {workspace === undefined ? null : (
        <Section
          footer={`The models to choose from are those ${workspace.name} is signed in to, under Models in the workspace's settings.`}
        >
          <Row
            title="Model sign-ins"
            tone="tint"
            go
            onPress={() => router.push(`/settings/w/${encodeURIComponent(workspace.id)}/models`)}
          />
        </Section>
      )}

      <Section
        title="While it works"
        footer="It takes the new message into what it is doing, as a correction would be. It can be made to finish first instead."
      >
        <Row
          title="Wait until it has finished"
          toggle={{
            value: whenBusy === "queue",
            disabled: saving,
            onChange: (next) => void change({ whenBusy: next ? "queue" : "steer" }),
          }}
        />
      </Section>

      <Section
        title="Computers it can use"
        footer="Where this Dood can keep files and run commands. Computers belong to the workspace, and a Dood has a folder of its own on each machine it has worked on."
      >
        {computers.data === undefined ? (
          <Row title={<ActivityIndicator />} />
        ) : usable.length === 0 ? (
          <Row title={<Text tone="ink2">It has no computer to work on.</Text>} />
        ) : (
          usable.map((computer) => {
            const paired = computer.kind === PAIRED_COMPUTER
            const kind = paired
              ? "paired"
              : (kinds.data?.kinds.find((entry) => entry.id === computer.kind)?.label ??
                computer.kind)
            const facts = [
              kind,
              computer.hostname,
              computer.readOnly ? "read-only" : "",
              computer.screen ? "screen" : "",
              computer.browser ? "browser" : "",
            ].filter((fact) => fact !== "")
            return (
              <Row
                key={computer.id}
                icon={paired ? ["desktop", "#2f7fd6"] : ["terminal", "#4b5559"]}
                title={computer.name}
                subtitle={facts.join(" · ")}
                tail={
                  computer.online ? <Pill label="Online" tone="good" /> : <Pill label="Offline" />
                }
              />
            )
          })
        )}
        {workspace === undefined ? null : (
          <Row
            title="Workspace computers"
            tone="tint"
            go
            onPress={() => router.push(`/settings/w/${encodeURIComponent(workspace.id)}/computers`)}
          />
        )}
      </Section>
    </Screen>
  )
}

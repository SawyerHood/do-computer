import { filterModels, type ModelOption, nearestThinking } from "@do-computer/protocol"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useMemo, useState } from "react"
import { ActivityIndicator, Platform } from "react-native"
import { modelFacts, modelsBySource, useAgentPage, useModels, useSaveAgent } from "@/agent/agent"
import { useTheme } from "@/lib/theme"
import {
  Empty,
  errorText,
  Field,
  haptic,
  HeaderItems,
  Icon,
  Row,
  Screen,
  Section,
  Text,
} from "@/ui"

/** How many matches are drawn at once. There are hundreds of models; typing narrows them. */
const SHOWN = 60

/**
 * Choosing the model an agent thinks with: the ones suggested first, then the rest under where
 * each comes from, narrowed by what is typed. Choosing one keeps it and closes the page.
 */
export default function ModelPicker() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const router = useRouter()
  const theme = useTheme()
  const { state, workspace } = useAgentPage(agentId)
  const models = useModels(workspace?.id)
  const { save } = useSaveAgent(agentId)
  const [search, setSearch] = useState("")
  const [choosing, setChoosing] = useState<string>()
  const current = state?.agent.model

  const all = models.data
  const shown = useMemo(() => filterModels(all ?? [], search).slice(0, SHOWN), [all, search])
  const matches = useMemo(() => filterModels(all ?? [], search).length, [all, search])
  const searching = search.trim() !== ""
  // The suggested ones lead only while nothing is typed: a search is in the list's own order.
  const suggested = searching ? [] : shown.filter((model) => model.recommended)
  const sources = useMemo(
    () => modelsBySource(searching ? shown : shown.filter((model) => !model.recommended)),
    [shown, searching],
  )

  const choose = async (model: ModelOption) => {
    if (state === undefined || choosing !== undefined) return
    if (model.id === current) return router.back()
    haptic.tap()
    setChoosing(model.id)
    const next = await save({
      model: model.id,
      // A level the new model lacks becomes the nearest one it has.
      thinking: nearestThinking(model.thinking ?? [], state.agent.thinking) ?? state.agent.thinking,
    })
    setChoosing(undefined)
    if (next !== undefined) router.back()
  }

  const row = (model: ModelOption) => (
    <Row
      key={`${model.id}/${model.signIn?.subscription ?? ""}`}
      title={model.name}
      bold={model.id === current}
      subtitle={[model.id.replace(/^openrouter\//, ""), modelFacts(model)]
        .filter((part) => part !== "")
        .join(" · ")}
      value={
        model.recommended && searching ? (
          <Text variant="footnote" tone="ink2">
            suggested
          </Text>
        ) : undefined
      }
      tail={
        model.id === current ? (
          <Icon name="check" size={17} color={theme.tint} weight="semibold" />
        ) : undefined
      }
      busy={choosing === model.id}
      accessibilityLabel={model.id === current ? `${model.name}, chosen` : model.name}
      onPress={() => void choose(model)}
    />
  )

  return (
    <Screen>
      <Stack.Screen options={{ title: "Model" }} />
      <HeaderItems
        placement="left"
        items={[{ label: "Cancel", text: "Cancel", onPress: () => router.back() }]}
      />
      {Platform.OS === "ios" ? (
        <Stack.SearchBar
          placeholder={all === undefined ? "Search" : `Search ${all.length} models`}
          placement="integrated"
          onChangeText={(event) => setSearch(event.nativeEvent.text)}
          onCancelButtonPress={() => setSearch("")}
        />
      ) : (
        <Section>
          <Field
            accessibilityLabel="Model"
            placeholder={all === undefined ? "Search" : `Search ${all.length} models`}
            value={search}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearch}
          />
        </Section>
      )}

      {all === undefined ? (
        models.error ? (
          <Empty title="The models could not be loaded">{errorText(models.error)}</Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 60 }} />
        )
      ) : shown.length === 0 ? (
        <Empty title="No model matches." />
      ) : (
        <>
          <Section title="Suggested">{suggested.map(row)}</Section>
          {sources.map((source) => (
            <Section
              key={source.title}
              title={
                source.title === ""
                  ? suggested.length > 0
                    ? "All models"
                    : undefined
                  : source.title
              }
            >
              {source.items.map(row)}
            </Section>
          ))}
          {matches > shown.length ? (
            <Text variant="footnote" tone="ink2" style={{ textAlign: "center", marginBottom: 20 }}>
              {`${matches - shown.length} more. Search to narrow them.`}
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  )
}

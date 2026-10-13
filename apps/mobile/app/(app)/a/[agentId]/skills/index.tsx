import type { SkillSummary } from "@do-computer/protocol"
import { useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, StyleSheet, Switch } from "react-native"
import { sourceWords, useSkillActions, useSkills } from "@/agent/skills"
import { keys, useAgentLive } from "@/lib/queries"
import { mono, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Empty, errorText, Field, haptic, Row, Screen, Section, SwipeRow, tell, Text } from "@/ui"

/**
 * What the agent knows how to do. It writes skills itself; this page is for installing one from
 * GitHub, putting one out of use, reading one (its own page) and pruning.
 */
export default function Skills() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSession()
  const queryClient = useQueryClient()
  useAgentLive(agentId)
  const skills = useSkills(agentId)
  const { setEnabled, remove } = useSkillActions(agentId)
  const [url, setUrl] = useState("")
  const [installing, setInstalling] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const install = async () => {
    if (installing || url.trim() === "") return
    setInstalling(true)
    try {
      await client.agent(agentId).installSkill(url)
      setUrl("")
      haptic.done()
    } catch (error) {
      tell("The skill could not be installed", errorText(error))
    } finally {
      setInstalling(false)
      void queryClient.invalidateQueries({ queryKey: keys.skills(agentId) })
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    await skills.refetch()
    setRefreshing(false)
  }

  const row = (skill: SkillSummary) => (
    <SwipeRow
      key={skill.name}
      actions={[
        { title: "Delete", icon: "trash", color: "red", onPress: () => void remove(skill) },
      ]}
    >
      <Row
        title={
          <Text
            tone={skill.enabled ? "ink" : "ink2"}
            numberOfLines={1}
            style={{ fontFamily: mono, fontSize: 15 }}
          >
            {skill.name}
          </Text>
        }
        subtitle={
          <>
            {skill.description === "" ? null : (
              <Text variant="subhead" tone="ink2" numberOfLines={2}>
                {skill.description}
              </Text>
            )}
            <Text variant="caption" tone="ink2" numberOfLines={1} style={{ marginTop: 2 }}>
              {sourceWords(skill)}
            </Text>
          </>
        }
        tail={
          <Switch
            value={skill.enabled}
            onValueChange={(next) => void setEnabled(skill, next)}
            accessibilityLabel={`Use ${skill.name}`}
          />
        }
        go
        onPress={() => router.push(`/a/${agentId}/skills/${encodeURIComponent(skill.name)}`)}
        testID={`skill-${skill.name}`}
      />
    </SwipeRow>
  )

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: "Skills" }} />
      <Text variant="footnote" tone="ink2" style={styles.intro}>
        Saved instructions your Dood loads when a task calls for them. It writes new ones as it
        learns; you can also ask it to “save that as a skill”.
      </Text>

      <Section footer="A GitHub folder containing a SKILL.md, or a direct link to one. A skill is instructions your Dood will follow, so install only from sources you trust.">
        <Field
          accessibilityLabel="Skill URL"
          placeholder="https://github.com/owner/repo/tree/main/skills/name"
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => void install()}
          editable={!installing}
        />
        <Row
          title={installing ? "Installing…" : "Install"}
          tone="tint"
          busy={installing}
          disabled={url.trim() === ""}
          onPress={() => void install()}
        />
      </Section>

      {skills.data === undefined ? (
        skills.error ? (
          <Empty title="The skills could not be loaded">
            {errorText(skills.error, "Check your connection and pull down to try again.")}
          </Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 40 }} color={theme.ink2} />
        )
      ) : (
        <Section>{skills.data.map(row)}</Section>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  intro: { marginHorizontal: 32, marginBottom: 18 },
})

import { useQuery } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { skillKey, sourceWords, useSkillActions, useSkills } from "@/agent/skills"
import { useAgentLive } from "@/lib/queries"
import { mono, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Empty, errorText, Row, Screen, Section, Text } from "@/ui"

/**
 * One skill, to read: what it is for, whether it is in use, and each of its files as it is
 * written. What the web shows when a skill's card is opened with "Read".
 */
export default function Skill() {
  const { agentId, name } = useLocalSearchParams<{ agentId: string; name: string }>()
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSession()
  useAgentLive(agentId)
  const skills = useSkills(agentId)
  const { setEnabled, remove } = useSkillActions(agentId)
  const [removing, setRemoving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const skill = skills.data?.find((each) => each.name === name)
  const detail = useQuery({
    queryKey: skillKey(agentId, { name, updatedAt: skill?.updatedAt ?? 0 }),
    queryFn: () => client.agent(agentId).skill(name),
    enabled: skill !== undefined,
  })

  const refresh = async () => {
    setRefreshing(true)
    await Promise.all([skills.refetch(), detail.refetch()])
    setRefreshing(false)
  }

  const deleteIt = async () => {
    if (skill === undefined || removing) return
    setRemoving(true)
    const gone = await remove(skill)
    setRemoving(false)
    if (gone) router.back()
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: name }} />
      {skills.data === undefined ? (
        skills.error ? (
          <Empty title="The skill could not be loaded">
            {errorText(skills.error, "Check your connection and pull down to try again.")}
          </Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 80 }} color={theme.ink2} />
        )
      ) : skill === undefined ? (
        <Empty title="This skill is gone">It was deleted, or given another name.</Empty>
      ) : (
        <>
          <Section footer={sourceWords(skill)}>
            {skill.description === "" ? null : (
              <Row
                title={
                  <Text variant="subhead" selectable>
                    {skill.description}
                  </Text>
                }
              />
            )}
            <Row
              title="In use"
              accessibilityLabel={`Use ${skill.name}`}
              toggle={{ value: skill.enabled, onChange: (next) => void setEnabled(skill, next) }}
            />
          </Section>

          {detail.data === undefined ? (
            detail.error ? (
              <Empty title="Its files could not be loaded">{errorText(detail.error)}</Empty>
            ) : (
              <ActivityIndicator style={{ marginVertical: 30 }} color={theme.ink2} />
            )
          ) : (
            Object.entries(detail.data.contents).map(([path, content]) => (
              <Section key={path} title={path}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                  <Text
                    selectable
                    style={{ fontFamily: mono, fontSize: 13, lineHeight: 18, letterSpacing: 0 }}
                  >
                    {content}
                  </Text>
                </View>
              </Section>
            ))
          )}

          <Section>
            <Row
              title="Delete"
              accessibilityLabel={`Delete ${skill.name}`}
              tone="red"
              busy={removing}
              onPress={() => void deleteIt()}
            />
          </Section>
        </>
      )}
    </Screen>
  )
}

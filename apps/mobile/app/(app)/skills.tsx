import type { SkillSummary } from "@durable-computer/protocol"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Switch, View } from "react-native"
import { Screen } from "@/components/screen"
import { Button, Card, ErrorText, Field, Text } from "@/components/ui"
import { space, useTheme } from "@/lib/theme"
import { keys, useAgent } from "@/lib/use-agent"
import { useSession } from "@/lib/use-session"

const SOURCES = {
  bundled: "Built in",
  agent: "Written by the agent",
  installed: "Installed",
} as const

function SkillCard({ agentId, skill }: { agentId: string; skill: SkillSummary }) {
  const theme = useTheme()
  const queryClient = useQueryClient()
  const api = useSession().client.agent(agentId)
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(skill.enabled)
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.skills(agentId) })
  const toggle = useMutation({
    mutationFn: (next: boolean) => api.setSkillEnabled(skill.name, next),
    onError: () => setEnabled(skill.enabled),
    onSettled: refresh,
  })
  const remove = useMutation({ mutationFn: () => api.removeSkill(skill.name), onSettled: refresh })
  const detail = useQuery({
    queryKey: [...keys.skills(agentId), skill.name, skill.updatedAt],
    queryFn: () => api.skill(skill.name),
    enabled: open,
  })
  return (
    <Card accessibilityLabel={skill.name} style={{ opacity: enabled ? 1 : 0.7 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <View style={{ flex: 1 }}>
          <Text weight="500">{skill.name}</Text>
          <Text tone="muted" size={12}>
            {SOURCES[skill.source]}
          </Text>
        </View>
        <Switch
          accessibilityLabel={`Use ${skill.name}`}
          value={enabled}
          trackColor={{ true: theme.primary, false: theme.raised }}
          thumbColor={theme.onPrimary}
          // react-native-web colors the thumb of an on switch separately.
          {...({ activeThumbColor: theme.onPrimary } as object)}
          onValueChange={(next) => {
            setEnabled(next)
            toggle.mutate(next)
          }}
        />
      </View>
      <Text size={14}>{skill.description}</Text>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <Button
          variant="outline"
          label={open ? "Hide" : "Read"}
          onPress={() => setOpen((value) => !value)}
        />
        <Button
          variant="danger"
          label="Delete"
          accessibilityLabel={`Delete ${skill.name}`}
          busy={remove.isPending}
          onPress={() => remove.mutate()}
        />
      </View>
      {open && detail.data
        ? Object.entries(detail.data.contents).map(([path, content]) => (
            <View key={path} style={{ gap: space(1) }}>
              <Text tone="muted" size={12}>
                {path}
              </Text>
              <Text size={13} selectable>
                {content}
              </Text>
            </View>
          ))
        : null}
    </Card>
  )
}

/** What the agent knows how to do: skills it wrote, came with, or was given. */
export default function Skills() {
  const { agentId } = useAgent()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const [url, setUrl] = useState("")
  const skills = useQuery({
    queryKey: keys.skills(agentId ?? ""),
    queryFn: () => client.agent(agentId!).skills(),
    enabled: agentId !== undefined,
  })
  const install = useMutation({
    mutationFn: () => client.agent(agentId!).installSkill(url),
    onSuccess: () => {
      setUrl("")
      void queryClient.invalidateQueries({ queryKey: keys.skills(agentId!) })
    },
  })
  return (
    <Screen
      title="Skills"
      subtitle="Saved instructions your agent loads when a task calls for them. It writes new ones as it learns."
    >
      <Card>
        <Field
          label="Install from a URL"
          value={url}
          onChangeText={setUrl}
          placeholder="https://github.com/owner/repo/tree/main/skills/name"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text tone="muted" size={12}>
          A skill is instructions your agent will follow, so install only from sources you trust.
        </Text>
        <ErrorText>{install.error?.message}</ErrorText>
        <Button
          label="Install"
          busy={install.isPending}
          disabled={url.trim() === ""}
          onPress={() => install.mutate()}
        />
      </Card>
      {(skills.data ?? []).map((skill) => (
        <SkillCard key={skill.name} agentId={agentId!} skill={skill} />
      ))}
    </Screen>
  )
}

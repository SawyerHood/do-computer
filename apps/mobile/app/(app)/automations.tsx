import type { ScheduleSummary } from "@durable-computer/protocol"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { View } from "react-native"
import { Screen } from "@/components/screen"
import { Badge, Button, Card, Empty, ErrorText, Text } from "@/components/ui"
import { space } from "@/lib/theme"
import { keys, useAgent } from "@/lib/use-agent"
import { useSession } from "@/lib/use-session"

const when = (at: number) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at))

const OUTCOMES = {
  delivered: "reported back",
  silent: "had nothing to report",
  failed: "did not finish",
} as const

function ScheduleCard({ agentId, schedule }: { agentId: string; schedule: ScheduleSummary }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const api = useSession().client.agent(agentId)
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.schedules(agentId) })
  const toggle = useMutation({
    mutationFn: () => api.updateSchedule(schedule.id, { enabled: !schedule.enabled }),
    onSettled: refresh,
  })
  const run = useMutation({ mutationFn: () => api.runSchedule(schedule.id), onSettled: refresh })
  const remove = useMutation({
    mutationFn: () => api.removeSchedule(schedule.id),
    onSettled: refresh,
  })
  const done = !schedule.enabled && schedule.nextRunAt === null && schedule.runCount > 0
  const active = schedule.enabled && schedule.nextRunAt !== null
  return (
    <Card accessibilityLabel={schedule.title}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space(2) }}>
        <View style={{ flex: 1 }}>
          <Text weight="500" numberOfLines={1}>
            {schedule.title}
          </Text>
          <Text tone="muted" size={13}>
            {schedule.schedule}
            {active ? ` · next ${when(schedule.nextRunAt!)}` : ""}
          </Text>
        </View>
        <Badge
          label={schedule.running ? "Running" : active ? "Active" : done ? "Done" : "Paused"}
          tone={active ? "good" : "plain"}
        />
      </View>
      <Text size={14} numberOfLines={3}>
        {schedule.prompt}
      </Text>
      {schedule.lastRun ? (
        <Text
          tone="muted"
          size={13}
          accessibilityRole="link"
          onPress={() => router.push(`/chat/${schedule.lastRun!.chatId}`)}
        >
          Last run {when(schedule.lastRun.at)}: {OUTCOMES[schedule.lastRun.outcome]}. View run
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        {done ? null : (
          <Button
            variant="outline"
            label={schedule.enabled ? "Pause" : "Resume"}
            busy={toggle.isPending}
            onPress={() => toggle.mutate()}
          />
        )}
        <Button
          variant="outline"
          label="Run now"
          busy={run.isPending}
          disabled={schedule.running}
          onPress={() => run.mutate()}
        />
        <Button
          variant="danger"
          label="Delete"
          accessibilityLabel={`Delete ${schedule.title}`}
          busy={remove.isPending}
          onPress={() => remove.mutate()}
        />
      </View>
      <ErrorText>{(toggle.error ?? run.error ?? remove.error)?.message}</ErrorText>
    </Card>
  )
}

/** Scheduled and repeating tasks. They are created by asking the agent in a chat. */
export default function Automations() {
  const { agentId } = useAgent()
  const { client } = useSession()
  const schedules = useQuery({
    queryKey: keys.schedules(agentId ?? ""),
    queryFn: () => client.agent(agentId!).schedules(),
    enabled: agentId !== undefined,
  })
  return (
    <Screen
      title="Automations"
      subtitle="Things your agent does on its own. To add one, ask it in a chat."
    >
      {schedules.data?.length === 0 ? <Empty>Nothing scheduled yet.</Empty> : null}
      {(schedules.data ?? []).map((schedule) => (
        <ScheduleCard key={schedule.id} agentId={agentId!} schedule={schedule} />
      ))}
    </Screen>
  )
}

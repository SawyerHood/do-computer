import type { ScheduleSummary } from "@do-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { ActivityIndicator, View } from "react-native"
import { keys, useAgentLive } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { inWords, OUTCOMES, statusOf, when } from "@/settings/schedule"
import { StatusPill } from "@/settings/status-pill"
import { confirm, Empty, errorText, haptic, Row, Screen, Section, SwipeRow, type SwipeAction, tell, Text } from "@/ui"

function ScheduleRow({ agentId, schedule }: { agentId: string; schedule: ScheduleSummary }) {
  const theme = useTheme()
  const router = useRouter()
  const queryClient = useQueryClient()
  const api = useSession().client.agent(agentId)
  const status = statusOf(schedule)
  const change = async (work: () => Promise<unknown>) => {
    try {
      await work()
      haptic.done()
    } catch (error) {
      haptic.fail()
      tell("That did not work", errorText(error))
    } finally {
      void queryClient.invalidateQueries({ queryKey: keys.schedules(agentId) })
    }
  }
  const actions: SwipeAction[] = [
    ...(schedule.running
      ? []
      : [{ title: "Run now", icon: "clock", color: "tint", onPress: () => void change(() => api.runSchedule(schedule.id)) } satisfies SwipeAction]),
    // A one-off that has run has nothing to pause or resume.
    ...(status === "Done"
      ? []
      : [
          {
            title: schedule.enabled ? "Pause" : "Resume",
            icon: schedule.enabled ? "pause" : "play",
            color: "grey",
            onPress: () => void change(() => api.updateSchedule(schedule.id, { enabled: !schedule.enabled })),
          } satisfies SwipeAction,
        ]),
    {
      title: "Delete",
      icon: "trash",
      color: "red",
      onPress: async () => {
        if (await confirm({ title: `Delete ${schedule.title}?`, message: "Your agent will stop doing this.", action: "Delete" })) {
          void change(() => api.removeSchedule(schedule.id))
        }
      },
    },
  ]
  const next =
    schedule.enabled && schedule.nextRunAt !== null ? ` · next ${when(schedule.nextRunAt)}` : ""
  return (
    <SwipeRow actions={actions}>
      <View style={{ backgroundColor: theme.card }}>
        <Row
          bold
          title={schedule.title}
          accessibilityLabel={schedule.title}
          subtitle={
            <View>
              <Text variant="subhead" tone="ink2" numberOfLines={2}>
                {inWords(schedule.schedule)}
                {next}
              </Text>
              {schedule.lastRun === null ? null : (
                <Text variant="footnote" tone="ink3" numberOfLines={2}>
                  Last run {when(schedule.lastRun.at)}: {OUTCOMES[schedule.lastRun.outcome]}.
                </Text>
              )}
            </View>
          }
          tail={<StatusPill status={status} />}
          go
          onPress={() => router.push(`/a/${agentId}/automations/${schedule.id}`)}
        />
      </View>
    </SwipeRow>
  )
}

/** The agent's scheduled and repeating tasks. They are created by asking the agent, in chat. */
export default function Automations() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const { client } = useSession()
  useAgentLive(agentId)
  const schedules = useQuery({
    queryKey: keys.schedules(agentId),
    queryFn: () => client.agent(agentId).schedules(),
  })
  return (
    <Screen onRefresh={() => void schedules.refetch()} refreshing={schedules.isRefetching}>
      <Stack.Screen options={{ title: "Automations", headerLargeTitle: true }} />
      <Text variant="subhead" tone="ink2" style={{ marginHorizontal: 20, marginBottom: 18 }}>
        Things your agent does on its own, once or on a schedule. To add one, ask in chat: “Every
        weekday at 9, tell me what is on my calendar.”
      </Text>
      {schedules.data === undefined ? (
        schedules.isError ? (
          <Empty title="The automations could not be read.">{errorText(schedules.error)}</Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 40 }} />
        )
      ) : schedules.data.length === 0 ? (
        <Empty title="Nothing scheduled yet." />
      ) : (
        <Section>
          {schedules.data.map((schedule) => (
            <ScheduleRow key={schedule.id} agentId={agentId} schedule={schedule} />
          ))}
        </Section>
      )}
    </Screen>
  )
}

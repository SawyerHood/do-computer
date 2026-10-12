import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { keys, useAgentLive } from "@/lib/queries"
import { mono } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { inWords, OUTCOMES, statusOf, tally, when } from "@/settings/schedule"
import { StatusPill } from "@/settings/status-pill"
import { confirm, Empty, errorText, haptic, Row, Screen, Section, tell, Text } from "@/ui"

/**
 * One automation: when it runs, what the agent is told, what it checks first and how the last
 * run went. It can be paused, run now or deleted here; it is made and changed by asking the agent.
 */
export default function Automation() {
  const { agentId, scheduleId } = useLocalSearchParams<{ agentId: string; scheduleId: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const api = useSession().client.agent(agentId)
  useAgentLive(agentId)
  const schedules = useQuery({ queryKey: keys.schedules(agentId), queryFn: () => api.schedules() })
  const schedule = schedules.data?.find((each) => each.id === scheduleId)
  const [busy, setBusy] = useState<"toggle" | "run" | "remove">()

  const change = async (what: "toggle" | "run" | "remove", work: () => Promise<unknown>) => {
    setBusy(what)
    try {
      await work()
      haptic.done()
      return true
    } catch (error) {
      haptic.fail()
      tell("That did not work", errorText(error))
      return false
    } finally {
      setBusy(undefined)
      void queryClient.invalidateQueries({ queryKey: keys.schedules(agentId) })
    }
  }

  if (schedule === undefined) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "" }} />
        {schedules.data === undefined && !schedules.isError ? (
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : (
          <Empty title="This automation is gone.">
            {schedules.isError ? errorText(schedules.error) : "It was deleted, here or by the agent."}
          </Empty>
        )}
      </Screen>
    )
  }

  const status = statusOf(schedule)
  const lastRun = schedule.lastRun
  return (
    <Screen onRefresh={() => void schedules.refetch()} refreshing={schedules.isRefetching}>
      <Stack.Screen options={{ title: schedule.title, headerLargeTitle: true }} />
      <Section>
        {/* A one-off that has run has nothing to pause or resume. */}
        {status === "Done" ? null : (
          <Row
            title="Active"
            toggle={{
              value: schedule.enabled,
              disabled: busy !== undefined,
              onChange: (enabled) => {
                haptic.tap()
                void change("toggle", () => api.updateSchedule(schedule.id, { enabled }))
              },
            }}
          />
        )}
        <Row title="Status" tail={<StatusPill status={status} />} />
        <Row
          title="Schedule"
          subtitle={
            inWords(schedule.schedule) === schedule.schedule ? undefined : (
              <Text variant="footnote" tone="ink3" style={{ fontFamily: mono }}>
                {schedule.schedule}
                {schedule.timezone === null ? "" : ` · ${schedule.timezone}`}
              </Text>
            )
          }
          value={inWords(schedule.schedule)}
        />
        <Row
          title="Next run"
          value={schedule.enabled && schedule.nextRunAt !== null ? when(schedule.nextRunAt) : "None"}
        />
      </Section>

      <Section title="What it is told">
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text selectable>{schedule.prompt}</Text>
        </View>
      </Section>

      {schedule.check ? (
        <Section
          title={`Checks first on ${schedule.check.computer}`}
          footer={[
            `Only starts the agent ${
              schedule.check.wake === "change"
                ? "when what this prints changes"
                : "if this prints something"
            }.`,
            ...(schedule.runCount > 0
              ? [tally(schedule.runCount, schedule.runCount - schedule.skipCount)]
              : []),
          ].join(" ")}
        >
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text variant="footnote" selectable style={{ fontFamily: mono }}>
              {schedule.check.command}
            </Text>
          </View>
        </Section>
      ) : null}

      <Section title="Last run">
        {lastRun === null ? (
          <Row title={<Text tone="ink2">It has not run yet.</Text>} />
        ) : (
          <Row
            title={when(lastRun.at)}
            subtitle={`It ${OUTCOMES[lastRun.outcome]}.`}
            numberOfLines={2}
          />
        )}
        {lastRun !== null && lastRun.chatId !== null ? (
          <Row
            title="View run"
            go
            onPress={() => router.push(`/a/${agentId}/c/${lastRun.chatId}`)}
          />
        ) : null}
      </Section>

      <Section>
        <Row
          title="Run now"
          tone="tint"
          busy={busy === "run"}
          disabled={schedule.running || busy !== undefined}
          onPress={() => void change("run", () => api.runSchedule(schedule.id))}
        />
      </Section>

      <Section>
        <Row
          title="Delete automation"
          tone="red"
          accessibilityLabel={`Delete ${schedule.title}`}
          busy={busy === "remove"}
          disabled={busy !== undefined}
          onPress={async () => {
            const sure = await confirm({
              title: `Delete ${schedule.title}?`,
              message: "Your agent will stop doing this.",
              action: "Delete",
            })
            if (!sure) return
            if (await change("remove", () => api.removeSchedule(schedule.id))) router.back()
          }}
        />
      </Section>
    </Screen>
  )
}

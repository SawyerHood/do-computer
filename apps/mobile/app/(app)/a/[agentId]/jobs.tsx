import { jobOutcome, type JobSummary, spanOf } from "@do-computer/protocol"
import { useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { firstLine, useAgentPage, useJobs, useNow } from "@/agent/agent"
import { mainChatOf } from "@/chat/chats"
import { keys } from "@/lib/queries"
import { mono, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import {
  Button,
  confirm,
  Empty,
  errorText,
  haptic,
  Icon,
  IconTile,
  Row,
  Screen,
  Section,
  SwipeRow,
  tell,
  Text,
} from "@/ui"

/** How many of the commands that are over are listed, the latest first. */
const OVER_SHOWN = 20

/** A command is one of an agent's, and ids start over if its record of them is ever lost. */
const keyOf = (job: Pick<JobSummary, "id" | "startedAt">) => `${job.id}-${job.startedAt}`

/**
 * The commands the agent left running in the background: each with how long it has run and a
 * way to stop it, and under them the ones that ended lately. Tapping one opens the chat it was
 * started in, which is where what it prints is read.
 */
export default function Jobs() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const router = useRouter()
  const theme = useTheme()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const { state, name } = useAgentPage(agentId)
  const jobs = useJobs(agentId)
  const [stopping, setStopping] = useState<string>()
  const [refreshing, setRefreshing] = useState(false)

  const running = (jobs.data ?? []).filter((job) => job.status === "running")
  const over = (jobs.data ?? [])
    .filter((job) => job.status !== "running")
    .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
    .slice(0, OVER_SHOWN)
  const now = useNow(1000, running.length > 0)
  const main = mainChatOf(state?.chats)

  /** Opens it where it was started: back to the main chat, or into the chat that is not. */
  const open = (job: JobSummary) => {
    if (main === undefined || job.chatId === main.id) router.dismissTo(`/a/${agentId}`)
    else router.push(`/a/${agentId}/c/${encodeURIComponent(job.chatId)}`)
  }

  const stop = async (job: JobSummary) => {
    const went = await confirm({
      title: "Stop this command?",
      message: `${firstLine(job.command)}\n\n${name} is told that someone stopped it.`,
      action: "Stop",
    })
    if (!went) return
    setStopping(keyOf(job))
    try {
      await client.agent(agentId).stopJob(job.id)
      haptic.done()
    } catch (error) {
      haptic.fail()
      tell("It could not be stopped", errorText(error))
    } finally {
      await queryClient.invalidateQueries({ queryKey: keys.jobs(agentId), exact: true })
      setStopping(undefined)
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    await jobs.refetch()
    setRefreshing(false)
  }

  const command = (job: JobSummary) => (
    <Text numberOfLines={1} style={{ fontFamily: mono, fontSize: 14, letterSpacing: 0 }}>
      {firstLine(job.command)}
    </Text>
  )

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: "Background commands" }} />
      {jobs.data === undefined ? (
        jobs.error ? (
          <Empty title="The commands could not be loaded">{errorText(jobs.error)}</Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 80 }} />
        )
      ) : running.length === 0 && over.length === 0 ? (
        <Empty title="Nothing is running.">
          {`A command ${name} leaves running in the background, such as a server or a long test, is listed here while it runs.`}
        </Empty>
      ) : (
        <>
          <Section title="Running in the background">
            {running.map((job) => (
              <SwipeRow
                key={keyOf(job)}
                actions={[
                  { title: "Stop", icon: "stop", color: "red", onPress: () => void stop(job) },
                ]}
              >
                <View style={{ backgroundColor: theme.card }}>
                  <Row
                    lead={<IconTile icon="terminal" color="#4b5559" />}
                    title={command(job)}
                    subtitle={`${job.computer} · ${spanOf(now - job.startedAt)}`}
                    tail={
                      <Button
                        title="Stop"
                        kind="grey"
                        size="small"
                        destructive
                        busy={stopping === keyOf(job)}
                        accessibilityLabel={`Stop ${firstLine(job.command)}`}
                        onPress={() => void stop(job)}
                      />
                    }
                    accessibilityLabel={`${firstLine(job.command)}, on ${job.computer}. Show where it was started`}
                    onPress={() => open(job)}
                  />
                </View>
              </SwipeRow>
            ))}
          </Section>
          <Section title="Lately over">
            {over.map((job) => {
              const failed =
                job.status === "failed" || job.status === "lost" || job.status === "timed_out"
              return (
                <Row
                  key={keyOf(job)}
                  lead={
                    <View style={{ width: 30, alignItems: "center" }}>
                      <Icon
                        name={
                          failed ? "warning" : job.status === "stopped" ? "stop" : "checkCircle"
                        }
                        size={19}
                        color={failed ? theme.red : theme.ink3}
                      />
                    </View>
                  }
                  title={command(job)}
                  subtitle={`${job.computer} · ${jobOutcome({
                    status: job.status,
                    exitCode: job.exitCode,
                    ms: (job.endedAt ?? job.startedAt) - job.startedAt,
                  })}`}
                  go
                  accessibilityLabel={`${firstLine(job.command)}, on ${job.computer}. Show where it was started`}
                  onPress={() => open(job)}
                />
              )
            })}
          </Section>
        </>
      )}
    </Screen>
  )
}

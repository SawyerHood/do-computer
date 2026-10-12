import {
  jobOutcome,
  type JobSummary,
  type NoticePart,
  spanOf,
  type ToolPart,
} from "@do-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { atom, useAtomValue, useSetAtom } from "jotai"
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  View,
} from "react-native"
import { keys, useAgentLive } from "@/lib/queries"
import { mono, radius, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Button, confirm, errorText, haptic, Icon, tell, Text } from "@/ui"
import { Card, ChipIcon, Fold, NoticeLine, Pre, useChatScope } from "./shared"

/** How often a running command is asked what it has printed since. The web asks as often. */
const READ_EVERY_MS = 4_000
/** How much of what a command printed is kept: the end of it. */
const KEPT_CHARS = 32 * 1024
/** How many lines of it are shown. */
const SHOWN_LINES = 40

/** How a command ended, as the middle of a sentence: "finished in 4m 12s". */
const ended = (job: {
  status: JobSummary["status"]
  exitCode?: number | undefined
  ms: number
}) => {
  const words = jobOutcome(job)
  return words.charAt(0).toLowerCase() + words.slice(1)
}

const firstLine = (command: string) => command.split("\n")[0] ?? command

/** A command is one of an agent's, and ids start over if its record of them is ever lost. */
const keyOf = (job: Pick<JobSummary, "id" | "startedAt">) => `${job.id}-${job.startedAt}`

/**
 * Which commands are unfolded to show what they are printing. Kept outside the chips, so that
 * one stays unfolded while the list it is in lets go of its row and draws it again.
 */
const openCommandsAtom = atom<Record<string, boolean>>({})

const EMPTY: JobSummary[] = []

type Printed = { text: string; next: number | undefined }

/**
 * The end of what a running command has printed, added to while it is shown. It is asked for
 * every few seconds, as the web does, and only while the command runs and is unfolded. It is
 * kept under the name the web keeps it under, so whatever else shows the same command shares it.
 */
function usePrinted(agentId: string, job: JobSummary, on: boolean): string {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const queryKey = [...keys.jobs(agentId), keyOf(job), "output"]
  const { data } = useQuery<Printed>({
    queryKey,
    queryFn: async () => {
      const before = queryClient.getQueryData<Printed>(queryKey)
      const more = await client.agent(agentId).jobOutput(job.id, before?.next)
      return {
        text: `${before?.text ?? ""}${more.output}`.slice(-KEPT_CHARS),
        next: more.next,
      }
    },
    enabled: on && job.status === "running",
    refetchInterval: READ_EVERY_MS,
    // What it printed after it ended is with the word that it ended.
    retry: false,
  })
  return data?.text ?? ""
}

/** How long ago `since` was, kept up to the second while it is on screen. Goes inside a line. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  return (
    <NativeText style={{ fontVariant: ["tabular-nums"] }}>
      {spanOf(Math.max(0, now - since))}
    </NativeText>
  )
}

/**
 * The last lines a command printed, in a box that rests at the newest line, as a terminal does.
 * It looks as `Pre` does, which cannot be told to stay at its end.
 */
function Tail({ text, label }: { text: string; label: string }) {
  const theme = useTheme()
  const box = useRef<ScrollView>(null)
  return (
    <View accessibilityLabel={label}>
      <ScrollView
        ref={box}
        nestedScrollEnabled
        onContentSizeChange={() => box.current?.scrollToEnd({ animated: false })}
        style={{
          maxHeight: 220,
          borderRadius: radius.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.sep,
          backgroundColor: theme.fill,
        }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}
      >
        <Text
          selectable={text !== ""}
          style={{
            fontFamily: mono,
            fontSize: 12,
            lineHeight: 17,
            color: text === "" ? theme.ink3 : theme.ink2,
          }}
        >
          {text === "" ? "It has printed nothing yet." : text}
        </Text>
      </ScrollView>
    </View>
  )
}

/** The end of what a running command has printed, with the way to stop it. */
function Printing({ agentId, job }: { agentId: string; job: JobSummary }) {
  const theme = useTheme()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const [stopping, setStopping] = useState(false)
  const text = usePrinted(agentId, job, true)
  const shown = useMemo(() => text.trimEnd().split("\n").slice(-SHOWN_LINES).join("\n"), [text])
  const command = firstLine(job.command)

  // Its agent is told that someone stopped it, so it is asked first.
  const stop = async () => {
    const sure = await confirm({ title: "Stop this command?", message: command, action: "Stop" })
    if (!sure) return
    setStopping(true)
    try {
      await client.agent(agentId).stopJob(job.id)
      haptic.done()
    } catch (error) {
      haptic.fail()
      tell("It could not be stopped", errorText(error))
    } finally {
      setStopping(false)
      await queryClient.invalidateQueries({ queryKey: keys.jobs(agentId), exact: true })
    }
  }

  return (
    <View
      style={{
        gap: 8,
        padding: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.sep,
      }}
    >
      <Text variant="footnote" tone="ink2">
        Running on {job.computer} for <Elapsed since={job.startedAt} /> · the last lines it printed
      </Text>
      <Tail text={shown} label={`What ${command} is printing`} />
      <Button
        title="Stop"
        kind="grey"
        size="small"
        destructive
        busy={stopping}
        accessibilityLabel={`Stop ${command}`}
        onPress={() => void stop()}
        style={{ alignSelf: "flex-end" }}
      />
    </View>
  )
}

/**
 * A command where the agent left it running, in its message: how it is getting on, and, opened,
 * what it is printing. Once it has ended it says how; what it printed is with the word of that.
 */
export const CommandChip = memo(function CommandChip({ part }: { part: ToolPart }) {
  const { agentId } = useChatScope()
  const theme = useTheme()
  const { client } = useSession()
  // The list of commands is asked for again whenever the agent says one of them changed.
  useAgentLive(agentId)
  const { data: jobs = EMPTY } = useQuery({
    queryKey: keys.jobs(agentId),
    queryFn: () => client.agent(agentId).jobs(),
  })
  const { job: id } = part.details as { job: string }
  const args = part.args as { command?: string; run_in_background?: boolean } | null
  const command = args?.command ?? ""
  const job = jobs.find((one) => one.id === id && one.command === command)
  const running = job?.status === "running"
  const key = job === undefined ? undefined : keyOf(job)
  const openAtom = useMemo(
    () => atom((get) => key !== undefined && get(openCommandsAtom)[key] === true),
    [key],
  )
  const open = useAtomValue(openAtom)
  const setOpen = useSetAtom(openCommandsAtom)
  const unfolded = running && open
  // One the agent did not start this way was moved here when the wait for it ended.
  const moved = args?.run_in_background !== true

  let how: ReactNode
  if (job === undefined) how = "ran in the background"
  else if (running) {
    how = (
      <>
        {moved ? "still going after a minute, now in the background" : "in the background"} ·{" "}
        <Elapsed since={job.startedAt} />
      </>
    )
  } else how = ended({ ...job, ms: (job.endedAt ?? job.startedAt) - job.startedAt })

  const body = (
    <>
      <ChipIcon icon="terminal" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          variant="footnote"
          weight="600"
          numberOfLines={1}
          style={{ fontFamily: mono, lineHeight: 20 }}
        >
          {firstLine(command)}
        </Text>
        <Text variant="footnote" tone="ink2" numberOfLines={2}>
          {job === undefined ? null : <>{job.computer} · </>}
          {how}
        </Text>
      </View>
      {running ? (
        <ActivityIndicator size="small" color={theme.ink2} />
      ) : job === undefined || job.status === "done" ? (
        <Icon name="checkCircle" size={17} color={theme.ink2} />
      ) : job.status === "stopped" ? (
        <Icon name="stop" size={17} color={theme.ink2} />
      ) : (
        <Icon name="warning" size={17} color={theme.red} />
      )}
    </>
  )
  const shape = {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    minHeight: 52,
  } as const

  if (job === undefined || !running || key === undefined) {
    return (
      <Card>
        <View testID="command-chip" style={shape}>
          {body}
        </View>
      </Card>
    )
  }
  return (
    <Card>
      <Pressable
        testID="command-chip"
        accessibilityRole="button"
        accessibilityState={{ expanded: unfolded }}
        accessibilityHint="Shows what it is printing"
        onPress={() => {
          haptic.tap()
          setOpen((before) => ({ ...before, [key]: before[key] !== true }))
        }}
        style={({ pressed }) => [shape, { opacity: pressed ? 0.6 : 1 }]}
      >
        {body}
        <View style={{ transform: [{ rotate: unfolded ? "90deg" : "0deg" }] }}>
          <Icon name="chevronRight" size={13} color={theme.ink3} weight="semibold" />
        </View>
      </Pressable>
      {unfolded ? <Printing agentId={agentId} job={job} /> : null}
    </Card>
  )
})

/**
 * Word that a command the agent left running in the background has ended, in the chat that
 * started it: how it ended, and the last of what it printed for whoever wants to look.
 */
export const CommandWord = memo(function CommandWord({ part }: { part: NoticePart }) {
  const job = part.job
  const stopped = job?.status === "stopped"
  const well = job === undefined || job.status === "done"
  const command = (
    <Text variant="footnote" weight="600" style={{ fontFamily: mono }}>
      {firstLine(part.text)}
    </Text>
  )
  return (
    <View testID="command-word">
      <NoticeLine icon={stopped ? "stop" : well ? "checkCircle" : "warning"}>
        <Text variant="subhead" tone="ink2">
          {stopped ? (
            <>You stopped {command}</>
          ) : (
            <>
              {command} {job === undefined ? "ended" : ended(job)}
            </>
          )}
          {job?.computer ? ` on ${job.computer}` : null}
        </Text>
        {part.detail === undefined ? null : (
          <Fold label={well || stopped ? "What it printed" : "What went wrong"}>
            <Pre text={part.detail} maxHeight={320} />
          </Fold>
        )}
      </NoticeLine>
    </View>
  )
})

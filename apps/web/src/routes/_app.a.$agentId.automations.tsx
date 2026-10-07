import type { ScheduleSummary } from "@durable-computer/protocol"
import { ClockIcon, PauseIcon, PlayIcon, TrashIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { AgentAside } from "@/components/chat/agent-aside"
import { Loads } from "@/components/loads"
import { CardsPlaceholder } from "@/components/placeholders"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { agentQuery, schedulesKey, schedulesQuery } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"
import { useListedAgent } from "@/lib/workspaces"

export const Route = createFileRoute("/_app/a/$agentId/automations")({
  // Started and not waited for: the page is drawn at once, and its list when it is here.
  // Pointing at the tab runs this too.
  loader: ({ params }) => {
    void queryClient.prefetchQuery(schedulesQuery(params.agentId))
  },
  component: AutomationsPage,
})

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

function status(schedule: ScheduleSummary): { label: string; tone: string } {
  if (schedule.running) return { label: "Running", tone: "bg-primary/15 text-foreground" }
  if (schedule.enabled && schedule.nextRunAt !== null) {
    return { label: "Active", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" }
  }
  return schedule.runCount > 0 && schedule.nextRunAt === null && !schedule.enabled
    ? { label: "Done", tone: "bg-muted text-muted-foreground" }
    : { label: "Paused", tone: "bg-muted text-muted-foreground" }
}

function ScheduleCard({ agentId, schedule }: { agentId: string; schedule: ScheduleSummary }) {
  const api = client.agent(agentId)
  const refresh = () => queryClient.invalidateQueries({ queryKey: schedulesKey(agentId) })
  const toggle = useMutation({
    mutationFn: () => api.updateSchedule(schedule.id, { enabled: !schedule.enabled }),
    onSettled: refresh,
  })
  const run = useMutation({ mutationFn: () => api.runSchedule(schedule.id), onSettled: refresh })
  const remove = useMutation({
    mutationFn: () => api.removeSchedule(schedule.id),
    onSettled: refresh,
  })
  const { label, tone } = status(schedule)
  const error = toggle.error ?? run.error ?? remove.error

  return (
    <li className="flex flex-col gap-3 rounded-2xl border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-medium">{schedule.title}</h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono text-[0.8125rem]">{schedule.schedule}</span>
            {schedule.enabled && schedule.nextRunAt !== null
              ? ` · next ${when(schedule.nextRunAt)}`
              : null}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-medium", tone)}>
          {label}
        </span>
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap text-sm">{schedule.prompt}</p>
      {schedule.lastRun ? (
        <p className="text-sm text-muted-foreground">
          Last run {when(schedule.lastRun.at)}: {OUTCOMES[schedule.lastRun.outcome]}.{" "}
          <Link
            to="/a/$agentId/c/$chatId"
            params={{ agentId, chatId: schedule.lastRun.chatId }}
            className="text-foreground underline underline-offset-3"
          >
            View run
          </Link>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {label === "Done" ? null : (
          // A one-off that has run has nothing to pause or resume.
          <Button
            size="sm"
            variant="outline"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate()}
          >
            {schedule.enabled ? <PauseIcon /> : <PlayIcon />}
            {schedule.enabled ? "Pause" : "Resume"}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={schedule.running || run.isPending}
          onClick={() => run.mutate()}
        >
          <ClockIcon /> Run now
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-muted-foreground"
          disabled={remove.isPending}
          aria-label={`Delete ${schedule.title}`}
          onClick={() => remove.mutate()}
        >
          <TrashIcon /> Delete
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : null}
    </li>
  )
}

/** The list itself, which waits for the agent to say what it has scheduled. */
function Schedules({ agentId }: { agentId: string }) {
  const { data: schedules } = useSuspenseQuery(schedulesQuery(agentId))
  return schedules.length === 0 ? (
    <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
      Nothing scheduled yet.
    </p>
  ) : (
    <ul className="flex flex-col gap-3">
      {schedules.map((schedule) => (
        <ScheduleCard key={schedule.id} agentId={agentId} schedule={schedule} />
      ))}
    </ul>
  )
}

/** The agent's scheduled and repeating tasks. They are created by asking the agent, in chat. */
function AutomationsPage() {
  const { agentId } = Route.useParams()
  // Shares the layout's query, so this never fetches on its own.
  const { data: state } = useQuery(agentQuery(agentId))
  const listed = useListedAgent(agentId)
  const agent = state?.agent ?? listed

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 pt-8 pb-24 md:pt-10">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Automations</h1>
            <p className="text-sm text-muted-foreground">
              Things your agent does on its own, once or on a schedule. To add one, ask in chat:
              “Every weekday at 9, tell me what is on my calendar.”
            </p>
          </div>
          <Loads key={agentId} fallback={<CardsPlaceholder />}>
            <Schedules agentId={agentId} />
          </Loads>
        </div>
      </div>
      {agent === undefined ? null : <AgentAside agent={agent} />}
    </div>
  )
}

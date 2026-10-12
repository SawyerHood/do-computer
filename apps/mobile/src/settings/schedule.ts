import type { ScheduleSummary } from "@durable-computer/protocol"

/** A moment as an automation's rows say it: "Mon, Oct 12, 9:00 AM". */
export const when = (at: number) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at))

const times = (count: number) => (count === 1 ? "once" : `${count} times`)

/** How often a check ran, and how often it led to the agent being started. */
export const tally = (checked: number, started: number) =>
  started === 0
    ? `Checked ${times(checked)} and never started the agent.`
    : `Checked ${times(checked)} and started the agent ${times(started)}.`

/** What came of a run, in the web app's words. */
export const OUTCOMES = {
  delivered: "reported back",
  silent: "had nothing to report",
  failed: "did not finish",
  skipped: "the check found nothing, so the agent was not started",
  "check-failed": "the check is still failing, so the agent was not started",
} as const

export type ScheduleStatus = "Running" | "Active" | "Paused" | "Done"

/** The one word on an automation's pill. A one-off that has run is Done, not Paused. */
export function statusOf(schedule: ScheduleSummary): ScheduleStatus {
  if (schedule.running) return "Running"
  if (schedule.enabled && schedule.nextRunAt !== null) return "Active"
  return schedule.runCount > 0 && schedule.nextRunAt === null && !schedule.enabled
    ? "Done"
    : "Paused"
}

const DURATION = /^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/i
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function duration(text: string): string | undefined {
  const match = DURATION.exec(text.trim())
  if (!match) return undefined
  const count = Number(match[1])
  const unit = match[2]![0]!.toLowerCase() === "m" ? "minute" : match[2]![0]!.toLowerCase() === "h" ? "hour" : "day"
  return count === 1 ? unit : `${count} ${unit}s`
}

const clock = (hour: number, minute: number) =>
  `${hour % 12 === 0 ? 12 : hour % 12}${minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`} ${hour < 12 ? "AM" : "PM"}`

/** The common shapes of a five-field cron expression, said plainly. Undefined for the rest. */
function cron(text: string): string | undefined {
  const fields = text.trim().split(/\s+/)
  if (fields.length !== 5) return undefined
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string]
  if (month !== "*") return undefined
  if (hour === "*" && dayOfMonth === "*" && dayOfWeek === "*") {
    if (minute === "*") return "Every minute"
    const step = /^\*\/(\d+)$/.exec(minute)
    if (step) return `Every ${step[1]} minutes`
    return /^\d+$/.test(minute) ? "Every hour" : undefined
  }
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return undefined
  const at = `at ${clock(Number(hour), Number(minute))}`
  if (dayOfMonth !== "*") {
    return dayOfWeek === "*" && /^\d+$/.test(dayOfMonth) ? `Day ${dayOfMonth} of every month ${at}` : undefined
  }
  if (dayOfWeek === "*") return `Every day ${at}`
  if (dayOfWeek === "1-5") return `Weekdays ${at}`
  if (dayOfWeek === "0,6" || dayOfWeek === "6,0") return `Weekends ${at}`
  if (/^[0-7](,[0-7])*$/.test(dayOfWeek)) {
    const days = dayOfWeek.split(",").map((day) => DAYS[Number(day) % 7]!)
    return `${days.length === 1 ? `Every ${days[0]}` : days.map((day) => day.slice(0, 3)).join(", ")} ${at}`
  }
  return undefined
}

/**
 * A schedule as written ("every 2h", "0 9 * * 1-5", "30m", a timestamp) in words a person
 * would say. What it cannot read is given back as it was written.
 */
export function inWords(schedule: string): string {
  const text = schedule.trim()
  const every = /^every\s+(.+)$/i.exec(text)
  if (every) {
    const each = duration(every[1]!)
    return each === undefined ? text : `Every ${each}`
  }
  if (duration(text) !== undefined) return "Once"
  const said = cron(text)
  if (said !== undefined) return said
  const at = /^\d{4}-\d{2}-\d{2}T/.test(text) ? Date.parse(text) : Number.NaN
  return Number.isNaN(at) ? text : `Once, ${when(at)}`
}

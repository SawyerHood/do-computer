import { Cron } from "croner"

/**
 * Schedule grammar: one string, four shapes.
 *
 *   "30m" / "2h" / "1d"          one-shot, that long from now
 *   "every 30m" / "every 2h"     recurring interval
 *   "0 9 * * *"                  recurring 5-field cron, in the given IANA timezone (default UTC)
 *   "2026-07-04T09:00:00Z"       one-shot at that instant (ISO 8601)
 *
 * Parsing is pure and repeated on demand: a schedule stores the raw string and its next run time.
 */
export type ScheduleSpec =
  | { kind: "once"; runAt: number }
  | { kind: "interval"; everyMs: number }
  | { kind: "cron"; expression: string; timezone?: string }

const DURATION_PATTERN = /^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/i
const MIN_INTERVAL_MS = 60_000

function parseDurationMs(text: string): number | null {
  const match = DURATION_PATTERN.exec(text.trim())
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = match[2]![0]!.toLowerCase()
  return unit === "m" ? value * 60_000 : unit === "h" ? value * 3_600_000 : value * 86_400_000
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/**
 * Parse a schedule string. `now` anchors relative forms. Throws with a message fit to show the
 * agent on anything it cannot read.
 */
export function parseSchedule(raw: string, now: number, timezone?: string): ScheduleSpec {
  const text = raw.trim()
  if (!text) throw new Error("A schedule is required.")
  if (timezone !== undefined && !isValidTimezone(timezone)) {
    throw new Error(`"${timezone}" is not an IANA timezone such as "America/New_York".`)
  }

  const every = /^every\s+(.+)$/i.exec(text)
  if (every) {
    const ms = parseDurationMs(every[1]!)
    if (ms === null) {
      throw new Error(
        `Could not parse interval "${raw}". Use for example "every 30m" or "every 2h".`,
      )
    }
    if (ms < MIN_INTERVAL_MS) throw new Error("Intervals must be at least 1 minute.")
    return { kind: "interval", everyMs: ms }
  }

  const duration = parseDurationMs(text)
  if (duration !== null) return { kind: "once", runAt: now + duration }

  // An ISO timestamp needs a date part, so bare numbers and cron fields never match.
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const at = Date.parse(text)
    if (Number.isNaN(at)) throw new Error(`Could not parse timestamp "${raw}". Use ISO 8601.`)
    if (at <= now) throw new Error(`"${raw}" is in the past.`)
    return { kind: "once", runAt: at }
  }

  // Any five words have the shape of a cron expression, so only call it one when at least one
  // field has a digit or wildcard; otherwise fall through to the general guidance.
  const fields = text.split(/\s+/)
  if (fields.length === 5 && fields.some((field) => /[\d*]/.test(field))) {
    try {
      // Constructing validates; paused, so croner never arms a timer of its own.
      new Cron(text, { paused: true, timezone: timezone ?? "UTC" })
    } catch (error) {
      throw new Error(`Invalid cron expression "${raw}": ${(error as Error).message}`)
    }
    return { kind: "cron", expression: text, ...(timezone ? { timezone } : {}) }
  }

  throw new Error(
    `Could not parse schedule "${raw}". Use "30m" (once, from now), "every 2h" (repeating), a 5-field cron expression, or an ISO 8601 timestamp.`,
  )
}

/**
 * The next fire time strictly after `from`, or null when the schedule is spent (a one-shot that
 * already ran). Computing from now at fire time collapses an outage's backlog into one run.
 */
export function nextRunAt(spec: ScheduleSpec, from: number): number | null {
  switch (spec.kind) {
    case "once":
      return spec.runAt > from ? spec.runAt : null
    case "interval":
      return from + spec.everyMs
    case "cron": {
      const cron = new Cron(spec.expression, { paused: true, timezone: spec.timezone ?? "UTC" })
      return cron.nextRun(new Date(from))?.getTime() ?? null
    }
  }
}

/** A time as the user would read it, in their timezone when known. */
export function formatTime(at: number, timezone?: string | null): string {
  const zone = timezone && isValidTimezone(timezone) ? timezone : "UTC"
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at))
  return `${text} (${zone})`
}

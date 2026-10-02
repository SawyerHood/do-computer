import { describe, expect, it } from "vitest"
import { formatTime, nextRunAt, parseSchedule } from "../src/schedule.ts"

const now = Date.UTC(2026, 9, 2, 12, 0, 0) // Fri 2026-10-02 12:00 UTC

describe("schedule grammar", () => {
  it("reads a bare duration as once, that long from now", () => {
    expect(parseSchedule("30m", now)).toEqual({ kind: "once", runAt: now + 30 * 60_000 })
    expect(parseSchedule("2 hours", now)).toEqual({ kind: "once", runAt: now + 2 * 3_600_000 })
    expect(parseSchedule("1d", now)).toEqual({ kind: "once", runAt: now + 86_400_000 })
  })

  it("reads 'every' as a repeating interval", () => {
    expect(parseSchedule("every 15m", now)).toEqual({ kind: "interval", everyMs: 15 * 60_000 })
    expect(() => parseSchedule("every 0m", now)).toThrow("Could not parse interval")
    expect(() => parseSchedule("every fortnight", now)).toThrow("Could not parse interval")
  })

  it("reads ISO timestamps and refuses past ones", () => {
    expect(parseSchedule("2026-10-03T09:00:00Z", now)).toEqual({
      kind: "once",
      runAt: Date.UTC(2026, 9, 3, 9),
    })
    expect(() => parseSchedule("2026-10-01T09:00:00Z", now)).toThrow("in the past")
    expect(() => parseSchedule("2026-13-45", now)).toThrow("Could not parse timestamp")
  })

  it("reads cron expressions in the given timezone", () => {
    const spec = parseSchedule("0 9 * * *", now, "America/Los_Angeles")
    expect(spec).toEqual({ kind: "cron", expression: "0 9 * * *", timezone: "America/Los_Angeles" })
    // 9:00 in Los Angeles is 16:00 UTC while daylight time is in effect.
    expect(nextRunAt(spec, now)).toBe(Date.UTC(2026, 9, 2, 16))
    expect(nextRunAt(parseSchedule("0 9 * * *", now), now)).toBe(Date.UTC(2026, 9, 3, 9))
    expect(() => parseSchedule("99 9 * * *", now)).toThrow("Invalid cron expression")
    expect(() => parseSchedule("0 9 * * *", now, "Mars/Olympus")).toThrow("not an IANA timezone")
  })

  it("explains itself instead of guessing at free text", () => {
    expect(() => parseSchedule("whenever you feel like it", now)).toThrow(
      "Could not parse schedule",
    )
    expect(() => parseSchedule("  ", now)).toThrow("required")
  })

  it("computes the next run from the time asked, so a backlog collapses", () => {
    const interval = parseSchedule("every 1h", now)
    const muchLater = now + 10 * 3_600_000 + 5_000
    expect(nextRunAt(interval, muchLater)).toBe(muchLater + 3_600_000)
    const once = parseSchedule("30m", now)
    expect(nextRunAt(once, now)).toBe(now + 30 * 60_000)
    expect(nextRunAt(once, now + 31 * 60_000)).toBe(null)
  })

  it("formats times in the user's timezone", () => {
    expect(formatTime(now, "America/New_York")).toBe("Fri, Oct 2, 2026, 8:00 AM (America/New_York)")
    expect(formatTime(now, null)).toBe("Fri, Oct 2, 2026, 12:00 PM (UTC)")
  })
})

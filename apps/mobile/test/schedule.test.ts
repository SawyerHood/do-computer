import type { ScheduleSummary } from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import { inWords, statusOf, tally } from "../src/settings/schedule.ts"

const schedule = (change: Partial<ScheduleSummary>): ScheduleSummary => ({
  id: "s1",
  title: "Morning calendar",
  prompt: "Tell me what is on my calendar.",
  schedule: "0 9 * * 1-5",
  timezone: null,
  enabled: true,
  nextRunAt: 1,
  createdAt: 0,
  running: false,
  lastRun: null,
  runCount: 0,
  check: null,
  skipCount: 0,
  ...change,
})

describe("an automation's schedule in words", () => {
  it("says an interval", () => {
    expect(inWords("every 30m")).toBe("Every 30 minutes")
    expect(inWords("every 2h")).toBe("Every 2 hours")
    expect(inWords("every 1 day")).toBe("Every day")
  })

  it("says the common cron shapes", () => {
    expect(inWords("0 9 * * *")).toBe("Every day at 9 AM")
    expect(inWords("30 17 * * 1-5")).toBe("Weekdays at 5:30 PM")
    expect(inWords("0 0 * * 1")).toBe("Every Monday at 12 AM")
    expect(inWords("0 8 * * 1,3")).toBe("Mon, Wed at 8 AM")
    expect(inWords("*/15 * * * *")).toBe("Every 15 minutes")
    expect(inWords("0 9 1 * *")).toBe("Day 1 of every month at 9 AM")
  })

  it("says a one-off", () => {
    expect(inWords("30m")).toBe("Once")
    expect(inWords("2026-07-04T09:00:00Z")).toMatch(/^Once, /)
  })

  it("gives back what it cannot read as it was written", () => {
    expect(inWords("0 9 * 1-3 *")).toBe("0 9 * 1-3 *")
    expect(inWords("0 9-17 * * *")).toBe("0 9-17 * * *")
    expect(inWords("every so often")).toBe("every so often")
  })
})

describe("an automation's pill", () => {
  it("is Running while a run is in progress, whatever else", () => {
    expect(statusOf(schedule({ running: true, enabled: false }))).toBe("Running")
  })

  it("is Active when it is on and has a next run", () => {
    expect(statusOf(schedule({}))).toBe("Active")
  })

  it("is Done for a one-off that has run, and Paused otherwise", () => {
    expect(statusOf(schedule({ enabled: false, nextRunAt: null, runCount: 1 }))).toBe("Done")
    expect(statusOf(schedule({ enabled: false }))).toBe("Paused")
    expect(statusOf(schedule({ enabled: false, nextRunAt: null }))).toBe("Paused")
  })
})

describe("the tally of an automation's checks", () => {
  it("says how often it checked and how often the agent was started", () => {
    expect(tally(1, 0)).toBe("Checked once and never started the Dood.")
    expect(tally(12, 1)).toBe("Checked 12 times and started the Dood once.")
  })
})

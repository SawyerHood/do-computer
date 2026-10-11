import { describe, expect, it } from "vitest"
import { POLL_EAGER_FOR_MS, POLL_EAGER_MS, POLL_PATIENT_MS, pollDelay } from "../src/pairing.ts"

describe("how often a daemon asks whether it has been paired", () => {
  it("is every few seconds while someone is likely to be confirming its code", () => {
    expect(pollDelay(0)).toBe(POLL_EAGER_MS)
    expect(pollDelay(POLL_EAGER_FOR_MS - 1)).toBe(POLL_EAGER_MS)
  })

  it("is seldom once nobody has confirmed for a while", () => {
    expect(pollDelay(POLL_EAGER_FOR_MS)).toBe(POLL_PATIENT_MS)
    expect(pollDelay(24 * 60 * 60_000)).toBe(POLL_PATIENT_MS)
  })

  it("is as a test asks to begin with, and never more often after", () => {
    expect(pollDelay(0, 200)).toBe(200)
    expect(pollDelay(POLL_EAGER_FOR_MS, 200)).toBe(POLL_PATIENT_MS)
    expect(pollDelay(POLL_EAGER_FOR_MS, 60_000)).toBe(60_000)
  })

  it("asks about a tenth as often in a day nobody confirms", () => {
    const day = 24 * 60 * 60_000
    let asked = 0
    for (let waited = 0; waited < day; waited += pollDelay(waited)) asked++
    expect(asked).toBeLessThan(day / POLL_EAGER_MS / 9)
  })
})

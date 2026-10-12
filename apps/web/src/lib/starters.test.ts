import { describe, expect, it } from "vitest"
import { screenHolds, startersFor } from "./starters"

const labels = (computer: Parameters<typeof startersFor>[0]) =>
  startersFor(computer).map((starter) => starter.label)

describe("what a new agent offers to start with", () => {
  it("is drawing on the screen first, on a computer it may work on", () => {
    expect(labels({ name: "air", readOnly: false })).toEqual([
      "Draw me a picture",
      "Make me a little game",
      "What’s filling up this computer?",
      "Check in with me every morning",
    ])
    expect(startersFor({ name: "air", readOnly: false })[0]!.screen).toBe(true)
  })

  it("is only what needs no computer, where it was given none or may only read", () => {
    const anywhere = [
      "Make me a little game",
      "Research three things at once",
      "Check in with me every morning",
    ]
    expect(labels(undefined)).toEqual(anywhere)
    expect(labels(null)).toEqual(anywhere)
    expect(labels({ name: "air", readOnly: true })).toEqual(anywhere)
    expect(startersFor(undefined).some((starter) => starter.screen)).toBe(false)
  })
})

describe("a starter that takes the screen", () => {
  it("goes ahead once its owner has allowed it", () => {
    expect(screenHolds({ allowed: true })).toBeUndefined()
    expect(screenHolds({ allowed: true, missing: [] })).toBeUndefined()
  })

  it("waits for what macOS has still to allow, and says what", () => {
    expect(screenHolds({ allowed: true, missing: ["Accessibility", "Screen Recording"] })).toMatch(
      /under Accessibility and Screen Recording in the window that just opened/,
    )
  })

  it("is not said where the owner said no, and says why where it cannot be asked for", () => {
    expect(screenHolds({ allowed: false })).toBe("")
    expect(screenHolds({ allowed: false, why: "No driver here." })).toBe("No driver here.")
  })
})

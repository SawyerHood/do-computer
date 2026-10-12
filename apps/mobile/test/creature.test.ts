import { NEW_CREATURE, WEAR_ITEMS } from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import { boxProgress, foundLine } from "../src/creature/words"

const NOW = 1_700_000_000_000
const HOUR = 3_600_000

describe("what is said about a creature's boxes", () => {
  it("says how long is left in hours, and in minutes under an hour", () => {
    expect(boxProgress({ nextBoxAt: NOW + 7 * HOUR }, NOW).left).toBe("7 hours")
    expect(boxProgress({ nextBoxAt: NOW + HOUR }, NOW).left).toBe("1 hour")
    expect(boxProgress({ nextBoxAt: NOW + 40 * 60_000 }, NOW).left).toBe("40 minutes")
    expect(boxProgress({ nextBoxAt: NOW - HOUR }, NOW).left).toBe("1 minute")
  })

  it("fills as the twelve hours pass", () => {
    expect(boxProgress({ nextBoxAt: NOW + 12 * HOUR }, NOW).part).toBe(0)
    expect(boxProgress({ nextBoxAt: NOW + 6 * HOUR }, NOW).part).toBe(0.5)
    expect(boxProgress({ nextBoxAt: NOW }, NOW).part).toBe(1)
  })

  it("says what was found, and the next box or the ones waiting", () => {
    const some = { ...NEW_CREATURE, owned: ["party", "wizard"] }
    const all = WEAR_ITEMS.length
    expect(foundLine({ ...some, boxes: 0, nextBoxAt: NOW + 7 * HOUR }, NOW)).toBe(
      `2 of ${all} found · next box in 7 hours`,
    )
    expect(foundLine({ ...some, boxes: 1 }, NOW)).toBe(`2 of ${all} found · a box is waiting`)
    expect(foundLine({ ...some, boxes: 3 }, NOW)).toBe(`2 of ${all} found · 3 boxes waiting`)
  })

  it("says nothing of boxes once everything is found", () => {
    const owned = WEAR_ITEMS.map((item) => item.id)
    expect(foundLine({ ...NEW_CREATURE, boxes: 0, owned }, NOW)).toBe(`${all(owned)} found`)
  })
})

const all = (owned: string[]) => `${owned.length} of ${WEAR_ITEMS.length}`

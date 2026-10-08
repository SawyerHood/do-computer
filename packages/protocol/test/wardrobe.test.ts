import { describe, expect, it } from "vitest"
import {
  hasEverything,
  parseOutfit,
  RARITIES,
  rollItem,
  WEAR_ITEMS,
  WEAR_SLOTS,
  wearItem,
} from "../src/index.ts"

describe("the things a creature can wear", () => {
  it("are a hundred, each with an id of its own, in every place and every rarity", () => {
    expect(WEAR_ITEMS).toHaveLength(100)
    expect(new Set(WEAR_ITEMS.map((item) => item.id)).size).toBe(100)
    for (const slot of WEAR_SLOTS) {
      expect(WEAR_ITEMS.some((item) => item.slot === slot)).toBe(true)
    }
    for (const rarity of RARITIES) {
      expect(WEAR_ITEMS.some((item) => item.rarity === rarity.id)).toBe(true)
    }
    // The rarer, the fewer.
    const counts = RARITIES.map(
      (rarity) => WEAR_ITEMS.filter((item) => item.rarity === rarity.id).length,
    )
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
  })
})

describe("what a box holds", () => {
  /** Numbers handed out in turn, standing in for chance. */
  const dealt = (...numbers: number[]) => {
    let at = 0
    return () => numbers[at++ % numbers.length]!
  }

  it("is something common six times in ten and something legendary once in a hundred", () => {
    expect(rollItem([], dealt(0, 0))?.rarity).toBe("common")
    expect(rollItem([], dealt(0.599, 0))?.rarity).toBe("common")
    expect(rollItem([], dealt(0.6, 0))?.rarity).toBe("uncommon")
    expect(rollItem([], dealt(0.85, 0))?.rarity).toBe("rare")
    expect(rollItem([], dealt(0.95, 0))?.rarity).toBe("epic")
    expect(rollItem([], dealt(0.99, 0))?.rarity).toBe("legendary")
    expect(rollItem([], dealt(0.999999, 0.999999))?.rarity).toBe("legendary")
  })

  it("is never something already owned, until there is nothing left", () => {
    const owned: string[] = []
    let seed = 7
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (let box = 0; box < WEAR_ITEMS.length; box++) {
      const item = rollItem(owned, random)
      expect(item).toBeDefined()
      expect(owned).not.toContain(item!.id)
      owned.push(item!.id)
    }
    expect(hasEverything(owned)).toBe(true)
    expect(rollItem(owned, random)).toBeUndefined()
  })

  it("draws from the rarities that are left when one has run out", () => {
    const commons = WEAR_ITEMS.filter((item) => item.rarity === "common").map((item) => item.id)
    expect(rollItem(commons, dealt(0, 0))?.rarity).toBe("uncommon")
  })
})

describe("an outfit", () => {
  const owned = ["party", "round"]

  it("is made of things that are owned, each worn in its own place", () => {
    expect(parseOutfit({ hat: "party", glasses: "round" }, owned)).toEqual({
      outfit: { hat: "party", glasses: "round" },
    })
    expect(parseOutfit({ hat: null, neck: "" }, owned)).toEqual({ outfit: {} })
  })

  it("is refused with the reason otherwise", () => {
    expect(parseOutfit({ hat: "tophat" }, owned)).toEqual({
      error: `${wearItem("tophat")!.name} has not been found yet`,
    })
    expect(parseOutfit({ neck: "party" }, owned)).toEqual({ error: "Party hat is not worn there" })
    expect(parseOutfit({ hat: "nothing-like-it" }, owned)).toHaveProperty("error")
    expect(parseOutfit({ feet: "party" }, owned)).toHaveProperty("error")
    expect(parseOutfit("party", owned)).toHaveProperty("error")
  })
})

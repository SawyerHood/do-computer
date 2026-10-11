import { describe, expect, it } from "vitest"
import { dealPresent, isDoodSeed, keptFrom, parseDoodName } from "../src/index.ts"

describe("a Dood's name", () => {
  it("is kept as letters and numbers in any script, with single spaces", () => {
    expect(parseDoodName("  Mossy  the   2nd ")).toBe("Mossy the 2nd")
    expect(parseDoodName("Tomás")).toBe("Tomás")
    expect(parseDoodName("もち")).toBe("もち")
    expect(parseDoodName("Mr. O’Pip!")).toBe("Mr. O’Pip!")
  })

  it("loses what could be markup, and is cut to its length", () => {
    expect(parseDoodName('<b onclick="x">Pip</b>')).toBe("b onclickxPipb")
    expect(parseDoodName("a".repeat(60))).toHaveLength(20)
  })

  it("is refused where nothing is left, or where it reads as an address", () => {
    for (const bad of [
      "",
      "   ",
      "!!!",
      "<>",
      "www.example.com",
      "see evil.io",
      "http evil",
      7,
      null,
    ]) {
      expect(parseDoodName(bad), String(bad)).toBeUndefined()
    }
  })
})

describe("a Dood's present", () => {
  it("is three different things, a common one, an uncommon one and a rarer one", () => {
    for (const seed of ["abcd1234", "post-5678", "zzzz", "0000-0000"]) {
      const dealt = dealPresent(seed)
      expect(dealt.map((item) => item.rarity).slice(0, 2)).toEqual(["common", "uncommon"])
      expect(["rare", "epic"]).toContain(dealt[2].rarity)
      expect(new Set(dealt.map((item) => item.id)).size).toBe(3)
    }
  })

  it("follows from its seed, so that what was kept can be checked", () => {
    expect(dealPresent("abcd1234")).toEqual(dealPresent("abcd1234"))
    const [first] = dealPresent("abcd1234")
    expect(keptFrom("abcd1234", first.id)).toEqual(first)
    // The rarest things are in nobody's.
    expect(keptFrom("abcd1234", "galaxy")).toBeUndefined()
    expect(keptFrom("abcd1234", undefined)).toBeUndefined()
    // Different eggs hold different things, taken over many.
    const thirds = new Set(
      Array.from({ length: 40 }, (_, index) => dealPresent(`seed-${index}`)[2].id),
    )
    expect(thirds.size).toBeGreaterThan(10)
  })

  it("has a seed of a few plain characters", () => {
    expect(isDoodSeed("a1b2c3d4")).toBe(true)
    for (const bad of ["abc", "A1B2C3D4", "a b c d", "x".repeat(33), 12345678]) {
      expect(isDoodSeed(bad), String(bad)).toBe(false)
    }
  })
})

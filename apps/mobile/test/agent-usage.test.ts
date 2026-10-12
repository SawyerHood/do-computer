import { describe, expect, it } from "vitest"
import { dollars, tokens } from "../src/agent/usage.ts"

describe("an agent's usage", () => {
  it("writes a count of tokens as the web app does", () => {
    const web = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
    for (const count of [
      0, 7, 950, 999, 1000, 1049, 1050, 1234, 9999, 12_345, 123_456, 999_949, 999_950, 1_000_000,
      1_250_000, 48_300_000, 999_999_999, 2_400_000_000, 7_000_000_000_000,
    ]) {
      expect(tokens(count), String(count)).toBe(web.format(count))
    }
  })

  it("writes a cost as the web app does", () => {
    expect(dollars(0)).toBe("$0")
    expect(dollars(0.004)).toBe("under $0.01")
    expect(dollars(4.123)).toBe("$4.12")
    expect(dollars(12.6)).toBe("$13")
  })
})

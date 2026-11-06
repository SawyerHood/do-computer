import { describe, expect, it } from "vitest"
import { numericColumns } from "./numeric-columns"
describe("numeric table columns", () => {
  it("recognizes currency, units and percentages without aligning prose", () => {
    expect(
      numericColumns([
        ["River House", "45 min", "$180"],
        ["Cedar Lodge", "1 hr", "$210"],
      ]),
    ).toEqual([1, 2])
    expect(
      numericColumns([
        ["12%", "1,200"],
        ["-3.5%", "2,000"],
      ]),
    ).toEqual([0, 1])
  })
  it("does not infer empty, mixed, date, or sentence columns", () => {
    expect(
      numericColumns([
        ["", "2026-11-06", "3 of 5"],
        ["", "2026-11-07", "4 of 5"],
      ]),
    ).toEqual([])
    expect(numericColumns([["3"], ["Not available"]])).toEqual([])
  })
})

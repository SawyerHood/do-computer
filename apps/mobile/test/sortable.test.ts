import { describe, expect, it } from "vitest"
import { heightOf, placeHeld, topOf } from "../src/ui/sortable-places"

// Three rows, the middle one taller, as a row with a line under its name is.
const heights = { a: 60, b: 80, c: 60 }
const order = ["a", "b", "c"]

describe("the rows of a list being put in order", () => {
  it("start where the rows over them end", () => {
    expect(topOf(order, heights, "a")).toBe(0)
    expect(topOf(order, heights, "b")).toBe(60)
    expect(topOf(order, heights, "c")).toBe(140)
    expect(heightOf(order, heights)).toBe(200)
  })

  it("keep their place while the one held has not passed the middle of the next", () => {
    // The top one moved down by less than half the next row's height.
    expect(placeHeld(order, heights, "a", 39)).toEqual(["a", "b", "c"])
  })

  it("make room for the one held once its middle has passed theirs", () => {
    expect(placeHeld(order, heights, "a", 41)).toEqual(["b", "a", "c"])
    expect(placeHeld(order, heights, "a", 140)).toEqual(["b", "c", "a"])
    expect(placeHeld(order, heights, "c", 0)).toEqual(["c", "a", "b"])
  })

  it("keep the one held at an end when it is taken past it", () => {
    expect(placeHeld(order, heights, "b", -500)).toEqual(["b", "a", "c"])
    expect(placeHeld(order, heights, "b", 5_000)).toEqual(["a", "c", "b"])
  })
})

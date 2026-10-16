import { describe, expect, it } from "vitest"
import { inOrder, MAX_ORDERED, moved, readOrderIds } from "../src/order.ts"

describe("a workspace's order", () => {
  const agents = [
    { id: "old", createdAt: 10 },
    { id: "spoke", createdAt: 5, latest: { kind: "reply" as const, at: 50, text: "" } },
    { id: "new", createdAt: 30 },
  ]
  const ids = (order: readonly string[] | undefined) =>
    inOrder(agents, order).map((agent) => agent.id)

  it("is the one last heard from first until one is moved", () => {
    expect(ids(undefined)).toEqual(["spoke", "new", "old"])
  })

  it("keeps the order they were put in, whichever was heard from since", () => {
    expect(ids(["old", "new", "spoke"])).toEqual(["old", "new", "spoke"])
  })

  it("puts one that came since on top, and passes over one that is gone", () => {
    expect(ids(["old", "gone", "new"])).toEqual(["spoke", "old", "new"])
  })
})

describe("moving one", () => {
  it("takes it out and puts it back where it was let go", () => {
    expect(moved(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"])
    expect(moved(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"])
  })

  it("keeps it at an end when let go past it", () => {
    expect(moved(["a", "b", "c"], 0, 9)).toEqual(["b", "c", "a"])
    expect(moved(["a", "b", "c"], 2, -4)).toEqual(["c", "a", "b"])
  })
})

describe("an order that comes in", () => {
  it("is kept with each id once", () => {
    expect(readOrderIds(["a", "b", "a"])).toEqual(["a", "b"])
  })

  it("is not an order when it is anything but a list of ids", () => {
    expect(readOrderIds("a")).toBeUndefined()
    expect(readOrderIds(["a", 2])).toBeUndefined()
    expect(readOrderIds(["a", ""])).toBeUndefined()
    expect(readOrderIds(null)).toBeUndefined()
  })

  it("keeps no more than the most an order holds", () => {
    const many = Array.from({ length: MAX_ORDERED + 5 }, (_, index) => `id-${index}`)
    expect(readOrderIds(many)).toHaveLength(MAX_ORDERED)
  })
})

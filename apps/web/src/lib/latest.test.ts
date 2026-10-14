import type { AgentLatest, Person } from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import { inOrder, isUnread, latestFirst, latestWords, when } from "./latest.ts"

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()

describe("when", () => {
  const now = at(12, 15)

  it("says now for the last minute, and the time of day for earlier today", () => {
    expect(when(now - 20_000, now)).toBe("now")
    expect(when(at(12, 9, 20), now)).toMatch(/9:20/)
    // Late last night is yesterday, however few hours ago it was.
    expect(when(at(11, 23, 50), at(12, 0, 30))).toBe("Yesterday")
  })

  it("names the day within a week, and the date before that", () => {
    expect(when(at(11, 8), now)).toBe("Yesterday")
    expect(when(at(9, 8), now)).toMatch(/Fri/)
    expect(when(at(2, 8), now)).toMatch(/Oct 2/)
  })
})

describe("latestWords", () => {
  const maya: Person = { id: "u-maya", name: "Maya Okafor", image: null }
  const people = new Map([[maya.id, maya]])
  const line = (latest: Partial<AgentLatest>): AgentLatest => ({
    kind: "reply",
    at: 1,
    text: "Done.",
    ...latest,
  })

  it("says who wrote to the agent, and nothing in front of its own answer", () => {
    expect(latestWords(line({ kind: "said", by: "u-me" }), "u-me", people)).toBe("You: Done.")
    expect(latestWords(line({ kind: "said", by: "u-maya" }), "u-me", people)).toBe("Maya: Done.")
    // Someone who has left the team since is not named.
    expect(latestWords(line({ kind: "said", by: "u-gone" }), "u-me", people)).toBe("Done.")
    expect(latestWords(line({}), "u-me", people)).toBe("Done.")
  })

  it("says what a scheduled run, another agent's message and a Slack thread are from", () => {
    expect(latestWords(line({ kind: "scheduled", from: "Morning brief" }), "u-me", people)).toBe(
      "Morning brief: Done.",
    )
    expect(latestWords(line({ kind: "agent", from: "Scout" }), "u-me", people)).toBe(
      "From Scout: Done.",
    )
    expect(latestWords(line({ kind: "slack", from: "launch" }), "u-me", people)).toBe(
      "#launch: Done.",
    )
    expect(latestWords(line({ kind: "slack" }), "u-me", people)).toBe("Done.")
  })
})

describe("isUnread", () => {
  const reply: AgentLatest = { kind: "reply", at: 200, text: "Done." }

  it("is what came after the last look", () => {
    expect(isUnread({ latest: reply, seenAt: 100 }, "u-me", undefined)).toBe(true)
    expect(isUnread({ latest: reply, seenAt: 200 }, "u-me", undefined)).toBe(false)
    // A look from this tab that the list has not caught up with counts.
    expect(isUnread({ latest: reply, seenAt: 100 }, "u-me", 250)).toBe(false)
  })

  it("claims nothing of an agent never looked at, or of what the person wrote themselves", () => {
    expect(isUnread({ latest: reply }, "u-me", undefined)).toBe(false)
    expect(isUnread({ seenAt: 100 }, "u-me", undefined)).toBe(false)
    const mine: AgentLatest = { kind: "said", at: 200, text: "Hello", by: "u-me" }
    expect(isUnread({ latest: mine, seenAt: 100 }, "u-me", undefined)).toBe(false)
    expect(isUnread({ latest: { ...mine, by: "u-maya" }, seenAt: 100 }, "u-me", undefined)).toBe(
      true,
    )
  })
})

describe("latestFirst", () => {
  it("puts the one last heard from first, and counts a silent one from when it was made", () => {
    const agents = [
      { id: "old", createdAt: 10 },
      { id: "spoke", createdAt: 5, latest: { kind: "reply" as const, at: 50, text: "" } },
      { id: "new", createdAt: 30 },
    ]
    expect(latestFirst(agents).map((agent) => agent.id)).toEqual(["spoke", "new", "old"])
  })
})

describe("inOrder", () => {
  const agents = [
    { id: "old", createdAt: 10 },
    { id: "spoke", createdAt: 5, latest: { kind: "reply" as const, at: 50, text: "" } },
    { id: "new", createdAt: 30 },
  ]
  const ids = (order: readonly string[] | undefined) =>
    inOrder(agents, order).map((agent) => agent.id)

  it("is the one last heard from first until they are put in an order", () => {
    expect(ids(undefined)).toEqual(["spoke", "new", "old"])
  })

  it("keeps the order they were put in, whichever was heard from since", () => {
    expect(ids(["old", "new", "spoke"])).toEqual(["old", "new", "spoke"])
  })

  it("has one that came since above the rest, and passes over one that is gone", () => {
    expect(ids(["old", "gone", "new"])).toEqual(["spoke", "old", "new"])
    expect(ids(["old"])).toEqual(["spoke", "new", "old"])
  })
})

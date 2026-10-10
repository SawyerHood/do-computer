import { describe, expect, it } from "vitest"
import { type ChatState, diffChat, digest, EMPTY_CHAT, reduceChat } from "../src/index.ts"

describe("digest", () => {
  it("is the same for values that are equal as JSON, whatever order their keys are in", () => {
    const one = { a: 1, b: [1, "two", { c: null, d: true }], e: "text" }
    const other = { e: "text", b: [1, "two", { d: true, c: null }], a: 1 }
    expect(digest(one)).toBe(digest(other))
    expect(digest(one)).toMatch(/^[0-9a-f]{16}$/)
    // A key with no value is one that is not there, as it is once the value has been sent.
    expect(digest({ a: 1, b: undefined })).toBe(digest({ a: 1 }))
    expect(digest(JSON.parse(JSON.stringify(one)))).toBe(digest(one))
  })

  it("tells apart values that differ, however slightly", () => {
    const values: unknown[] = [
      null,
      0,
      1,
      -1,
      1.5,
      "",
      "1",
      "a",
      "ab",
      true,
      false,
      [],
      [[]],
      [null],
      [0],
      ["a", "b"],
      ["ab"],
      ["b", "a"],
      {},
      { a: 1 },
      { a: "1" },
      { a: [1] },
      { a: { b: 1 } },
      { a: 1, b: 2 },
      { ab: 1 },
      { a: "b" },
      { a: null },
      { a: {} },
    ]
    const seen = new Map<string, unknown>()
    for (const value of values) {
      const mark = digest(value)
      expect(seen.has(mark), `${JSON.stringify(value)} and ${JSON.stringify(seen.get(mark))}`).toBe(
        false,
      )
      seen.set(mark, value)
    }
  })

  it("is the same for a chat as it was sent and as its changes made it", () => {
    const before: ChatState = {
      ...EMPTY_CHAT,
      busy: true,
      messages: [
        { id: "1", role: "user", parts: [{ type: "text", text: "hi" }], status: "done" },
        {
          id: "live:2",
          role: "assistant",
          parts: [{ type: "text", text: "he" }],
          status: "streaming",
        },
      ],
    }
    const after: ChatState = {
      ...before,
      busy: false,
      messages: [
        before.messages[0]!,
        { id: "2", role: "assistant", parts: [{ type: "text", text: "hello" }], status: "done" },
      ],
    }
    // What a client holds: the first state as it arrived, and then each change applied.
    let held = JSON.parse(JSON.stringify(before)) as ChatState
    for (const event of diffChat(before, after)) {
      held = reduceChat(held, JSON.parse(JSON.stringify(event)))
    }
    expect(digest(held)).toBe(digest(after))
    expect(digest(held)).not.toBe(digest(before))
  })
})

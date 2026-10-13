import type { Message } from "@earendil-works/pi-ai"
import type { ContextView, EntryRecord } from "@earendil-works/pi-durable"
import { describe, expect, it } from "vitest"
import { cutDown, isWarm, WARM_MS } from "../src/branch.ts"

const NOW = 1_800_000_000_000
const MODEL = { provider: "test", modelId: "model" }

const entry = (id: number, kind: string, message?: object): EntryRecord =>
  ({ id, kind, ...(message === undefined ? {} : { model: [message] }) }) as unknown as EntryRecord

const user = (id: number, text: string) => entry(id, "pi.user", { role: "user", content: text })
const said = (id: number, text: string) =>
  entry(id, "pi.assistant", {
    role: "assistant",
    stopReason: "stop",
    content: [{ type: "text", text }],
  })
const calling = (id: number) =>
  entry(id, "pi.assistant", {
    role: "assistant",
    stopReason: "toolUse",
    content: [{ type: "toolCall", id: `call-${id}`, name: "bash", arguments: {} }],
  })
const output = (id: number, text: string) =>
  entry(id, "pi.tool-result", {
    role: "toolResult",
    toolCallId: `call-${id - 1}`,
    toolName: "bash",
    content: [{ type: "text", text }],
    isError: false,
  })

/** A chat's context as pi-durable gives it, for entries nothing has edited. */
const viewOf = (entries: EntryRecord[], head?: EntryRecord): ContextView => {
  const all = head === undefined ? entries : [head, ...entries]
  const contributions = all.map((item) => [...(item.model ?? [])])
  return { head, entries: all, contributions, messages: contributions.flat() }
}

/** About `tokens` tokens of text, as the estimate counts them: three and a half characters each. */
const words = (tokens: number, word = "word") =>
  `${word} `.repeat(Math.round((tokens * 3.5) / (word.length + 1)))

describe("whether a branch would be read from the provider's cache", () => {
  const answer = (
    id: number,
    usage: { cacheRead?: number; cacheWrite?: number },
    more: { at?: number; model?: string } = {},
  ) =>
    entry(id, "pi.assistant", {
      role: "assistant",
      provider: "test",
      model: more.model ?? "model",
      timestamp: more.at ?? NOW - 60_000,
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, ...usage },
      content: [{ type: "text", text: "Yes." }],
    })

  it("is so when the chat was answered lately from the cache", () => {
    expect(isWarm([user(1, "hi"), answer(2, { cacheRead: 900 })], MODEL, NOW)).toBe(true)
    // The first answer of a chat reads nothing and writes all of it.
    expect(isWarm([user(1, "hi"), answer(2, { cacheWrite: 900 })], MODEL, NOW)).toBe(true)
  })

  it("is not so once the cache's lifetime has passed, or where the provider keeps none", () => {
    const old = answer(2, { cacheRead: 900 }, { at: NOW - WARM_MS })
    expect(isWarm([user(1, "hi"), old], MODEL, NOW)).toBe(false)
    expect(isWarm([user(1, "hi"), answer(2, {})], MODEL, NOW)).toBe(false)
    expect(isWarm([], MODEL, NOW)).toBe(false)
    expect(isWarm([user(1, "hi")], MODEL, NOW)).toBe(false)
  })

  it("asks the answers before the last, for a provider that does not say when it writes", () => {
    const entries = [answer(1, { cacheRead: 900 }), user(2, "more"), answer(3, {})]
    expect(isWarm(entries, MODEL, NOW)).toBe(true)
    // Only the latest few: what was cached long ago says nothing of now.
    const stale = [answer(1, { cacheRead: 900 }), answer(2, {}), answer(3, {}), answer(4, {})]
    expect(isWarm(stale, MODEL, NOW)).toBe(false)
  })

  it("is not so when the chat was last answered by another model", () => {
    const entries = [answer(1, { cacheRead: 900 }), answer(2, { cacheRead: 900 }, { model: "b" })]
    expect(isWarm(entries, MODEL, NOW)).toBe(false)
    expect(isWarm(entries, { provider: "test", modelId: "b" }, NOW)).toBe(true)
    // The other model's answers are not asked about this one's cache.
    const switched = [answer(1, { cacheRead: 900 }, { model: "b" }), answer(2, {})]
    expect(isWarm(switched, MODEL, NOW)).toBe(false)
  })
})

describe("cutting down what a branch carries", () => {
  it("cuts nothing that fits", () => {
    const view = viewOf([user(1, words(100)), calling(2), output(3, words(5_000)), said(4, "Ok.")])
    expect(cutDown(view, 60_000, 20_000)).toEqual({ carried: "whole", edits: [] })
  })

  it("leaves old tool output behind first, and keeps what was said and what is recent", () => {
    const view = viewOf([
      user(1, words(1_000, "asked")),
      calling(2),
      output(3, words(30_000)),
      said(4, words(1_000, "answered")),
      user(5, "And the other file?"),
      calling(6),
      output(7, words(30_000)),
      said(8, "That one too."),
      user(9, "Again, for today."),
      calling(10),
      output(11, words(25_000)),
      said(12, "Done."),
    ])
    const cut = cutDown(view, 60_000, 20_000)
    expect(cut.carried).toBe("trimmed")
    // Only the two outputs before the last 20,000 tokens, each as its own tool's result.
    expect(cut.edits.map((edit) => [edit.target, edit.action])).toEqual([
      [3, "replace"],
      [7, "replace"],
    ])
    const [first] = cut.edits
    const replaced = (first!.action === "replace" ? first!.messages : [])[0] as Message & {
      toolCallId?: string
    }
    expect(replaced.role).toBe("toolResult")
    expect(replaced.toolCallId).toBe("call-2")
    expect(JSON.stringify(replaced.content)).toContain(
      "105,000 characters of output left behind in the main chat",
    )
  })

  it("leaves small outputs and pictures of late alone, and old pictures behind", () => {
    const picture = { type: "image", data: "x".repeat(4_000), mimeType: "image/png" }
    const shown = (id: number) =>
      entry(id, "pi.user", { role: "user", content: [{ type: "text", text: "Look." }, picture] })
    const view = viewOf([
      shown(1),
      calling(2),
      output(3, "ok"),
      said(4, "I see it."),
      user(5, words(3_000)),
      said(6, "Long."),
      shown(7),
      said(8, "Seen."),
    ])
    const cut = cutDown(view, 5_000, 1_000)
    expect(cut.carried).toBe("trimmed")
    const edits = cut.edits
    expect(edits.map((edit) => [edit.target, edit.action])).toEqual([[1, "replace"]])
    expect(JSON.stringify(edits[0])).toContain("A picture, left behind in the main chat.")
    expect(JSON.stringify(edits[0])).toContain("Look.")
  })

  it("then leaves the oldest turns out, whole, and never the summary or the prompt", () => {
    const summary = entry(90, "pi.compaction", { role: "user", content: words(2_000, "summary") })
    const view = viewOf(
      [
        entry(1, "pi.system", {
          role: "system",
          content: "",
          sections: { identity: words(3_000, "prompt") },
        }),
        user(2, words(30_000, "first")),
        calling(3),
        output(4, words(10_000)),
        said(5, "One."),
        entry(6, "dc.scheduled", { role: "user", content: words(500, "report") }),
        user(7, words(30_000, "second")),
        said(8, "Two."),
        entry(9, "pi.system", { role: "system", content: "", sections: { recent: "changed" } }),
        user(10, words(30_000, "third")),
        said(11, "Three."),
      ],
      summary,
    )
    const cut = cutDown(view, 60_000, 20_000)
    expect(cut.carried).toBe("recent")
    // Up to the user's second message: the first turn, its tool call and result together, and
    // the report that came after it. The summary and both entries of the prompt stay.
    expect(cut.edits.map((edit) => [edit.target, edit.action])).toEqual([
      [2, "omit"],
      [3, "omit"],
      [4, "omit"],
      [5, "omit"],
      [6, "omit"],
      [7, "omit"],
      [8, "omit"],
    ])
  })

  it("stops at the last of the user's messages, however large what follows it", () => {
    const view = viewOf([user(1, words(40_000, "first")), said(2, "One."), user(3, words(90_000))])
    expect(cutDown(view, 60_000, 20_000)).toEqual({
      carried: "recent",
      edits: [
        { target: 1, action: "omit" },
        { target: 2, action: "omit" },
      ],
    })
    // One turn cannot be parted.
    const one = viewOf([user(1, words(90_000)), said(2, "One.")])
    expect(cutDown(one, 60_000, 20_000)).toEqual({ carried: "trimmed", edits: [] })
  })
})

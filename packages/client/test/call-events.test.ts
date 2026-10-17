import { describe, expect, it } from "vitest"
import { pieces, readVoiceEvent, voiceClose, voiceReply } from "../src/call-events.ts"

/** Events as the two kinds of call really sent them, taken from calls placed on 2026-10-14. */
const codex = (event: unknown) => readVoiceEvent("codex", JSON.stringify(event))
const openai = (event: unknown) => readVoiceEvent("openai", JSON.stringify(event))

describe("what a call on a ChatGPT sign-in says", () => {
  it("is read: ready, words as they come, whole turns, a hand-off with its request, the end", () => {
    expect(
      codex({ type: "session.started", session: { id: "rtc_1", status: "active", expires_at: 1 } }),
    ).toEqual({ type: "started" })
    expect(
      codex({
        type: "input_transcript.added",
        end_ms: 7800,
        item: { id: "item_1", type: "input_transcript", text: " Hello, can" },
        start_ms: 7600,
      }),
    ).toEqual({ type: "words", who: "you", text: " Hello, can" })
    expect(
      codex({
        type: "output_transcript.added",
        item: { type: "output_transcript", text: " Yep," },
      }),
    ).toEqual({ type: "words", who: "dood", text: " Yep," })
    expect(
      codex({
        type: "turn.done",
        turn: { id: "turn_1", role: "user", transcript: " What is my favorite color?" },
      }),
    ).toEqual({ type: "line", who: "you", text: "What is my favorite color?" })
    expect(
      codex({ type: "turn.done", turn: { id: "turn_2", role: "assistant", transcript: " Teal." } }),
    ).toEqual({ type: "line", who: "dood", text: "Teal." })
    expect(
      codex({
        type: "delegation.created",
        item: {
          id: "item_9",
          type: "delegation",
          content: [{ type: "input_text", text: "Please look in my project folder" }],
          handoff_id: "handoff_1",
          target: "client",
        },
      }),
    ).toEqual({ type: "handOn", id: "item_9", ask: "Please look in my project folder" })
    expect(codex({ type: "session.closed", reason: "client_request" })).toEqual({ type: "closed" })
  })

  it("passes over what the app has no use for, and what is not for it", () => {
    for (const type of [
      "turn.created",
      "turn.delta",
      "session.usage.updated",
      "delegation.context.appended",
    ]) {
      expect(codex({ type, turn: { role: "user", transcript: "x" } })).toBeNull()
    }
    // A hand-off to something else is not the app's to answer.
    expect(
      codex({
        type: "delegation.created",
        item: { id: "item_1", target: "responses", content: [] },
      }),
    ).toBeNull()
    expect(codex({ type: "turn.done", turn: { role: "user", transcript: "  " } })).toBeNull()
    expect(readVoiceEvent("codex", "not json")).toBeNull()
    expect(readVoiceEvent("codex", "null")).toBeNull()
  })

  it("says a refused voice for what it is", () => {
    const refused = codex({
      type: "error",
      error: { message: "Voice session access denied.", type: "", code: "forbidden" },
    })
    expect(refused).toMatchObject({ type: "error" })
    expect((refused as { message: string }).message).toContain("choose another")
    expect(codex({ type: "error", error: { message: "Out of capacity." } })).toEqual({
      type: "error",
      message: "Out of capacity.",
    })
  })
})

describe("what a call on an OpenAI key says", () => {
  it("is the same things under other names", () => {
    expect(openai({ type: "session.started", session: { id: "live_1" } })).toEqual({
      type: "started",
    })
    expect(
      openai({
        type: "session.input_transcript.delta",
        start_ms: 7400,
        end_ms: 7600,
        delta: " Hello",
      }),
    ).toEqual({ type: "words", who: "you", text: " Hello" })
    expect(openai({ type: "session.output_transcript.delta", delta: " I hear" })).toEqual({
      type: "words",
      who: "dood",
      text: " I hear",
    })
    // The request is not given in words: it is what the person said last.
    expect(
      openai({
        type: "session.delegation.created",
        offset_ms: 35000,
        delegation: { id: "item_3", type: "delegation", target: "client" },
      }),
    ).toEqual({ type: "handOn", id: "item_3" })
    expect(openai({ type: "session.closed", reason: "close_requested" })).toEqual({
      type: "closed",
    })
    // The other kind's names mean nothing here.
    expect(openai({ type: "input_transcript.added", item: { text: "x" } })).toBeNull()
    expect(openai({ type: "session.commentary.appended" })).toBeNull()
  })
})

describe("what the app says back", () => {
  it("answers a hand-off on a ChatGPT sign-in, in pieces that fit", () => {
    const [answer] = voiceReply("codex", "item_9", "There are 42 files.", "answer")
    expect(JSON.parse(answer!)).toEqual({
      type: "delegation.context.append",
      delegation_item_id: "item_9",
      channel: "speakable",
      content: [{ type: "input_text", text: "There are 42 files." }],
    })
    const [progress] = voiceReply("codex", "item_9", "Running a command", "progress")
    expect(JSON.parse(progress!).channel).toBe("commentary")
    const long = voiceReply("codex", "item_9", "One sentence here. ".repeat(60), "answer")
    expect(long.length).toBeGreaterThan(1)
    for (const piece of long) {
      const text = (JSON.parse(piece) as { content: { text: string }[] }).content[0]!.text
      expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(480)
      // Each piece ends where a sentence does.
      expect(text.endsWith(".")).toBe(true)
    }
  })

  it("answers one on an OpenAI key, once, cut short where it is too long", () => {
    const sent = voiceReply("openai", "item_3", "Friday.", "answer")
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]!)).toMatchObject({
      type: "session.commentary.append",
      delegation_id: "item_3",
      content: "Friday.",
    })
    expect(JSON.parse(voiceReply("openai", "item_3", "Reading", "progress")[0]!).type).toBe(
      "session.thinking.append",
    )
    const long = JSON.parse(voiceReply("openai", "item_3", "x".repeat(5_000), "answer")[0]!) as {
      content: string
      event_id: string
    }
    expect(long.content).toHaveLength(1_800)
    expect(long.content.endsWith("…")).toBe(true)
    // Each has an id of its own.
    expect(long.event_id).not.toBe(JSON.parse(sent[0]!).event_id)
  })

  it("cuts by bytes, and gives up after a few pieces", () => {
    expect(pieces("Short.")).toEqual(["Short."])
    expect(pieces("")).toEqual([])
    const wide = pieces("é".repeat(1_000), 100)
    expect(wide).toHaveLength(4)
    for (const piece of wide)
      expect(new TextEncoder().encode(piece).length).toBeLessThanOrEqual(100)
    expect(pieces("word ".repeat(400), 50, 2)).toHaveLength(2)
  })

  it("hangs up the same way on both", () => {
    expect(JSON.parse(voiceClose())).toEqual({ type: "session.close" })
  })
})

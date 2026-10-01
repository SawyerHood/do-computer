import { describe, expect, it } from "vitest"
import {
  type ChatEvent,
  type ChatMessage,
  type ChatState,
  diffChat,
  EMPTY_CHAT,
  encodeSse,
  readSse,
  reduceChat,
} from "../src/index.ts"

const user = (id: string, text: string): ChatMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
  status: "done",
})

const assistant = (
  id: string,
  parts: ChatMessage["parts"],
  status: ChatMessage["status"] = "done",
): ChatMessage => ({ id, role: "assistant", parts, status })

/** A run as the server sees it, commit by commit. */
const run: ChatState[] = [
  EMPTY_CHAT,
  { ...EMPTY_CHAT, busy: true, messages: [user("1", "list files")] },
  {
    ...EMPTY_CHAT,
    busy: true,
    messages: [
      user("1", "list files"),
      assistant("live:1", [{ type: "thinking", text: "I" }], "streaming"),
    ],
  },
  {
    ...EMPTY_CHAT,
    busy: true,
    messages: [
      user("1", "list files"),
      assistant(
        "live:1",
        [
          { type: "thinking", text: "I should look" },
          { type: "text", text: "Let me" },
        ],
        "streaming",
      ),
    ],
  },
  {
    ...EMPTY_CHAT,
    busy: true,
    messages: [
      user("1", "list files"),
      assistant(
        "live:1",
        [
          { type: "thinking", text: "I should look" },
          { type: "text", text: "Let me check." },
          {
            type: "tool",
            toolCallId: "t1",
            name: "bash",
            args: { command: "ls" },
            status: "pending",
          },
        ],
        "streaming",
      ),
    ],
  },
  {
    ...EMPTY_CHAT,
    busy: true,
    usage: { inputTokens: 10, outputTokens: 5, cost: 0.001 },
    messages: [
      user("1", "list files"),
      assistant("2", [
        { type: "thinking", text: "I should look" },
        { type: "text", text: "Let me check." },
        {
          type: "tool",
          toolCallId: "t1",
          name: "bash",
          args: { command: "ls" },
          status: "running",
        },
      ]),
    ],
  },
  {
    ...EMPTY_CHAT,
    busy: true,
    queued: [{ id: "9", mode: "steer", text: "also hidden ones" }],
    usage: { inputTokens: 10, outputTokens: 5, cost: 0.001 },
    messages: [
      user("1", "list files"),
      assistant("2", [
        { type: "thinking", text: "I should look" },
        { type: "text", text: "Let me check." },
        {
          type: "tool",
          toolCallId: "t1",
          name: "bash",
          args: { command: "ls" },
          status: "running",
          output: "a.txt\n",
        },
      ]),
    ],
  },
  {
    ...EMPTY_CHAT,
    busy: true,
    usage: { inputTokens: 10, outputTokens: 5, cost: 0.001 },
    messages: [
      user("1", "list files"),
      assistant("2", [
        { type: "thinking", text: "I should look" },
        { type: "text", text: "Let me check." },
        {
          type: "tool",
          toolCallId: "t1",
          name: "bash",
          args: { command: "ls" },
          status: "done",
          output: "a.txt\nb.txt\n",
          details: { exitCode: 0 },
        },
      ]),
      user("4", "also hidden ones"),
      assistant("live:4", [{ type: "text", text: "Sure" }], "streaming"),
    ],
  },
  {
    ...EMPTY_CHAT,
    busy: false,
    usage: { inputTokens: 30, outputTokens: 9, cost: 0.002 },
    messages: [
      user("1", "list files"),
      assistant("2", [
        { type: "thinking", text: "I should look" },
        { type: "text", text: "Let me check." },
        {
          type: "tool",
          toolCallId: "t1",
          name: "bash",
          args: { command: "ls" },
          status: "done",
          output: "a.txt\nb.txt\n",
          details: { exitCode: 0 },
        },
      ]),
      user("4", "also hidden ones"),
      assistant("5", [{ type: "text", text: "Sure, there are none." }]),
    ],
  },
]

describe("diffChat and reduceChat", () => {
  it("reproduce every step of a run, without snapshots", () => {
    let client = run[0]!
    for (let step = 1; step < run.length; step++) {
      const events = diffChat(run[step - 1]!, run[step]!)
      expect(events.some((event) => event.type === "snapshot")).toBe(false)
      client = events.reduce(reduceChat, client)
      expect(client).toEqual(run[step])
    }
  })

  it("reproduce any jump between steps, as a slow client sees them", () => {
    for (let from = 0; from < run.length; from++) {
      for (let to = 0; to < run.length; to++) {
        const result = diffChat(run[from]!, run[to]!).reduce(reduceChat, run[from]!)
        expect(result).toEqual(run[to])
      }
    }
  })

  it("streams text as deltas and tool output as appends", () => {
    expect(diffChat(run[2]!, run[3]!)).toEqual([
      { type: "delta", messageId: "live:1", index: 0, text: " should look" },
      { type: "part", messageId: "live:1", index: 1, part: { type: "text", text: "Let me" } },
    ])
    expect(diffChat(run[5]!, run[6]!)).toEqual([
      { type: "tool", toolCallId: "t1", output: { append: "a.txt\n" } },
      { type: "queued", queued: [{ id: "9", mode: "steer", text: "also hidden ones" }] },
    ])
  })

  it("replaces a live message with its final entry", () => {
    const events = diffChat(run[4]!, run[5]!)
    expect(events[0]).toMatchObject({ type: "message", replaces: "live:1", message: { id: "2" } })
  })

  it("sends a snapshot when messages disappear", () => {
    const after: ChatState = { ...run[8]!, messages: run[8]!.messages.slice(3) }
    expect(diffChat(run[8]!, after)).toEqual([{ type: "snapshot", state: after }])
  })

  it("does not mutate the state it reduces", () => {
    const before = structuredClone(run[6]!)
    diffChat(run[6]!, run[7]!).reduce(reduceChat, run[6]!)
    expect(run[6]).toEqual(before)
  })

  it("ignores an event for a message it does not have", () => {
    const event: ChatEvent = { type: "delta", messageId: "missing", index: 0, text: "x" }
    expect(reduceChat(run[1]!, event)).toBe(run[1])
  })
})

describe("server-sent events", () => {
  it("round-trips values across arbitrary chunk boundaries", async () => {
    const values = [{ a: 1 }, { text: "line\nbreak — ünïcode" }, [1, 2, 3]]
    const bytes = Uint8Array.from(values.flatMap((value) => [...encodeSse(value)]))
    for (const size of [1, 3, 7, bytes.length]) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(": keep-alive\n\n"))
          for (let offset = 0; offset < bytes.length; offset += size) {
            controller.enqueue(bytes.slice(offset, offset + size))
          }
          controller.close()
        },
      })
      const received: unknown[] = []
      for await (const value of readSse(body)) received.push(value)
      expect(received).toEqual(values)
    }
  })
})

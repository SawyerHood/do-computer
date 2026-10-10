import {
  type ApprovalRequest,
  type ChatMessage,
  type ChatState,
  type ChatSummary,
  EMPTY_CHAT,
} from "@durable-computer/protocol"
import { describe, expect, it } from "vitest"
import {
  chatsToFollow,
  excerpt,
  type FollowedChat,
  petEnding,
  petEndings,
  petMemory,
  petNow,
} from "./pet.ts"

const NOW = 10_000_000

const summary = (id: string, rest: Partial<ChatSummary> = {}): ChatSummary => ({
  id,
  title: `Chat ${id}`,
  kind: "chat",
  createdAt: 0,
  updatedAt: NOW,
  archived: false,
  ...rest,
})

const answer = (rest: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m",
  role: "assistant",
  parts: [],
  status: "done",
  ...rest,
})

const chat = (messages: ChatMessage[], busy = false): ChatState => ({
  ...EMPTY_CHAT,
  messages,
  busy,
})

const followed = (chat: ChatSummary, state: ChatState, loaded = true): FollowedChat => ({
  chat,
  state,
  loaded,
})

describe("the chats a companion follows", () => {
  it("are the main one, then the few last written in", () => {
    const chats = [
      summary("1", { updatedAt: NOW - 5_000 }),
      summary("2", { main: true, updatedAt: 0 }),
      summary("3", { updatedAt: NOW - 1_000 }),
      summary("4", { updatedAt: NOW - 2 * 60 * 60_000 }),
      summary("5", { updatedAt: NOW - 2_000, archived: true }),
      summary("6", { updatedAt: NOW - 3_000, kind: "schedule" }),
      summary("7", { updatedAt: NOW - 4_000 }),
      summary("8", { updatedAt: NOW - 6_000 }),
    ]
    expect(chatsToFollow(chats, NOW).map((entry) => entry.id)).toEqual(["2", "3", "6", "7"])
    expect(chatsToFollow([], NOW)).toEqual([])
  })
})

describe("what a companion says", () => {
  const main = summary("1", { main: true })
  const side = summary("2", { title: "Deploy check" })
  const running: ChatMessage = answer({
    status: "streaming",
    parts: [
      {
        type: "tool",
        toolCallId: "t",
        name: "bash",
        args: { command: "pnpm test" },
        status: "running",
        output: "",
      },
    ],
  })

  it("is nothing while the agent has nothing to do", () => {
    expect(petNow([followed(main, chat([]))], [])).toEqual({ mood: { state: "idle" } })
    // A chat that has not been heard from yet is not known to be at work.
    expect(petNow([followed(main, chat([], true), false)], [])).toEqual({
      mood: { state: "idle" },
    })
  })

  it("is what the agent is doing, and where when that is not its main chat", () => {
    expect(petNow([followed(main, chat([running], true))], [])).toEqual({
      mood: { state: "working", variant: "command" },
      saying: { kind: "working", text: "Running: pnpm test", chatId: "1" },
    })
    expect(
      petNow([followed(main, chat([])), followed(side, chat([running], true))], []).saying,
    ).toEqual({ kind: "working", text: "Running: pnpm test", chatId: "2", where: "Deploy check" })
    // Its answer being written says nothing of itself in the chat. Here it is said.
    const writing = answer({ status: "streaming", parts: [{ type: "text", text: "Here" }] })
    expect(petNow([followed(main, chat([writing], true))], [])).toEqual({
      mood: { state: "speaking" },
      saying: { kind: "working", text: "Writing its answer", chatId: "1" },
    })
  })

  it("is that it needs an OK, before anything it is doing", () => {
    const asked: ApprovalRequest = {
      id: "a",
      chatId: "2",
      chatTitle: "Deploy check",
      chatKind: "chat",
      title: "Run commands on studio-mac",
      detail: "rm -rf build",
      createdAt: NOW,
    }
    expect(petNow([followed(main, chat([running], true))], [asked])).toEqual({
      mood: { state: "waiting" },
      saying: {
        kind: "waiting",
        text: "Run commands on studio-mac",
        chatId: "2",
        where: "Deploy check",
      },
    })
    expect(petNow([followed(main, chat([]))], [{ ...asked, chatId: "1" }]).saying).toEqual({
      kind: "waiting",
      text: "Run commands on studio-mac",
      chatId: "1",
    })
  })

  it("is the start of the answer once a run has ended, or what went wrong", () => {
    const done = answer({
      parts: [
        { type: "text", text: "Looking." },
        { type: "text", text: "## Result\n\nThe **tests** pass: see [the log](https://x.test)." },
      ],
    })
    expect(petEnding(main, chat([done]))).toEqual({
      kind: "done",
      text: "Result The tests pass: see the log.",
      chatId: "1",
    })
    expect(petEnding(side, chat([answer()]))).toEqual({
      kind: "done",
      text: "Finished.",
      chatId: "2",
      where: "Deploy check",
    })
    const failed = answer({ status: "error", error: "429 rate limit exceeded" })
    expect(petEnding(main, chat([failed]))).toEqual({
      kind: "error",
      text: "Too many requests to the model.",
      chatId: "1",
    })
    // A run its owner stopped is theirs to know of already.
    expect(petEnding(main, chat([answer({ status: "aborted" })]))).toBeUndefined()
    expect(petEnding(main, chat([]))).toBeUndefined()
  })

  it("says a run's ending once, when a chat that was at work no longer is", () => {
    const memory = petMemory(NOW)
    // The chat was last written in before the companion came, and is at work as it comes.
    const old = summary("1", { main: true, updatedAt: NOW - 60_000 })
    const done = answer({ id: "a1", parts: [{ type: "text", text: "All done." }] })
    expect(petEndings([followed(old, chat([running], true))], memory)).toBeUndefined()
    expect(petEndings([followed(old, chat([done]))], memory)).toEqual({
      kind: "done",
      text: "All done.",
      chatId: "1",
    })
    expect(petEndings([followed(old, chat([done]))], memory)).toBeUndefined()
  })

  it("says nothing of what was over before it came", () => {
    const memory = petMemory(NOW)
    const old = summary("1", { main: true, updatedAt: NOW - 60_000 })
    const done = answer({ id: "a1", parts: [{ type: "text", text: "Long ago." }] })
    expect(petEndings([followed(old, chat([done]))], memory)).toBeUndefined()
    expect(petEndings([followed(old, chat([done]))], memory)).toBeUndefined()
  })

  it("says the ending of a run that was over before its chat was heard from", () => {
    const memory = petMemory(NOW)
    const done = answer({ id: "a1", parts: [{ type: "text", text: "That was quick." }] })
    // The chat says what was written before the list of chats says that it was written in.
    const stale = summary("2", { title: "Side", updatedAt: NOW - 60_000 })
    expect(petEndings([followed(stale, chat([done]))], memory)).toBeUndefined()
    const fresh = { ...stale, updatedAt: NOW + 1_000 }
    expect(petEndings([followed(fresh, chat([done]))], memory)).toEqual({
      kind: "done",
      text: "That was quick.",
      chatId: "2",
      where: "Side",
    })
    expect(petEndings([followed(fresh, chat([done]))], memory)).toBeUndefined()
    // What its owner wrote is no ending, and the answer to it is the next one.
    const asked: ChatMessage = { id: "u2", role: "user", parts: [], status: "done" }
    expect(petEndings([followed(fresh, chat([done, asked]))], memory)).toBeUndefined()
    const next = answer({ id: "a2", parts: [{ type: "text", text: "And again." }] })
    expect(petEndings([followed(fresh, chat([done, asked, next]))], memory)?.text).toBe(
      "And again.",
    )
    // A chat that has not been heard from says nothing.
    expect(petEndings([followed(fresh, chat([next]), false)], petMemory(NOW))).toBeUndefined()
  })

  it("is one plain line, cut at a word", () => {
    expect(excerpt("```js\nlet a = 1\n```\n- one\n- `two`")).toBe("one two")
    expect(excerpt("Set _both_ of __MY_API_KEY__ and `other_key`.")).toBe(
      "Set both of MY_API_KEY and other_key.",
    )
    const long = excerpt("word ".repeat(80), 40)
    expect(long.length).toBeLessThanOrEqual(40)
    expect(long.endsWith("…")).toBe(true)
    expect(long).not.toContain("  ")
  })
})

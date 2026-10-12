import type { ChatMessage, ChatState, ChatSummary } from "@do-computer/protocol"
import { EMPTY_CHAT } from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import {
  ago,
  GIVE_UP_MS,
  mainChatOf,
  mainChatsFrom,
  names,
  type Sending,
  sideChatsOf,
  subagentsOf,
  whoIs,
  withSending,
} from "../src/chat/chats.ts"

const chat = (id: string, more: Partial<ChatSummary> = {}): ChatSummary => ({
  id,
  title: id,
  kind: "chat",
  createdAt: 1,
  updatedAt: 1,
  archived: false,
  ...more,
})

const said = (id: string, text: string, role: ChatMessage["role"] = "user"): ChatMessage => ({
  id,
  role,
  parts: [{ type: "text", text }],
  status: "done",
})

const state = (messages: ChatMessage[], more: Partial<ChatState> = {}): ChatState => ({
  ...EMPTY_CHAT,
  messages,
  ...more,
})

describe("an agent's chats", () => {
  const chats = [
    chat("main", { main: true }),
    chat("old", { updatedAt: 5 }),
    chat("new", { updatedAt: 9 }),
    chat("away", { archived: true }),
    chat("run", { kind: "schedule" }),
    chat("sub-b", { kind: "subagent", parentId: "main", createdAt: 3 }),
    chat("sub-a", { kind: "subagent", parentId: "main", createdAt: 2 }),
    chat("sub-c", { kind: "subagent", parentId: "new" }),
  ]

  it("has one main chat, and side chats that are neither it nor put away, the latest first", () => {
    expect(mainChatOf(chats)?.id).toBe("main")
    expect(sideChatsOf(chats).map((each) => each.id)).toEqual(["new", "old"])
    expect(sideChatsOf(undefined)).toEqual([])
  })

  it("lists the sub-agents started in one chat, oldest first", () => {
    expect(subagentsOf(chats, "main").map((each) => each.id)).toEqual(["sub-a", "sub-b"])
  })

  it("reads which chat is each agent's main one from what was kept, whatever was kept", () => {
    expect(mainChatsFrom('{"a":"1","b":2}')).toEqual({ a: "1" })
    expect(mainChatsFrom("not json")).toEqual({})
    expect(mainChatsFrom(null)).toEqual({})
  })
})

describe("words", () => {
  it("names people by their first names", () => {
    expect(names([{ name: "Maya Lin" }])).toBe("Maya")
    expect(names([{ name: "Maya" }, { name: "Jon" }, { name: "Priya" }])).toBe(
      "Maya, Jon and Priya",
    )
  })

  it("says how long ago shortly", () => {
    const now = 100 * 86_400_000
    expect(ago(now - 5_000, now)).toBe("now")
    expect(ago(now - 5 * 60_000, now)).toBe("5m")
    expect(ago(now - 3 * 3_600_000, now)).toBe("3h")
    expect(ago(now - 2 * 86_400_000, now)).toBe("2d")
    expect(ago(now - 15 * 86_400_000, now)).toBe("2w")
  })

  it("finds each person once", () => {
    const here = [
      { userId: "u1", agentId: "a", chatId: "1", typing: true },
      { userId: "u1", agentId: "a", chatId: "1", typing: false },
      { userId: "u2", agentId: "a", chatId: "2", typing: true },
    ]
    expect(whoIs(here, (place) => place.chatId === "1")).toEqual(["u1"])
  })
})

describe("a message on its way", () => {
  const sending = (text: string, more: Partial<Sending> = {}): Sending => ({
    id: `s-${text}`,
    text,
    at: 10,
    known: new Set(["m1"]),
    ...more,
  })

  it("is shown after the chat's own, with the agent at work on it", () => {
    const sends = [sending("hello")]
    const shown = withSending(state([said("m1", "hello")]), sends, 20)
    expect(shown.state.messages.map((message) => message.id)).toEqual(["m1", "s-hello"])
    expect(shown.state.busy).toBe(true)
    expect(shown.left).toBe(sends)
  })

  it("is over once the chat has a new message of the user's that says the same", () => {
    const live = state([said("m1", "hello"), said("m2", "hello")])
    const shown = withSending(live, [sending("hello")], 20)
    expect(shown.state).toBe(live)
    expect(shown.left).toEqual([])
  })

  it("is over once it is waiting in the chat's queue", () => {
    const live = state([], { busy: true, queued: [{ id: "q1", mode: "steer", text: "hello" }] })
    expect(withSending(live, [sending("hello")], 20).left).toEqual([])
  })

  it("is not taken for an answer that says the same, or for two sends at once", () => {
    const live = state([said("m2", "hello", "assistant"), said("m3", "hello")])
    const shown = withSending(live, [sending("hello"), sending("hello", { id: "second" })], 20)
    expect(shown.left.map((send) => send.id)).toEqual(["second"])
  })

  it("is given up on when the server took it and the chat never showed it", () => {
    const sends = [sending("hello", { acceptedAt: 100 })]
    expect(withSending(state([]), sends, 100 + GIVE_UP_MS - 1).left).toBe(sends)
    expect(withSending(state([]), sends, 100 + GIVE_UP_MS).left).toEqual([])
  })
})

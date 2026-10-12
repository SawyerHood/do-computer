import { type ChatMessage, type ChatState, EMPTY_CHAT } from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import { GIVE_UP_MS, type Sending, settleSends } from "./sending.ts"

const said = (id: string, text: string, role: ChatMessage["role"] = "user"): ChatMessage => ({
  id,
  role,
  parts: [{ type: "text", text }],
  status: "done",
})

const chat = (messages: ChatMessage[], rest: Partial<ChatState> = {}): ChatState => ({
  ...EMPTY_CHAT,
  messages,
  ...rest,
})

const send = (id: string, text: string, rest: Partial<Sending> = {}): Sending => ({
  id,
  text,
  images: [],
  at: 1_000,
  waiting: false,
  known: new Set(),
  ...rest,
})

describe("settleSends", () => {
  it("shows a message after the chat's own until the chat has it", () => {
    const sending = [send("a", "hello")]
    const before = settleSends(sending, chat([said("1", "earlier")]), 1_000, true)
    expect(before.sending).toBe(sending)
    expect(before.messages.map((message) => message.id)).toEqual(["sending:a"])

    const after = settleSends(
      sending,
      chat([said("1", "earlier"), said("2", "hello")]),
      1_000,
      true,
    )
    expect(after.sending).toEqual([])
    expect(after.messages).toEqual([])
    // Which of the chat's messages took its place, for whoever is waiting on the answer to it.
    expect(after.arrived).toEqual(["2"])
  })

  it("does not take a message that was already there for the one being sent", () => {
    const sending = [send("a", "ok", { known: new Set(["1"]) })]
    const settled = settleSends(sending, chat([said("1", "ok")]), 1_000, true)
    expect(settled.sending).toBe(sending)
    expect(settled.messages).toHaveLength(1)
  })

  it("gives each of two messages with the same words a copy of its own", () => {
    const sending = [send("a", "ok"), send("b", "ok")]
    const one = settleSends(sending, chat([said("1", "ok")]), 1_000, true)
    expect(one.sending.map((entry) => entry.id)).toEqual(["b"])
    expect(one.messages.map((message) => message.id)).toEqual(["sending:b"])
    const both = settleSends(sending, chat([said("1", "ok"), said("2", "ok")]), 1_000, true)
    expect(both.sending).toEqual([])
  })

  it("does not take another agent's message, or the agent's answer, for it", () => {
    const sending = [send("a", "hello")]
    const from = { ...said("1", "hello"), agent: { id: "x", name: "Wren" } }
    const settled = settleSends(sending, chat([from, said("2", "hello", "assistant")]), 1_000, true)
    expect(settled.sending).toBe(sending)
  })

  it("carries its pictures, after its words", () => {
    const image = { mimeType: "image/png", data: "AAAA" }
    const settled = settleSends([send("a", "look", { images: [image] })], chat([]), 1_000, true)
    expect(settled.messages[0]!.parts).toEqual([
      { type: "text", text: "look" },
      { type: "image", ...image },
    ])
  })

  it("stands for the chat's own waiting input while that is in the queue", () => {
    const sending = [send("a", "hello", { submissionId: "7", acceptedAt: 1_000 })]
    const queued = [{ id: "7", mode: "steer" as const, text: "hello" }]
    const settled = settleSends(sending, chat([], { queued }), 1_000, true)
    // Shown once, as the message, and not also as waiting.
    expect(settled.messages).toHaveLength(1)
    expect(settled.queued).toEqual([])
    expect(settled.sending[0]!.queued).toBe(true)
    // Taken up: still shown until the chat's copy is here, so it is never gone in between.
    const taken = settleSends(settled.sending, chat([]), 1_000, true)
    expect(taken.messages).toHaveLength(1)
  })

  it("sent while the agent is at work, it waits with what else is waiting", () => {
    const sending = [send("a", "also this", { waiting: true })]
    const mine = { id: "sending:a", mode: "steer" as const, text: "also this" }
    const first = settleSends(sending, chat([], { busy: true }), 1_000, true)
    expect(first.messages).toEqual([])
    expect(first.queued).toEqual([mine])

    // The chat's own waiting input takes its place, matched by its words before the server
    // has said what it calls it.
    const queued = [{ id: "7", mode: "steer" as const, text: "also this" }]
    const second = settleSends(sending, chat([], { busy: true, queued }), 1_000, true)
    expect(second.queued).toEqual(queued)
    expect(second.sending[0]!.queued).toBe(true)

    // Gone from the queue: it is the chat's to show from here, as a message or not at all.
    const third = settleSends(second.sending, chat([], { busy: true }), 1_000, true)
    expect(third.sending).toEqual([])
    expect(third.queued).toEqual([])
  })

  it("gives up on a message the server took and the chat never showed", () => {
    const sending = [send("a", "hello", { submissionId: "7", acceptedAt: 1_000 })]
    const late = 1_000 + GIVE_UP_MS + 1
    expect(settleSends(sending, chat([]), late, true).sending).toEqual([])
    // Not while the chat is not being heard from: it may well have it.
    expect(settleSends(sending, chat([]), late, false).sending).toBe(sending)
    // And not one whose request is still on its way.
    const unsent = [send("a", "hello")]
    expect(settleSends(unsent, chat([]), late, true).sending).toBe(unsent)
  })

  it("leaves the chat's queue as it is when nothing is being sent", () => {
    const state = chat([], { queued: [{ id: "7", mode: "steer", text: "x" }] })
    expect(settleSends([], state, 1_000, true).queued).toBe(state.queued)
  })
})

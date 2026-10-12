import type { ConversationView } from "@earendil-works/pi-durable"
import { describe, expect, it } from "vitest"
import { projectChat } from "../src/project.ts"

/** A chat with nothing said in it, and these inputs waiting for the agent. */
const waiting = (items: unknown[]) =>
  ({
    conversation: {},
    entries: [],
    docs: { "pi.inbox": { items } },
  }) as unknown as ConversationView

describe("what waits for the agent", () => {
  it("shows a person's message, without what the server added to it", () => {
    const state = projectChat(
      waiting([
        {
          id: 4,
          mode: "steer",
          content: [
            { type: "text", text: "and the tests too" },
            { type: "text", text: '<meta kind="sent">Monday 09:00</meta>' },
          ],
        },
        { id: 5, mode: "followUp", content: "then deploy it" },
      ]),
    )
    expect(state.queued).toEqual([
      { id: "4", mode: "steer", text: "and the tests too" },
      { id: "5", mode: "followUp", text: "then deploy it" },
    ])
  })

  it("leaves out what the server tells the agent to set it going again", () => {
    const state = projectChat(
      waiting([
        {
          id: 7,
          mode: "followUp",
          content: [{ type: "text", text: '<meta kind="command">A command has ended.</meta>' }],
        },
        { id: 8, mode: "write", content: [] },
      ]),
    )
    expect(state.queued).toEqual([])
  })
})

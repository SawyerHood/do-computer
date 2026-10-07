import { describe, expect, it } from "vitest"
import {
  type ChatMessage,
  chatRuns,
  type ChatState,
  EMPTY_CHAT,
  type MessagePart,
  type ToolPart,
} from "../src/index.ts"

const tool = (name: string, args: Record<string, unknown>, status: ToolPart["status"] = "done") =>
  ({ type: "tool", toolCallId: `${name}-${JSON.stringify(args)}`, name, args, status }) as ToolPart
const user = (id: string, text: string, createdAt?: number): ChatMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
  status: "done",
  ...(createdAt === undefined ? {} : { createdAt }),
})
const assistant = (
  id: string,
  parts: MessagePart[],
  status: ChatMessage["status"] = "done",
): ChatMessage => ({ id, role: "assistant", parts, status })
const chat = (messages: ChatMessage[], busy = false): ChatState => ({
  ...EMPTY_CHAT,
  messages,
  busy,
})

const log = (title: string, outcome: string, status: ToolPart["status"] = "done") =>
  tool("log", { title, outcome }, status)

describe("chatRuns", () => {
  it("is one run for each thing asked that the agent wrote an entry for, with its other steps", () => {
    const runs = chatRuns(
      chat([
        user("1", "What changed in the repo?", 1_000),
        assistant("2", [tool("bash", { command: "git log" })]),
        assistant("3", [
          tool("read", { path: "CHANGELOG.md" }),
          { type: "text", text: "Two fixes landed." },
        ]),
        user("4", "Thanks, now tidy the notes", 2_000),
        assistant("5", [
          tool("edit", { path: "notes.md" }),
          log("Tidy the notes.", "Sorted the notes into three folders."),
        ]),
        assistant("6", [{ type: "text", text: "Tidied." }]),
      ]),
    )
    expect(runs).toEqual([
      {
        id: "4",
        entry: { title: "Tidy the notes", outcome: "Sorted the notes into three folders." },
        steps: [tool("edit", { path: "notes.md" })],
        status: "done",
        at: 2_000,
      },
    ])
  })

  it("leaves out work with no entry, and a reply that was only words", () => {
    expect(
      chatRuns(
        chat([
          user("1", "hi"),
          assistant("2", [{ type: "text", text: "Hello." }]),
          user("3", "what time is it?"),
          assistant("4", [tool("bash", { command: "date" }), { type: "text", text: "Noon." }]),
        ]),
      ),
    ).toEqual([])
    expect(chatRuns(EMPTY_CHAT)).toEqual([])
  })

  it("takes the last entry written, and none from a call that failed or is still arriving", () => {
    const twice = chatRuns(
      chat([
        user("1", "set it up"),
        assistant("2", [log("Set up backups", "Started on the script.")]),
        assistant("3", [log("Set up backups", "Backups now run nightly.")]),
      ]),
    )
    expect(twice.map((run) => run.entry.outcome)).toEqual(["Backups now run nightly."])
    expect(twice[0]!.steps).toEqual([])
    expect(
      chatRuns(
        chat([
          user("1", "set it up"),
          assistant("2", [log("Set up backups", "", "error"), log("Set up", "Half", "running")]),
        ]),
      ),
    ).toEqual([])
  })

  it("knows a run that is still going, one that failed and one that was stopped", () => {
    const entry = log("Build it", "Built the site.")
    const working = chatRuns(
      chat(
        [
          user("1", "build it"),
          assistant("live:1", [entry, tool("bash", {}, "running")], "streaming"),
        ],
        true,
      ),
    )
    expect(working[0]!.status).toBe("working")
    const failed = chatRuns(
      chat([user("1", "build it"), assistant("2", [entry, tool("bash", {}, "error")], "error")]),
    )
    expect(failed[0]!.status).toBe("failed")
    const stopped = chatRuns(
      chat([user("1", "build it"), assistant("2", [entry, tool("bash", {})], "aborted")]),
    )
    expect(stopped[0]!.status).toBe("stopped")
  })

  it("starts a run at a scheduled task's heading", () => {
    const runs = chatRuns(
      chat([
        {
          id: "1",
          role: "notice",
          parts: [{ type: "notice", kind: "schedule", text: "Morning digest" }],
          status: "done",
        },
        assistant("2", [
          tool("web_search", { query: "news" }),
          log("Write the morning digest", "Sent five stories."),
          { type: "text", text: "Here." },
        ]),
      ]),
    )
    expect(runs).toMatchObject([{ id: "1", status: "done", steps: [{ name: "web_search" }] }])
  })
})

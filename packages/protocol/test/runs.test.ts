import { describe, expect, it } from "vitest"
import {
  type ChatMessage,
  chatRuns,
  type ChatState,
  EMPTY_CHAT,
  type MessagePart,
  runSummary,
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

describe("chatRuns", () => {
  it("is one run for each thing asked, with the steps taken and what was said back", () => {
    const runs = chatRuns(
      chat([
        user("1", "What changed in the repo?", 1_000),
        assistant("2", [tool("bash", { command: "git log" })]),
        assistant("3", [
          tool("read", { path: "CHANGELOG.md" }),
          { type: "text", text: "Two fixes landed." },
        ]),
        user("4", "Thanks, now tidy the notes"),
        assistant("5", [tool("edit", { path: "notes.md" }), { type: "text", text: "Tidied." }]),
      ]),
    )
    expect(
      runs.map((run) => [run.id, run.asked, run.steps.length, run.answer, run.status]),
    ).toEqual([
      ["1", "What changed in the repo?", 2, "Two fixes landed.", "done"],
      ["4", "Thanks, now tidy the notes", 1, "Tidied.", "done"],
    ])
    expect(runs[0]!.at).toBe(1_000)
  })

  it("leaves out a reply that was only words", () => {
    expect(
      chatRuns(chat([user("1", "hi"), assistant("2", [{ type: "text", text: "Hello." }])])),
    ).toEqual([])
    expect(chatRuns(EMPTY_CHAT)).toEqual([])
  })

  it("knows a run that is still going, one that failed and one that was stopped", () => {
    const working = chatRuns(
      chat(
        [user("1", "build it"), assistant("live:1", [tool("bash", {}, "running")], "streaming")],
        true,
      ),
    )
    expect(working[0]!.status).toBe("working")
    const failed = chatRuns(
      chat([user("1", "build it"), assistant("2", [tool("bash", {}, "error")], "error")]),
    )
    expect(failed[0]!.status).toBe("failed")
    const stopped = chatRuns(
      chat([user("1", "build it"), assistant("2", [tool("bash", {})], "aborted")]),
    )
    expect(stopped[0]!.status).toBe("stopped")
  })

  it("starts a run at a scheduled task's heading, named by the task", () => {
    const runs = chatRuns(
      chat([
        {
          id: "1",
          role: "notice",
          parts: [{ type: "notice", kind: "schedule", text: "Morning digest" }],
          status: "done",
        },
        assistant("2", [tool("web_search", { query: "news" }), { type: "text", text: "Here." }]),
      ]),
    )
    expect(runs).toMatchObject([{ id: "1", asked: "Morning digest", status: "done" }])
  })
})

describe("runSummary", () => {
  const run = (over: Partial<ReturnType<typeof chatRuns>[number]>) => ({
    id: "1",
    asked: "Find out why the build is failing and fix it, then tell me what it was in detail",
    steps: [tool("bash", { command: "pnpm build" }), tool("edit", { path: "tsconfig.json" })],
    answer: "**Fixed.** The config pointed at a folder that had moved. It builds now.",
    status: "done" as const,
    ...over,
  })

  it("is titled by what was asked, cut to a line, and says how the answer opens", () => {
    expect(runSummary(run({}))).toEqual({
      title: "Find out why the build is…",
      outcome: "Fixed.",
    })
    expect(runSummary(run({ answer: "" })).outcome).toBe("Done in 2 steps.")
  })

  it("says what it is doing while it works, and how it ended when it did not finish", () => {
    expect(runSummary(run({ status: "working" })).outcome).toBe("Editing tsconfig.json")
    expect(runSummary(run({ status: "failed" })).outcome).toBe("Did not finish, after 2 steps.")
    expect(runSummary(run({ status: "stopped", steps: [tool("bash", {})] })).outcome).toBe(
      "Stopped after 1 step.",
    )
  })
})

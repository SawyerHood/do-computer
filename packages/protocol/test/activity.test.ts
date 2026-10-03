import { describe, expect, it } from "vitest"
import {
  type ChatMessage,
  type ChatState,
  chatActivity,
  chatMood,
  EMPTY_CHAT,
  type MessagePart,
  toolActivity,
  toolKind,
  type ToolPart,
  toolSummary,
} from "../src/index.ts"

const tool = (
  name: string,
  args: Record<string, unknown>,
  status: ToolPart["status"] = "running",
) => ({ type: "tool", toolCallId: `${name}-1`, name, args, status }) as ToolPart

describe("toolActivity", () => {
  it.each([
    [tool("bash", { command: "git status" }), "Running: git status"],
    [tool("bash", { command: "pnpm test\necho done" }), "Running: pnpm test"],
    [tool("bash", {}), "Running a command"],
    [tool("bash", { command: "ls", computer: "laptop" }), "Running on laptop: ls"],
    [tool("read", { path: "notes/todo.md" }), "Reading todo.md"],
    [tool("write", { path: "/workspace/plan.md", content: "x" }), "Writing plan.md"],
    [tool("edit", { path: "plan.md", computer: "studio" }), "Editing plan.md on studio"],
    [tool("web_search", { query: "latest Node LTS" }), "Searching the web: latest Node LTS"],
    [tool("send_file", { path: "out/report.pdf" }), "Sending you report.pdf"],
    [tool("schedule", { action: "create", title: "Stretch" }), "Scheduling: Stretch"],
    [tool("schedule", { action: "list" }), "Checking its schedule"],
    [
      tool("skill", { action: "view", name: "browsing-the-web" }),
      "Reading its browsing-the-web skill",
    ],
    [tool("memory", { action: "add" }), "Updating its memory"],
    [
      tool("history", { action: "search", query: "locker code" }),
      "Searching earlier chats: locker code",
    ],
    [tool("library", { action: "get", file: "a.csv" }), "Getting a file from your library: a.csv"],
    [tool("deepwiki__read_wiki_structure", {}), "Using deepwiki: read wiki structure"],
    [tool("something_else", {}), "Using something else"],
  ])("describes %j", (part, expected) => {
    expect(toolActivity(part)).toBe(expected)
  })

  it("keeps a long command to one short line, and copes with arguments still arriving", () => {
    const long = toolActivity(tool("bash", { command: `echo ${"x".repeat(300)}` }))
    expect(long.length).toBeLessThan(90)
    expect(long.endsWith("…")).toBe(true)
    expect(toolActivity({ name: "bash", args: null })).toBe("Running a command")
    expect(toolActivity({ name: "web_search", args: "partial" })).toBe("Searching the web")
  })
})

describe("toolSummary", () => {
  it.each([
    [tool("bash", { command: "git status" }), "Ran: git status"],
    [tool("bash", {}), "Ran a command"],
    [tool("read", { path: "notes/todo.md" }), "Read todo.md"],
    [tool("write", { path: "plan.md" }), "Wrote plan.md"],
    [tool("edit", { path: "plan.md", computer: "studio" }), "Edited plan.md on studio"],
    [tool("web_search", { query: "node lts" }), "Searched the web: node lts"],
    [tool("send_file", { path: "out/report.pdf" }), "Sent you report.pdf"],
    [tool("memory", { action: "add" }), "Updated its memory"],
    [tool("schedule", { action: "list" }), "Checked its schedule"],
    [tool("skill", { action: "list" }), "Looked through its skills"],
    [tool("library", { action: "get", file: "a.csv" }), "Got a file from your library: a.csv"],
    [tool("deepwiki__ask_question", {}), "Used deepwiki: ask question"],
  ])("says what %j did", (part, expected) => {
    expect(toolSummary(part)).toBe(expected)
  })
})

describe("chatActivity", () => {
  const user: ChatMessage = {
    id: "1",
    role: "user",
    parts: [{ type: "text", text: "hi" }],
    status: "done",
  }
  const assistant = (
    parts: MessagePart[],
    status: ChatMessage["status"] = "streaming",
  ): ChatMessage => ({
    id: "live:1",
    role: "assistant",
    parts,
    status,
  })
  const chat = (messages: ChatMessage[], busy = true): ChatState => ({
    ...EMPTY_CHAT,
    messages,
    busy,
  })

  it("says nothing when the agent is idle", () => {
    expect(
      chatActivity(chat([user, assistant([{ type: "text", text: "hello" }], "done")], false)),
    ).toBe(null)
    expect(chatActivity(EMPTY_CHAT)).toBe(null)
  })

  it("is thinking until something comes back", () => {
    expect(chatActivity(chat([user]))).toBe("Thinking")
    expect(chatActivity(chat([user, assistant([])]))).toBe("Thinking")
    expect(chatActivity(chat([user, assistant([{ type: "thinking", text: "hmm" }])]))).toBe(
      "Thinking",
    )
  })

  it("says what the running tool is doing, the latest one when there are several", () => {
    expect(
      chatActivity(
        chat([
          user,
          assistant([
            tool("read", { path: "a.txt" }, "done"),
            tool("bash", { command: "make build" }, "running"),
            tool("web_search", { query: "why" }, "pending"),
          ]),
        ]),
      ),
    ).toBe("Searching the web: why")
  })

  it("stays quiet while the answer is being written, and is working between steps", () => {
    expect(chatActivity(chat([user, assistant([{ type: "text", text: "Here is" }])]))).toBe(null)
    expect(
      chatActivity(chat([user, assistant([tool("bash", { command: "ls" }, "done")], "done")])),
    ).toBe("Working")
  })
})

describe("chatMood", () => {
  const user: ChatMessage = {
    id: "1",
    role: "user",
    parts: [{ type: "text", text: "hi" }],
    status: "done",
  }
  const assistant = (
    parts: MessagePart[],
    status: ChatMessage["status"] = "streaming",
  ): ChatMessage => ({ id: "live:1", role: "assistant", parts, status })
  const chat = (messages: ChatMessage[], busy = true): ChatState => ({
    ...EMPTY_CHAT,
    messages,
    busy,
  })

  it("is idle when nothing is running, and troubled when the last answer failed", () => {
    expect(chatMood(EMPTY_CHAT)).toEqual({ state: "idle" })
    expect(
      chatMood(chat([user, assistant([{ type: "text", text: "hello" }], "done")], false)),
    ).toEqual({ state: "idle" })
    expect(chatMood(chat([user, assistant([], "error")], false))).toEqual({ state: "error" })
  })

  it("thinks until something comes back, and speaks while its answer is written", () => {
    expect(chatMood(chat([user]))).toEqual({ state: "thinking" })
    expect(chatMood(chat([user, assistant([{ type: "thinking", text: "hmm" }])]))).toEqual({
      state: "thinking",
    })
    expect(chatMood(chat([user, assistant([{ type: "text", text: "Here is" }])]))).toEqual({
      state: "speaking",
    })
  })

  it("works at the kind of thing its tool does, and stays at it between steps", () => {
    const working = (part: ToolPart) => chatMood(chat([user, assistant([part])]))
    expect(working(tool("bash", { command: "ls" }))).toEqual({
      state: "working",
      variant: "command",
    })
    expect(working(tool("edit", { path: "a.md" }))).toEqual({ state: "working", variant: "file" })
    expect(working(tool("web_search", { query: "x" }, "pending"))).toEqual({
      state: "working",
      variant: "search",
    })
    expect(working(tool("memory", { action: "add" }, "done"))).toEqual({
      state: "working",
      variant: "memory",
    })
  })

  it("sorts every tool into a kind of work", () => {
    expect(["read", "write", "send_file", "library", "skill"].map(toolKind)).toEqual(
      Array(5).fill("file"),
    )
    expect(["history", "deepwiki__ask_question"].map(toolKind)).toEqual(["search", "search"])
    expect(["set_identity", "schedule"].map(toolKind)).toEqual(["memory", "memory"])
    expect(toolKind("something_new")).toBe("command")
  })
})

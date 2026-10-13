import { describe, expect, it } from "vitest"
import {
  chatUses,
  goingUse,
  isUse,
  type ChatMessage,
  type ChatState,
  chatActivity,
  chatMood,
  EMPTY_CHAT,
  type MessagePart,
  sentFiles,
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
    [tool("sign_in", {}), "Signing in"],
    [tool("sign_in", { login: "GitHub", computer: "MacBook" }), "Signing in on MacBook: GitHub"],
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
    [tool("sign_in", { login: "GitHub" }), "Asked to sign in: GitHub"],
    [tool("send_file", { path: "out/report.pdf" }), "Sent you report.pdf"],
    [tool("memory", { action: "add" }), "Updated its memory"],
    [tool("log", { title: "Fix the build" }), "Noted what it did"],
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

describe("sentFiles", () => {
  const sent = (id: string, name: string, status: ToolPart["status"] = "done"): ToolPart => ({
    type: "tool",
    toolCallId: `send-${id}-${name}`,
    name: "send_file",
    args: { path: `library/${name}` },
    status,
    ...(status === "done" ? { details: { id, name, path: name } } : {}),
  })
  const says = (id: string, parts: MessagePart[]): ChatMessage => ({
    id,
    role: "assistant",
    parts,
    status: "done",
  })

  it("lists what was delivered, newest first, and nothing that was not", () => {
    const state: ChatState = {
      ...EMPTY_CHAT,
      messages: [
        says("1", [{ type: "text", text: "Here." }, sent("a", "plan.md"), sent("b", "data.csv")]),
        says("2", [
          tool("write", { path: "library/draft.md" }, "done"),
          sent("c", "late.md", "error"),
        ]),
        says("3", [sent("d", "chart.png")]),
      ],
    }
    expect(sentFiles(state).map((file) => file.name)).toEqual(["chart.png", "data.csv", "plan.md"])
    expect(sentFiles(EMPTY_CHAT)).toEqual([])
  })

  it("lists a file sent again once, where it was last sent and as it then was", () => {
    const state: ChatState = {
      ...EMPTY_CHAT,
      messages: [
        says("1", [sent("a", "plan.md"), sent("b", "data.csv")]),
        says("2", [sent("a", "the-plan.md")]),
      ],
    }
    expect(sentFiles(state).map((file) => file.name)).toEqual(["the-plan.md", "data.csv"])
  })
})

describe("chatUses", () => {
  const step = (
    id: string,
    name: "screen" | "browser",
    over: Partial<ToolPart> & {
      say?: string
      computer?: string
      shot?: string
      title?: string
    } = {},
  ): ToolPart => {
    const { say = "Clicking Save", computer = "MacBook", shot, title, ...rest } = over
    return {
      type: "tool",
      toolCallId: id,
      name,
      args: { computer, note: say },
      status: "done",
      details: {
        use: {
          what: name,
          computer: { id: `id-${computer}`, name: computer },
          say,
          ...(shot === undefined
            ? {}
            : { shot, width: 1280, height: 800, pointer: { x: 4, y: 9 } }),
          ...(title === undefined ? {} : { title }),
        },
      },
      ...rest,
    }
  }
  const said = (id: string, at: number, ...parts: ChatMessage["parts"]): ChatMessage => ({
    id,
    role: "assistant",
    parts,
    status: "done",
    createdAt: at,
  })
  const asked: ChatMessage = {
    id: "u",
    role: "user",
    parts: [{ type: "text", text: "Go on" }],
    status: "done",
    createdAt: 500,
  }
  const words = (value: string) => ({ type: "text" as const, text: value })

  it("says which screen or browser is being used, by the computer's name", () => {
    expect(toolActivity({ name: "screen", args: { computer: "MacBook", action: "click" } })).toBe(
      "Using MacBook's screen",
    )
    expect(toolActivity({ name: "browser", args: { computer: "MacBook" } })).toBe(
      "Using a browser on MacBook",
    )
    expect(toolSummary({ name: "screen", args: { computer: "MacBook" } })).toBe(
      "Used MacBook's screen",
    )
  })

  it("makes one use of a turn's steps on a screen, across its messages and what it says between", () => {
    const uses = chatUses({
      busy: false,
      messages: [
        said("a", 1_000, step("1", "screen", { shot: "s1" })),
        said("b", 5_000, words("Now the total."), step("2", "screen", { say: "Typing 4,820" })),
        said("c", 9_000, words("Done.")),
      ],
    })
    expect(uses).toHaveLength(1)
    expect(uses[0]).toMatchObject({ id: "1", what: "screen", going: false, last: true, ms: 8_000 })
    expect(uses[0]!.computer).toEqual({ id: "id-MacBook", name: "MacBook" })
    expect(uses[0]!.steps.map((each) => each.say)).toEqual(["Clicking Save", "Typing 4,820"])
    expect(uses[0]!.steps[0]).toMatchObject({ shot: "s1", width: 1280, pointer: { x: 4, y: 9 } })
    expect(uses[0]!.steps[1]!.shot).toBeUndefined()
  })

  it("keeps the window a step on a screen was done in, and has none for the whole screen or a page", () => {
    const uses = chatUses({
      busy: false,
      messages: [
        said(
          "a",
          0,
          step("1", "screen", { shot: "s1", title: "Notes: Shopping" }),
          step("2", "screen", { shot: "s2" }),
          // A page's title is not a window's, and is not kept as one.
          step("3", "browser", { title: "Pricing" }),
        ),
      ],
    })
    expect(uses.map((use) => use.steps.map((each) => each.title))).toEqual([
      ["Notes: Shopping", undefined],
      [undefined],
    ])
    expect(uses[0]!.steps[0]).toMatchObject({ shot: "s1", width: 1280, title: "Notes: Shopping" })
    expect(uses[0]!.steps[1]).not.toHaveProperty("title")
    expect(uses[1]!.steps[0]).not.toHaveProperty("title")
  })

  it("starts another use at the other tool, another computer, a message from someone, or a thing shown", () => {
    const sent: ToolPart = {
      type: "tool",
      toolCallId: "f",
      name: "send_file",
      args: {},
      status: "done",
      details: { id: "file" },
    }
    const uses = chatUses({
      busy: false,
      messages: [
        said("a", 0, step("1", "screen"), step("2", "browser"), step("3", "browser")),
        said(
          "b",
          1,
          step("4", "browser", { computer: "Studio" }),
          sent,
          step("5", "browser", { computer: "Studio" }),
        ),
        asked,
        said("c", 600, step("6", "browser", { computer: "Studio" })),
      ],
    })
    expect(uses.map((use) => [use.what, use.computer.name, use.steps.length])).toEqual([
      ["screen", "MacBook", 1],
      ["browser", "MacBook", 2],
      ["browser", "Studio", 1],
      ["browser", "Studio", 1],
      ["browser", "Studio", 1],
    ])
    expect(uses.map((use) => use.last)).toEqual([false, false, false, false, true])
  })

  it("is going while its last step runs, and while the chat is busy with nothing but words after it", () => {
    const running = step("2", "screen", { status: "running", details: undefined })
    const first = said("a", 0, step("1", "screen"))
    expect(isUse(running)).toBe(true)
    expect(isUse({ ...running, status: "error" })).toBe(false)
    const mid = chatUses({ busy: true, messages: [first, said("b", 1, running)] })
    expect(mid[0]).toMatchObject({ going: true, computer: { id: "id-MacBook" } })
    expect(mid[0]!.steps[1]!.say).toBe("Clicking Save")
    expect(mid[0]!.ms).toBeUndefined()
    const between = { busy: true, messages: [first, said("b", 1, words("Next, the total."))] }
    expect(goingUse(between)?.id).toBe("1")
    expect(goingUse({ ...between, busy: false })).toBeUndefined()
    expect(goingUse({ busy: true, messages: [first, asked] })).toBeUndefined()
  })
})

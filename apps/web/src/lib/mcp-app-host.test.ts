import type { McpAppDetails } from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import { type AppHostContext, createAppHost } from "./mcp-app-host.ts"

const DETAILS: McpAppDetails = {
  app: {
    id: "a".repeat(32),
    connectorId: "c1",
    connector: "Weather",
    tool: "forecast",
    uri: "ui://w/f",
  },
  input: { city: "Lisbon" },
  result: { content: [{ type: "text", text: "Sunny" }] },
}

/** A page's host with nothing behind it but what a test puts there. */
function open(with_: { pressed?: boolean; box?: boolean } = {}) {
  const posted: Record<string, unknown>[] = []
  const done = {
    opened: [] as string[],
    said: [] as string[],
    modes: [] as string[],
    heights: [] as number[],
  }
  const context: AppHostContext = {
    theme: "dark",
    styles: { variables: { "--color-text-primary": "white" } },
    displayMode: "inline",
    availableDisplayModes: ["inline", "fullscreen"],
    containerDimensions: { maxHeight: 1600 },
    platform: "web",
    locale: "en",
    timeZone: "UTC",
  }
  const state = { pressed: with_.pressed ?? true }
  const host = createAppHost(DETAILS, {
    post: (message) => posted.push(message as Record<string, unknown>),
    context: () => ({ ...context }),
    pressed: async () => state.pressed,
    callTool: async (name) => {
      if (name === "refused") throw new Error("The person said no.")
      return { content: [{ type: "text", text: `${name} done` }] }
    },
    readResource: async (uri) => ({ contents: [{ uri }] }),
    openLink: (url) => void done.opened.push(url),
    say: (text) => {
      if (with_.box === false) return false
      done.said.push(text)
      return true
    },
    setMode: (mode) => {
      context.displayMode = mode
      done.modes.push(mode)
    },
    onHeight: (height) => void done.heights.push(height),
  })
  const ask = (id: number, method: string, params?: unknown) =>
    host.receive({ jsonrpc: "2.0", id, method, params })
  const told = (method: string, params?: unknown) =>
    host.receive({ jsonrpc: "2.0", method, params })
  const answer = (id: number) => posted.find((message) => message.id === id)
  return { host, posted, done, context, state, ask, told, answer }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("the app's side of the talk with a connector's page", () => {
  it("tells the page where it is, and then what the tool was asked and answered, once", () => {
    const page = open()
    page.ask(1, "ui/initialize", { protocolVersion: "2026-01-26" })
    expect(page.answer(1)!.result).toMatchObject({
      protocolVersion: "2026-01-26",
      hostInfo: { name: "do-computer" },
      hostContext: { theme: "dark", displayMode: "inline" },
    })
    // Nothing of the tool until the page says it is ready for it.
    expect(page.posted).toHaveLength(1)
    page.told("ui/notifications/initialized")
    page.told("ui/notifications/initialized")
    expect(page.posted.slice(1)).toEqual([
      {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-input",
        params: { arguments: { city: "Lisbon" } },
      },
      { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: DETAILS.result },
    ])
  })

  it("uses the server's tools and reads its resources for the page, and passes on a refusal", async () => {
    const page = open()
    page.ask(2, "tools/call", { name: "refresh", arguments: {} })
    page.ask(3, "tools/call", { name: "refused" })
    page.ask(4, "resources/read", { uri: "ui://w/other" })
    page.ask(5, "tools/call", { arguments: {} })
    await settle()
    expect(page.answer(2)!.result).toEqual({ content: [{ type: "text", text: "refresh done" }] })
    expect(page.answer(3)!.error).toMatchObject({ message: "The person said no." })
    expect(page.answer(4)!.result).toEqual({ contents: [{ uri: "ui://w/other" }] })
    expect(page.answer(5)!.error).toMatchObject({ code: -32602 })
  })

  it("answers only so much at once", async () => {
    const page = open()
    for (let id = 1; id <= 10; id++) page.ask(id, "tools/call", { name: "refresh" })
    expect(page.posted.filter((message) => message.error !== undefined)).toHaveLength(2)
    await settle()
    expect(page.posted.filter((message) => message.result !== undefined)).toHaveLength(8)
  })

  it("opens a link, takes words and goes large only on the reader's own press", async () => {
    const idle = open({ pressed: false })
    idle.ask(1, "ui/open-link", { url: "https://example.com" })
    idle.ask(2, "ui/message", { role: "user", content: [{ type: "text", text: "book it" }] })
    idle.ask(3, "ui/request-display-mode", { mode: "fullscreen" })
    await settle()
    expect(idle.done).toMatchObject({ opened: [], said: [], modes: [] })
    expect(idle.answer(1)!.error).toBeDefined()
    expect(idle.answer(2)!.error).toBeDefined()
    expect(idle.answer(3)!.result).toEqual({ mode: "inline" })

    const page = open()
    page.ask(1, "ui/open-link", { url: "https://example.com/a" })
    page.ask(2, "ui/open-link", { url: "javascript:alert(1)" })
    page.ask(3, "ui/message", { role: "user", content: [{ type: "text", text: " book it " }] })
    page.ask(4, "ui/message", {
      role: "assistant",
      content: [{ type: "text", text: "as the agent" }],
    })
    page.ask(5, "ui/message", { role: "user", content: [{ type: "image", data: "…" }] })
    page.ask(6, "ui/request-display-mode", { mode: "fullscreen" })
    await settle()
    page.ask(7, "ui/request-display-mode", { mode: "picture-in-picture" })
    await settle()
    expect(page.done.opened).toEqual(["https://example.com/a"])
    expect(page.done.said).toEqual(["book it"])
    expect(page.done.modes).toEqual(["fullscreen"])
    expect(page.answer(2)!.error).toMatchObject({ code: -32602 })
    expect(page.answer(4)!.error).toBeDefined()
    expect(page.answer(5)!.error).toBeDefined()
    expect(page.answer(6)!.result).toEqual({ mode: "fullscreen" })
    expect(page.answer(7)!.result).toEqual({ mode: "fullscreen" })
    // Where there is no message box, the page is told its words went nowhere.
    const boxless = open({ box: false })
    boxless.ask(1, "ui/message", { role: "user", content: { type: "text", text: "hello" } })
    await settle()
    expect(boxless.answer(1)!.error).toBeDefined()
  })

  it("hears how tall the page is, and says plainly what it does not do", () => {
    const page = open()
    page.told("ui/notifications/size-changed", { height: 412 })
    page.told("ui/notifications/size-changed", { height: -1 })
    page.told("ui/notifications/size-changed", { height: "tall" })
    expect(page.done.heights).toEqual([412])
    page.ask(1, "ui/update-model-context", { content: [] })
    page.ask(2, "ping")
    expect(page.answer(1)!.error).toMatchObject({ code: -32601 })
    expect(page.answer(2)!.result).toEqual({})
    // What is not JSON-RPC is not heard at all.
    page.host.receive({ id: 9, method: "ping" })
    expect(page.answer(9)).toBeUndefined()
  })

  it("tells the page what has changed about where it is shown, and only that", () => {
    const page = open()
    page.host.contextChanged()
    expect(page.posted).toEqual([])
    page.ask(1, "ui/initialize")
    page.host.contextChanged()
    expect(page.posted).toHaveLength(1)
    page.context.theme = "light"
    page.host.contextChanged()
    expect(page.posted.at(-1)).toEqual({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { theme: "light" },
    })
    page.context.displayMode = "fullscreen"
    page.host.contextChanged()
    expect(page.posted.at(-1)!.params).toEqual({ displayMode: "fullscreen" })
  })
})

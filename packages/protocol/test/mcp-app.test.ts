import { describe, expect, it } from "vitest"
import {
  isMcpApp,
  mcpAppContentSecurityPolicy,
  mcpAppFrameHeight,
  mcpAppToolFor,
  mcpAppUriOf,
  readMcpApp,
  readMcpAppCsp,
  readMcpAppMessage,
  type ToolPart,
} from "../src/index.ts"

describe("what a connector's page says it needs to load", () => {
  it("is kept only where it is a whole origin", () => {
    expect(
      readMcpAppCsp({
        connectDomains: [
          "https://api.example.com",
          "wss://live.example.com:8443",
          "https://*.example.com",
          // Each of these would widen the policy it is written into, or end it.
          "'unsafe-eval'",
          "*",
          "https://example.com/path",
          "https://example.com; script-src *",
          "data:",
          'https://a.example"',
          42,
        ],
        resourceDomains: ["'self'"],
        somethingElse: ["https://x.example"],
      }),
    ).toEqual({
      connectDomains: [
        "https://api.example.com",
        "wss://live.example.com:8443",
        "https://*.example.com",
      ],
    })
    expect(readMcpAppCsp(undefined)).toBeUndefined()
    expect(readMcpAppCsp({ connectDomains: "https://api.example.com" })).toBeUndefined()
    const many = Array.from({ length: 60 }, (_, at) => `https://h${at}.example.com`)
    expect(readMcpAppCsp({ frameDomains: many })!.frameDomains).toHaveLength(24)
  })

  it("makes a policy that lets in nothing it did not name, and never the app's own address", () => {
    const bare = mcpAppContentSecurityPolicy(undefined)
    expect(bare).toContain("sandbox allow-scripts allow-forms;")
    expect(bare).not.toContain("allow-same-origin")
    expect(bare).toContain("default-src 'none'")
    expect(bare).toContain("connect-src 'none'")
    expect(bare).toContain("frame-src 'none'")
    expect(bare).toContain("base-uri 'none'")
    expect(bare).toContain("form-action 'none'")
    expect(bare).not.toContain("'self'")
    const named = mcpAppContentSecurityPolicy({
      connectDomains: ["https://api.example.com"],
      resourceDomains: ["https://cdn.example.com"],
    })
    expect(named).toContain("connect-src https://api.example.com;")
    expect(named).toContain("script-src 'unsafe-inline' https://cdn.example.com;")
    expect(named).toContain("img-src data: blob: https://cdn.example.com;")
    expect(named).toContain("frame-src 'none'")
  })
})

describe("what a tool says of its page", () => {
  it("is where the page is, by either of the two names for it", () => {
    expect(mcpAppUriOf({ ui: { resourceUri: "ui://weather/view" } })).toBe("ui://weather/view")
    expect(mcpAppUriOf({ "ui/resourceUri": "ui://old/view" })).toBe("ui://old/view")
    for (const not of [
      undefined,
      {},
      { ui: {} },
      { ui: { resourceUri: "https://example.com/page" } },
      { ui: { resourceUri: 7 } },
      { ui: { resourceUri: `ui://${"x".repeat(3000)}` } },
    ]) {
      expect(mcpAppUriOf(not)).toBeUndefined()
    }
  })

  it("is who the tool is for, which is both unless it says", () => {
    expect(mcpAppToolFor(undefined)).toEqual({ model: true, app: true })
    expect(mcpAppToolFor({ ui: { visibility: ["app"] } })).toEqual({ model: false, app: true })
    expect(mcpAppToolFor({ ui: { visibility: ["model"] } })).toEqual({ model: true, app: false })
    expect(mcpAppToolFor({ ui: { visibility: "app" } })).toEqual({ model: true, app: true })
  })
})

describe("a tool call that has a page to show", () => {
  const details = {
    app: {
      id: "a".repeat(32),
      connectorId: "c1",
      connector: "Weather",
      tool: "forecast",
      uri: "ui://weather/view",
      csp: { connectDomains: ["https://api.example.com", "'unsafe-eval'"] },
      border: false,
    },
    input: { city: "Lisbon" },
    result: { content: [{ type: "text", text: "Sunny" }], structuredContent: { high: 21 } },
  }
  const part = (changed: object = {}, status: ToolPart["status"] = "done"): ToolPart => ({
    type: "tool",
    toolCallId: "t1",
    name: "weather__forecast",
    args: {},
    status,
    details: { ...details, ...changed } as ToolPart["details"],
  })

  it("is known by its details, read again as carefully as when they were written", () => {
    expect(isMcpApp(part())).toBe(true)
    expect(readMcpApp(details)).toEqual({
      ...details,
      app: { ...details.app, csp: { connectDomains: ["https://api.example.com"] } },
    })
    expect(isMcpApp(part({}, "running"))).toBe(false)
    for (const app of [
      { ...details.app, id: "../../etc" },
      { ...details.app, id: "short" },
      { ...details.app, uri: "https://example.com" },
      { ...details.app, connectorId: undefined },
    ]) {
      expect(isMcpApp(part({ app }))).toBe(false)
    }
    expect(isMcpApp(part({ result: undefined }))).toBe(false)
    // A file the agent sent has details too, and is not this.
    expect(readMcpApp({ id: "f1", path: "a.txt" })).toBeUndefined()
  })

  it("is given a frame within bounds", () => {
    expect(mcpAppFrameHeight(undefined)).toBe(280)
    expect(mcpAppFrameHeight(12)).toBe(60)
    expect(mcpAppFrameHeight(99_999)).toBe(1600)
  })
})

describe("what a page posts", () => {
  it("is read as something asked, something told, or nothing", () => {
    expect(readMcpAppMessage({ jsonrpc: "2.0", id: 1, method: "ping" })).toEqual({
      id: 1,
      method: "ping",
      params: {},
    })
    expect(
      readMcpAppMessage({
        jsonrpc: "2.0",
        method: "ui/notifications/size-changed",
        params: { height: 9 },
      }),
    ).toEqual({ method: "ui/notifications/size-changed", params: { height: 9 } })
    for (const not of [
      null,
      "ping",
      { id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 1 },
      { jsonrpc: "2.0", id: { x: 1 }, method: "ping" },
      { jsonrpc: "2.0", id: Number.NaN, method: "ping" },
    ]) {
      expect(readMcpAppMessage(not)).toBeUndefined()
    }
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

const world = vi.hoisted(() => ({
  row: undefined as undefined | { user_id: string; agent_id: string; connector_id: string; created_at: number; desktop_port: number | null },
  deleted: false,
  called: undefined as Request | undefined,
}))
vi.mock("#platform", () => ({
  getPlatform: () => ({
    config: { baseUrl: "https://dc.test", clientOrigins: ["http://127.0.0.1:8772"] },
    db: {
      get: async () => world.row,
      batch: async () => {},
      run: async (sql: string) => { if (sql.startsWith("DELETE")) world.deleted = true },
    },
    agents: { get: () => ({ fetch: async (request: Request) => {
      world.called = request
      return Response.json(request.url.includes("authorize") ? {} : { connector: { id: "c" }, authorizationUrl: "https://service.test/authorize?state=s", state: "s" })
    } }) },
  }),
}))
vi.mock("./auth.ts", () => ({
  getUser: async (request: Request) => request.headers.get("authorization") === "Bearer owner" ? { id: "u", name: "Ada" } : undefined,
}))
vi.mock("./agents.ts", () => ({
  agentFor: async () => ({}),
  fail: (status: number, error: string) => Response.json({ error }, { status }),
  json: (body: unknown, status = 200) => Response.json(body, { status }),
}))
const { connectConnector, connectorCallback, connectorClientReturn } = await import("./connectors.ts")
const owner = { id: "u", name: "Ada" } as Parameters<typeof connectConnector>[0]
const query = (returnTo: string, rest = "") => `https://dc.test/api/connectors/callback?state=s&client_return=${encodeURIComponent(returnTo)}${rest}`
const client = "http://127.0.0.1:8772/a/dood/connectors"
beforeEach(() => {
  world.row = { user_id: "u", agent_id: "dood", connector_id: "c", created_at: Date.now(), desktop_port: null }
  world.deleted = false
  world.called = undefined
})

describe("a connector's return to a bearer web client", () => {
  it("accepts its development origin and the server's own origin, but not other pages or origins", () => {
    for (const url of [client, "https://dc.test/a/dood/connectors"]) {
      expect(connectorClientReturn(new Request(query(url)))).toBe(url)
    }
    for (const url of ["https://evil.test/a/dood/connectors", "https://dc.test/login", `${client}?code=old`, "https://user:pass@dc.test/a/dood/connectors", `${client}#fragment`]) {
      expect(connectorClientReturn(new Request(query(url)))).toBeUndefined()
    }
  })
  it("registers exactly that return with the service and rejects an untrusted return before contacting it", async () => {
    const request = new Request(`https://dc.test/api/agents/dood/connectors?client_return=${encodeURIComponent(client)}`, { method: "POST", body: JSON.stringify({ name: "Test", url: "https://service.test/mcp" }) })
    expect((await connectConnector(owner, request, "dood")).status).toBe(201)
    expect(world.called?.headers.get("x-dc-connector-redirect") ?? [...world.called!.headers].find(([k]) => k.includes("redirect"))?.[1]).toContain(encodeURIComponent(client))
    world.called = undefined
    const bad = new Request("https://dc.test/api/agents/dood/connectors?client_return=https://evil.test/a/x/connectors", { method: "POST", body: "{}" })
    expect((await connectConnector(owner, bad, "dood")).status).toBe(400)
    expect(world.called).toBeUndefined()
  })
  it("returns the code to the client without a browser cookie and does not spend it yet", async () => {
    const response = await connectorCallback(new Request(query(client, "&code=abc&iss=https%3A%2F%2Fservice.test")))
    const target = new URL(response.headers.get("location")!)
    expect(target.origin + target.pathname).toBe(client)
    expect(target.searchParams.get("code")).toBe("abc")
    expect(world.deleted).toBe(false)
    expect(world.called).toBeUndefined()
  })
  it("finishes under the bearer session and returns status only, not codes or secrets", async () => {
    const response = await connectorCallback(new Request(`${query(client, "&code=abc")}&dc_client=1`, { headers: { authorization: "Bearer owner" } }))
    expect(await response.json()).toEqual({ ok: true, error: "" })
    expect(world.deleted).toBe(true)
    expect(world.called?.url).toContain("/connectors/c/authorize")
  })
  it("refuses a missing bearer without spending the state", async () => {
    const response = await connectorCallback(new Request(`${query(client, "&code=abc")}&dc_client=1`))
    expect(response.status).toBe(401)
    expect(world.deleted).toBe(false)
  })
  it("returns a cancellation or expired state in words", async () => {
    const denied = await connectorCallback(new Request(`${query(client, "&error=access_denied")}&dc_client=1`, { headers: { authorization: "Bearer owner" } }))
    expect(await denied.json()).toEqual({ ok: false, error: "The sign-in was cancelled." })
    world.row!.created_at = 0
    const expired = await connectorCallback(new Request(`${query(client, "&code=abc")}&dc_client=1`, { headers: { authorization: "Bearer owner" } }))
    expect(await expired.json()).toEqual({ ok: false, error: "That sign-in link has expired. Try connecting again." })
  })
  it("keeps the cookie web app and desktop returns as before", async () => {
    const response = await connectorCallback(new Request("https://dc.test/api/connectors/callback?state=s&code=abc", { headers: { authorization: "Bearer owner" } }))
    expect(response.headers.get("location")).toBe("https://dc.test/a/dood/connectors?connected=c")
    world.row!.desktop_port = 12345
    const desktop = await connectorCallback(new Request("https://dc.test/api/connectors/callback?state=s&code=abc"))
    expect(desktop.headers.get("location")).toBe("http://127.0.0.1:12345/connector?state=s&code=abc")
  })
})

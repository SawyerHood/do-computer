/**
 * A remote MCP server, and the OAuth authorization server in front of it, as a `fetch` stand-in.
 * Enough of both protocols for a client to connect, list tools, call them and sign in.
 */
export type FakeMcpOptions = {
  /** Require this fixed bearer token. */
  token?: string
  /** Require an OAuth access token, issued by the fake authorization server. */
  oauth?: boolean
}

const MCP_URL = "https://mcp.test/mcp"
const ISSUER = "https://auth.test"
const ACCESS_TOKEN = "access-token-1"
export const GOOD_CODE = "good-code"

const TOOLS = [
  {
    name: "add",
    description: "Add two numbers",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
  { name: "whoami", description: "Say who is calling", inputSchema: { type: "object" } },
  {
    name: "always.fails",
    description: "A tool that reports failure",
    inputSchema: { type: "object" },
  },
]

export function fakeMcp(options: FakeMcpOptions = {}) {
  const calls: { tool: string; args: unknown; authorization: string | null }[] = []
  const requests: string[] = []
  let down = false

  const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json", ...headers },
    })

  const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const method = init?.method ?? "GET"
    const headers = new Headers(init?.headers)
    requests.push(`${method} ${url.origin}${url.pathname}`)
    if (down) throw new TypeError("fetch failed")

    if (url.origin === ISSUER) {
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: `${ISSUER}/token`,
          registration_endpoint: `${ISSUER}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        })
      }
      if (url.pathname === "/register" && method === "POST") {
        const metadata = JSON.parse(String(init?.body))
        return json({ ...metadata, client_id: "client-1", client_id_issued_at: 1 }, 201)
      }
      if (url.pathname === "/token" && method === "POST") {
        const form = new URLSearchParams(String(init?.body))
        if (form.get("code") !== GOOD_CODE || !form.get("code_verifier")) {
          return json({ error: "invalid_grant" }, 400)
        }
        return json({
          access_token: ACCESS_TOKEN,
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh-1",
        })
      }
      return json({ error: "not_found" }, 404)
    }

    if (url.origin !== "https://mcp.test") return json({ error: "unknown host" }, 404)
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return options.oauth
        ? json({ resource: MCP_URL, authorization_servers: [ISSUER] })
        : json({ error: "not_found" }, 404)
    }
    if (url.pathname !== "/mcp") return json({ error: "not_found" }, 404)

    const authorization = headers.get("authorization")
    if (options.token !== undefined && authorization !== `Bearer ${options.token}`) {
      return json({ error: "unauthorized" }, 401)
    }
    if (options.oauth && authorization !== `Bearer ${ACCESS_TOKEN}`) {
      return json({ error: "unauthorized" }, 401, {
        "www-authenticate": `Bearer resource_metadata="https://mcp.test/.well-known/oauth-protected-resource/mcp"`,
      })
    }
    if (method === "DELETE") return new Response(null, { status: 200 })
    if (method !== "POST") return new Response(null, { status: 405 })

    const message = JSON.parse(String(init?.body)) as {
      id?: number | string
      method: string
      params?: { name?: string; arguments?: Record<string, number>; protocolVersion?: string }
    }
    const result = (value: unknown) => json({ jsonrpc: "2.0", id: message.id, result: value })
    switch (message.method) {
      case "initialize":
        return result({
          protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-mcp", version: "1.0.0" },
        })
      case "notifications/initialized":
        return new Response(null, { status: 202 })
      case "ping":
        return result({})
      case "tools/list":
        return result({ tools: TOOLS })
      case "tools/call": {
        const { name, arguments: args = {} } = message.params ?? {}
        calls.push({ tool: name ?? "", args, authorization })
        if (name === "add")
          return result({ content: [{ type: "text", text: String(args.a! + args.b!) }] })
        if (name === "whoami")
          return result({
            content: [{ type: "text", text: `caller with ${authorization ?? "no credentials"}` }],
          })
        if (name === "always.fails")
          return result({ isError: true, content: [{ type: "text", text: "It broke." }] })
        return json({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32602, message: "Unknown tool" },
        })
      }
      default:
        return json({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found" },
        })
    }
  }

  return {
    fetch,
    url: MCP_URL,
    calls,
    requests,
    /** Make every request fail as if the network were down, or restore it. */
    setDown: (value: boolean) => void (down = value),
  }
}

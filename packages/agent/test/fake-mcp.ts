/**
 * A remote MCP server, and the OAuth authorization server in front of it, as a `fetch` stand-in.
 * Enough of both protocols for a client to connect, list tools, call them and sign in.
 */
export type FakeMcpOptions = {
  /** Require this fixed bearer token. */
  token?: string
  /** Require an OAuth access token, issued by the fake authorization server. */
  oauth?: boolean
  /**
   * The one app the authorization server knows. It then lets no app register itself, as Slack's
   * does not, and gives a token only to this id and secret.
   */
  client?: { id: string; secret: string }
  /**
   * The authorization server says it names itself, as `iss`, in what it sends the user back with
   * (RFC 9207). A client must then refuse a code that comes back without it.
   */
  iss?: boolean
  /** The authorization server publishes nothing about itself, so a client goes by the usual paths. */
  noMetadata?: boolean
  /**
   * The server has a page for one of its tools (an MCP App), and tools for that page to use.
   * `page` is what it gives when the page is read: left out, a small page of its own.
   */
  apps?: boolean | { page: Record<string, unknown> }
  /** This many more tools, `ledger_0` and up, for a server with more than anyone would be shown. */
  many?: number
}

/** The address of the page the server has for its `forecast` tool. */
export const APP_URI = "ui://weather/forecast"
export const APP_PAGE = "<!doctype html><title>Forecast</title><p id=out>…</p>"

const APP_TOOLS = [
  {
    name: "forecast",
    description: "The weather somewhere",
    inputSchema: { type: "object", properties: { city: { type: "string" } } },
    _meta: { ui: { resourceUri: APP_URI } },
  },
  {
    name: "refresh",
    description: "The weather again",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
  },
  { name: "book", description: "Book a trip there", inputSchema: { type: "object" } },
  {
    name: "hourly",
    description: "The weather hour by hour, for the page",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
    _meta: { ui: { visibility: ["app"] } },
  },
]

const MCP_URL = "https://mcp.test/mcp"
export const ISSUER = "https://auth.test"
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
  /** What each client said of itself when it connected. */
  const clients: Record<string, unknown>[] = []
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
      if (url.pathname === "/.well-known/oauth-authorization-server" && !options.noMetadata) {
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: `${ISSUER}/token`,
          ...(options.client === undefined ? { registration_endpoint: `${ISSUER}/register` } : {}),
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: [
            options.client === undefined ? "none" : "client_secret_post",
          ],
          ...(options.iss ? { authorization_response_iss_parameter_supported: true } : {}),
        })
      }
      if (url.pathname === "/register" && method === "POST" && options.client === undefined) {
        const metadata = JSON.parse(String(init?.body))
        return json({ ...metadata, client_id: "client-1", client_id_issued_at: 1 }, 201)
      }
      if (url.pathname === "/token" && method === "POST") {
        const form = new URLSearchParams(String(init?.body))
        if (form.get("code") !== GOOD_CODE || !form.get("code_verifier")) {
          return json({ error: "invalid_grant" }, 400)
        }
        if (
          options.client !== undefined &&
          (form.get("client_id") !== options.client.id ||
            form.get("client_secret") !== options.client.secret)
        ) {
          return json({ error: "invalid_client" }, 401)
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
      params?: {
        name?: string
        uri?: string
        arguments?: Record<string, number>
        protocolVersion?: string
        capabilities?: Record<string, unknown>
      }
    }
    const result = (value: unknown) => json({ jsonrpc: "2.0", id: message.id, result: value })
    switch (message.method) {
      case "initialize":
        clients.push(message.params?.capabilities ?? {})
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
        return result({
          tools: [
            ...TOOLS,
            ...(options.apps ? APP_TOOLS : []),
            ...Array.from({ length: options.many ?? 0 }, (_, index) => ({
              name: `ledger_${index}`,
              description: `Read page ${index} of the ledger`,
              inputSchema: { type: "object", properties: {} },
            })),
          ],
        })
      case "resources/read": {
        if (!options.apps || message.params?.uri !== APP_URI) {
          return json({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32002, message: "No such resource" },
          })
        }
        return result({
          contents: [
            typeof options.apps === "object"
              ? options.apps.page
              : {
                  uri: APP_URI,
                  mimeType: "text/html;profile=mcp-app",
                  text: APP_PAGE,
                  _meta: {
                    ui: {
                      csp: {
                        connectDomains: ["https://api.weather.example", "'unsafe-eval'"],
                        resourceDomains: ["https://cdn.weather.example"],
                      },
                      prefersBorder: false,
                    },
                  },
                },
          ],
        })
      }
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
        if (options.apps && name === "forecast")
          return result({
            content: [{ type: "text", text: "Sunny, 21 degrees" }],
            structuredContent: { city: (args as { city?: string }).city ?? "here", high: 21 },
          })
        if (options.apps && (name === "refresh" || name === "hourly" || name === "book"))
          return result({ content: [{ type: "text", text: `${name} done` }] })
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
    clients,
    /** Make every request fail as if the network were down, or restore it. */
    setDown: (value: boolean) => void (down = value),
  }
}

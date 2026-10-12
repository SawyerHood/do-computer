/**
 * A stand-in for Composio's MCP server, for the pictures in `docs/apps.md`: its sign-in is one page
 * with Allow on it, and it offers Composio's own tool names with made-up answers.
 */
import { createServer } from "node:http"

const ACCESS_TOKEN = "guide-access-token"
const CODE = "guide-code"
const obj = (properties, required = []) => ({ type: "object", properties, required })
const TOOLS = [
  {
    name: "COMPOSIO_SEARCH_TOOLS",
    description:
      "Search the tools of the person's connected apps (Gmail, Google Calendar, Slack, Notion, GitHub and many more) for the ones a task needs. Always call this first.",
    inputSchema: obj(
      {
        queries: {
          type: "array",
          items: obj({ use_case: { type: "string" }, known_fields: { type: "string" } }, ["use_case"]),
        },
        session: obj({ id: { type: "string" }, generate_id: { type: "boolean" } }),
      },
      ["queries"],
    ),
  },
  {
    name: "COMPOSIO_GET_TOOL_SCHEMAS",
    description: "Get the input schemas of tools by slug.",
    inputSchema: obj({ tool_slugs: { type: "array", items: { type: "string" } } }, ["tool_slugs"]),
  },
  {
    name: "COMPOSIO_MANAGE_CONNECTIONS",
    description: "Make a sign-in link for a toolkit the person has not connected yet.",
    inputSchema: obj({ toolkits: { type: "array", items: { type: "string" } } }, ["toolkits"]),
  },
  {
    name: "COMPOSIO_MULTI_EXECUTE_TOOL",
    description: "Run one or more tools found with COMPOSIO_SEARCH_TOOLS, in parallel.",
    inputSchema: obj(
      {
        tools: {
          type: "array",
          items: obj({ tool_slug: { type: "string" }, arguments: { type: "object" } }, [
            "tool_slug",
            "arguments",
          ]),
        },
        thought: { type: "string" },
        sync_response_to_workbench: { type: "boolean" },
        session_id: { type: "string" },
      },
      ["tools", "sync_response_to_workbench"],
    ),
  },
]
const GMAIL_SEND = obj(
  {
    recipient_email: { type: "string" },
    subject: { type: "string" },
    body: { type: "string" },
  },
  ["recipient_email", "subject", "body"],
)

export async function startStandIn(port) {
  const origin = `http://127.0.0.1:${port}`
  const send = (response, status, body, headers = {}) => {
    const html = typeof body === "string"
    response.writeHead(status, {
      "content-type": html ? "text/html; charset=utf-8" : "application/json",
      ...headers,
    })
    response.end(html ? body : JSON.stringify(body))
  }
  const read = async (request) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    return Buffer.concat(chunks).toString("utf8")
  }
  const calls = []
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", origin)
    const method = request.method ?? "GET"
    const path = url.pathname
    if (path.startsWith("/.well-known/oauth-protected-resource")) {
      return send(response, 200, { resource: `${origin}/oauth/mcp`, authorization_servers: [origin] })
    }
    if (path === "/.well-known/oauth-authorization-server") {
      return send(response, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      })
    }
    if (path === "/register" && method === "POST") {
      return send(response, 201, { ...JSON.parse(await read(request)), client_id: "guide", client_id_issued_at: 1 })
    }
    if (path === "/authorize") {
      const target = new URL(url.searchParams.get("redirect_uri") ?? origin)
      target.searchParams.set("state", url.searchParams.get("state") ?? "")
      target.searchParams.set("code", CODE)
      return send(response, 200, `<!doctype html><title>Stand-in</title><a href="${target.toString().replaceAll("&", "&amp;")}">Allow</a>`)
    }
    if (path === "/token" && method === "POST") {
      return send(response, 200, { access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 36000, refresh_token: "guide-refresh" })
    }
    if (path !== "/oauth/mcp") return send(response, 404, { error: "not_found" })
    if (request.headers.authorization !== `Bearer ${ACCESS_TOKEN}`) {
      return send(response, 401, { error: "unauthorized" }, {
        "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/oauth/mcp"`,
      })
    }
    if (method === "DELETE") return send(response, 200, {})
    if (method !== "POST") return send(response, 405, { error: "method_not_allowed" })
    const message = JSON.parse(await read(request))
    const result = (value) => send(response, 200, { jsonrpc: "2.0", id: message.id, result: value })
    const text = (value) => result({ content: [{ type: "text", text: JSON.stringify(value) }] })
    switch (message.method) {
      case "initialize":
        return result({
          protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "composio-stand-in", version: "1.0.0" },
        })
      case "notifications/initialized":
        response.writeHead(202)
        return response.end()
      case "ping":
        return result({})
      case "tools/list":
        return result({ tools: TOOLS })
      case "tools/call": {
        const { name, arguments: args = {} } = message.params ?? {}
        calls.push({ name, args })
        console.error(`[stand-in] ${name} ${JSON.stringify(args)}`)
        if (name === "COMPOSIO_SEARCH_TOOLS") {
          return text({
            data: {
              results: (args.queries ?? []).map((query, index) => ({
                index: index + 1,
                use_case: query.use_case,
                primary_tool_slugs: ["GMAIL_SEND_EMAIL"],
                related_tool_slugs: ["GMAIL_CREATE_EMAIL_DRAFT"],
                toolkits: ["gmail"],
              })),
              tool_schemas: { GMAIL_SEND_EMAIL: { description: "Send an email from the person's Gmail account.", input_parameters: GMAIL_SEND } },
              toolkit_connection_statuses: [
                { toolkit: "gmail", has_active_connection: true, current_user_info: { email: "sam@example.com" }, status_message: "Connected. Run the tool with COMPOSIO_MULTI_EXECUTE_TOOL." },
              ],
              session: { id: "sess_guide" },
              next_steps_guidance: ["Run GMAIL_SEND_EMAIL with COMPOSIO_MULTI_EXECUTE_TOOL."],
            },
            error: null,
            successful: true,
          })
        }
        if (name === "COMPOSIO_GET_TOOL_SCHEMAS") {
          return text({ data: { tool_schemas: { GMAIL_SEND_EMAIL: { input_parameters: GMAIL_SEND } } }, error: null, successful: true })
        }
        if (name === "COMPOSIO_MANAGE_CONNECTIONS") {
          return text({ data: { results: { gmail: { status: "active" } } }, error: null, successful: true })
        }
        if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
          return text({
            data: {
              success_count: (args.tools ?? []).length,
              error_count: 0,
              results: (args.tools ?? []).map((tool, index) => ({ index, tool_slug: tool.tool_slug, response: { successful: true, data: { id: "msg_1" } } })),
            },
            error: null,
            successful: true,
          })
        }
      }
      // falls through
      default:
        return send(response, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Not found" } })
    }
  })
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve))
  return { origin, calls, close: () => new Promise((resolve) => server.close(() => resolve())) }
}


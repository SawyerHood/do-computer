import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

const ACCESS_TOKEN = "e2e-access-token"
const CODE = "e2e-code"
export const FIXED_TOKEN = "e2e-fixed-token"

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
  { name: "today", description: "What is on today", inputSchema: { type: "object" } },
]

/**
 * A remote MCP server for the browser tests, with its own sign-in. `/token/mcp` wants a fixed
 * token; `/oauth/mcp` wants the user to sign in, which here is a page with Allow and Deny.
 */
export async function startFakeMcp(port = 0) {
  const server = createServer((request, response) => void handle(request, response))
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const send = (
    response: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) => {
    const html = typeof body === "string"
    response.writeHead(status, {
      "content-type": html ? "text/html; charset=utf-8" : "application/json",
      ...headers,
    })
    response.end(html ? body : JSON.stringify(body))
  }

  const read = async (request: IncomingMessage) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString("utf8")
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", origin)
    const method = request.method ?? "GET"
    const path = url.pathname

    if (path.startsWith("/.well-known/oauth-protected-resource")) {
      return path.endsWith("/oauth/mcp")
        ? send(response, 200, { resource: `${origin}/oauth/mcp`, authorization_servers: [origin] })
        : send(response, 404, { error: "not_found" })
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
        // It names itself in what it sends the user back with, and a client must look (RFC 9207).
        authorization_response_iss_parameter_supported: true,
      })
    }
    if (path === "/register" && method === "POST") {
      return send(response, 201, {
        ...JSON.parse(await read(request)),
        client_id: "e2e-client",
        client_id_issued_at: 1,
      })
    }
    if (path === "/authorize") {
      const back = (params: Record<string, string>) => {
        const target = new URL(url.searchParams.get("redirect_uri") ?? origin)
        target.searchParams.set("state", url.searchParams.get("state") ?? "")
        target.searchParams.set("iss", origin)
        for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value)
        return target.toString().replaceAll("&", "&amp;")
      }
      return send(
        response,
        200,
        `<!doctype html><title>Fake service</title><h1>Let Do Computer use your account?</h1>
         <a href="${back({ code: CODE })}">Allow</a>
         <a href="${back({ error: "access_denied", error_description: "You said no." })}">Deny</a>`,
      )
    }
    if (path === "/token" && method === "POST") {
      const form = new URLSearchParams(await read(request))
      if (form.get("grant_type") === "authorization_code" && form.get("code") !== CODE) {
        return send(response, 400, { error: "invalid_grant" })
      }
      return send(response, 200, {
        access_token: ACCESS_TOKEN,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "e2e-refresh",
      })
    }

    if (path !== "/token/mcp" && path !== "/oauth/mcp") {
      return send(response, 404, { error: "not_found" })
    }
    const authorization = request.headers.authorization
    if (path === "/token/mcp" && authorization !== `Bearer ${FIXED_TOKEN}`) {
      return send(response, 401, { error: "unauthorized" })
    }
    if (path === "/oauth/mcp" && authorization !== `Bearer ${ACCESS_TOKEN}`) {
      return send(
        response,
        401,
        { error: "unauthorized" },
        {
          "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/oauth/mcp"`,
        },
      )
    }
    if (method === "DELETE") return send(response, 200, {})
    if (method !== "POST") return send(response, 405, { error: "method_not_allowed" })

    const message = JSON.parse(await read(request)) as {
      id?: number | string
      method: string
      params?: { name?: string; arguments?: Record<string, number>; protocolVersion?: string }
    }
    const result = (value: unknown) =>
      send(response, 200, { jsonrpc: "2.0", id: message.id, result: value })
    const unknown = () =>
      send(response, 200, {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Not found" },
      })
    switch (message.method) {
      case "initialize":
        return result({
          protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-mcp", version: "1.0.0" },
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
        if (name === "add")
          return result({ content: [{ type: "text", text: `sum is ${args.a! + args.b!}` }] })
        if (name === "today") return result({ content: [{ type: "text", text: "Dentist at 3pm" }] })
        return unknown()
      }
      default:
        return unknown()
    }
  }

  return {
    origin,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

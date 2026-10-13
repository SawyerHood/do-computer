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

/** The address of the page the server has for its `forecast` tool. */
const APP_URI = "ui://weather/forecast"

/** Tools of a server that has a page for one of them, and tools for that page to use. */
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
]

/**
 * The page itself: an MCP App written by hand, with no library, so that what the app speaks to
 * is the standard and not somebody's reading of it. It says it is there, is told where it is
 * shown and what the tool answered, and has a button for each thing a page may ask. It also
 * tries what a page must not be able to do, and leaves how that went on its root.
 */
const APP_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Forecast</title>
<style>body{margin:0;padding:12px;font:14px var(--font-sans,sans-serif);color:var(--color-text-primary,#111)}
button{font:inherit;margin-right:6px}</style></head><body>
<h3 id="city" style="margin:0 0 4px">…</h3><p id="temp" style="margin:0 0 8px"></p>
<button id="refresh">Refresh</button><button id="book">Book a trip</button>
<button id="tell">Tell the Dood</button><button id="large">Larger</button><p id="log"></p>
<script>
var n = 0, waiting = {}, root = document.documentElement
function post(message) { parent.postMessage(message, "*") }
function ask(method, params) {
  var id = ++n
  return new Promise(function (done, fail) {
    waiting[id] = [done, fail]
    post({ jsonrpc: "2.0", id: id, method: method, params: params })
  })
}
function apply(context) {
  if (context.theme) root.dataset.theme = context.theme
  if (context.displayMode) root.dataset.mode = context.displayMode
  var variables = context.styles && context.styles.variables
  for (var name in variables) root.style.setProperty(name, variables[name])
}
function size() {
  var height = Math.ceil(root.getBoundingClientRect().height)
  post({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: height } })
}
addEventListener("message", function (event) {
  var said = event.data
  if (!said || said.jsonrpc !== "2.0") return
  if (said.id && waiting[said.id]) {
    var held = waiting[said.id]
    delete waiting[said.id]
    return said.error ? held[1](said.error) : held[0](said.result)
  }
  if (said.method === "ui/notifications/tool-input") city.textContent = said.params.arguments.city || "here"
  if (said.method === "ui/notifications/tool-result") temp.textContent = said.params.content[0].text
  if (said.method === "ui/notifications/host-context-changed") apply(said.params)
  size()
})
ask("ui/initialize", { protocolVersion: "2026-01-26", appInfo: { name: "forecast", version: "1" }, appCapabilities: {} })
  .then(function (result) {
    root.dataset.host = result.hostInfo.name
    apply(result.hostContext)
    post({ jsonrpc: "2.0", method: "ui/notifications/initialized" })
    size()
  })
function show(result) { log.textContent = result.content[0].text; size() }
function refused(error) { log.textContent = "refused: " + error.message; size() }
refresh.onclick = function () { ask("tools/call", { name: "refresh", arguments: {} }).then(show, refused) }
book.onclick = function () { ask("tools/call", { name: "book", arguments: {} }).then(show, refused) }
tell.onclick = function () {
  ask("ui/message", { role: "user", content: [{ type: "text", text: "Book the trip to " + city.textContent }] })
}
large.onclick = function () { ask("ui/request-display-mode", { mode: "fullscreen" }) }
var kept
try { kept = document["coo" + "kie"] } catch (error) { kept = "blocked" }
root.dataset.cookie = kept
fetch("/api/me").then(function () { root.dataset.api = "reached" }, function () { root.dataset.api = "blocked" })
</script></body></html>`

/**
 * A remote MCP server for the browser tests, with its own sign-in. `/token/mcp` wants a fixed
 * token; `/oauth/mcp` wants the user to sign in, which here is a page with Allow and Deny.
 * `/apps/mcp` wants nothing, and has a page for one of its tools.
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

    if (path !== "/token/mcp" && path !== "/oauth/mcp" && path !== "/apps/mcp") {
      return send(response, 404, { error: "not_found" })
    }
    const apps = path === "/apps/mcp"
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
      params?: {
        name?: string
        uri?: string
        arguments?: Record<string, number>
        protocolVersion?: string
      }
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
        return result({ tools: apps ? APP_TOOLS : TOOLS })
      case "resources/read":
        return apps && message.params?.uri === APP_URI
          ? result({
              contents: [{ uri: APP_URI, mimeType: "text/html;profile=mcp-app", text: APP_PAGE }],
            })
          : unknown()
      case "tools/call": {
        const { name, arguments: args = {} } = message.params ?? {}
        if (name === "add")
          return result({ content: [{ type: "text", text: `sum is ${args.a! + args.b!}` }] })
        if (name === "today") return result({ content: [{ type: "text", text: "Dentist at 3pm" }] })
        if (apps && name === "forecast") {
          return result({ content: [{ type: "text", text: "Sunny, 21 degrees" }] })
        }
        if (apps && (name === "refresh" || name === "book")) {
          return result({ content: [{ type: "text", text: `${name} done` }] })
        }
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

/**
 * An MCP App is a page a connector's own server gives for one of its tools: when the agent uses
 * the tool, the page is shown in the chat as a live view of what the tool answered, and the
 * page can ask the server for more. The standard is MCP Apps (SEP-1865):
 * https://github.com/modelcontextprotocol/ext-apps
 *
 * The page is somebody else's, so it is kept further apart than a page the agent drew: it is
 * shown in a frame whose origin is nobody's, it loads nothing but what its server said it
 * needs, and what it asks of the server goes through the app, which asks the person first
 * whenever a tool might change something.
 */

import type { Json, MessagePart, ToolPart } from "./chat.ts"

/** The version of the standard spoken here. */
export const MCP_APP_PROTOCOL_VERSION = "2026-01-26"
/** What a page that is an app says it is. */
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app"
/** What a client says it takes, for a server to offer its pages at all. */
export const MCP_APP_EXTENSION = "io.modelcontextprotocol/ui"
/** The largest page that is kept. */
export const MAX_MCP_APP_BYTES = 2 * 1024 * 1024
export const MCP_APP_MIN_HEIGHT = 60
export const MCP_APP_MAX_HEIGHT = 1600
/** How tall an app's frame is until the app has said how tall it is. */
export const MCP_APP_DEFAULT_HEIGHT = 280

/** The other origins a page says it needs, by what for. Anything it does not name is blocked. */
export type McpAppCsp = {
  /** Where its scripts may fetch from. */
  connectDomains?: string[]
  /** Where its scripts, styles, pictures, fonts and media may come from. */
  resourceDomains?: string[]
  /** What it may frame. */
  frameDomains?: string[]
  baseUriDomains?: string[]
}

/** What a tool's result carries for a client to show the server's page for it. */
export type McpAppRef = {
  /** The page as it was when the tool was used: the name it is kept under. */
  id: string
  /** The connector whose server gave it. */
  connectorId: string
  connector: string
  /** The server's own name for the tool. */
  tool: string
  /** The server's own address for the page: `ui://…`. */
  uri: string
  csp?: McpAppCsp
  /** The page asks for a line round it, or says it wants none. Unsaid, the client decides. */
  border?: boolean
}

/** A tool's answer as MCP has it, which the page is told. */
export type McpAppToolResult = {
  content: Json[]
  structuredContent?: { [key: string]: Json }
  isError?: boolean
}

/** What the details of a tool call hold when the tool has a page. */
export type McpAppDetails = { app: McpAppRef; input: Json; result: McpAppToolResult }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// Only a whole origin, with a `*.` in front of it at most: a keyword, a path, a quote or a
// space could widen the policy it is written into, or end it.
const ORIGIN = /^(?:https?|wss?):\/\/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d{1,5})?$/i
const MAX_ORIGINS = 24

function origins(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kept = value
    .filter((each): each is string => typeof each === "string" && each.length <= 200)
    .filter((each) => ORIGIN.test(each))
    .slice(0, MAX_ORIGINS)
  return kept.length === 0 ? undefined : kept
}

/** The part of what a page says it needs that is well formed. */
export function readMcpAppCsp(value: unknown): McpAppCsp | undefined {
  if (!isObject(value)) return undefined
  const csp: McpAppCsp = {}
  for (const key of [
    "connectDomains",
    "resourceDomains",
    "frameDomains",
    "baseUriDomains",
  ] as const) {
    const kept = origins(value[key])
    if (kept !== undefined) csp[key] = kept
  }
  return Object.keys(csp).length === 0 ? undefined : csp
}

/**
 * The policy a page is served under. Nothing loads from anywhere it did not name, and nothing
 * at all from the app's own address, which the page is served from but is no part of. Inline
 * scripts and styles run, since a page is one document; the frame's `sandbox` is what keeps
 * them from the app.
 */
export function mcpAppContentSecurityPolicy(csp: McpAppCsp | undefined): string {
  const from = (domains: string[] | undefined) => (domains ?? []).join(" ")
  const or = (domains: string[] | undefined) => (domains?.length ? domains.join(" ") : "'none'")
  const resources = from(csp?.resourceDomains)
  return [
    "sandbox allow-scripts allow-forms",
    "default-src 'none'",
    `script-src 'unsafe-inline' ${resources}`.trim(),
    `style-src 'unsafe-inline' ${resources}`.trim(),
    `img-src data: blob: ${resources}`.trim(),
    `font-src data: ${resources}`.trim(),
    `media-src data: blob: ${resources}`.trim(),
    `connect-src ${or(csp?.connectDomains)}`,
    `frame-src ${or(csp?.frameDomains)}`,
    "object-src 'none'",
    `base-uri ${or(csp?.baseUriDomains)}`,
    "form-action 'none'",
  ].join("; ")
}

/** The page a tool says it has: `_meta.ui.resourceUri`, or the older flat name for it. */
export function mcpAppUriOf(meta: unknown): string | undefined {
  if (!isObject(meta)) return undefined
  const uri = (isObject(meta.ui) ? meta.ui.resourceUri : undefined) ?? meta["ui/resourceUri"]
  return typeof uri === "string" && uri.startsWith("ui://") && uri.length <= 2000 ? uri : undefined
}

/**
 * Who a tool is for: the model, a page, or both, which is what a tool that does not say is
 * for. A tool for pages alone is not one the agent is given.
 */
export function mcpAppToolFor(meta: unknown): { model: boolean; app: boolean } {
  const visibility = isObject(meta) && isObject(meta.ui) ? meta.ui.visibility : undefined
  if (!Array.isArray(visibility)) return { model: true, app: true }
  return { model: visibility.includes("model"), app: visibility.includes("app") }
}

/** What a tool call's details say of the page to show for it, where they say it rightly. */
export function readMcpApp(details: unknown): McpAppDetails | undefined {
  if (!isObject(details) || !isObject(details.app) || !isObject(details.result)) return undefined
  const { id, connectorId, connector, tool, uri, csp, border } = details.app
  if (typeof id !== "string" || !/^[a-f0-9]{16,64}$/.test(id)) return undefined
  if (typeof connectorId !== "string" || typeof connector !== "string") return undefined
  if (typeof tool !== "string" || typeof uri !== "string" || !uri.startsWith("ui://")) {
    return undefined
  }
  const kept = readMcpAppCsp(csp)
  const { content, structuredContent, isError } = details.result
  return {
    app: {
      id,
      connectorId,
      connector,
      tool,
      uri,
      ...(kept === undefined ? {} : { csp: kept }),
      ...(typeof border === "boolean" ? { border } : {}),
    },
    input: (details.input ?? {}) as Json,
    result: {
      content: Array.isArray(content) ? (content as Json[]) : [],
      ...(isObject(structuredContent)
        ? { structuredContent: structuredContent as { [key: string]: Json } }
        : {}),
      ...(isError === true ? { isError: true } : {}),
    },
  }
}

/** Whether a part is a tool call that has a server's page to show for it. */
export function isMcpApp(part: MessagePart): part is ToolPart {
  return part.type === "tool" && part.status === "done" && readMcpApp(part.details) !== undefined
}

/** How tall an app's frame is, for a page that says it is `height` tall. */
export function mcpAppFrameHeight(height: number | undefined): number {
  return Math.min(
    MCP_APP_MAX_HEIGHT,
    Math.max(MCP_APP_MIN_HEIGHT, Math.round(height ?? MCP_APP_DEFAULT_HEIGHT)),
  )
}

/**
 * The app's colors and shapes under the names the standard gives them, each as the name of the
 * variable of ours it is. A client gives a page these with what each of ours is at that moment.
 */
export const MCP_APP_STYLE_NAMES: Readonly<Record<string, string>> = {
  "--color-background-primary": "--background",
  "--color-background-secondary": "--card",
  "--color-background-tertiary": "--muted",
  "--color-background-inverse": "--foreground",
  "--color-background-ghost": "--accent",
  "--color-background-danger": "--destructive",
  "--color-background-success": "--success",
  "--color-background-warning": "--warning",
  "--color-text-primary": "--foreground",
  "--color-text-secondary": "--muted-foreground",
  "--color-text-tertiary": "--muted-foreground",
  "--color-text-inverse": "--background",
  "--color-text-danger": "--destructive",
  "--color-text-success": "--success",
  "--color-text-warning": "--warning",
  "--color-border-primary": "--border",
  "--color-border-secondary": "--input",
  "--color-border-tertiary": "--border",
  "--color-border-danger": "--destructive",
  "--color-ring-primary": "--ring",
}

/** An answer to something a page asked. */
export const mcpAppResult = (id: string | number, result: unknown) =>
  ({ jsonrpc: "2.0", id, result }) as const

/** The answer to something a page asked that was not done, with why. */
export const mcpAppError = (id: string | number, message: string, code = -32000) =>
  ({ jsonrpc: "2.0", id, error: { code, message } }) as const

/** Something a page is told, which it does not answer. */
export const mcpAppNotice = (method: string, params: unknown) =>
  ({ jsonrpc: "2.0", method, params }) as const

/** What a page says, read as one of the two things it can be: something asked, or something told. */
export function readMcpAppMessage(
  data: unknown,
):
  | { id: string | number; method: string; params: Record<string, unknown> }
  | { id?: undefined; method: string; params: Record<string, unknown> }
  | undefined {
  if (!isObject(data) || data.jsonrpc !== "2.0" || typeof data.method !== "string") return undefined
  const params = isObject(data.params) ? data.params : {}
  if (data.id === undefined || data.id === null) return { method: data.method, params }
  if (typeof data.id !== "string" && !(typeof data.id === "number" && Number.isFinite(data.id))) {
    return undefined
  }
  return { id: data.id, method: data.method, params }
}

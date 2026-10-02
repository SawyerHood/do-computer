import type {
  AddConnectorRequest,
  ConnectorResult,
  ConnectorSummary,
} from "@durable-computer/protocol"
import type { SqliteDatabase } from "@durable-computer/runtime"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import { BlockedAddressError, checkConnectorAddress, guardedFetch } from "./connector-fetch.ts"
import {
  McpClient,
  type McpFetch,
  StreamableHttpTransport,
  type Tool as McpTool,
  toLlmContent,
} from "@earendil-works/pi-mcp"
import {
  adaptOAuthProvider,
  authorizeMcp,
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  type McpOAuthState,
} from "@earendil-works/pi-mcp/oauth"
import {
  defineDoc,
  defineExtension,
  type Extension,
  type Harness,
  type ToolRegistration,
} from "@earendil-works/pi-durable"

export const MAX_CONNECTORS = 20
/** Tools past this many per connector are not offered: every tool costs prompt space each turn. */
const MAX_TOOLS_PER_CONNECTOR = 60
const EXTENSION_NAME = "dc.connectors"
const CLIENT = { name: "durable-computer", version: "0.1.0" }

type ConnectorRecord = Omit<ConnectorSummary, "id">
type ConnectorsState = { connectors: Record<string, ConnectorRecord> }

/** What connectors exist and how they are doing. Holds nothing secret. */
export const ConnectorsDoc = defineDoc<ConnectorsState>({
  kind: "dc.connectors",
  version: 1,
  scope: "session",
  initial: () => ({ connectors: {} }),
})

/** Credentials and cached tool definitions. Kept in a table no tool can read. */
type Secrets = {
  /** Sent with every request, for a service that issued a fixed token. */
  headers?: Record<string, string>
  oauth?: McpOAuthState
  /** Where the service sends the user back after they sign in; fixed for a sign-in attempt. */
  redirectUrl?: string
  tools?: McpTool[]
}

export class ConnectorError extends Error {}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24) || "service"

/** A provider-safe tool name, at most 64 characters, that says which connector a tool is from. */
export function connectorToolName(connector: string, tool: string): string {
  return `${slug(connector)}__${tool.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64)
}

export type ConnectorsOptions = {
  readonly sql: SqliteDatabase
  readonly now: () => number
  /** Replace the installed tools when the set of connectors or their tools changes. */
  readonly install: (extension: Extension) => void
  readonly fetch?: McpFetch
  /**
   * Allow connectors on this machine and on private networks, and over plain http. Off by
   * default: the server makes these calls for whoever adds the connector.
   */
  readonly allowPrivateHosts?: boolean
}

/**
 * The agent's connectors: remote MCP servers whose tools it can call. Each is reached over HTTP
 * from the server, with a fixed token or with OAuth tokens the user granted; neither is ever in
 * the model's context or on the agent's computer.
 */
export class Connectors {
  readonly #options: ConnectorsOptions
  readonly #fetch: McpFetch
  readonly #clients = new Map<string, Promise<McpClient>>()
  #harness: Harness | undefined
  #ready: Promise<void> | undefined

  constructor(options: ConnectorsOptions) {
    this.#options = options
    this.#fetch = guardedFetch(
      options.fetch ?? ((input, init) => fetch(input, init)),
      options.allowPrivateHosts === true,
    )
  }

  /** Attach to the harness and offer the tools remembered from last time. */
  async attach(harness: Harness, context: Context): Promise<void> {
    this.#harness = harness
    await this.#prepare()
    await this.#reinstall(context)
  }

  #require(): Harness {
    if (this.#harness === undefined) throw new Error("Connectors are not attached to a harness")
    return this.#harness
  }

  #prepare(): Promise<void> {
    this.#ready ??= this.#options.sql.exec(
      "CREATE TABLE IF NOT EXISTS dc_connector_secrets (id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT",
    )
    return this.#ready
  }

  async #secrets(id: string): Promise<Secrets> {
    await this.#prepare()
    const row = await this.#options.sql.get<{ value: string }>(
      "SELECT value FROM dc_connector_secrets WHERE id = ?",
      id,
    )
    return row === undefined ? {} : (JSON.parse(row.value) as Secrets)
  }

  async #saveSecrets(id: string, change: (secrets: Secrets) => Secrets): Promise<void> {
    const next = change(await this.#secrets(id))
    await this.#options.sql.run(
      "INSERT INTO dc_connector_secrets (id, value) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value",
      id,
      JSON.stringify(next),
    )
  }

  #oauth(id: string, url: string, redirectUrl: string, onRedirect: (url: URL) => void) {
    return new McpOAuthProvider({
      serverUrl: url,
      redirectUrl,
      clientMetadata: { client_name: "durable computer" },
      store: {
        load: async () => (await this.#secrets(id)).oauth,
        save: (state) => this.#saveSecrets(id, (secrets) => ({ ...secrets, oauth: state })),
      },
      onRedirect,
    })
  }

  /** Open a connection. Rejects with `McpOAuthAuthorizationRequiredError` when the user must sign in. */
  async #open(
    id: string,
    url: string,
    onRedirect: (url: URL) => void = () => {},
  ): Promise<McpClient> {
    const secrets = await this.#secrets(id)
    const client = new McpClient(CLIENT)
    await client.connect(
      new StreamableHttpTransport({
        url,
        fetch: this.#fetch,
        headers: secrets.headers,
        // Only requests and their answers are needed; no stream is held open between calls.
        openGetStream: false,
        authProvider:
          secrets.headers === undefined && secrets.redirectUrl !== undefined
            ? adaptOAuthProvider(this.#oauth(id, url, secrets.redirectUrl, onRedirect))
            : undefined,
      }),
    )
    return client
  }

  /** A connection for calling tools, shared between calls and reopened if it was lost. */
  #client(id: string, url: string): Promise<McpClient> {
    let client = this.#clients.get(id)
    if (client === undefined) {
      client = this.#open(id, url)
      this.#clients.set(id, client)
      client.then(
        (opened) => opened.onClose(() => this.#clients.delete(id)),
        () => this.#clients.delete(id),
      )
    }
    return client
  }

  #drop(id: string): void {
    const client = this.#clients.get(id)
    this.#clients.delete(id)
    void client?.then((opened) => opened.close()).catch(() => {})
  }

  async list(context: Context): Promise<ConnectorSummary[]> {
    const connectors = (await this.#require().snapshot(ConnectorsDoc, context))?.connectors ?? {}
    return Object.entries(connectors)
      .map(([id, record]) => ({ id, ...record, tools: record.tools.map((tool) => ({ ...tool })) }))
      .sort((a, b) => a.addedAt - b.addedAt)
  }

  /** The connector a tool the agent can call belongs to, if it is one of a connector's. */
  async connectorOf(
    toolName: string,
    context: Context,
  ): Promise<{ id: string; name: string } | undefined> {
    for (const connector of await this.list(context)) {
      if (connector.tools.some((tool) => connectorToolName(connector.name, tool.name) === toolName))
        return { id: connector.id, name: connector.name }
    }
    return undefined
  }

  async #get(id: string, context: Context): Promise<ConnectorSummary> {
    const found = (await this.list(context)).find((connector) => connector.id === id)
    if (found === undefined) throw new ConnectorError("There is no such connector.")
    return found
  }

  /** Add a connector and try to connect. `redirectUrl` is where a sign-in sends the user back. */
  async add(
    input: AddConnectorRequest,
    redirectUrl: string,
    context: Context,
  ): Promise<ConnectorResult> {
    const name = input.name?.trim()
    if (!name || name.length > 60)
      throw new ConnectorError("Give the connector a name of up to 60 characters.")
    let url: URL
    try {
      url = checkConnectorAddress(input.url.trim(), this.#options.allowPrivateHosts === true)
    } catch (error) {
      throw new ConnectorError(
        error instanceof BlockedAddressError ? error.message : `"${input.url}" is not a URL.`,
      )
    }
    // Starts with a letter so that it is never mistaken for a number, as "12345678" or "1e234567"
    // would be by anything that parses a URL's query the way JSON is parsed.
    const id = `c${crypto.randomUUID().slice(0, 8)}`
    await this.#require().commit(async (tx) => {
      const { connectors } = await tx.doc(ConnectorsDoc)
      if (Object.keys(connectors).length >= MAX_CONNECTORS) {
        throw new ConnectorError(
          `There are already ${MAX_CONNECTORS} connectors. Remove one first.`,
        )
      }
      if (Object.values(connectors).some((other) => slug(other.name) === slug(name))) {
        throw new ConnectorError(`There is already a connector called "${name}".`)
      }
      connectors[id] = {
        name,
        url: url.toString(),
        enabled: true,
        status: "error",
        error: "Not connected yet.",
        tools: [],
        addedAt: this.#options.now(),
      }
    }, context)
    const token = input.token?.trim()
    await this.#saveSecrets(id, () =>
      token ? { headers: { authorization: `Bearer ${token}` } } : { redirectUrl },
    )
    return this.connect(id, redirectUrl, context)
  }

  /** Connect, or reconnect, and refresh the tools. Says where to send the user if they must sign in. */
  async connect(id: string, redirectUrl: string, context: Context): Promise<ConnectorResult> {
    const connector = await this.#get(id, context)
    this.#drop(id)
    await this.#saveSecrets(id, (secrets) =>
      secrets.headers ? secrets : { ...secrets, redirectUrl },
    )
    let authorizationUrl: string | undefined
    let outcome: Pick<ConnectorRecord, "status" | "error">
    let tools: McpTool[] = []
    try {
      const client = await this.#open(
        id,
        connector.url,
        (url) => void (authorizationUrl = url.toString()),
      )
      try {
        tools = (await client.listTools()).slice(0, MAX_TOOLS_PER_CONNECTOR)
      } finally {
        await client.close().catch(() => {})
      }
      outcome = { status: "connected", error: null }
    } catch (error) {
      if (error instanceof McpOAuthAuthorizationRequiredError && authorizationUrl !== undefined) {
        outcome = { status: "needs_auth", error: null }
      } else {
        outcome = { status: "error", error: error instanceof Error ? error.message : String(error) }
      }
    }
    await this.#saveSecrets(id, (secrets) => ({ ...secrets, tools }))
    await this.#require().commit(async (tx) => {
      const record = (await tx.doc(ConnectorsDoc)).connectors[id]
      if (record === undefined) return
      record.status = outcome.status
      record.error = outcome.error
      record.tools = tools.map((tool) => ({
        name: tool.name,
        description: (tool.description ?? tool.title ?? "").slice(0, 300),
      }))
    }, context)
    await this.#reinstall(context)
    return { connector: await this.#get(id, context), authorizationUrl }
  }

  /** The value the service will hand back with the user after they sign in, to match them up. */
  async pendingState(id: string): Promise<string | undefined> {
    return (await this.#secrets(id)).oauth?.oauthState
  }

  /** Finish a sign-in with the code the service sent the user back with, then connect. */
  async authorize(id: string, code: string, context: Context): Promise<ConnectorResult> {
    const connector = await this.#get(id, context)
    const { redirectUrl } = await this.#secrets(id)
    if (redirectUrl === undefined)
      throw new ConnectorError("That connector is not waiting for a sign-in.")
    try {
      await authorizeMcp(
        this.#oauth(id, connector.url, redirectUrl, () => {}),
        {
          serverUrl: connector.url,
          authorizationCode: code,
          fetch: this.#fetch,
        },
      )
    } catch (error) {
      throw new ConnectorError(
        `The sign-in could not be completed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return this.connect(id, redirectUrl, context)
  }

  async setEnabled(id: string, enabled: boolean, context: Context): Promise<ConnectorSummary> {
    await this.#require().commit(async (tx) => {
      const record = (await tx.doc(ConnectorsDoc)).connectors[id]
      if (record === undefined) throw new ConnectorError("There is no such connector.")
      record.enabled = enabled
    }, context)
    await this.#reinstall(context)
    return this.#get(id, context)
  }

  async remove(id: string, context: Context): Promise<void> {
    await this.#require().commit(async (tx) => {
      const { connectors } = await tx.doc(ConnectorsDoc)
      if (connectors[id] === undefined) throw new ConnectorError("There is no such connector.")
      delete connectors[id]
    }, context)
    this.#drop(id)
    await this.#options.sql.run("DELETE FROM dc_connector_secrets WHERE id = ?", id)
    await this.#reinstall(context)
  }

  async close(): Promise<void> {
    for (const id of [...this.#clients.keys()]) this.#drop(id)
  }

  /** Offer the tools of every enabled, connected connector, replacing the previous set. */
  async #reinstall(context: Context): Promise<void> {
    const tools: ToolRegistration[] = []
    for (const connector of await this.list(context)) {
      if (!connector.enabled || connector.status !== "connected") continue
      for (const tool of (await this.#secrets(connector.id)).tools ?? []) {
        tools.push(this.#tool(connector, tool))
      }
    }
    this.#options.install(defineExtension({ name: EXTENSION_NAME, tools }))
  }

  #tool(connector: ConnectorSummary, tool: McpTool): ToolRegistration {
    return {
      name: connectorToolName(connector.name, tool.name),
      description: `[${connector.name}] ${tool.description ?? tool.title ?? tool.name}`,
      // Providers need an object schema, and some reject one without `properties`.
      parameters: Type.Unsafe({
        ...tool.inputSchema,
        type: "object",
        properties: (tool.inputSchema.properties as object | undefined) ?? {},
      }),
      execute: async (args, _api, context) => {
        const call = async () => {
          const client = await this.#client(connector.id, connector.url)
          return client.callTool(tool.name, args as Record<string, unknown>, {
            signal: context.abortSignal,
          })
        }
        try {
          let result
          try {
            result = await call()
          } catch (error) {
            if (error instanceof McpOAuthAuthorizationRequiredError) throw error
            // The connection may simply have gone stale; one fresh attempt.
            this.#drop(connector.id)
            result = await call()
          }
          // MCP reports a failing tool in its result, not as a protocol error.
          return { content: toLlmContent(result), isError: result.isError === true }
        } catch (error) {
          const message =
            error instanceof McpOAuthAuthorizationRequiredError
              ? `${connector.name} needs the user to sign in again. Ask them to reconnect it under Connectors.`
              : `${connector.name} could not be reached: ${error instanceof Error ? error.message : String(error)}`
          return { isError: true, content: [{ type: "text", text: message }] }
        }
      },
    }
  }
}

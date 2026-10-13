import type { AddConnectorRequest, ConnectorResult, ConnectorSummary } from "@do-computer/protocol"
import type { SqliteDatabase } from "@do-computer/runtime"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import { BlockedAddressError, checkAddress, guardedFetch } from "./guarded-fetch.ts"
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
  type Conversation,
  type ConversationId,
  defineDoc,
  defineExtension,
  defineTool,
  type Extension,
  type Harness,
  section,
  type ToolRegistration,
} from "@earendil-works/pi-durable"
import type { Caller } from "./caller.ts"
import { ChatsDoc } from "./docs.ts"
import { own } from "./own.ts"

export const MAX_CONNECTORS = 20
/** Tools past this many per connector are not offered: every tool costs prompt space each turn. */
const MAX_TOOLS_PER_CONNECTOR = 60
const EXTENSION_NAME = "dc.connectors"
const TOOL = "connectors"
/** How many of a connector's tools are named when the agent lists its connectors. */
const MAX_TOOLS_NAMED = 12
/**
 * The most text one call's answer may carry into the conversation. A mailbox or a long document
 * comes back whole otherwise, and is then paid for on every turn after.
 */
const MAX_RESULT_CHARS = 60_000

/** What the connector that reaches people's own accounts on other services is called. */
export const APPS_NAME = "Apps"
/** Composio's MCP server, which each person signs in to with a Composio account of their own. */
export const APPS_URL = "https://connect.composio.dev/mcp"
/**
 * Its tools that only look things up, or hand back a link to sign in to a service with. They
 * are not asked about: whatever does things in someone's account is.
 */
const APPS_LOOKUPS = [
  "COMPOSIO_SEARCH_TOOLS",
  "COMPOSIO_GET_TOOL_SCHEMAS",
  "COMPOSIO_MANAGE_CONNECTIONS",
]

/** An answer's text, cut where it is longer than a conversation should carry. */
function bounded<T extends { type: string }>(content: T[]): T[] {
  let left = MAX_RESULT_CHARS
  return content.map((part) => {
    const text = (part as { text?: unknown }).text
    if (part.type !== "text" || typeof text !== "string") return part
    if (text.length <= left) {
      left -= text.length
      return part
    }
    const kept = text.slice(0, left)
    left = 0
    return {
      ...part,
      text: `${kept}\n[Cut here: ${text.length - kept.length} more characters were left out. Ask for less at a time: fewer results, or only the fields you need.]`,
    }
  })
}

/** Entry kind of how a sign-in the agent asked for went, in the chat that asked. */
export const CONNECTOR_ENTRY = "dc.connector"

/** What the agent is told to set it going on an answer. Not shown in the chat. */
const NUDGE =
  '<meta kind="connector">Word about a connector you asked for is above. Carry on with what you wanted it for, or tell the user where things stand.</meta>'

type Turn = Awaited<ReturnType<Conversation["submit"]>>
const CLIENT = { name: "do-computer", version: "0.1.0" }

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
  /** An app registered with the service by hand, for one that does not let an app register itself. */
  client?: { id: string; secret?: string }
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
  /** Looks a host name up, where the runtime can, so a name pointing inside is refused too. */
  readonly resolveHost?: (hostname: string) => Promise<readonly string[]>
  /**
   * Where a service sends someone back after they sign in, when the app's address is known.
   * Without it the agent cannot add or reconnect a connector itself: only the app can.
   */
  readonly redirectUrl?: () => string | undefined
  /**
   * Ask the person, from a chat, to type the access token of a connector that is reached with
   * one. It is added once they have. Absent: the agent cannot add such a connector.
   */
  readonly askToken?: (
    input: { chatId: string; name: string; url: string },
    context: Context,
  ) => Promise<{ fresh: boolean }>
  /** Where Apps is. Only a test's stand-in is anywhere but at Composio. */
  readonly appsUrl?: string
  /** Called with the id of an Apps connector when it is added, before it is connected. */
  readonly appsAdded?: (connectorId: string, context: Context) => Promise<void>
}

const fail = (text: string) => ({ isError: true, output: [{ type: "text" as const, text }] })

/** A name as it is written into a note for the model, which it must not be able to end. */
const personOf = (caller: Caller | undefined) =>
  (caller?.name ?? "")
    .replace(/[<>\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "The person"

const toolsOf = (connector: ConnectorSummary) => {
  const names = connector.tools.map((tool) => connectorToolName(connector.name, tool.name))
  const named = names.slice(0, MAX_TOOLS_NAMED).join(", ")
  return names.length > MAX_TOOLS_NAMED
    ? `${named} and ${names.length - MAX_TOOLS_NAMED} more`
    : named
}

/** How a connector is doing, in a few words. */
function stateOf(connector: ConnectorSummary): string {
  if (!connector.enabled) return "turned off"
  if (connector.status === "needs_auth") return "waiting for someone to sign in"
  if (connector.status === "error") return `not connected: ${connector.error ?? "no answer"}`
  return `connected, ${connector.tools.length} tool${connector.tools.length === 1 ? "" : "s"}`
}

/**
 * The agent's connectors: remote MCP servers whose tools it can call. Each is reached over HTTP
 * from the server, with a fixed token or with OAuth tokens the user granted; neither is ever in
 * the model's context or on the agent's computer.
 */
export class Connectors {
  /** The tool the agent sees and changes its connectors with, and what it is told of them. */
  readonly extension: Extension
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
      { resolve: options.resolveHost },
    )
    this.extension = defineExtension({
      name: "dc.connectors.manage",
      tools: [this.#manage()],
      sections: [
        section("connectors", async (input, context) => {
          const connectors = Object.values(
            (await input.read.snapshot(ConnectorsDoc, context))?.connectors ?? {},
          ).sort((a, b) => a.addedAt - b.addedAt)
          const apps = connectors.find((connector) => connector.kind === "apps")
          const how = `A connector is another service whose tools become yours: a calendar, an issue tracker, a database. The \`${TOOL}\` tool lists yours and adds one from the address of its MCP server.${
            apps === undefined
              ? ` Its "add_apps" adds ${APPS_NAME}, which reaches the person's own accounts on other services (mail, calendars, documents, chat, code and many more) once they sign in to it: add it when they ask for something in one of their accounts and no connector of yours covers it.`
              : apps.status === "connected"
                ? ` ${APPS_NAME} reaches the person's own accounts on other services (mail, calendars, documents, chat, code and many more). Search it for the tools a task needs. Where an account is not connected yet it gives you a link: show the person that link to click, and go on once they say they have signed in.`
                : ""
          }`
          if (connectors.length === 0) return `${how} You have none yet.`
          return `${how}\n${connectors
            .map((connector) => `- ${connector.name}: ${stateOf({ id: "", ...connector })}`)
            .join("\n")}`
        }),
      ],
    })
  }

  /** Attach to the harness and offer the tools remembered from last time. */
  async attach(harness: Harness, context: Context): Promise<void> {
    this.#harness = harness
    this.#options.install(this.extension)
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

  #oauth(
    id: string,
    url: string,
    redirectUrl: string,
    client: Secrets["client"],
    onRedirect: (url: URL) => void,
  ) {
    return new McpOAuthProvider({
      serverUrl: url,
      redirectUrl,
      clientMetadata: { client_name: "Do Computer" },
      ...(client === undefined
        ? {}
        : {
            clientId: client.id,
            ...(client.secret === undefined ? {} : { clientSecret: client.secret }),
          }),
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
            ? adaptOAuthProvider(
                this.#oauth(id, url, secrets.redirectUrl, secrets.client, onRedirect),
              )
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
      if (
        connector.tools.some((tool) => connectorToolName(connector.name, tool.name) === toolName)
      ) {
        const lookup =
          connector.kind === "apps" &&
          APPS_LOOKUPS.some((name) => connectorToolName(connector.name, name) === toolName)
        return lookup ? undefined : { id: connector.id, name: connector.name }
      }
    }
    return undefined
  }

  async #get(id: string, context: Context): Promise<ConnectorSummary> {
    const found = (await this.list(context)).find((connector) => connector.id === id)
    if (found === undefined) throw new ConnectorError("There is no such connector.")
    return found
  }

  /**
   * Add a connector and try to connect. `redirectUrl` is where a sign-in sends the user back.
   * `askedIn` is the chat the agent added it from, where it is told how a sign-in went.
   */
  async add(
    request: AddConnectorRequest,
    redirectUrl: string,
    context: Context,
    askedIn?: string,
  ): Promise<ConnectorResult> {
    const appsUrl = this.#options.appsUrl ?? APPS_URL
    if ("apps" in request) {
      // There is one of it: asked for again, the one there is is tried again.
      const existing = (await this.list(context)).find((connector) => connector.kind === "apps")
      if (existing !== undefined) return this.connect(existing.id, redirectUrl, context, askedIn)
    }
    const input: Exclude<AddConnectorRequest, { apps: true }> =
      "apps" in request ? { name: APPS_NAME, url: appsUrl } : request
    const name = input.name?.trim()
    if (!name || name.length > 60)
      throw new ConnectorError("Give the connector a name of up to 60 characters.")
    let url: URL
    try {
      url = checkAddress(input.url.trim(), this.#options.allowPrivateHosts === true)
    } catch (error) {
      throw new ConnectorError(
        error instanceof BlockedAddressError ? error.message : `"${input.url}" is not a URL.`,
      )
    }
    // Starts with a letter so that it is never mistaken for a number, as "12345678" or "1e234567"
    // would be by anything that parses a URL's query the way JSON is parsed.
    const id = `c${crypto.randomUUID().slice(0, 8)}`
    // Its address is what makes it Apps, however it came to be added.
    const apps = url.toString() === new URL(appsUrl).toString()
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
        ...(apps ? { kind: "apps" as const } : {}),
        enabled: true,
        status: "error",
        error: "Not connected yet.",
        tools: [],
        addedAt: this.#options.now(),
      }
    }, context)
    const token = input.token?.trim()
    const clientId = input.clientId?.trim()
    const clientSecret = input.clientSecret?.trim()
    await this.#saveSecrets(id, () =>
      token
        ? { headers: { authorization: `Bearer ${token}` } }
        : {
            redirectUrl,
            ...(clientId
              ? { client: { id: clientId, ...(clientSecret ? { secret: clientSecret } : {}) } }
              : {}),
          },
    )
    if (apps) await this.#options.appsAdded?.(id, context)
    return this.connect(id, redirectUrl, context, askedIn)
  }

  /**
   * Connect, or reconnect, and refresh the tools. Says where to send the user if they must sign
   * in. `askedIn` is the chat the agent did this from, which waits there for a sign-in.
   */
  async connect(
    id: string,
    redirectUrl: string,
    context: Context,
    askedIn?: string,
  ): Promise<ConnectorResult> {
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
      const record = own((await tx.doc(ConnectorsDoc)).connectors, id)
      if (record === undefined) return
      record.status = outcome.status
      record.error = outcome.error
      // Someone is waited for only while there is a sign-in to wait for.
      if (outcome.status !== "needs_auth") delete record.askedIn
      else if (askedIn !== undefined) record.askedIn = askedIn
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

  /**
   * Finish a sign-in with the code the service sent the user back with, then connect. `iss` is who
   * the service said it was when it did (RFC 9207): the code is used only if that is the service
   * being signed in to. Where the agent asked for the connector from a chat, it is told there how
   * it went, and `chatId` and `turn` are that chat and the turn it is given.
   */
  async authorize(
    id: string,
    { code, iss }: { code: string; iss?: string },
    context: Context,
    by?: Caller,
  ): Promise<ConnectorResult & { chatId?: string; turn?: Turn }> {
    const connector = await this.#get(id, context)
    const askedIn = connector.askedIn
    const { redirectUrl, client } = await this.#secrets(id)
    if (redirectUrl === undefined)
      throw new ConnectorError("That connector is not waiting for a sign-in.")
    try {
      await authorizeMcp(
        this.#oauth(id, connector.url, redirectUrl, client, () => {}),
        {
          serverUrl: connector.url,
          authorizationCode: code,
          ...(iss === undefined ? {} : { iss }),
          fetch: this.#fetch,
        },
      )
    } catch (error) {
      throw new ConnectorError(
        `The sign-in could not be completed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const result = await this.connect(id, redirectUrl, context)
    if (askedIn === undefined) return result
    const who = personOf(by)
    const now = result.connector
    const turn = await this.#tell(
      askedIn,
      `signed-in:${id}:${this.#options.now()}`,
      {
        name: now.name,
        connected: now.status === "connected",
        by: who,
        text:
          now.status === "connected"
            ? `${who} signed in to the connector "${now.name}". It is connected and offers ${now.tools.length} tool${now.tools.length === 1 ? "" : "s"}${now.tools.length === 0 ? "" : `: ${toolsOf(now)}`}. They are yours to use from your next step.`
            : `${who} signed in to the connector "${now.name}", but it is still not connected: ${now.error ?? "it wants another sign-in"}.`,
        ...(now.status === "connected"
          ? {}
          : { problem: now.error ?? "It wants another sign-in." }),
      },
      context,
    )
    return { ...result, chatId: askedIn, ...(turn === undefined ? {} : { turn }) }
  }

  /**
   * The person chose not to sign in to a connector the agent asked for. It stops being offered
   * beside the chat, and the agent is told. Resolves with the turn it is given, if any.
   */
  async dismiss(id: string, context: Context, by?: Caller): Promise<Turn | undefined> {
    const asked = await this.#require().commit(async (tx) => {
      const record = own((await tx.doc(ConnectorsDoc)).connectors, id)
      if (record === undefined) throw new ConnectorError("There is no such connector.")
      const chatId = record.askedIn
      delete record.askedIn
      return chatId === undefined ? undefined : { chatId, name: record.name }
    }, context)
    if (asked === undefined) return undefined
    const who = personOf(by)
    return this.#tell(
      asked.chatId,
      `dismissed:${id}:${this.#options.now()}`,
      {
        name: asked.name,
        connected: false,
        by: who,
        text: `${who} chose not to sign in to the connector "${asked.name}" for now. It stays added and is not connected. Do not ask again unless they bring it up; carry on without it.`,
      },
      context,
    )
  }

  /** Say in a chat how a connector the agent asked for there got on, and give it a turn. */
  async #tell(
    chatId: string,
    key: string,
    told: { name: string; connected: boolean; by: string; text: string; problem?: string },
    context: Context,
  ): Promise<Turn | undefined> {
    const harness = this.#require()
    if (!/^\d+$/.test(chatId)) return undefined
    const chat = own((await harness.snapshot(ChatsDoc, context))?.chats ?? {}, chatId)
    const conversation = await harness.conversation(Number(chatId) as ConversationId, context)
    if (chat === undefined || conversation === undefined) return undefined
    await conversation.submit(
      {
        type: "write",
        requestId: `connector-note:${key}`,
        entry: {
          kind: CONNECTOR_ENTRY,
          model: [{ role: "user", content: `[${told.text}]`, timestamp: Date.now() }],
          data: {
            name: told.name,
            connected: told.connected,
            by: told.by,
            ...(told.problem === undefined ? {} : { problem: told.problem }),
          },
        },
      },
      context,
    )
    return conversation.submit(
      {
        type: "input",
        requestId: `connector-turn:${key}`,
        content: [{ type: "text", text: NUDGE }],
        whenBusy: "followUp",
      },
      context,
    )
  }

  async setEnabled(id: string, enabled: boolean, context: Context): Promise<ConnectorSummary> {
    await this.#require().commit(async (tx) => {
      const record = own((await tx.doc(ConnectorsDoc)).connectors, id)
      if (record === undefined) throw new ConnectorError("There is no such connector.")
      record.enabled = enabled
    }, context)
    await this.#reinstall(context)
    return this.#get(id, context)
  }

  async remove(id: string, context: Context): Promise<void> {
    await this.#require().commit(async (tx) => {
      const { connectors } = await tx.doc(ConnectorsDoc)
      if (own(connectors, id) === undefined) {
        throw new ConnectorError("There is no such connector.")
      }
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

  /** The tool the agent sees and changes its connectors with. */
  #manage() {
    return defineTool({
      name: TOOL,
      description:
        "See and change your connectors: other services, reached as MCP servers, whose tools become yours. " +
        'action "list" shows each one, how it is doing and the tools it gives you. "add" needs `name` (what to call it) and `url` (the address of its MCP server, which the person or its documentation gives you). ' +
        "If the service has people sign in, a Sign in button appears for the person beside the chat, and you are told here once they have. If it is reached with an access token instead, pass `needs_token: true`: the person is asked to type it into a form, and you never see it. Never ask for a token in the chat. " +
        '"reconnect" tries one again; "enable" and "disable" turn one on and off; "remove" deletes it. Each of those needs `name`, from the list. ' +
        `"add_apps" adds ${APPS_NAME}, the connector that reaches the person's own accounts on other services through Composio, and needs nothing else: they sign in to it from the Sign in button.`,
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal("list"),
          Type.Literal("add"),
          Type.Literal("add_apps"),
          Type.Literal("reconnect"),
          Type.Literal("enable"),
          Type.Literal("disable"),
          Type.Literal("remove"),
        ]),
        name: Type.Optional(Type.String({ description: "The connector: its name or id" })),
        url: Type.Optional(Type.String({ description: "For add: the address of its MCP server" })),
        needs_token: Type.Optional(
          Type.Boolean({
            description: "For add: the service is reached with an access token the person has",
          }),
        ),
      }),
      execute: async (args, api, context) => {
        const reply = (text: string, connector?: ConnectorSummary) => ({
          output: [{ type: "text" as const, text }],
          ...(connector === undefined
            ? {}
            : {
                details: {
                  connectorId: connector.id,
                  name: connector.name,
                  status: connector.status,
                },
              }),
        })
        const connectors = await this.list(context)
        if (args.action === "list") {
          return reply(
            connectors.length === 0
              ? 'You have no connectors. "add" one from the address of its MCP server.'
              : connectors
                  .map(
                    (connector) =>
                      `- ${connector.name} (id ${connector.id}, ${connector.url}): ${stateOf(connector)}${
                        connector.enabled &&
                        connector.status === "connected" &&
                        connector.tools.length > 0
                          ? `. Tools: ${toolsOf(connector)}`
                          : ""
                      }`,
                  )
                  .join("\n"),
          )
        }
        const chatId = String(api.conversationId)
        const kind = own((await api.snapshot(ChatsDoc, context))?.chats ?? {}, chatId)?.kind
        if (kind !== "chat") {
          return fail("Only a conversation with the user can change connectors.")
        }
        if (args.action === "add_apps") {
          const redirectUrl = this.#options.redirectUrl?.()
          if (redirectUrl === undefined) {
            return fail(
              "A connector cannot be added from here, because the address of the app is not known. The person can add it under Connectors.",
            )
          }
          try {
            const { connector } = await this.add({ apps: true }, redirectUrl, context, chatId)
            return reply(
              `${this.#outcome("Added", connector)}${
                connector.status === "needs_auth"
                  ? " What they sign in to is Composio, with an account of their own, which is free to make."
                  : ""
              }`,
              connector,
            )
          } catch (error) {
            if (error instanceof ConnectorError) return fail(error.message)
            throw error
          }
        }
        const wanted = (args.name ?? "").trim()
        if (wanted === "") return fail(`"${args.action}" needs name.`)
        try {
          if (args.action === "add") {
            const url = (args.url ?? "").trim()
            if (url === "") return fail('"add" needs url, the address of the MCP server.')
            if (args.needs_token === true) {
              const ask = this.#options.askToken
              if (ask === undefined) {
                return fail(
                  "A connector that needs an access token can only be added from the app, under Connectors.",
                )
              }
              // Checked now, so that the person is not asked for a token that has nowhere to go.
              try {
                checkAddress(url, this.#options.allowPrivateHosts === true)
              } catch (error) {
                return fail(
                  error instanceof BlockedAddressError ? error.message : `"${url}" is not a URL.`,
                )
              }
              if (connectors.some((other) => slug(other.name) === slug(wanted))) {
                return fail(`There is already a connector called "${wanted}".`)
              }
              const { fresh } = await ask({ chatId, name: wanted, url }, context)
              return reply(
                fresh
                  ? `Asked the person for the access token of "${wanted}". A form is in front of them, above their message box; the connector is added once they fill it in, and you are told here. Do not wait for it or ask again, and do not ask them to paste the token into the chat.`
                  : `You have already asked for the access token of "${wanted}", and the person has not answered yet. Do not ask again.`,
              )
            }
            const redirectUrl = this.#options.redirectUrl?.()
            if (redirectUrl === undefined) {
              return fail(
                "A connector cannot be added from here, because the address of the app is not known. The person can add it under Connectors.",
              )
            }
            const { connector } = await this.add(
              { name: wanted, url },
              redirectUrl,
              context,
              chatId,
            )
            return reply(this.#outcome("Added", connector), connector)
          }
          const matches = connectors.filter(
            (connector) =>
              connector.id === wanted || connector.name.toLowerCase() === wanted.toLowerCase(),
          )
          if (matches.length !== 1) {
            return fail(
              connectors.length === 0
                ? `There is no connector "${wanted}": you have none.`
                : `There is no connector "${wanted}". You have: ${connectors.map((connector) => connector.name).join(", ")}.`,
            )
          }
          const found = matches[0]!
          switch (args.action) {
            case "reconnect": {
              const redirectUrl = this.#options.redirectUrl?.()
              if (redirectUrl === undefined) {
                return fail(
                  "A connector cannot be reconnected from here, because the address of the app is not known. The person can do it under Connectors.",
                )
              }
              const { connector } = await this.connect(found.id, redirectUrl, context, chatId)
              return reply(this.#outcome("Tried", connector), connector)
            }
            case "enable":
            case "disable": {
              const connector = await this.setEnabled(found.id, args.action === "enable", context)
              return reply(
                args.action === "enable"
                  ? `Turned on "${connector.name}": ${stateOf(connector)}.`
                  : `Turned off "${connector.name}". Its tools are no longer yours until it is turned on again.`,
                connector,
              )
            }
            case "remove":
              await this.remove(found.id, context)
              return reply(`Removed the connector "${found.name}", and its tools with it.`)
          }
        } catch (error) {
          if (error instanceof ConnectorError) return fail(error.message)
          throw error
        }
      },
    })
  }

  /** What to tell the agent about a connector it has just added or tried again. */
  #outcome(did: "Added" | "Tried", connector: ConnectorSummary): string {
    const lead = did === "Added" ? `Added the connector "${connector.name}"` : `"${connector.name}"`
    if (connector.status === "connected") {
      return `${lead}${did === "Added" ? ". It" : ""} is connected and offers ${connector.tools.length} tool${connector.tools.length === 1 ? "" : "s"}${connector.tools.length === 0 ? "" : `: ${toolsOf(connector)}`}. They are yours to use from your next step.`
    }
    if (connector.status === "needs_auth") {
      return `${lead}${did === "Added" ? ". It" : ""} needs the person to sign in to the service. A Sign in button is in front of them, above their message box. You will be told here once they have, which may take a while: do not wait for it or try again. Tell them in a sentence what you added and why.`
    }
    return `${lead}${did === "Added" ? ", but it" : ""} could not be connected: ${connector.error ?? "it did not answer"}. If the address is wrong, remove it and add it again with the right one. If it needs an access token, remove it and add it again with needs_token.`
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
          return { output: bounded(toLlmContent(result)), isError: result.isError === true }
        } catch (error) {
          const message =
            error instanceof McpOAuthAuthorizationRequiredError
              ? `${connector.name} needs the user to sign in again. Ask them to reconnect it under Connectors.`
              : `${connector.name} could not be reached: ${error instanceof Error ? error.message : String(error)}`
          return { isError: true, output: [{ type: "text", text: message }] }
        }
      },
    }
  }
}

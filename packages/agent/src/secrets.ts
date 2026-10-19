import {
  type AddConnectorRequest,
  type ConnectorResult,
  LOGIN_PASSWORD,
  LOGIN_USERNAME,
  MAX_SECRET_CHARS,
  type SavedLogin,
  type SaveLoginRequest,
  SECRET_NAME,
  type SecretField,
  type SecretRequest,
} from "@do-computer/protocol"
import { SandboxEnv } from "@do-computer/sandbox"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  type Conversation,
  type ConversationId,
  defineDoc,
  defineExtension,
  defineTool,
  type Extension,
  type Harness,
  section,
} from "@earendil-works/pi-durable"
import { ASKED_THROUGH_MAIN, askingThrough, canAsk } from "./bus.ts"
import type { Caller } from "./caller.ts"
import type { ComputerTarget } from "./computers.ts"
import { ChatsDoc } from "./docs.ts"
import { DotenvError, reconcileDotenv } from "./dotenv.ts"
import { LIBRARY_FOLDER } from "./library-store.ts"
import { own } from "./own.ts"

/** Entry kind of the answer to a request for secrets, in the chat that asked. */
export const SECRET_ENTRY = "dc.secret"

const TOOL = "request_secret"
const MAX_FIELDS = 12
const MAX_PENDING = 20
/** Answered requests kept for the record. */
const MAX_ANSWERED = 30
const DEFAULT_PATH = ".env"

/** What the agent is told to set it going on an answer. Not shown in the chat. */
const NUDGE =
  '<meta kind="secret">Your request for secrets was answered, above. Carry on with what you needed them for, or tell the user where things stand.</meta>'

type Destination =
  | { kind: "dotenv"; computer: string; computerId: string; path: string }
  | { kind: "connector"; name: string; url: string }
  | { kind: "login"; site: string }

type Stored = {
  chatId: string
  purpose: string | null
  fields: SecretField[]
  destination: Destination
  status: "pending" | "saved" | "declined"
  createdAt: number
  answeredAt: number | null
}

type State = { requests: Record<string, Stored> }

/** What the agent has asked people to type in secret. Holds the questions, never the answers. */
export const SecretsDoc = defineDoc<State>({
  kind: "dc.secrets",
  version: 1,
  scope: "session",
  initial: () => ({ requests: {} }),
})

export class SecretError extends Error {}

type Turn = Awaited<ReturnType<Conversation["submit"]>>
/** The chat that was told how a request went, and the turn the agent was given there. */
type Told = { chatId: string; turn: Turn }

export type SecretsOptions = {
  readonly now: () => number
  /** The computer a call names, or means by naming none, ready to work on; or why there is none. */
  readonly computer: (
    name: string | undefined,
    context: Context,
  ) => Promise<ComputerTarget | string>
  /** Add a connector that is reached with a fixed token. Absent: the agent has no connectors. */
  readonly addConnector?: (input: AddConnectorRequest, context: Context) => Promise<ConnectorResult>
  /**
   * Keep a login for the agent's workspace, to sign in on websites with. Absent: the workspace
   * keeps none. Told who typed it, and the chat that asked, once it is kept.
   */
  readonly saveLogin?: (
    input: SaveLoginRequest,
    asked: { chatId: string; site: string; by: Caller | undefined },
    context: Context,
  ) => Promise<SavedLogin>
  /** Called when the agent has asked, to tell the person wherever they are. */
  readonly onRequest?: (request: SecretRequest) => void
  /** Called when something it asked for waits on nobody any more: given, or declined. */
  readonly onSettled?: () => void
}

const fail = (text: string) => ({ isError: true, output: [{ type: "text" as const, text }] })
const reply = (text: string) => ({ output: [{ type: "text" as const, text }] })

const line = (value: unknown, limit: number): string | null => {
  if (typeof value !== "string") return null
  const text = value.replace(/\s+/g, " ").trim()
  return text === "" ? null : text.slice(0, limit)
}

/** A name as it is written into a note for the model, which it must not be able to end. */
const nameOf = (caller: Caller | undefined) =>
  (caller?.name ?? "")
    .replace(/[<>\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "The person"

const copy = (request: Stored): Stored => JSON.parse(JSON.stringify(request)) as Stored

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

const shown = ({ id, chatId, purpose, fields, destination, createdAt }: Stored & { id: string }) =>
  ({
    id,
    chatId,
    purpose,
    fields: fields.map((field) => ({ ...field })),
    destination:
      destination.kind === "dotenv"
        ? { kind: "dotenv", computer: destination.computer, path: destination.path }
        : { ...destination },
    createdAt,
  }) satisfies SecretRequest

/**
 * How the agent comes by a secret without ever seeing it. It asks, saying what it needs and
 * where to keep it; the person types the values into a form in the app; they are written to a
 * dotenv file on a computer, or kept as the access token of a connector. Nothing typed is put
 * in a chat, in a document, or in what the agent is told: it hears only that they were saved.
 */
export class Secrets {
  readonly extension: Extension
  readonly #options: SecretsOptions
  #harness: Harness | undefined

  constructor(options: SecretsOptions) {
    this.#options = options
    this.extension = defineExtension({
      name: "dc.secrets",
      tools: [this.#tool()],
      sections: [
        section(
          "secrets",
          () =>
            `When you need a secret from the person (an API key, a password, a token), ask for it with the \`${TOOL}\` tool: they type it into a form and it is saved to a file on a computer without passing through this conversation. Never ask them to paste a secret into the chat, and if they do, do not repeat it. Do not read, print or copy a file of secrets you asked for: load it where it is needed, for example \`set -a; . ./.env; set +a\` before a command.`,
        ),
      ],
    })
  }

  attach(harness: Harness): void {
    this.#harness = harness
  }

  #require(): Harness {
    if (this.#harness === undefined) throw new Error("Secrets are not attached to a harness")
    return this.#harness
  }

  /** Whether anything it asked for is still waiting to be typed in. */
  async asking(context: Context): Promise<boolean> {
    const state = await this.#require().snapshot(SecretsDoc, context)
    return Object.values(state?.requests ?? {}).some((request) => request.status === "pending")
  }

  async pending(context: Context): Promise<SecretRequest[]> {
    const harness = this.#require()
    const state = await harness.snapshot(SecretsDoc, context)
    const chats = (await harness.snapshot(ChatsDoc, context))?.chats
    return Object.entries(state?.requests ?? {})
      .filter(([, request]) => request.status === "pending")
      .map(([id, request]) => {
        // Shown in the main chat under the name of the sub-agent that asked, where one did.
        const through = askingThrough(chats, request.chatId)
        return {
          ...shown({ id, ...request }),
          ...(through === undefined
            ? {}
            : { subagent: { title: through.title, task: through.task } }),
        }
      })
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /** Whether a chat asked for something that is still waiting to be typed in. */
  async waitingIn(chatId: string, context: Context): Promise<boolean> {
    const state = await this.#require().snapshot(SecretsDoc, context)
    return Object.values(state?.requests ?? {}).some(
      (request) => request.status === "pending" && request.chatId === chatId,
    )
  }

  /**
   * Take back what a chat asked for and was not answered, when its work has been stopped. Nobody
   * is told: the chat that asked is not at work any more.
   */
  async withdraw(chatId: string, context: Context): Promise<void> {
    const now = this.#options.now()
    const withdrawn = await this.#require().commit(async (tx) => {
      const doc = await tx.doc(SecretsDoc)
      let any = false
      for (const request of Object.values(doc.requests)) {
        if (request.chatId !== chatId || request.status !== "pending") continue
        request.status = "declined"
        request.answeredAt = now
        any = true
      }
      return any
    }, context)
    if (withdrawn) this.#options.onSettled?.()
  }

  /**
   * Ask for secrets from a chat. Asking again for the same things, to be kept in the same place,
   * is the same question.
   */
  async ask(
    input: {
      chatId: string
      purpose: string | null
      fields: SecretField[]
      destination: Destination
    },
    context: Context,
  ): Promise<{ request: SecretRequest; fresh: boolean }> {
    const key = JSON.stringify([input.destination, input.fields.map((field) => field.name)])
    const now = this.#options.now()
    const outcome = await this.#require().commit(async (tx) => {
      const doc = await tx.doc(SecretsDoc)
      const pending = Object.entries(doc.requests).filter(
        ([, request]) => request.status === "pending",
      )
      const same = pending.find(
        ([, request]) =>
          request.chatId === input.chatId &&
          JSON.stringify([request.destination, request.fields.map((field) => field.name)]) === key,
      )
      // Copied out whole: what is in the document cannot be read once the commit settles.
      if (same !== undefined) return { id: same[0], request: copy(same[1]), fresh: false }
      if (pending.length >= MAX_PENDING) {
        throw new SecretError(
          "Too many requests for secrets are waiting to be answered. Wait for the person to answer those.",
        )
      }
      const id = `s${crypto.randomUUID().slice(0, 8)}`
      const request: Stored = {
        chatId: input.chatId,
        purpose: input.purpose,
        fields: input.fields,
        destination: input.destination,
        status: "pending",
        createdAt: now,
        answeredAt: null,
      }
      doc.requests[id] = request
      return { id, request: copy(request), fresh: true }
    }, context)
    const request = shown({ id: outcome.id, ...outcome.request })
    if (outcome.fresh) this.#options.onRequest?.(request)
    return { request, fresh: outcome.fresh }
  }

  /** Ask a person to save a login for a site, which the workspace then keeps for signing in there. */
  askForLogin(
    input: { chatId: string; purpose: string | null; site: string },
    context: Context,
  ): Promise<{ request: SecretRequest; fresh: boolean }> {
    return this.ask(
      {
        chatId: input.chatId,
        purpose: input.purpose,
        fields: [
          { name: LOGIN_USERNAME, description: "The username or email you sign in with" },
          { name: LOGIN_PASSWORD, description: null },
        ],
        destination: { kind: "login", site: input.site },
      },
      context,
    )
  }

  /** Mark a request answered, and resolve with what it asked. Undefined if it was answered already. */
  async #settle(
    id: string,
    status: "saved" | "declined",
    context: Context,
  ): Promise<Stored | undefined> {
    const now = this.#options.now()
    const request = await this.#require().commit(async (tx) => {
      const doc = await tx.doc(SecretsDoc)
      const found = own(doc.requests, id)
      if (found === undefined || found.status !== "pending") return undefined
      found.status = status
      found.answeredAt = now
      const answered = Object.entries(doc.requests)
        .filter(([, entry]) => entry.status !== "pending")
        .sort(([, a], [, b]) => (b.answeredAt ?? 0) - (a.answeredAt ?? 0))
      const settled = copy(found)
      for (const [old] of answered.slice(MAX_ANSWERED)) delete doc.requests[old]
      return settled
    }, context)
    if (request !== undefined) this.#options.onSettled?.()
    return request
  }

  async #find(id: string, context: Context): Promise<Stored> {
    const found = own((await this.#require().snapshot(SecretsDoc, context))?.requests, id)
    if (found === undefined || found.status !== "pending") {
      throw new SecretError("That request has already been answered.")
    }
    return found
  }

  /** Say in the chat that asked how it went, and give the agent a turn there. */
  async #tell(
    id: string,
    request: Stored,
    told: { saved: boolean; text: string; by: string },
    context: Context,
  ): Promise<Told | undefined> {
    const harness = this.#require()
    const conversation = await harness.conversation(
      Number(request.chatId) as ConversationId,
      context,
    )
    const chat = own((await harness.snapshot(ChatsDoc, context))?.chats ?? {}, request.chatId)
    if (chat === undefined || conversation === undefined) return undefined
    const where =
      request.destination.kind === "dotenv"
        ? request.destination.path
        : request.destination.kind === "login"
          ? request.destination.site
          : request.destination.name
    await conversation.submit(
      {
        type: "write",
        requestId: `secret-answer:${id}`,
        entry: {
          kind: SECRET_ENTRY,
          model: [{ role: "user", content: `[${told.text}]`, timestamp: Date.now() }],
          data: {
            where,
            to: request.destination.kind,
            names: request.fields.map((field) => field.name),
            saved: told.saved,
            by: told.by,
          },
        },
      },
      context,
    )
    const turn = await conversation.submit(
      {
        type: "input",
        requestId: `secret-turn:${id}`,
        content: [{ type: "text", text: NUDGE }],
        whenBusy: "followUp",
      },
      context,
    )
    return { chatId: request.chatId, turn }
  }

  /**
   * Take what the person typed and put it where it was asked to be kept. The values are checked,
   * written, and dropped: they are in no document and in nothing the agent is told. Resolves
   * with the turn the agent is given to carry on, where the chat that asked is still there.
   */
  async answer(
    id: string,
    values: unknown,
    context: Context,
    by?: Caller,
    sites?: unknown,
  ): Promise<Told | undefined> {
    const request = await this.#find(id, context)
    if (typeof values !== "object" || values === null) {
      throw new SecretError("Give a value for each secret.")
    }
    const given: Record<string, string> = {}
    for (const { name } of request.fields) {
      const value = own(values as Record<string, unknown>, name)
      if (typeof value !== "string" || value === "") {
        throw new SecretError(`Give a value for ${name}.`)
      }
      if (value.length > MAX_SECRET_CHARS || /[\r\n\0]/.test(value)) {
        throw new SecretError(`${name} must be one line of at most ${MAX_SECRET_CHARS / 1024} KiB.`)
      }
      given[name] = value
    }
    const who = nameOf(by)
    let text: string
    if (request.destination.kind === "login") {
      const { site } = request.destination
      const save = this.#options.saveLogin
      if (save === undefined) throw new SecretError("This workspace does not keep logins.")
      let login: SavedLogin
      try {
        login = await save(
          {
            // Called after its site until someone gives it a name of their own.
            name: site,
            username: given[LOGIN_USERNAME] ?? "",
            password: given[LOGIN_PASSWORD] ?? "",
            // The site that asked is always one of them: it is what the login was typed for.
            sites: [site, ...(Array.isArray(sites) ? sites.filter((entry) => entry !== site) : [])],
          },
          { chatId: request.chatId, site, by },
          context,
        )
      } catch (error) {
        throw new SecretError(error instanceof Error ? error.message : String(error))
      }
      text = `${who} saved a login for ${site}: it is called "${login.name}" and signs in as ${login.username}. You were not shown the password and will not be. Call \`sign_in\` again to sign in with it.`
    } else if (request.destination.kind === "connector") {
      const { name, url } = request.destination
      const add = this.#options.addConnector
      if (add === undefined) throw new SecretError("This Dood cannot have connectors.")
      const token = given[request.fields[0]!.name]!
      let result: ConnectorResult
      try {
        result = await add({ name, url, token }, context)
      } catch (error) {
        throw new SecretError(error instanceof Error ? error.message : String(error))
      }
      const { connector } = result
      text =
        connector.status === "connected"
          ? `${who} gave the access token for the connector "${connector.name}", which you were not shown. It is connected and offers ${connector.tools.length} tool${connector.tools.length === 1 ? "" : "s"}, which you can use from your next step.`
          : `${who} gave the access token for the connector "${connector.name}", which you were not shown, but it could not be connected: ${connector.error ?? "it did not answer"}. The \`connectors\` tool can reconnect or remove it.`
    } else {
      const { computerId, path } = request.destination
      const target = await this.#options.computer(computerId, context)
      if (typeof target === "string") throw new SecretError(target)
      if (target.computer.readOnly) {
        throw new SecretError(`The computer "${target.computer.name}" is read-only.`)
      }
      const env = new SandboxEnv(target.sandbox, target.cwd)
      let content = ""
      if ((await target.sandbox.fs.stat(path)) !== undefined) {
        const read = await env.readTextFile(path)
        if (!read.ok) throw new SecretError(`Could not read ${path}: ${read.error.message}`)
        content = read.value
      }
      let change: ReturnType<typeof reconcileDotenv>
      try {
        change = reconcileDotenv(content, given)
      } catch (error) {
        if (error instanceof DotenvError) throw new SecretError(error.message)
        throw error
      }
      const written = await env.writeFile(path, change.content)
      if (!written.ok) throw new SecretError(`Could not write ${path}: ${written.error.message}`)
      // Only its owner should read it. A shell without chmod has no other users to keep out.
      await target.sandbox.exec(`chmod 600 ${quote(path)}`).catch(() => undefined)
      const counts = [
        change.added.length > 0 ? `added ${change.added.join(", ")}` : "",
        change.updated.length > 0 ? `updated ${change.updated.join(", ")}` : "",
        change.unchanged.length > 0 ? `left ${change.unchanged.join(", ")} as it was` : "",
      ].filter(Boolean)
      text = `${who} gave the secrets you asked for, and they were saved to ${path} on the computer "${target.computer.name}": ${counts.join("; ")}. The values were not shown to you. Do not read, print or copy that file: load it where it is needed, for example \`set -a; . ${quote(path)}; set +a\` before a command.`
    }
    // Saved, so it is answered, whoever else was answering it at the same time.
    await this.#settle(id, "saved", context)
    return this.#tell(id, request, { saved: true, text, by: who }, context)
  }

  /** The person chose not to give them. The agent is told, and does without. */
  async decline(id: string, context: Context, by?: Caller): Promise<Told | undefined> {
    const request = await this.#settle(id, "declined", context)
    if (request === undefined) throw new SecretError("That request has already been answered.")
    const who = nameOf(by)
    const what =
      request.destination.kind === "connector"
        ? `the access token for the connector "${request.destination.name}"`
        : request.destination.kind === "login"
          ? `a login for ${request.destination.site}`
          : `the secrets you asked for (${request.fields.map((field) => field.name).join(", ")})`
    return this.#tell(
      id,
      request,
      {
        saved: false,
        text: `${who} chose not to give ${what}. Do not ask again unless they bring it up, and do not ask them to paste it into the chat. Carry on without it, or ask what they would prefer.`,
        by: who,
      },
      context,
    )
  }

  #tool() {
    return defineTool({
      name: TOOL,
      description:
        "Ask the person to type secrets (API keys, passwords, tokens) into a form in the app, to be saved to a dotenv file on a computer. You are never shown the values: they do not pass through this conversation, and you are told only which names were saved. " +
        "`secrets` lists each one: `name` is the variable it is saved as, and `description` says what it is and where the person finds it. Ask for everything you know you need in one call. `purpose` is a sentence on what they are for. `path` is the file, `.env` in your folder unless you say otherwise; one that is there keeps its other lines. " +
        "Asking returns at once and the answer reaches you later as a message: say what you asked for, do not wait or ask again, and carry on with whatever does not need them.",
      parameters: Type.Object({
        secrets: Type.Array(
          Type.Object({
            name: Type.String({
              description: "The variable to save it as, such as OPENAI_API_KEY",
            }),
            description: Type.Optional(
              Type.String({ description: "What it is and where the person finds it" }),
            ),
          }),
          { minItems: 1, maxItems: MAX_FIELDS },
        ),
        purpose: Type.Optional(Type.String({ description: "What they are for, in a sentence" })),
        path: Type.Optional(
          Type.String({ description: `The dotenv file to save them to. Default ${DEFAULT_PATH}` }),
        ),
        computer: Type.Optional(
          Type.String({
            description:
              "Name of the computer to save them on. It can be left out when there is only one machine of your workspace that you can use.",
          }),
        ),
      }),
      execute: async (args, api, context) => {
        const chatId = String(api.conversationId)
        const chats = (await api.snapshot(ChatsDoc, context))?.chats
        // A sub-agent asks through a main chat with the bus on, where someone can type it.
        if (!canAsk(chats, chatId)) {
          return fail(
            "Only a conversation with the user can ask for a secret: there has to be someone to type it.",
          )
        }
        const through = askingThrough(chats, chatId) !== undefined
        const fields: SecretField[] = []
        for (const entry of args.secrets ?? []) {
          const name = (entry.name ?? "").trim()
          if (!SECRET_NAME.test(name)) {
            return fail(
              `"${name}" cannot be a secret's name: use letters, digits and underscores, not starting with a digit, such as OPENAI_API_KEY.`,
            )
          }
          if (fields.some((field) => field.name === name)) {
            return fail(`${name} is asked for twice.`)
          }
          fields.push({ name, description: line(entry.description, 240) })
        }
        if (fields.length === 0) return fail("Say which secrets you need, in `secrets`.")
        if (fields.length > MAX_FIELDS) {
          return fail(`Ask for at most ${MAX_FIELDS} secrets at a time.`)
        }
        const named = typeof args.computer === "string" && args.computer.trim() !== ""
        const target = await this.#options.computer(named ? args.computer : undefined, context)
        if (typeof target === "string") return fail(target)
        if (target.computer.readOnly) {
          return fail(
            `The computer "${target.computer.name}" is read-only, so nothing can be saved there.`,
          )
        }
        const wanted = (args.path ?? "").trim() || DEFAULT_PATH
        const absolute = await new SandboxEnv(target.sandbox, target.cwd).absolutePath(wanted)
        if (!absolute.ok) return fail(`"${wanted}" is not a path.`)
        const path = absolute.value
        const library = `${target.computer.home}/${LIBRARY_FOLDER}`
        if (target.machine && (path === library || path.startsWith(`${library}/`))) {
          return fail(
            `${path} is in the library, which is copied off the machine for people to read. Keep secrets in your own folder.`,
          )
        }
        const stat = await target.sandbox.fs.stat(path).catch(() => undefined)
        if (stat !== undefined && stat.kind !== "file") return fail(`${path} is not a file.`)
        try {
          const { request, fresh } = await this.ask(
            {
              chatId,
              purpose: line(args.purpose, 300),
              fields,
              destination: {
                kind: "dotenv",
                computer: target.computer.name,
                computerId: target.id,
                path,
              },
            },
            context,
          )
          const names = fields.map((field) => field.name).join(", ")
          return {
            ...reply(
              fresh
                ? through
                  ? `Asked for ${names}, to be saved to ${path} on "${target.computer.name}". ${ASKED_THROUGH_MAIN}`
                  : `Asked. A form for ${names} is in front of the person, above their message box, and what they type will be saved to ${path} on "${target.computer.name}". Their answer will reach you as a message, which may take a while: do not wait for it or ask again. Tell them in a sentence what you asked for and why.`
                : `You have already asked for ${names}, and the person has not answered yet. Do not ask again: the answer will reach you as a message.`,
            ),
            details: { requestId: request.id, path, computer: target.computer.name },
          }
        } catch (error) {
          if (error instanceof SecretError) return fail(error.message)
          throw error
        }
      },
    })
  }
}

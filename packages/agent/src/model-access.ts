import type {
  AnswerModelLoginRequest,
  ModelLogin,
  ModelLoginType,
  ModelOption,
  ModelProvider,
  ModelProvidersState,
  StartModelLoginRequest,
} from "@durable-computer/protocol"
import type { Actor, ActorHost, ActorStub } from "@durable-computer/runtime"
import type {
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai"
import { createModels, type Provider } from "@earendil-works/pi-ai/models"
import { type Caller, readCaller } from "./caller.ts"
import {
  inOfferedOrder,
  isFeatured,
  isSuggested,
  loginMethods,
  modelOption,
  modelProviders,
} from "./model-providers.ts"
import { isInherited } from "./own.ts"

/** How long someone has to finish a sign-in before it is given up. */
const LOGIN_TTL_MS = 15 * 60_000
/** How long a sign-in that ended can still be asked about. */
const ENDED_TTL_MS = 5 * 60_000
/** Sign-ins under way in one workspace. Each may hold a port or poll a provider. */
const MAX_LOGINS = 4
/** The longest a request waits for a sign-in to change before it is answered as it stands. */
const MAX_WAIT_MS = 25_000
/** How long starting or answering waits for a sign-in to reach its next question. */
const REST_MS = 2_000
/** A token with less than this left is exchanged for a new one before an agent is handed it. */
const FRESH_MS = 10 * 60_000
const REFRESH_TIMEOUT_MS = 15_000
const MAX_ANSWER_CHARS = 8192
const MAX_ERROR_CHARS = 400

/**
 * Which of a provider's own choices is made for the person, where only one of them can work
 * from a page. Anthropic's other way ends at an address on the machine that asked, which is the
 * server here and not the person's.
 */
const CHOSEN: Record<string, string> = { anthropic: "copy_code" }

const json = (value: unknown, status = 200) => Response.json(value, { status })

/** A sign-in that cannot go on, with the reason, as opposed to a bug. */
class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

type Row = {
  provider: string
  json: string
  by_id: string | null
  by_name: string | null
  at: number
}

/**
 * The credentials a workspace keeps, in the database of the actor that keeps them. Read once
 * and held in memory, which is safe because the actor is the only writer. Writes to one
 * provider's wait their turn, so a token is never exchanged twice at once.
 */
class StoredCredentials implements CredentialStore {
  readonly #host: ActorHost
  #rows: Map<string, Row> | undefined
  #loading: Promise<Map<string, Row>> | undefined
  readonly #chains = new Map<string, Promise<unknown>>()

  constructor(host: ActorHost) {
    this.#host = host
  }

  async rows(): Promise<Map<string, Row>> {
    if (this.#rows !== undefined) return this.#rows
    this.#loading ??= (async () => {
      await this.#host.sql.exec(
        `CREATE TABLE IF NOT EXISTS dc_model_credentials (
          provider TEXT PRIMARY KEY, json TEXT NOT NULL, by_id TEXT, by_name TEXT,
          at INTEGER NOT NULL
        ) STRICT`,
      )
      const rows = await this.#host.sql.all<Row>(
        "SELECT provider, json, by_id, by_name, at FROM dc_model_credentials",
      )
      this.#rows = new Map(
        rows.filter((row) => !isInherited(row.provider)).map((row) => [row.provider, row]),
      )
      return this.#rows
    })()
    return this.#loading
  }

  #queue<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const run = (this.#chains.get(providerId) ?? Promise.resolve()).then(task, task)
    this.#chains.set(
      providerId,
      run.catch(() => undefined),
    )
    return run
  }

  async read(providerId: string): Promise<Credential | undefined> {
    const row = (await this.rows()).get(providerId)
    return row === undefined ? undefined : (JSON.parse(row.json) as Credential)
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return [...(await this.rows()).values()].map((row) => ({
      providerId: row.provider,
      type: (JSON.parse(row.json) as Credential).type,
    }))
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.#queue(providerId, async () => {
      const rows = await this.rows()
      const kept = rows.get(providerId)
      const current = kept === undefined ? undefined : (JSON.parse(kept.json) as Credential)
      const next = await fn(current)
      if (next === undefined) return current
      const row: Row = {
        provider: providerId,
        json: JSON.stringify(next),
        by_id: kept?.by_id ?? null,
        by_name: kept?.by_name ?? null,
        at: kept?.at ?? this.#host.now(),
      }
      await this.#host.sql.run(
        `INSERT INTO dc_model_credentials (provider, json, by_id, by_name, at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (provider) DO UPDATE SET json = excluded.json`,
        row.provider,
        row.json,
        row.by_id,
        row.by_name,
        row.at,
      )
      rows.set(providerId, row)
      return next
    })
  }

  delete(providerId: string): Promise<void> {
    return this.#queue(providerId, async () => {
      const rows = await this.rows()
      await this.#host.sql.run("DELETE FROM dc_model_credentials WHERE provider = ?", providerId)
      rows.delete(providerId)
    })
  }

  /** Record who signed in and when, once a sign-in has stored its credential. */
  signed(providerId: string, by: Caller | undefined): Promise<void> {
    return this.#queue(providerId, async () => {
      const row = (await this.rows()).get(providerId)
      if (row === undefined) return
      row.by_id = by?.id ?? null
      row.by_name = by?.name ?? null
      row.at = this.#host.now()
      await this.#host.sql.run(
        "UPDATE dc_model_credentials SET by_id = ?, by_name = ?, at = ? WHERE provider = ?",
        row.by_id,
        row.by_name,
        row.at,
        providerId,
      )
    })
  }
}

/** A sign-in under way: what the app is shown of it, and how it is answered or stopped. */
type Running = {
  view: ModelLogin
  by: Caller | undefined
  readonly abort: AbortController
  answer: { id: string; resolve(value: string): void; reject(error: Error): void } | undefined
  /** Called, once each, when what is shown changes. */
  waiting: Set<() => void>
  endedAt: number | undefined
  timer: ReturnType<typeof setTimeout> | undefined
}

/** What a provider said went wrong, without the trace some of them append to it. */
function reason(error: unknown): string {
  let text = error instanceof Error ? error.message : String(error)
  const cause = error instanceof Error ? error.cause : undefined
  // pi wraps what a provider's sign-in threw; the cause is what says why.
  if (cause instanceof Error && cause.message !== "") text = cause.message
  const trace = text.indexOf("; stack=")
  if (trace !== -1) text = text.slice(0, trace)
  text = text.replace(/\s+/g, " ").trim()
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}…` : text
}

export type ModelAccessOptions = {
  /** The providers there are to sign in to. Default: every one pi has that a page can sign in to. */
  readonly providers?: () => readonly Provider[]
  /** What the app is called, where a provider names the app that is signing in. */
  readonly appName?: string
}

/**
 * The model providers a workspace is signed in to: with a subscription someone in it has, or
 * with a key. One actor per workspace. It leads a person through a provider's sign-in, keeps
 * what comes of it, and hands it to the workspace's agents when they call a model, exchanging a
 * token that is about to run out for a new one first. That happens here and nowhere else, so
 * that two agents never exchange the same token at once: a provider that sees one used twice
 * may sign the account out.
 *
 * It trusts its callers, which are the gateway, after checking that someone is in the
 * workspace, and the workspace's agents. A credential is only ever handed to an agent.
 */
export function createModelAccessActor(host: ActorHost, options: ModelAccessOptions = {}): Actor {
  const credentials = new StoredCredentials(host)
  // No environment and no files: a workspace is signed in only to what is kept here.
  const models = createModels({
    credentials,
    authContext: { env: async () => undefined, fileExists: async () => false },
  })
  for (const provider of (options.providers ?? modelProviders)()) models.setProvider(provider)
  const logins = new Map<string, Running>()

  const provider = (id: string): Provider => {
    const found = isInherited(id) ? undefined : models.getProvider(id)
    if (found === undefined) throw new Refusal(404, "There is no such model provider.")
    return found
  }

  /** A provider as it is named to people. pi marks one as older, which is not part of its name. */
  const named = (entry: Provider) => ({ name: entry.name.replace(/\s*\(legacy\)$/i, "") })

  /** The models a provider gives with the credential kept for it. */
  const offered = (from: Provider, credential: Credential) => {
    const handled = credential.type === "oauth" ? from.auth.oauth : from.auth.apiKey
    if (handled === undefined) return []
    const all = from.getModels()
    return from.filterModels?.(all, credential) ?? all
  }

  const providers = async (): Promise<ModelProvidersState> => {
    const rows = await credentials.rows()
    const list = models.getProviders().flatMap((entry): ModelProvider[] => {
      const methods = loginMethods(entry)
      const row = rows.get(entry.id)
      if (methods.length === 0 && row === undefined) return []
      const credential = row === undefined ? undefined : (JSON.parse(row.json) as Credential)
      return [
        {
          id: entry.id,
          name: named(entry).name,
          methods,
          featured: isFeatured(entry),
          signedIn:
            row === undefined || credential === undefined
              ? null
              : {
                  type: credential.type,
                  by: row.by_name,
                  byId: row.by_id,
                  at: row.at,
                  models: offered(entry, credential).length,
                },
        },
      ]
    })
    return { providers: list }
  }

  const modelOptions = async (): Promise<ModelOption[]> => {
    const rows = await credentials.rows()
    return models.getProviders().flatMap((entry) => {
      const row = rows.get(entry.id)
      if (row === undefined) return []
      const credential = JSON.parse(row.json) as Credential
      const signIn = {
        subscription: credential.type === "oauth" && entry.auth.oauth?.isSubscription === true,
        by: row.by_name,
      }
      return inOfferedOrder(offered(entry, credential)).map((model) => ({
        ...modelOption(model, named(entry), isSuggested(model)),
        signIn,
      }))
    })
  }

  /**
   * The credential kept for a provider, as an agent needs it: one with a token that will last
   * the call. A token that is running out is exchanged first, one exchange at a time.
   */
  const credentialFor = async (providerId: string): Promise<Credential | undefined> => {
    const from = provider(providerId)
    const oauth = from.auth.oauth
    const stored = await credentials.read(providerId)
    if (stored?.type !== "oauth" || oauth === undefined) return stored
    const running = (credential: Credential) =>
      credential.type === "oauth" && host.now() + FRESH_MS >= credential.expires
    if (!running(stored)) return stored
    try {
      return await credentials.modify(providerId, async (current) => {
        // Signed out, or exchanged by a call that was ahead of this one.
        if (current?.type !== "oauth" || !running(current)) return undefined
        return oauth.refresh(current, AbortSignal.timeout(REFRESH_TIMEOUT_MS))
      })
    } catch (error) {
      const current = await credentials.read(providerId)
      // The exchange was early. While the token it failed to replace still works, it is used.
      if (current?.type === "oauth" && host.now() < current.expires) return current
      throw new Refusal(
        409,
        `The sign-in to ${named(from).name} has run out and could not be renewed (${reason(error)}). Someone in the workspace needs to sign in to ${named(from).name} again.`,
        "sign_in_expired",
      )
    }
  }

  const changed = (running: Running) => {
    running.view.rev++
    const waiting = [...running.waiting]
    running.waiting.clear()
    for (const tell of waiting) tell()
  }

  const end = (running: Running, status: ModelLogin["status"], error?: string) => {
    if (running.endedAt !== undefined) return
    running.endedAt = host.now()
    if (running.timer !== undefined) clearTimeout(running.timer)
    const pending = running.answer
    running.answer = undefined
    Object.assign(running.view, {
      status,
      prompt: null,
      authUrl: null,
      deviceCode: null,
      progress: null,
      error: error ?? null,
    })
    changed(running)
    // After the view is settled: whatever is still waiting on an answer is let go.
    pending?.reject(new Error("Login cancelled"))
    running.abort.abort()
  }

  const prune = () => {
    const now = host.now()
    for (const [id, running] of logins) {
      if (running.endedAt !== undefined && now - running.endedAt > ENDED_TTL_MS) logins.delete(id)
    }
  }

  const interaction = (running: Running): AuthInteraction => ({
    signal: running.abort.signal,
    prompt: (prompt: AuthPrompt) => {
      if (running.endedAt !== undefined || prompt.signal?.aborted === true) {
        return Promise.reject(new Error("Login cancelled"))
      }
      if (prompt.type === "select") {
        const chosen = CHOSEN[running.view.providerId]
        if (chosen !== undefined && prompt.options.some((option) => option.id === chosen)) {
          return Promise.resolve(chosen)
        }
      }
      const id = crypto.randomUUID().slice(0, 8)
      // Asked again while a question stands: the newer one takes its place.
      running.answer?.reject(new Error("Login cancelled"))
      running.view.prompt = {
        id,
        type: prompt.type,
        message: prompt.message,
        ...("placeholder" in prompt && prompt.placeholder !== undefined
          ? { placeholder: prompt.placeholder }
          : {}),
        ...(prompt.type === "select"
          ? { options: prompt.options.map((option) => ({ ...option })) }
          : {}),
      }
      return new Promise<string>((resolve, reject) => {
        running.answer = { id, resolve, reject }
        // A provider withdraws a question when it has its answer another way.
        prompt.signal?.addEventListener(
          "abort",
          () => {
            if (running.answer?.id !== id) return
            running.answer = undefined
            running.view.prompt = null
            changed(running)
            reject(new Error("Login cancelled"))
          },
          { once: true },
        )
        changed(running)
      })
    },
    notify: (event: AuthEvent) => {
      if (running.endedAt !== undefined) return
      const { view } = running
      if (event.type === "auth_url") {
        view.authUrl = {
          url: event.url,
          ...(event.instructions === undefined ? {} : { instructions: event.instructions }),
        }
      } else if (event.type === "device_code") {
        view.deviceCode = {
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          ...(event.expiresInSeconds === undefined
            ? {}
            : { expiresAt: host.now() + event.expiresInSeconds * 1000 }),
        }
      } else if (event.type === "progress") {
        view.progress = event.message
      } else {
        view.notes.push({
          message: event.message,
          ...(event.links === undefined ? {} : { links: event.links.map((link) => ({ ...link })) }),
        })
      }
      changed(running)
    },
  })

  const start = async (input: StartModelLoginRequest, by: Caller | undefined) => {
    prune()
    const from = provider(typeof input.providerId === "string" ? input.providerId : "")
    const type: ModelLoginType = input.type === "oauth" ? "oauth" : "api_key"
    if (!loginMethods(from).some((method) => method.type === type)) {
      throw new Refusal(400, `${from.name} cannot be signed in to that way.`)
    }
    // Starting again leaves the sign-in that was under way behind.
    for (const other of logins.values()) {
      if (other.endedAt === undefined && other.view.providerId === from.id) end(other, "cancelled")
    }
    const live = [...logins.values()].filter((other) => other.endedAt === undefined)
    if (live.length >= MAX_LOGINS) {
      throw new Refusal(409, "Too many sign-ins are under way. Finish or cancel one first.")
    }
    const running: Running = {
      view: {
        id: crypto.randomUUID(),
        rev: 0,
        providerId: from.id,
        type,
        status: "waiting",
        prompt: null,
        authUrl: null,
        deviceCode: null,
        progress: null,
        notes: [],
        error: null,
      },
      by,
      abort: new AbortController(),
      answer: undefined,
      waiting: new Set(),
      endedAt: undefined,
      timer: undefined,
    }
    logins.set(running.view.id, running)
    running.timer = setTimeout(
      () => end(running, "failed", "The sign-in was not finished in time. Start it again."),
      LOGIN_TTL_MS,
    )
    // A sign-in nobody finishes must not keep a server from stopping.
    const timer = running.timer as unknown as { unref?: () => void }
    if (typeof timer === "object" && timer !== null) timer.unref?.()
    const deviceId = async () => {
      // One id for the workspace, made the first time a provider asks for it.
      await host.sql.exec(
        "CREATE TABLE IF NOT EXISTS dc_model_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT",
      )
      const kept = await host.sql.get<{ value: string }>(
        "SELECT value FROM dc_model_meta WHERE key = 'device'",
      )
      if (kept !== undefined) return kept.value
      const id = crypto.randomUUID()
      await host.sql.run("INSERT INTO dc_model_meta (key, value) VALUES ('device', ?)", id)
      return id
    }
    // A provider asks for it without waiting, so it is read before the sign-in starts.
    const device = await deviceId()
    void models
      .login(from.id, type, interaction(running), {
        agentName: options.appName ?? "Do Computer",
        getDeviceId: () => device,
      })
      .then(async () => {
        await credentials.signed(from.id, by)
        end(running, "done")
      })
      // Cancelled or out of time, it has ended already, and this is only what that left behind.
      .catch((error: unknown) => end(running, "failed", reason(error)))
    // Most sign-ins say their first thing at once. Waiting for it saves the app a round trip.
    await rest(running, REST_MS)
    return running.view
  }

  /** Resolve when what is shown has moved past `rev`, or after `ms` at the latest. */
  const settle = (running: Running, rev: number, ms: number): Promise<void> => {
    if (running.view.rev > rev || running.endedAt !== undefined || ms <= 0) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        running.waiting.delete(done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      running.waiting.add(done)
    })
  }

  /**
   * Resolve when the sign-in has come to something for the person: a question, a code to enter
   * at the provider, or its end. After `ms` at the latest, with whatever it is doing.
   */
  const rest = async (running: Running, ms: number): Promise<void> => {
    const until = Date.now() + ms
    const { view } = running
    while (running.endedAt === undefined && view.prompt === null && view.deviceCode === null) {
      const left = until - Date.now()
      if (left <= 0) return
      await settle(running, view.rev, left)
    }
  }

  const login = (id: string): Running => {
    const running = isInherited(id) ? undefined : logins.get(id)
    if (running === undefined) {
      throw new Refusal(404, "That sign-in is no longer under way. Start it again.", "gone")
    }
    return running
  }

  const answer = (running: Running, input: AnswerModelLoginRequest) => {
    const asked = running.answer
    const prompt = running.view.prompt
    if (asked === undefined || prompt === null || asked.id !== input.promptId) {
      throw new Refusal(409, "That question has already been answered.")
    }
    const value = typeof input.value === "string" ? input.value : ""
    if (value.trim() === "") throw new Refusal(400, "Give an answer.")
    if (value.length > MAX_ANSWER_CHARS) throw new Refusal(400, "That is too long.")
    if (prompt.type === "select" && !prompt.options?.some((option) => option.id === value)) {
      throw new Refusal(400, "Choose one of the options.")
    }
    running.answer = undefined
    running.view.prompt = null
    changed(running)
    asked.resolve(prompt.type === "select" ? value : value.trim())
  }

  const route = async (request: Request, segments: readonly string[]): Promise<Response> => {
    const [what, id, action] = segments
    const method = request.method
    if (what === "providers") {
      if (method === "GET" && id === undefined) return json(await providers())
      if (method === "DELETE" && id !== undefined) {
        const from = provider(id)
        for (const running of logins.values()) {
          if (running.endedAt === undefined && running.view.providerId === from.id) {
            end(running, "cancelled")
          }
        }
        await models.logout(from.id)
        return json(await providers())
      }
    }
    if (what === "models" && method === "GET") return json({ models: await modelOptions() })
    // Someone left the workspace: what they signed in with was theirs, and goes with them.
    if (what === "members" && id !== undefined && method === "DELETE") {
      for (const running of logins.values()) {
        if (running.endedAt === undefined && running.by?.id === id) end(running, "cancelled")
      }
      const theirs = [...(await credentials.rows()).values()].filter((row) => row.by_id === id)
      for (const row of theirs) await models.logout(row.provider)
      return json({ removed: theirs.map((row) => row.provider) })
    }
    if (what === "logins") {
      if (method === "POST" && id === undefined) {
        const input = (await request.json().catch(() => ({}))) as StartModelLoginRequest
        return json({ login: await start(input, readCaller(request)) }, 201)
      }
      if (id !== undefined) {
        prune()
        const running = login(id)
        // A sign-in is its starter's: what is typed into it is theirs, and so is what it shows.
        if (running.by?.id !== readCaller(request)?.id) {
          throw new Refusal(404, "That sign-in is no longer under way. Start it again.", "gone")
        }
        if (method === "GET" && action === undefined) {
          const query = new URL(request.url).searchParams
          const wait = Math.min(Number(query.get("wait") ?? "0") || 0, MAX_WAIT_MS)
          await settle(running, Number(query.get("rev") ?? "-1"), wait)
          return json({ login: running.view })
        }
        if (method === "POST" && action === "answer") {
          answer(running, (await request.json().catch(() => ({}))) as AnswerModelLoginRequest)
          // What the answer leads to, where that comes at once.
          await rest(running, REST_MS)
          return json({ login: running.view })
        }
        if (method === "DELETE" && action === undefined) {
          end(running, "cancelled")
          return json({ login: running.view })
        }
      }
    }
    // Only ever asked by an agent of the workspace, through its host. The gateway has no route here.
    if (what === "credentials" && id !== undefined && method === "GET") {
      // An agent asks about every provider it calls, the deployment's own among them. One
      // that nobody can sign in to here simply has nothing kept for it.
      const known = !isInherited(id) && models.getProvider(id) !== undefined
      return json({ credential: known ? ((await credentialFor(id)) ?? null) : null })
    }
    if (what === "destroy" && method === "POST") {
      for (const running of logins.values()) end(running, "cancelled")
      logins.clear()
      await host.destroy()
      return json({ ok: true })
    }
    return json({ error: "Not found" }, 404)
  }

  return {
    async fetch(request) {
      let segments: string[]
      try {
        segments = new URL(request.url).pathname.split("/").filter(Boolean).map(decodeURIComponent)
      } catch {
        return json({ error: "Not found" }, 404)
      }
      try {
        return await route(request, segments)
      } catch (error) {
        if (error instanceof Refusal) {
          return json({ error: error.message, code: error.code }, error.status)
        }
        throw error
      }
    },
    async alarm() {},
  }
}

/** The actor of an agent's workspace that keeps its sign-ins, or undefined where it has none. */
export type ModelAccess = () => Promise<ActorStub | undefined>

/**
 * What an agent's workspace is signed in to, as the agent's models read it. An agent only ever
 * reads: it cannot sign its workspace in or out, and a token that needs exchanging is exchanged
 * by the workspace, for all its agents, before it is handed over.
 */
export function workspaceCredentials(access: ModelAccess): CredentialStore {
  const read = async (providerId: string, signal?: AbortSignal) => {
    const actor = await access()
    if (actor === undefined) return undefined
    const response = await actor.fetch(
      new Request(`http://models/credentials/${encodeURIComponent(providerId)}`, { signal }),
    )
    const body = (await response.json().catch(() => ({}))) as {
      credential?: Credential | null
      error?: string
    }
    if (!response.ok) {
      throw new Error(
        body.error ?? `The workspace's sign-ins could not be read (${response.status}).`,
      )
    }
    return body.credential ?? undefined
  }
  return {
    read: (providerId, options) => read(providerId, options?.signal),
    async list(options) {
      const actor = await access()
      if (actor === undefined) return []
      const response = await actor.fetch(
        new Request("http://models/providers", { signal: options?.signal }),
      )
      if (!response.ok) return []
      const { providers } = (await response.json()) as ModelProvidersState
      return providers.flatMap((entry) =>
        entry.signedIn === null ? [] : [{ providerId: entry.id, type: entry.signedIn.type }],
      )
    },
    // pi asks to write when it finds a token running out. The workspace has seen to that
    // already, so what it keeps now is the answer, whatever pi meant to put there.
    modify: (providerId, _change, options) => read(providerId, options?.signal),
    delete: async () => {
      throw new Error("An agent cannot sign its workspace out of a model provider.")
    },
  }
}

/** The models an agent's workspace is signed in to. None where it has no such actor, or it fails. */
export async function workspaceModelOptions(access: ModelAccess): Promise<ModelOption[]> {
  const actor = await access()
  if (actor === undefined) return []
  const response = await actor.fetch(new Request("http://models/models"))
  if (!response.ok) return []
  return ((await response.json()) as { models: ModelOption[] }).models
}

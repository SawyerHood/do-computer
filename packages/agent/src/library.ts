import type {
  DeletedLibraryFile,
  LibraryFile,
  LibraryListing,
  LibraryVersion,
} from "@durable-computer/protocol"
import type { BlobStore } from "@durable-computer/runtime"
import type { Sandbox } from "@durable-computer/sandbox"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  defineDoc,
  defineExtension,
  defineTool,
  type Extension,
  type Harness,
  hook,
  section,
  type ToolDiagnostic,
  type ToolRegistration,
  ToolTask,
} from "@earendil-works/pi-durable"
import { getOrThrow } from "@earendil-works/pi-durable/env"
import { type Base, syncFolder } from "./library-sync.ts"
import { isInherited, own } from "./own.ts"

/** A whole file is held in memory to store or serve it, so files stay well under a Worker's limit. */
export const MAX_LIBRARY_FILE_BYTES = 25 * 1024 * 1024
export const MAX_LIBRARY_FILES = 2_000
/** Earlier contents kept for each file, and deleted files kept, before the oldest go for good. */
const MAX_VERSIONS = 10
const MAX_DELETED = 100
/** The folder in the agent's workspace that is the library, as the agent sees it. */
export const LIBRARY_FOLDER = "library"
/** Where files the user attaches in a chat are put. */
const UPLOADS_FOLDER = "uploads"
/** How long an address for viewing files stays the same. It works for up to twice as long. */
const VIEW_WINDOW_MS = 6 * 60 * 60 * 1000

type Who = "agent" | "user"

/**
 * A file as it is stored. Everything after `createdAt` is absent on a file from before the
 * library had folders and versions; `fileOf` says what each then means.
 */
type Entry = {
  name: string
  path?: string
  size: number
  contentType: string
  source: Who
  chatId: string | null
  createdAt: number
  updatedAt?: number
  updatedBy?: Who
  rev?: number
  /** SHA-256 of the content, to tell a file that was rewritten from one that was changed. */
  hash?: string
  versions?: LibraryVersion[]
}
type Deleted = Entry & { deletedAt: number; deletedBy: Who }
type LibraryState = { files: Record<string, Entry>; deleted?: Record<string, Deleted> }

/** What is in the library. The bytes are in blob storage, under the file's id and revision. */
export const LibraryDoc = defineDoc<LibraryState>({
  kind: "dc.library",
  version: 1,
  scope: "session",
  initial: () => ({ files: {} }),
})

type PrivateState = {
  /** Signs the addresses files are viewed at. */
  secret: string
  /** For each computer the agent has had, what its library folder held when last in step. */
  synced: Record<string, Record<string, Base>>
}

/** What the library keeps to itself: never sent to a client, and not watched by one. */
const LibraryPrivateDoc = defineDoc<PrivateState>({
  kind: "dc.library.private",
  version: 1,
  scope: "session",
  initial: () => ({ secret: "", synced: {} }),
})

export class LibraryError extends Error {}
/** The file changed since the caller last saw it. */
export class LibraryConflict extends LibraryError {}

const TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  map: "application/json",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  xml: "application/xml",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  wasm: "application/wasm",
  zip: "application/zip",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
}

export function contentTypeFor(name: string): string {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
  return TYPES[extension] ?? "application/octet-stream"
}

/** A file name safe to store and to put in a header: no path, no control characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).at(-1) ?? ""
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim()
    .slice(0, 200)
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "file" : cleaned
}

/**
 * Whether `path` can be a file's place in the library exactly as written: folders and a name
 * separated by `/`, none of them empty, hidden, or a name every object answers to.
 */
export function isLibraryPath(path: string): boolean {
  if (path.length === 0 || path.length > 600) return false
  const parts = path.split("/")
  if (parts.length > 16) return false
  return parts.every(
    (part) =>
      part !== "" &&
      part.length <= 200 &&
      !part.startsWith(".") &&
      part === part.trim() &&
      // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
      !/[\u0000-\u001f\u007f\\]/.test(part) &&
      !isInherited(part),
  )
}

/** A path somebody typed, made into one the library accepts, or undefined if it cannot be. */
export function cleanLibraryPath(path: string): string | undefined {
  const parts = path
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) return undefined
  const cleaned = parts.map((part) => cleanFileName(part.replace(/^\.+/, ""))).join("/")
  return isLibraryPath(cleaned) ? cleaned : undefined
}

/** `path`, or the first of `name-2.ext`, `name-3.ext`… that is free. */
function freePath(path: string, taken: (path: string) => boolean): string {
  if (!taken(path)) return path
  const slash = path.lastIndexOf("/")
  const dot = path.lastIndexOf(".")
  const [stem, extension] = dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ""]
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${extension}`
    if (!taken(candidate)) return candidate
  }
}

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1)

/**
 * The first revision keeps the key files had before there were revisions. The others sit beside
 * it, not under it: on a disk a key is a path, and a file cannot also be a directory.
 */
const blobKey = (id: string, rev: number) => (rev === 0 ? `library/${id}` : `library/${id}.r${rev}`)

function fileOf(id: string, entry: Entry): LibraryFile {
  return {
    id,
    path: entry.path ?? entry.name,
    name: entry.name,
    size: entry.size,
    contentType: entry.contentType,
    source: entry.source,
    chatId: entry.chatId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt ?? entry.createdAt,
    updatedBy: entry.updatedBy ?? entry.source,
    rev: entry.rev ?? 0,
  }
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

const encoder = new TextEncoder()

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** Compared in full whatever differs, so the time taken says nothing about where. */
function same(a: string, b: string): boolean {
  let difference = a.length ^ b.length
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index % Math.max(b.length, 1))
  }
  return difference === 0
}

/** Types a browser may show in place from the app's own address. Anything else is downloaded. */
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const isText = (type: string) =>
  type.startsWith("text/") || type === "application/json" || type === "application/xml"

/** The tools after which the library folder may have changed, and before which it must be right. */
const WRITING_TOOLS = new Set(["bash", "write", "edit"])
const READING_TOOLS = new Set(["bash", "write", "edit", "read"])
/** The call runs on one of the user's computers, so it cannot have touched the agent's own. */
const elsewhere = (args: Record<string, unknown>) =>
  typeof args.computer === "string" && args.computer !== ""

export type LibraryComputer = {
  readonly sandbox: Sandbox
  /** Tells this computer from the others the agent has had. Each has its own files. */
  readonly key: string
}

/**
 * The agent's library: documents and files it makes for the user, and files the user gives it.
 * They are kept here, outside the agent's computer, so they can be read and edited whatever
 * happens to it. On a computer of its own the agent has them as the folder `library` in its
 * workspace: a working copy, brought into step with what is kept here around every tool that can
 * read or change files.
 */
export class Library {
  readonly extension: Extension
  readonly sendFileTool: ToolRegistration
  /** Lets the agent see the library and bring a file from it onto a computer. */
  readonly libraryTool: ToolRegistration
  readonly #blobs: BlobStore
  readonly #now: () => number
  readonly #computer: () => LibraryComputer | undefined
  readonly #onProblem: (error: unknown) => void
  #harness: Harness | undefined
  /** Changes to what is stored happen one at a time. */
  #turn: Promise<unknown> = Promise.resolve()
  /** What is stored may have changed since the agent's folder last matched it. */
  #stale = true
  #syncing: Promise<readonly string[]> | undefined
  /** A pass that will start when the one under way ends, which callers arriving meanwhile share. */
  #queued: Promise<readonly string[]> | undefined
  /** What the agent has already been told could not be taken in. */
  readonly #reported = new Set<string>()

  constructor(options: {
    blobs: BlobStore
    now: () => number
    /** The agent's own computer, if it has one right now. */
    computer?: () => LibraryComputer | undefined
    /** Told when the folder could not be brought into step with the library. */
    onProblem?: (error: unknown) => void
  }) {
    this.#blobs = options.blobs
    this.#now = options.now
    this.#computer = options.computer ?? (() => undefined)
    this.#onProblem = options.onProblem ?? (() => {})
    const fail = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] })
    this.sendFileTool = defineTool({
      name: "send_file",
      description:
        "Put a file from your computer in front of the user: a document, image, export or anything else they should have. It appears in the chat, where they can open it, and is kept in their library. Use it instead of pasting long file contents into a reply.",
      parameters: Type.Object({
        path: Type.String({ description: "Path of the file to send" }),
        name: Type.Optional(Type.String({ description: "File name to give it, if not its own" })),
      }),
      execute: async (args, api, context) => {
        if (api.env === undefined) return fail("There is no computer to send a file from.")
        const absolute = getOrThrow(await api.env.absolutePath(args.path, context))
        const info = await api.env.fileInfo(absolute, context)
        if (!info.ok) return fail(`Could not find ${args.path}: ${info.error.message}`)
        if (info.value.kind !== "file") return fail(`${args.path} is not a file.`)
        if (info.value.size > MAX_LIBRARY_FILE_BYTES) {
          return fail(
            `${args.path} is ${Math.round(info.value.size / (1024 * 1024))} MB; files up to ${MAX_LIBRARY_FILE_BYTES / (1024 * 1024)} MB can be sent.`,
          )
        }
        try {
          // A file in the library folder is in the library already, or is once the folder is read.
          const folder = this.#folder()
          const computer = (args as { computer?: string }).computer
          if (
            folder !== undefined &&
            (computer === undefined || computer === "") &&
            args.name === undefined &&
            absolute.startsWith(`${folder}/`)
          ) {
            await this.sync(context)
            const kept = await this.find(absolute.slice(folder.length + 1), context)
            if (kept !== undefined) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Showed the user ${kept.path} (${kept.size} bytes) from the library.`,
                  },
                ],
                details: kept,
              }
            }
          }
          const bytes = await api.env.readBinaryFile(absolute, context)
          if (!bytes.ok) return fail(`Could not read ${args.path}: ${bytes.error.message}`)
          const file = await this.add(
            {
              name: args.name ?? info.value.name,
              bytes: bytes.value,
              source: "agent",
              chatId: String(api.conversationId),
              // Sending a newer copy of what it sent before updates that file.
              whenTaken: "replace",
            },
            context,
          )
          return {
            content: [
              { type: "text", text: `Sent ${file.name} (${file.size} bytes) to the user.` },
            ],
            details: file,
          }
        } catch (error) {
          if (error instanceof LibraryError) return fail(error.message)
          throw error
        }
      },
    })
    this.libraryTool = defineTool({
      name: "library",
      description:
        "The user's library: files they uploaded for you, and files you have made for them. `list` shows what is there, newest first. `get` copies one onto a computer so you can read it or work on it there.",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("list"), Type.Literal("get")]),
        file: Type.Optional(
          Type.String({ description: "For get: the file's path, name or id, as `list` shows it" }),
        ),
        path: Type.Optional(
          Type.String({ description: "For get: where to put it. Default: uploads/<name>" }),
        ),
      }),
      execute: async (args, api, context) => {
        const files = await this.list(context)
        if (args.action === "list") {
          const lines = files.map(
            (file) =>
              `${file.path} (${file.size} bytes, ${
                file.source === "user" ? "uploaded by the user" : "made by you"
              }, ${new Date(file.createdAt).toISOString().slice(0, 10)}, id ${file.id})`,
          )
          return {
            content: [
              {
                type: "text",
                text: lines.length === 0 ? "The library is empty." : lines.join("\n"),
              },
            ],
          }
        }
        const wanted = args.file?.trim() ?? ""
        if (wanted === "") return fail("`get` needs the file's path, name or id.")
        const lower = wanted.toLowerCase()
        // `list` is newest first, so a name used twice means the latest one.
        const file =
          files.find((entry) => entry.id === wanted || entry.path.toLowerCase() === lower) ??
          files.find((entry) => entry.name.toLowerCase() === lower)
        if (file === undefined) {
          return fail(`There is no "${wanted}" in the library. Use the list action to see it.`)
        }
        if (api.env === undefined) return fail("There is no computer to put the file on.")
        const bytes = await this.bytes(file)
        if (bytes === undefined) return fail(`The contents of ${file.name} are missing.`)
        const target = getOrThrow(
          await api.env.absolutePath(args.path?.trim() || `uploads/${file.name}`, context),
        )
        const written = await api.env.writeFile(target, bytes, context)
        if (!written.ok) return fail(`Could not write ${target}: ${written.error.message}`)
        return {
          content: [
            { type: "text", text: `Copied ${file.name} (${file.size} bytes) to ${target}.` },
          ],
          details: { path: target, file },
        }
      },
    })
    this.extension = defineExtension({
      name: "dc.library",
      tools: [this.sendFileTool, this.libraryTool],
      sections: [
        section("library", () => {
          const folder = this.#folder()
          if (folder === undefined) {
            return "The user can upload files to their library for you. When they mention a file they uploaded or attached, find it with the `library` tool and copy it onto a computer with its `get` action before answering; do not ask them to paste it."
          }
          return [
            `The folder ${folder} on your computer is the user's library. Whatever you put there is kept safe outside your computer and appears in the Library of their app, in the folders you gave it, where they can read it, edit it, and open it while your computer is off. Their edits and the files they add arrive in the same folder, and files they attach in a chat are in ${folder}/${UPLOADS_FOLDER}; read those there, and do not ask them to paste a file.`,
            "Write anything they should read or keep as a document in that folder: Markdown for writing, HTML for pages, charts and anything laid out. An HTML page is shown as a page, and the styles, scripts and images it links to with relative paths work when they are in the folder beside it. Use folders and plain file names, since those are what the user sees. Hidden files, `node_modules` and files over 25 MB are left out, so keep scratch work elsewhere in your workspace.",
            "After making or changing a document they asked for, show it to them with `send_file`, which puts it in the chat for them to open.",
          ].join("\n")
        }),
      ],
      hooks: [
        hook(ToolTask, {
          beforeTool: async (call, _api, context) => {
            if (elsewhere(call.arguments) || !READING_TOOLS.has(call.name)) return undefined
            // A computer that cannot be reached fails the tool itself, with the reason.
            if (this.#stale) await this.sync(context).catch((error) => this.#onProblem(error))
            return undefined
          },
          afterTool: async (call, result, _api, context) => {
            if (elsewhere(call.arguments) || !WRITING_TOOLS.has(call.name)) return undefined
            const problems = await this.sync(context).catch((error) => {
              this.#onProblem(error)
              return []
            })
            if (problems.length === 0) return undefined
            const added: ToolDiagnostic[] = problems.map((message) => ({
              severity: "warn",
              message,
            }))
            return { ...result, diagnostics: [...(result.diagnostics ?? []), ...added] }
          },
        }),
      ],
    })
  }

  attach(harness: Harness): void {
    this.#harness = harness
  }

  #require(): Harness {
    if (this.#harness === undefined) throw new Error("The library is not attached to a harness")
    return this.#harness
  }

  /** The library folder on the agent's own computer, if it has one. */
  #folder(): string | undefined {
    const computer = this.#computer()
    return computer === undefined ? undefined : `${computer.sandbox.home}/${LIBRARY_FOLDER}`
  }

  /** Run `change` after every change asked for before it. */
  #exclusive<T>(change: () => Promise<T>): Promise<T> {
    const result = this.#turn.then(change, change)
    this.#turn = result.catch(() => {})
    return result
  }

  /** The agent is on another computer now, whose folder has yet to be looked at. */
  computerChanged(): void {
    this.#stale = true
    this.#reported.clear()
  }

  /**
   * Bring the library folder on the agent's computer and the library into step, both ways.
   * Returns what could not be taken in, in words for the agent. Does nothing without a computer.
   */
  sync(context: Context): Promise<readonly string[]> {
    if (this.#queued !== undefined) return this.#queued
    const run = async () => {
      const computer = this.#computer()
      if (computer === undefined) return []
      this.#stale = false
      try {
        const harness = this.#require()
        const base =
          own((await harness.snapshot(LibraryPrivateDoc, context))?.synced, computer.key) ?? {}
        const outcome = await syncFolder({
          library: this,
          sandbox: computer.sandbox,
          folder: `${computer.sandbox.home}/${LIBRARY_FOLDER}`,
          base,
          context,
        })
        if (outcome.changed) {
          await harness.commit(async (tx) => {
            ;(await tx.doc(LibraryPrivateDoc)).synced[computer.key] = outcome.base
          }, context)
        }
        if (outcome.failed !== undefined) throw outcome.failed
        // Said once each. A file that stays where it is would otherwise be reported after every tool.
        const fresh = outcome.problems.filter((problem) => !this.#reported.has(problem))
        for (const problem of fresh) this.#reported.add(problem)
        return fresh
      } catch (error) {
        this.#stale = true
        throw error
      }
    }
    if (this.#syncing === undefined) {
      const pass = run().finally(() => {
        if (this.#syncing === pass) this.#syncing = undefined
      })
      this.#syncing = pass
      return pass
    }
    // One is under way and may already be past what this caller changed, so another follows it.
    const queued: Promise<readonly string[]> = this.#syncing
      .catch(() => {})
      .then(() => {
        this.#queued = undefined
        this.#syncing = queued
        return run()
      })
      .finally(() => {
        if (this.#syncing === queued) this.#syncing = undefined
      })
    this.#queued = queued
    return queued
  }

  /** Give every file from before the library had folders a place in it. */
  async upgrade(context: Context): Promise<void> {
    const files = (await this.#require().snapshot(LibraryDoc, context))?.files ?? {}
    if (Object.values(files).every((entry) => entry.path !== undefined)) return
    await this.#exclusive(() =>
      this.#require().commit(async (tx) => {
        const { files } = await tx.doc(LibraryDoc)
        const taken = new Set(Object.values(files).flatMap((entry) => entry.path ?? []))
        const oldestFirst = Object.values(files).sort((a, b) => a.createdAt - b.createdAt)
        for (const entry of oldestFirst) {
          if (entry.path !== undefined) continue
          const name = cleanFileName(entry.name)
          const wanted = entry.source === "user" ? `${UPLOADS_FOLDER}/${name}` : name
          entry.path = freePath(isLibraryPath(wanted) ? wanted : "file", (path) => taken.has(path))
          taken.add(entry.path)
        }
      }, context),
    )
  }

  async #state(context: Context): Promise<Readonly<LibraryState>> {
    return (await this.#require().snapshot(LibraryDoc, context)) ?? { files: {} }
  }

  async list(context: Context): Promise<LibraryFile[]> {
    return Object.entries((await this.#state(context)).files)
      .map(([id, entry]) => fileOf(id, entry))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Everything a client shows: the files, the deleted ones, and where files are viewed. */
  async listing(context: Context): Promise<LibraryListing> {
    const state = await this.#state(context)
    const deleted: DeletedLibraryFile[] = Object.entries(state.deleted ?? {})
      .map(([id, entry]) => ({
        ...fileOf(id, entry),
        deletedAt: entry.deletedAt,
        deletedBy: entry.deletedBy,
      }))
      .sort((a, b) => b.deletedAt - a.deletedAt)
    return { files: await this.list(context), deleted, view: await this.viewToken(context) }
  }

  async find(path: string, context: Context): Promise<LibraryFile | undefined> {
    return (await this.list(context)).find((file) => file.path === path)
  }

  /** Each file's place, revision and content hash, for comparing with a folder. */
  async stored(
    context: Context,
  ): Promise<Map<string, { id: string; rev: number; hash: string | undefined }>> {
    return new Map(
      Object.entries((await this.#state(context)).files).map(([id, entry]) => [
        entry.path ?? entry.name,
        { id, rev: entry.rev ?? 0, hash: entry.hash },
      ]),
    )
  }

  /** The content of a file as it is now, or as it was at an earlier revision. */
  async bytes(file: { id: string; rev: number }): Promise<Uint8Array | undefined> {
    return (await this.#blobs.get(blobKey(file.id, file.rev)))?.bytes()
  }

  /**
   * Keep a new file. `path` says exactly where; otherwise it goes by `name` into `dir`, which is
   * the uploads folder unless given. Store the bytes, then record the file: an unrecorded blob is
   * harmless, the reverse is not.
   */
  async add(
    input: {
      name?: string
      path?: string
      dir?: string
      bytes: Uint8Array
      source: Who
      chatId: string | null
      contentType?: string
      /** What to do when a file is already there: take the next free name, or become its new content. */
      whenTaken?: "rename" | "replace"
      /** Whoever is adding it already has it where the agent's folder would get it from. */
      quiet?: boolean
    },
    context: Context,
  ): Promise<LibraryFile> {
    if (input.bytes.length > MAX_LIBRARY_FILE_BYTES) {
      throw new LibraryError(
        `Files up to ${MAX_LIBRARY_FILE_BYTES / (1024 * 1024)} MB can be kept in the library.`,
      )
    }
    let wanted = input.path
    if (wanted === undefined) {
      const name = cleanFileName(input.name ?? "")
      const dir =
        input.dir !== undefined
          ? input.dir.trim() === ""
            ? ""
            : cleanLibraryPath(input.dir)
          : input.source === "user"
            ? UPLOADS_FOLDER
            : ""
      if (dir === undefined) throw new LibraryError("That is not a folder the library can use.")
      wanted = cleanLibraryPath(dir === "" ? name : `${dir}/${name}`)
    }
    if (wanted === undefined || !isLibraryPath(wanted)) {
      throw new LibraryError("That is not a name the library can use.")
    }
    const hash = await sha256(input.bytes)
    return this.#exclusive(async () => {
      const state = await this.#state(context)
      const existing = Object.entries(state.files).find(
        ([, entry]) => (entry.path ?? entry.name) === wanted,
      )
      if (existing !== undefined && input.whenTaken === "replace") {
        return this.#write(existing[0], input.bytes, hash, input.source, input.quiet, context)
      }
      const taken = new Set(Object.values(state.files).map((entry) => entry.path ?? entry.name))
      const path = freePath(wanted, (candidate) => taken.has(candidate))
      const id = crypto.randomUUID()
      const now = this.#now()
      const entry: Entry = {
        name: nameOf(path),
        path,
        size: input.bytes.length,
        // A browser names the type of what it uploads, when it knows. Otherwise the name says.
        contentType:
          input.contentType === undefined ||
          input.contentType === "" ||
          input.contentType === "application/octet-stream"
            ? contentTypeFor(path)
            : input.contentType,
        source: input.source,
        chatId: input.chatId,
        createdAt: now,
        updatedAt: now,
        updatedBy: input.source,
        rev: 0,
        hash,
      }
      await this.#blobs.put(blobKey(id, 0), input.bytes, { contentType: entry.contentType })
      await this.#require().commit(async (tx) => {
        const { files } = await tx.doc(LibraryDoc)
        if (Object.keys(files).length >= MAX_LIBRARY_FILES) {
          throw new LibraryError(
            `The library is full (${MAX_LIBRARY_FILES} files). Delete some first.`,
          )
        }
        files[id] = entry
      }, context)
      if (input.quiet !== true) this.#stale = true
      return fileOf(id, entry)
    })
  }

  /**
   * Give a file new content. What it held is kept as a version. With `ifRev`, only when the file
   * is still at that revision: otherwise somebody else changed it first, and that is reported.
   */
  async write(
    id: string,
    bytes: Uint8Array,
    by: Who,
    context: Context,
    options: { ifRev?: number; quiet?: boolean } = {},
  ): Promise<LibraryFile> {
    if (bytes.length > MAX_LIBRARY_FILE_BYTES) {
      throw new LibraryError(
        `Files up to ${MAX_LIBRARY_FILE_BYTES / (1024 * 1024)} MB can be kept in the library.`,
      )
    }
    const hash = await sha256(bytes)
    return this.#exclusive(async () => {
      const entry = own((await this.#state(context)).files, id)
      if (
        entry !== undefined &&
        options.ifRev !== undefined &&
        (entry.rev ?? 0) !== options.ifRev
      ) {
        throw new LibraryConflict(
          "This file was changed by someone else since you opened it. Your change was not saved.",
        )
      }
      return this.#write(id, bytes, hash, by, options.quiet, context)
    })
  }

  /** Only inside `#exclusive`. */
  async #write(
    id: string,
    bytes: Uint8Array,
    hash: string,
    by: Who,
    quiet: boolean | undefined,
    context: Context,
  ): Promise<LibraryFile> {
    const current = own((await this.#state(context)).files, id)
    if (current === undefined) throw new LibraryError("That file is not in the library.")
    // Saved again without a change: nothing to keep a version of.
    if (current.hash === hash) return fileOf(id, current)
    const rev = (current.rev ?? 0) + 1
    await this.#blobs.put(blobKey(id, rev), bytes, { contentType: current.contentType })
    const dropped: number[] = []
    const entry = await this.#require().commit(async (tx) => {
      const entry = (await tx.doc(LibraryDoc)).files[id]!
      const versions = [
        ...(entry.versions ?? []),
        {
          rev: entry.rev ?? 0,
          size: entry.size,
          at: entry.updatedAt ?? entry.createdAt,
          by: entry.updatedBy ?? entry.source,
        },
      ]
      while (versions.length > MAX_VERSIONS) dropped.push(versions.shift()!.rev)
      entry.versions = versions
      entry.rev = rev
      entry.size = bytes.length
      entry.hash = hash
      entry.updatedAt = this.#now()
      entry.updatedBy = by
      return { ...entry }
    }, context)
    for (const old of dropped) await this.#blobs.delete(blobKey(id, old))
    if (quiet !== true) this.#stale = true
    return fileOf(id, entry)
  }

  /** Rename a file or put it in another folder. Its content and versions go with it. */
  async move(
    id: string,
    to: string,
    context: Context,
    options: { quiet?: boolean; exact?: boolean } = {},
  ): Promise<LibraryFile> {
    const path =
      options.exact === true ? (isLibraryPath(to) ? to : undefined) : cleanLibraryPath(to)
    if (path === undefined) throw new LibraryError("That is not a name the library can use.")
    return this.#exclusive(async () => {
      const entry = await this.#require().commit(async (tx) => {
        const { files } = await tx.doc(LibraryDoc)
        const entry = own(files, id)
        if (entry === undefined) throw new LibraryError("That file is not in the library.")
        const taken = Object.entries(files).some(
          ([other, file]) => other !== id && (file.path ?? file.name) === path,
        )
        if (taken) throw new LibraryError(`There is already a file at ${path}.`)
        entry.path = path
        entry.name = nameOf(path)
        return { ...entry }
      }, context)
      if (options.quiet !== true) this.#stale = true
      return fileOf(id, entry)
    })
  }

  /** The earlier contents of a file that are still kept, newest first. */
  async versions(id: string, context: Context): Promise<LibraryVersion[] | undefined> {
    const entry = own((await this.#state(context)).files, id)
    return entry === undefined ? undefined : [...(entry.versions ?? [])].reverse()
  }

  /** Make an earlier content the current one. What it replaces becomes a version in turn. */
  async revert(id: string, rev: number, by: Who, context: Context): Promise<LibraryFile> {
    const versions = await this.versions(id, context)
    if (versions?.some((version) => version.rev === rev) !== true) {
      throw new LibraryError("That version is no longer kept.")
    }
    const bytes = await this.bytes({ id, rev })
    if (bytes === undefined) throw new LibraryError("That version is no longer kept.")
    return this.write(id, bytes, by, context)
  }

  /**
   * Take a file out of the library. It can be brought back for a while: a file the agent's
   * computer no longer has is taken out the same way, and that may not have been meant.
   */
  async remove(
    id: string,
    by: Who,
    context: Context,
    options: { quiet?: boolean } = {},
  ): Promise<boolean> {
    return this.#exclusive(async () => {
      const purged: [string, Deleted][] = []
      const existed = await this.#require().commit(async (tx) => {
        const state = await tx.doc(LibraryDoc)
        const entry = own(state.files, id)
        if (entry === undefined) return false
        delete state.files[id]
        state.deleted ??= {}
        state.deleted[id] = { ...entry, deletedAt: this.#now(), deletedBy: by }
        const oldestFirst = Object.entries(state.deleted).sort(
          (a, b) => a[1].deletedAt - b[1].deletedAt,
        )
        while (oldestFirst.length > MAX_DELETED) {
          const [oldId, old] = oldestFirst.shift()!
          purged.push([oldId, { ...old }])
          delete state.deleted[oldId]
        }
        return true
      }, context)
      for (const [oldId, old] of purged) await this.#purge(oldId, old)
      if (existed && options.quiet !== true) this.#stale = true
      return existed
    })
  }

  async #purge(id: string, entry: Entry): Promise<void> {
    for (const rev of [entry.rev ?? 0, ...(entry.versions ?? []).map((version) => version.rev)]) {
      await this.#blobs.delete(blobKey(id, rev))
    }
  }

  /** Bring a deleted file back, where it was if that place is still free. */
  async restore(id: string, context: Context): Promise<LibraryFile | undefined> {
    return this.#exclusive(async () => {
      const entry = await this.#require().commit(async (tx) => {
        const state = await tx.doc(LibraryDoc)
        const gone = own(state.deleted, id)
        if (gone === undefined) return undefined
        const { deletedAt: _at, deletedBy: _by, ...entry } = gone
        const taken = new Set(Object.values(state.files).map((file) => file.path ?? file.name))
        entry.path = freePath(entry.path ?? entry.name, (path) => taken.has(path))
        entry.name = nameOf(entry.path)
        delete state.deleted![id]
        state.files[id] = entry
        return { ...entry }
      }, context)
      if (entry === undefined) return undefined
      this.#stale = true
      return fileOf(id, entry)
    })
  }

  /** Delete a deleted file for good. */
  async forget(id: string, context: Context): Promise<boolean> {
    return this.#exclusive(async () => {
      const gone = await this.#require().commit(async (tx) => {
        const state = await tx.doc(LibraryDoc)
        const gone = own(state.deleted, id)
        if (gone === undefined) return undefined
        delete state.deleted![id]
        return { ...gone }
      }, context)
      if (gone === undefined) return false
      await this.#purge(id, gone)
      return true
    })
  }

  /**
   * A response serving the file to the app itself, or undefined when there is none. Only a
   * picture is shown in place: this is the app's own address, where nothing may run as a page.
   */
  async serve(id: string, request: Request, context: Context): Promise<Response | undefined> {
    const entry = own((await this.#state(context)).files, id)
    if (entry === undefined) return undefined
    const asked = new URL(request.url).searchParams.get("rev")
    const rev = asked === null ? (entry.rev ?? 0) : Number(asked)
    const kept =
      rev === (entry.rev ?? 0) || entry.versions?.some((version) => version.rev === rev) === true
    if (!kept) return undefined
    const etag = `"${id}.${rev}"`
    // An address that names a revision always serves the same bytes; one that does not, the newest.
    const cache = asked === null ? "private, no-cache" : "private, max-age=31536000, immutable"
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { etag, "cache-control": cache } })
    }
    const bytes = await this.bytes({ id, rev })
    if (bytes === undefined) return undefined
    const inline = INLINE_TYPES.has(entry.contentType)
    return new Response(bytes.slice().buffer, {
      headers: {
        "content-type": inline ? entry.contentType : "application/octet-stream",
        "content-length": String(bytes.length),
        // Files are untrusted content on the app's own origin: never let one run as a page.
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(entry.name)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
        "cache-control": cache,
        etag,
      },
    })
  }

  async #secret(context: Context): Promise<string> {
    const harness = this.#require()
    const existing = (await harness.snapshot(LibraryPrivateDoc, context))?.secret
    if (existing !== undefined && existing !== "") return existing
    return harness.commit(async (tx) => {
      const doc = await tx.doc(LibraryPrivateDoc)
      if (doc.secret === "") {
        const random = crypto.getRandomValues(new Uint8Array(32))
        doc.secret = [...random].map((byte) => byte.toString(16).padStart(2, "0")).join("")
      }
      return doc.secret
    }, context)
  }

  /**
   * What stands in for the user's session where files are viewed as pages. A page cannot be
   * given the session itself, so the address carries this instead. It is the same for a few
   * hours, so that a page being looked at does not reload, and stops working a few hours later.
   */
  async viewToken(context: Context): Promise<string> {
    const window = Math.floor(this.#now() / VIEW_WINDOW_MS).toString(36)
    return `${window}-${await sign(await this.#secret(context), `view:${window}`)}`
  }

  async #mayView(token: string, context: Context): Promise<boolean> {
    const dash = token.indexOf("-")
    if (dash === -1) return false
    const window = token.slice(0, dash)
    const current = Math.floor(this.#now() / VIEW_WINDOW_MS)
    if (window !== current.toString(36) && window !== (current - 1).toString(36)) return false
    return same(token.slice(dash + 1), await sign(await this.#secret(context), `view:${window}`))
  }

  /**
   * Serve the file at `path` as what it is, so that an HTML document is a page and what it links
   * to beside it loads. Whoever asks needs only `token`. Every response is sandboxed: the page
   * runs with an origin of its own that is nobody's, so it cannot act as the user in the app even
   * though it is served from the app's address.
   */
  async view(
    token: string,
    path: string,
    request: Request,
    context: Context,
  ): Promise<Response | undefined> {
    if (!(await this.#mayView(token, context))) return undefined
    const files = await this.list(context)
    const file =
      files.find((entry) => entry.path === path) ??
      // A folder is its index page, as on any web server.
      files.find((entry) => entry.path === `${path === "" ? "" : `${path}/`}index.html`)
    if (file === undefined) return undefined
    if (file.path !== path) {
      // Its links are relative to the folder, so the folder's address has to end in a slash.
      const url = new URL(request.url)
      if (!url.pathname.endsWith("/")) {
        if (path === "") return undefined
        return new Response(null, {
          status: 302,
          headers: { location: `${encodeURIComponent(path.slice(path.lastIndexOf("/") + 1))}/` },
        })
      }
    }
    const type = TYPES[file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()]
    const contentType = type ?? file.contentType
    const headers: Record<string, string> = {
      "content-type": isText(contentType) ? `${contentType}; charset=utf-8` : contentType,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox allow-scripts allow-popups allow-forms allow-modals",
      // The address is the permission. It must not travel to whatever the page loads or links to.
      "referrer-policy": "no-referrer",
      "cache-control": "private, no-cache",
      etag: `"${file.id}.${file.rev}"`,
    }
    if (request.headers.get("if-none-match") === headers.etag) {
      return new Response(null, { status: 304, headers })
    }
    // A link from a page to a document that is not a page: the app opens it in its own viewer.
    if (request.headers.get("sec-fetch-dest") === "iframe" && contentType === "text/markdown") {
      const message = JSON.stringify({ type: "dc-library-open", path: file.path })
      return new Response(
        `<!doctype html><meta charset="utf-8"><script>parent.postMessage(${message.replaceAll("<", "\\u003c")},"*")</script>`,
        {
          headers: {
            ...headers,
            "content-type": "text/html; charset=utf-8",
            etag: `"open.${file.id}"`,
          },
        },
      )
    }
    const bytes = await this.bytes(file)
    if (bytes === undefined) return undefined
    return new Response(bytes.slice().buffer, {
      headers: { ...headers, "content-length": String(bytes.length) },
    })
  }
}

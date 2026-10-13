import {
  type DeletedLibraryFile,
  type LibraryFile,
  type LibraryListing,
  type LibraryVersion,
  markdownFiles,
  PAGE_THEME_VERSION,
  SITE_LISTING_HEADER,
  type SiteEntry,
  type SiteListing,
  themePageBytes,
} from "@do-computer/protocol"
import type { BlobStore } from "@do-computer/runtime"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { defineDoc, type Harness } from "@earendil-works/pi-durable"
import type { Base } from "./library-sync.ts"
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
export const UPLOADS_FOLDER = "uploads"
/** The largest document that is read to see which pictures it refers to. */
const MAX_REFERRING_BYTES = 1024 * 1024
/** How long an address for viewing files stays the same. It works for up to twice as long. */
const VIEW_WINDOW_MS = 6 * 60 * 60 * 1000

export type Who = "agent" | "user"

/**
 * A file as it is stored. Everything after `createdAt` is absent on a file from before the
 * library had folders and versions; `fileOf` says what each then means.
 */
export type Entry = {
  name: string
  path?: string
  size: number
  contentType: string
  source: Who
  chatId: string | null
  /** The agent that made it, or in whose chat it was sent or uploaded. Absent where there is one agent. */
  agentId?: string
  createdAt: number
  updatedAt?: number
  updatedBy?: Who
  rev?: number
  /** SHA-256 of the content, to tell a file that was rewritten from one that was changed. */
  hash?: string
  versions?: LibraryVersion[]
}
export type Deleted = Entry & { deletedAt: number; deletedBy: Who }
export type LibraryState = { files: Record<string, Entry>; deleted?: Record<string, Deleted> }

/** What is in the library. The bytes are in blob storage, under the file's id and revision. */
export const LibraryDoc = defineDoc<LibraryState>({
  kind: "dc.library",
  version: 1,
  scope: "session",
  initial: () => ({ files: {} }),
})

export type PrivateState = {
  /** Signs the addresses files are viewed at. */
  secret: string
  /** For each computer with a copy of the library, what its folder held when last in step. */
  synced: Record<string, Record<string, Base>>
  /** Counts up whenever what is kept changes. */
  rev?: number
}

/** What the library keeps to itself: never sent to a client, and not watched by one. */
export const LibraryPrivateDoc = defineDoc<PrivateState>({
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
    ...(entry.agentId === undefined ? {} : { agentId: entry.agentId }),
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

/**
 * Where the record of what is in a library is kept: in the store of the agent it belongs to, or
 * in the database of an actor of its own.
 */
export interface LibraryDocs {
  read(): Promise<Readonly<LibraryState>>
  change<T>(change: (state: LibraryState) => T | Promise<T>): Promise<T>
  readPrivate(): Promise<Readonly<LibrarySecrets>>
  changePrivate<T>(change: (state: LibrarySecrets) => T): Promise<T>
  /** What a computer's folder held when it last agreed with the library. */
  base(computer: string): Promise<Record<string, Base> | undefined>
  setBase(computer: string, base: Record<string, Base> | undefined): Promise<void>
}

/** What a library keeps to itself, less the record of each computer's folder. */
export type LibrarySecrets = Pick<PrivateState, "secret" | "rev">

/** A library's record as documents of a harness: where an agent keeps a library of its own. */
export function harnessDocs(harness: () => Harness): LibraryDocs {
  const context = BACKGROUND_CONTEXT
  return {
    read: async () => (await harness().snapshot(LibraryDoc, context)) ?? { files: {} },
    change: (change) => harness().commit(async (tx) => change(await tx.doc(LibraryDoc)), context),
    readPrivate: async () =>
      (await harness().snapshot(LibraryPrivateDoc, context)) ?? { secret: "", synced: {} },
    changePrivate: (change) =>
      harness().commit(async (tx) => change(await tx.doc(LibraryPrivateDoc)), context),
    base: async (computer) =>
      own((await harness().snapshot(LibraryPrivateDoc, context))?.synced, computer),
    setBase: (computer, base) =>
      harness().commit(async (tx) => {
        const { synced } = await tx.doc(LibraryPrivateDoc)
        if (isInherited(computer)) return
        if (base === undefined) delete synced[computer]
        else synced[computer] = base
      }, context),
  }
}

/** A file to keep, and where. */
export type NewLibraryFile = {
  name?: string
  path?: string
  dir?: string
  bytes: Uint8Array
  source: Who
  /** The chat it was sent or uploaded in, and the agent whose chat that is. */
  chatId: string | null
  agentId?: string
  contentType?: string
  /** What to do when a file is already there: take the next free name, or become its new content. */
  whenTaken?: "rename" | "replace"
  /** The pass of a folder that is adding it, which therefore has it already. */
  pass?: string
}

/** One pass of bringing a computer's library folder into step, which nobody else may run meanwhile. */
export type LibraryPass = {
  /** Names the pass in whatever it changes, and when it ends. */
  pass: string
  /** What the folder and the library held when they last agreed. */
  base: Record<string, Base>
}

/** How long a pass may go without a sign of life before another may start. */
const PASS_TTL_MS = 90_000

/**
 * What an agent needs of a library, wherever it is kept: the files, and one pass at a time over
 * each computer's copy of them.
 */
export interface LibraryBackend {
  /** Counts up whenever what is kept changes. */
  rev(): Promise<number>
  list(): Promise<LibraryFile[]>
  stored(): Promise<Map<string, { id: string; rev: number; hash: string | undefined }>>
  bytes(file: { id: string; rev: number }): Promise<Uint8Array | undefined>
  add(input: NewLibraryFile): Promise<LibraryFile>
  write(
    id: string,
    bytes: Uint8Array,
    by: Who,
    options?: { ifRev?: number; pass?: string },
  ): Promise<LibraryFile>
  move(id: string, to: string, options?: { exact?: boolean; pass?: string }): Promise<LibraryFile>
  remove(id: string, by: Who, options?: { pass?: string }): Promise<boolean>
  /** Start a pass over a computer's folder, or undefined while another is under way. */
  beginPass(computer: string): Promise<LibraryPass | undefined>
  /** A pass that takes long says that it is still going. */
  renewPass(computer: string, pass: string): Promise<void>
  /**
   * End a pass, with what the folder and the library now agree on if that changed. Resolves
   * with where the library stands, and whether anything but this pass changed it meanwhile.
   */
  endPass(
    computer: string,
    pass: string,
    base: Record<string, Base> | undefined,
  ): Promise<{ rev: number; clean: boolean }>
}

/**
 * A library: documents and files an agent makes for the people it works for, and files they
 * give it. They are kept here, outside any computer, so they can be read and edited whatever
 * happens to one. On a machine of the workspace they are also the folder `library` in its home
 * directory: a working copy, brought into step with what is kept here around every tool that can
 * read or change files there.
 */
export class LibraryStore implements LibraryBackend {
  readonly #docs: LibraryDocs
  readonly #blobs: BlobStore
  readonly #now: () => number
  /** Changes to what is stored happen one at a time. */
  #turn: Promise<unknown> = Promise.resolve()
  /** The passes under way, by computer. */
  readonly #passes = new Map<string, { pass: string; until: number; dirty: boolean }>()
  /** Told after every change to what is kept. */
  onChange: () => void = () => {}

  constructor(options: { docs: LibraryDocs; blobs: BlobStore; now: () => number }) {
    this.#docs = options.docs
    this.#blobs = options.blobs
    this.#now = options.now
  }

  /** Run `change` after every change asked for before it. */
  #exclusive<T>(change: () => Promise<T>): Promise<T> {
    const result = this.#turn.then(change, change)
    this.#turn = result.catch(() => {})
    return result
  }

  /** What is kept changed. Every pass but the one that did it has something new to look at. */
  async #changed(pass?: string): Promise<void> {
    await this.#docs.changePrivate((state) => {
      state.rev = (state.rev ?? 0) + 1
    })
    for (const held of this.#passes.values()) if (held.pass !== pass) held.dirty = true
    this.onChange()
  }

  async rev(): Promise<number> {
    return (await this.#docs.readPrivate()).rev ?? 0
  }

  async beginPass(computer: string): Promise<LibraryPass | undefined> {
    const held = this.#passes.get(computer)
    if (held !== undefined && held.until > this.#now()) return undefined
    const pass = crypto.randomUUID()
    this.#passes.set(computer, { pass, until: this.#now() + PASS_TTL_MS, dirty: false })
    return { pass, base: { ...((await this.#docs.base(computer)) ?? {}) } }
  }

  async renewPass(computer: string, pass: string): Promise<void> {
    const held = this.#passes.get(computer)
    if (held?.pass === pass) held.until = this.#now() + PASS_TTL_MS
  }

  async endPass(
    computer: string,
    pass: string,
    base: Record<string, Base> | undefined,
  ): Promise<{ rev: number; clean: boolean }> {
    const held = this.#passes.get(computer)
    const mine = held?.pass === pass
    if (mine) this.#passes.delete(computer)
    if (base !== undefined) await this.#docs.setBase(computer, base)
    // A pass that was given up on may have run beside another. It cannot say it saw everything.
    return { rev: await this.rev(), clean: mine && !held.dirty }
  }

  /** What a computer's folder held when it last agreed with the library, to carry over. */
  base(computer: string): Promise<Record<string, Base> | undefined> {
    return this.#docs.base(computer)
  }

  /** Forget what a computer's folder held: the computer is gone, or is known by another name. */
  dropBase(computer: string): Promise<void> {
    return this.#docs.setBase(computer, undefined)
  }

  /** Give every file from before the library had folders a place in it. */
  async upgrade(): Promise<void> {
    const { files } = await this.#docs.read()
    if (Object.values(files).every((entry) => entry.path !== undefined)) return
    await this.#exclusive(() =>
      this.#docs.change(async (doc) => {
        const { files } = doc
        const taken = new Set(Object.values(files).flatMap((entry) => entry.path ?? []))
        const oldestFirst = Object.values(files).sort((a, b) => a.createdAt - b.createdAt)
        for (const entry of oldestFirst) {
          if (entry.path !== undefined) continue
          const name = cleanFileName(entry.name)
          const wanted = entry.source === "user" ? `${UPLOADS_FOLDER}/${name}` : name
          entry.path = freePath(isLibraryPath(wanted) ? wanted : "file", (path) => taken.has(path))
          taken.add(entry.path)
        }
      }),
    )
  }

  async list(): Promise<LibraryFile[]> {
    return Object.entries((await this.#docs.read()).files)
      .map(([id, entry]) => fileOf(id, entry))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Everything a client shows: the files, the deleted ones, and where files are viewed. */
  /**
   * Everything a client shows: the files, the deleted ones, and where files are viewed. For one
   * agent of several that share the library, a file's chat is only named where it is that agent's:
   * chats are numbered agent by agent.
   */
  async listing(forAgent?: string): Promise<LibraryListing> {
    const state = await this.#docs.read()
    const seen = <File extends LibraryFile>(file: File): File =>
      forAgent === undefined || file.agentId === undefined || file.agentId === forAgent
        ? file
        : { ...file, chatId: null }
    const deleted: DeletedLibraryFile[] = Object.entries(state.deleted ?? {})
      .map(([id, entry]) =>
        seen({ ...fileOf(id, entry), deletedAt: entry.deletedAt, deletedBy: entry.deletedBy }),
      )
      .sort((a, b) => b.deletedAt - a.deletedAt)
    return { files: (await this.list()).map(seen), deleted, view: await this.viewToken() }
  }

  async find(path: string): Promise<LibraryFile | undefined> {
    return (await this.list()).find((file) => file.path === path)
  }

  /** Everything that is kept, as it is kept, for moving it into another library. */
  async everything(): Promise<{ files: [string, Entry][]; deleted: [string, Deleted][] }> {
    const state = await this.#docs.read()
    return {
      files: Object.entries(state.files).map(([id, entry]) => [id, { ...entry }]),
      deleted: Object.entries(state.deleted ?? {}).map(([id, entry]) => [id, { ...entry }]),
    }
  }

  /** One content of a file that is being moved in from another library, ahead of its record. */
  async takeBytes(id: string, rev: number, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.#blobs.put(blobKey(id, rev), bytes, { contentType })
  }

  /**
   * Take in a file from another library, with its id, its history and its place among the
   * deleted if that is where it was. Its contents are here already. Where another file has its
   * path, it goes under `folder`, and failing that under the next free name. Taking in a file
   * that is here already changes nothing, so that a move cut short can be run again.
   */
  async take(
    id: string,
    entry: Entry | Deleted,
    options: { folder?: string; agentId?: string } = {},
  ): Promise<void> {
    if (isInherited(id)) return
    await this.#exclusive(async () => {
      const taken = await this.#docs.change((doc) => {
        if (own(doc.files, id) !== undefined || own(doc.deleted, id) !== undefined) return false
        const kept = {
          ...entry,
          ...(options.agentId === undefined ? {} : { agentId: options.agentId }),
        }
        if ("deletedAt" in kept) {
          doc.deleted ??= {}
          doc.deleted[id] = kept
          return true
        }
        const paths = new Set(Object.values(doc.files).map((file) => file.path ?? file.name))
        const wanted = kept.path ?? kept.name
        const under =
          options.folder === undefined ? undefined : cleanLibraryPath(`${options.folder}/${wanted}`)
        kept.path = !paths.has(wanted)
          ? wanted
          : freePath(under ?? wanted, (path) => paths.has(path))
        kept.name = nameOf(kept.path)
        doc.files[id] = kept
        return true
      })
      if (taken) await this.#changed()
    })
  }

  /** What a computer's folder held when it last agreed with a library these files came from. */
  async takeBase(computer: string, base: Record<string, Base>): Promise<void> {
    if ((await this.#docs.base(computer)) === undefined) await this.#docs.setBase(computer, base)
  }

  /** Let go of every file, deleted ones and earlier contents included. They are kept elsewhere now. */
  async empty(): Promise<void> {
    await this.#exclusive(async () => {
      const { files, deleted } = await this.everything()
      await this.#docs.change((doc) => {
        doc.files = {}
        delete doc.deleted
      })
      for (const [id, entry] of [...files, ...deleted]) await this.#purge(id, entry)
      await this.#changed()
    })
  }

  /** Each file's place, revision and content hash, for comparing with a folder. */
  async stored(): Promise<Map<string, { id: string; rev: number; hash: string | undefined }>> {
    return new Map(
      Object.entries((await this.#docs.read()).files).map(([id, entry]) => [
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
  async add(input: NewLibraryFile): Promise<LibraryFile> {
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
      const state = await this.#docs.read()
      const existing = Object.entries(state.files).find(
        ([, entry]) => (entry.path ?? entry.name) === wanted,
      )
      if (existing !== undefined && input.whenTaken === "replace") {
        return this.#write(existing[0], input.bytes, hash, input.source, input.pass)
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
        ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
        createdAt: now,
        updatedAt: now,
        updatedBy: input.source,
        rev: 0,
        hash,
      }
      await this.#blobs.put(blobKey(id, 0), input.bytes, { contentType: entry.contentType })
      await this.#docs.change(async (doc) => {
        const { files } = doc
        if (Object.keys(files).length >= MAX_LIBRARY_FILES) {
          throw new LibraryError(
            `The library is full (${MAX_LIBRARY_FILES} files). Delete some first.`,
          )
        }
        files[id] = entry
      })
      await this.#changed(input.pass)
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
    options: { ifRev?: number; pass?: string } = {},
  ): Promise<LibraryFile> {
    if (bytes.length > MAX_LIBRARY_FILE_BYTES) {
      throw new LibraryError(
        `Files up to ${MAX_LIBRARY_FILE_BYTES / (1024 * 1024)} MB can be kept in the library.`,
      )
    }
    const hash = await sha256(bytes)
    return this.#exclusive(async () => {
      const entry = own((await this.#docs.read()).files, id)
      if (
        entry !== undefined &&
        options.ifRev !== undefined &&
        (entry.rev ?? 0) !== options.ifRev
      ) {
        throw new LibraryConflict(
          "This file was changed by someone else since you opened it. Your change was not saved.",
        )
      }
      return this.#write(id, bytes, hash, by, options.pass)
    })
  }

  /** Only inside `#exclusive`. */
  async #write(
    id: string,
    bytes: Uint8Array,
    hash: string,
    by: Who,
    pass: string | undefined,
  ): Promise<LibraryFile> {
    const current = own((await this.#docs.read()).files, id)
    if (current === undefined) throw new LibraryError("That file is not in the library.")
    // Saved again without a change: nothing to keep a version of.
    if (current.hash === hash) return fileOf(id, current)
    const rev = (current.rev ?? 0) + 1
    await this.#blobs.put(blobKey(id, rev), bytes, { contentType: current.contentType })
    const dropped: number[] = []
    const entry = await this.#docs.change(async (doc) => {
      const entry = doc.files[id]!
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
    })
    for (const old of dropped) await this.#blobs.delete(blobKey(id, old))
    await this.#changed(pass)
    return fileOf(id, entry)
  }

  /** Rename a file or put it in another folder. Its content and versions go with it. */
  async move(
    id: string,
    to: string,
    options: { exact?: boolean; pass?: string } = {},
  ): Promise<LibraryFile> {
    const path =
      options.exact === true ? (isLibraryPath(to) ? to : undefined) : cleanLibraryPath(to)
    if (path === undefined) throw new LibraryError("That is not a name the library can use.")
    return this.#exclusive(async () => {
      const entry = await this.#docs.change(async (doc) => {
        const { files } = doc
        const entry = own(files, id)
        if (entry === undefined) throw new LibraryError("That file is not in the library.")
        const taken = Object.entries(files).some(
          ([other, file]) => other !== id && (file.path ?? file.name) === path,
        )
        if (taken) throw new LibraryError(`There is already a file at ${path}.`)
        entry.path = path
        entry.name = nameOf(path)
        return { ...entry }
      })
      await this.#changed(options.pass)
      return fileOf(id, entry)
    })
  }

  /** The earlier contents of a file that are still kept, newest first. */
  async versions(id: string): Promise<LibraryVersion[] | undefined> {
    const entry = own((await this.#docs.read()).files, id)
    return entry === undefined ? undefined : [...(entry.versions ?? [])].reverse()
  }

  /** Make an earlier content the current one. What it replaces becomes a version in turn. */
  async revert(id: string, rev: number, by: Who): Promise<LibraryFile> {
    const versions = await this.versions(id)
    if (versions?.some((version) => version.rev === rev) !== true) {
      throw new LibraryError("That version is no longer kept.")
    }
    const bytes = await this.bytes({ id, rev })
    if (bytes === undefined) throw new LibraryError("That version is no longer kept.")
    return this.write(id, bytes, by)
  }

  /**
   * Take a file out of the library. It can be brought back for a while: a file the agent's
   * computer no longer has is taken out the same way, and that may not have been meant.
   */
  async remove(id: string, by: Who, options: { pass?: string } = {}): Promise<boolean> {
    return this.#exclusive(async () => {
      const purged: [string, Deleted][] = []
      const existed = await this.#docs.change(async (doc) => {
        const state = doc
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
      })
      for (const [oldId, old] of purged) await this.#purge(oldId, old)
      if (existed) await this.#changed(options.pass)
      return existed
    })
  }

  async #purge(id: string, entry: Entry): Promise<void> {
    for (const rev of [entry.rev ?? 0, ...(entry.versions ?? []).map((version) => version.rev)]) {
      await this.#blobs.delete(blobKey(id, rev))
    }
  }

  /** Bring a deleted file back, where it was if that place is still free. */
  async restore(id: string): Promise<LibraryFile | undefined> {
    return this.#exclusive(async () => {
      const entry = await this.#docs.change(async (doc) => {
        const state = doc
        const gone = own(state.deleted, id)
        if (gone === undefined) return undefined
        const { deletedAt: _at, deletedBy: _by, ...entry } = gone
        const taken = new Set(Object.values(state.files).map((file) => file.path ?? file.name))
        entry.path = freePath(entry.path ?? entry.name, (path) => taken.has(path))
        entry.name = nameOf(entry.path)
        delete state.deleted![id]
        state.files[id] = entry
        return { ...entry }
      })
      if (entry === undefined) return undefined
      await this.#changed()
      return fileOf(id, entry)
    })
  }

  /** Delete a deleted file for good. */
  async forget(id: string): Promise<boolean> {
    return this.#exclusive(async () => {
      const gone = await this.#docs.change(async (doc) => {
        const state = doc
        const gone = own(state.deleted, id)
        if (gone === undefined) return undefined
        delete state.deleted![id]
        return { ...gone }
      })
      if (gone === undefined) return false
      await this.#purge(id, gone)
      await this.#changed()
      return true
    })
  }

  /**
   * A response serving the file to the app itself, or undefined when there is none. Only a
   * picture is shown in place: this is the app's own address, where nothing may run as a page.
   */
  async serve(id: string, request: Request): Promise<Response | undefined> {
    const entry = own((await this.#docs.read()).files, id)
    if (entry === undefined) return undefined
    const asked = new URL(request.url).searchParams.get("rev")
    const rev = asked === null ? (entry.rev ?? 0) : Number(asked)
    const kept =
      rev === (entry.rev ?? 0) || entry.versions?.some((version) => version.rev === rev) === true
    if (!kept) return undefined
    // A page that is taken out of the app, as a download, is asked for with the app's look in
    // it, so that it is the same page wherever it is then opened. It is still only handed over.
    const look =
      new URL(request.url).searchParams.has("look") && contentTypeFor(entry.name) === "text/html"
    const etag = look ? `"${id}.${rev}.${PAGE_THEME_VERSION}"` : `"${id}.${rev}"`
    // An address that names a revision always serves the same bytes; one that does not, the newest.
    const cache = asked === null ? "private, no-cache" : "private, max-age=31536000, immutable"
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { etag, "cache-control": cache } })
    }
    const written = await this.bytes({ id, rev })
    if (written === undefined) return undefined
    const bytes = look ? themePageBytes(written) : written
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

  async #secret(): Promise<string> {
    const existing = (await this.#docs.readPrivate()).secret
    if (existing !== "") return existing
    return this.#docs.changePrivate((doc) => {
      if (doc.secret === "") {
        const random = crypto.getRandomValues(new Uint8Array(32))
        doc.secret = [...random].map((byte) => byte.toString(16).padStart(2, "0")).join("")
      }
      return doc.secret
    })
  }

  /**
   * What stands in for the user's session where files are viewed as pages. A page cannot be
   * given the session itself, so the address carries this instead. It is the same for a few
   * hours, so that a page being looked at does not reload, and stops working a few hours later.
   */
  async viewToken(): Promise<string> {
    const window = Math.floor(this.#now() / VIEW_WINDOW_MS).toString(36)
    return `${window}-${await sign(await this.#secret(), `view:${window}`)}`
  }

  async #mayView(token: string): Promise<boolean> {
    const dash = token.indexOf("-")
    if (dash === -1) return false
    const window = token.slice(0, dash)
    const current = Math.floor(this.#now() / VIEW_WINDOW_MS)
    if (window !== current.toString(36) && window !== (current - 1).toString(36)) return false
    return same(token.slice(dash + 1), await sign(await this.#secret(), `view:${window}`))
  }

  /**
   * Serve the file at `path` as what it is, so that an HTML document is a page and what it links
   * to beside it loads. Whoever asks needs only `token`. Every response is sandboxed: the page
   * runs with an origin of its own that is nobody's, so it cannot act as the user in the app even
   * though it is served from the app's address.
   */
  async view(token: string, path: string, request: Request): Promise<Response | undefined> {
    if (!(await this.#mayView(token))) return undefined
    return this.#page(path, request, {
      sandbox: "sandbox allow-scripts allow-popups allow-forms allow-modals",
      opens: true,
      // The address of a viewed file opens the whole library, so a page is not let read with it.
      readable: false,
    })
  }

  /**
   * Serve what a site shares: the file at `root`, or what is at `rest` in the folder `root`.
   * Nothing outside `root` is served, whatever is asked for. Whether the asker may open the site
   * is for whoever calls this to have decided. The one exception is a Markdown document shared
   * by itself: asked for a `picture` by its place in the library, it serves that picture if the
   * document refers to it. A folder with no front page of its own is answered with a list of
   * what is in it, marked as one, for the caller to show. Sandboxed
   * as a viewed file is, and since a site is somewhere people are sent, a link it opens in a
   * new tab is an ordinary page there.
   */
  async site(root: string, rest: string, request: Request): Promise<Response | undefined> {
    const sandbox =
      "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads"
    const files = await this.list()
    const alone = files.find((file) => file.path === root)
    if (alone !== undefined && rest !== "") return undefined
    // A document shared by itself brings the pictures it refers to, and nothing else.
    const picture = new URL(request.url).searchParams.get("picture")
    if (alone !== undefined && picture !== null) {
      const wanted = files.find((file) => file.path === picture)
      if (wanted === undefined || !contentTypeFor(wanted.name).startsWith("image/"))
        return undefined
      if (contentTypeFor(alone.name) !== "text/markdown" || alone.size > MAX_REFERRING_BYTES) {
        return undefined
      }
      const bytes = await this.bytes(alone)
      if (bytes === undefined) return undefined
      if (!markdownFiles(root, new TextDecoder().decode(bytes)).has(picture)) return undefined
      return this.#page(picture, request, { sandbox, opens: false, readable: true })
    }
    const path = alone !== undefined || rest === "" ? root : `${root}/${rest}`
    // A site's pages may read its files: they are all shared with whoever has the page.
    const page = await this.#page(path, request, { sandbox, opens: false, readable: true })
    if (page !== undefined || alone !== undefined) return page
    const inside = files.filter((file) => file.path.startsWith(`${path}/`))
    if (inside.length === 0) return undefined
    // Its links are relative to the folder, so the folder's address has to end in a slash.
    if (!new URL(request.url).pathname.endsWith("/")) {
      return new Response(null, {
        status: 302,
        headers: { location: `${encodeURIComponent(path.slice(path.lastIndexOf("/") + 1))}/` },
      })
    }
    const entries = new Map<string, SiteEntry>()
    for (const file of inside) {
      const [name, ...deeper] = file.path.slice(path.length + 1).split("/")
      if (deeper.length > 0) entries.set(`0${name}`, { name: name!, kind: "folder" })
      else {
        entries.set(`1${name}`, {
          name: name!,
          kind: "file",
          size: file.size,
          updatedAt: file.updatedAt,
        })
      }
    }
    const listing: SiteListing = {
      folder: path === root ? "" : path.slice(root.length + 1),
      // Folders first, then files, each in name order.
      entries: [...entries.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, entry]) => entry),
    }
    return Response.json(listing, {
      headers: {
        [SITE_LISTING_HEADER]: "1",
        "content-security-policy": sandbox,
        "referrer-policy": "no-referrer",
        "cache-control": "private, no-cache",
      },
    })
  }

  /**
   * The file at `path` as what it is, or the front page of the folder there. `opens` is whether
   * whoever shows the page can open a document that is not one in a viewer of its own, and
   * `readable` whether a page may read the file, and not only show it.
   */
  async #page(
    path: string,
    request: Request,
    options: { sandbox: string; opens: boolean; readable: boolean },
  ): Promise<Response | undefined> {
    const files = await this.list()
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
    const page = contentType.startsWith("text/html")
    const headers: Record<string, string> = {
      "content-type": isText(contentType) ? `${contentType}; charset=utf-8` : contentType,
      "x-content-type-options": "nosniff",
      "content-security-policy": options.sandbox,
      // The address is the permission. It must not travel to whatever the page loads or links to.
      "referrer-policy": "no-referrer",
      "cache-control": "private, no-cache",
      // A page is served with the app's look put into it, so it is another page when that changes.
      etag: page ? `"${file.id}.${file.rev}.${PAGE_THEME_VERSION}"` : `"${file.id}.${file.rev}"`,
    }
    // A page has an origin that is nobody's, so to it the files beside it are another site's:
    // it can show a picture of one, but not read its data, load a module or use a font,
    // unless the file says anyone may read it.
    if (options.readable) headers["access-control-allow-origin"] = "*"
    if (request.headers.get("if-none-match") === headers.etag) {
      return new Response(null, { status: 304, headers })
    }
    // A link from a page to a document that is not a page: the app opens it in its own viewer.
    if (
      options.opens &&
      request.headers.get("sec-fetch-dest") === "iframe" &&
      contentType === "text/markdown"
    ) {
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
    const kept = await this.bytes(file)
    if (kept === undefined) return undefined
    const bytes = page ? themePageBytes(kept) : kept
    return new Response(bytes.slice().buffer, {
      headers: { ...headers, "content-length": String(bytes.length) },
    })
  }
}

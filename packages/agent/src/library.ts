import type { LibraryFile } from "@durable-computer/protocol"
import type { BlobStore } from "@durable-computer/runtime"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  defineDoc,
  defineExtension,
  defineTool,
  type Extension,
  type Harness,
  section,
  type ToolRegistration,
} from "@earendil-works/pi-durable"
import { getOrThrow } from "@earendil-works/pi-durable/env"
import { own } from "./own.ts"

/** A whole file is held in memory to store or serve it, so files stay well under a Worker's limit. */
export const MAX_LIBRARY_FILE_BYTES = 25 * 1024 * 1024
export const MAX_LIBRARY_FILES = 2_000

type Entry = Omit<LibraryFile, "id">
type LibraryState = { files: Record<string, Entry> }

/** What is in the library. The bytes are in blob storage, under the same id. */
export const LibraryDoc = defineDoc<LibraryState>({
  kind: "dc.library",
  version: 1,
  scope: "session",
  initial: () => ({ files: {} }),
})

export class LibraryError extends Error {}

const TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  zip: "application/zip",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
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

const blobKey = (id: string) => `library/${id}`

/** Types a browser may show in place. Anything else is only ever downloaded. */
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

/**
 * The agent's library: files it hands to the user and files the user hands to it. They live
 * outside the agent's computer, so they are there whatever happens to it.
 */
export class Library {
  readonly extension: Extension
  readonly sendFileTool: ToolRegistration
  /** Lets the agent see the library and bring a file from it onto a computer. */
  readonly libraryTool: ToolRegistration
  readonly #blobs: BlobStore
  readonly #now: () => number
  #harness: Harness | undefined

  constructor(options: { blobs: BlobStore; now: () => number }) {
    this.#blobs = options.blobs
    this.#now = options.now
    this.sendFileTool = defineTool({
      name: "send_file",
      description:
        "Give the user a file from your computer: a document, image, export or anything else they should have. It appears in the chat as a download and is kept in their library. Use it instead of pasting long file contents into a reply.",
      parameters: Type.Object({
        path: Type.String({ description: "Path of the file to send" }),
        name: Type.Optional(Type.String({ description: "File name to give it, if not its own" })),
      }),
      execute: async (args, api, context) => {
        const fail = (text: string) => ({
          isError: true,
          content: [{ type: "text" as const, text }],
        })
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
        const bytes = await api.env.readBinaryFile(absolute, context)
        if (!bytes.ok) return fail(`Could not read ${args.path}: ${bytes.error.message}`)
        try {
          const file = await this.add(
            {
              name: args.name ?? info.value.name,
              bytes: bytes.value,
              source: "agent",
              chatId: String(api.conversationId),
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
        "The user's library: files they uploaded for you, and files you have sent them. `list` shows what is there, newest first. `get` copies one onto your computer so you can read it or work on it.",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("list"), Type.Literal("get")]),
        file: Type.Optional(
          Type.String({ description: "For get: the file's name or id, as `list` shows it" }),
        ),
        path: Type.Optional(
          Type.String({ description: "For get: where to put it. Default: uploads/<name>" }),
        ),
      }),
      execute: async (args, api, context) => {
        const fail = (text: string) => ({
          isError: true,
          content: [{ type: "text" as const, text }],
        })
        const files = await this.list(context)
        if (args.action === "list") {
          const lines = files.map(
            (file) =>
              `${file.name} (${file.size} bytes, ${
                file.source === "user" ? "uploaded by the user" : "sent by you"
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
        if (wanted === "") return fail("`get` needs the file's name or id.")
        // `list` is newest first, so a name used twice means the latest one.
        const file = files.find(
          (entry) => entry.id === wanted || entry.name.toLowerCase() === wanted.toLowerCase(),
        )
        if (file === undefined) {
          return fail(`There is no "${wanted}" in the library. Use the list action to see it.`)
        }
        if (api.env === undefined) return fail("There is no computer to put the file on.")
        const blob = await this.#blobs.get(blobKey(file.id))
        if (blob === undefined) return fail(`The contents of ${file.name} are missing.`)
        const target = getOrThrow(
          await api.env.absolutePath(args.path?.trim() || `uploads/${file.name}`, context),
        )
        const written = await api.env.writeFile(target, await blob.bytes(), context)
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
        section(
          "library",
          () =>
            "The user can upload files to their library for you. When they mention a file they uploaded or attached, find it with the `library` tool and copy it onto your computer with its `get` action before answering; do not ask them to paste it.",
        ),
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

  async list(context: Context): Promise<LibraryFile[]> {
    const files = (await this.#require().snapshot(LibraryDoc, context))?.files ?? {}
    return Object.entries(files)
      .map(([id, entry]) => ({ id, ...entry }))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Store the bytes, then record the file. An unrecorded blob is harmless; the reverse is not. */
  async add(
    input: {
      name: string
      bytes: Uint8Array
      source: LibraryFile["source"]
      chatId: string | null
      contentType?: string
    },
    context: Context,
  ): Promise<LibraryFile> {
    if (input.bytes.length > MAX_LIBRARY_FILE_BYTES) {
      throw new LibraryError(
        `Files up to ${MAX_LIBRARY_FILE_BYTES / (1024 * 1024)} MB can be kept in the library.`,
      )
    }
    const name = cleanFileName(input.name)
    const id = crypto.randomUUID()
    const entry: Entry = {
      name,
      size: input.bytes.length,
      contentType: input.contentType || contentTypeFor(name),
      source: input.source,
      chatId: input.chatId,
      createdAt: this.#now(),
    }
    await this.#blobs.put(blobKey(id), input.bytes, { contentType: entry.contentType })
    await this.#require().commit(async (tx) => {
      const { files } = await tx.doc(LibraryDoc)
      if (Object.keys(files).length >= MAX_LIBRARY_FILES) {
        throw new LibraryError(
          `The library is full (${MAX_LIBRARY_FILES} files). Delete some first.`,
        )
      }
      files[id] = entry
    }, context)
    return { id, ...entry }
  }

  /** A response serving the file, or undefined when there is none. */
  async serve(id: string, context: Context): Promise<Response | undefined> {
    const entry = own((await this.#require().snapshot(LibraryDoc, context))?.files, id)
    const blob = entry === undefined ? undefined : await this.#blobs.get(blobKey(id))
    if (entry === undefined || blob === undefined) return undefined
    const inline = INLINE_TYPES.has(entry.contentType)
    const bytes = await blob.bytes()
    return new Response(bytes.slice().buffer, {
      headers: {
        "content-type": inline ? entry.contentType : "application/octet-stream",
        "content-length": String(bytes.length),
        // Files are untrusted content on the app's own origin: never let one run as a page.
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(entry.name)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
        "cache-control": "private, max-age=3600",
      },
    })
  }

  async remove(id: string, context: Context): Promise<boolean> {
    const existed = await this.#require().commit(async (tx) => {
      const { files } = await tx.doc(LibraryDoc)
      if (own(files, id) === undefined) return false
      delete files[id]
      return true
    }, context)
    if (existed) await this.#blobs.delete(blobKey(id))
    return existed
  }
}

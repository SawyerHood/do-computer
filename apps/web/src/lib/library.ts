import type { LibraryFile } from "@durable-computer/protocol"

/** How a file is shown: each kind has a viewer of its own, and `other` only a download. */
export type FileKind = "markdown" | "page" | "image" | "text" | "other"

const KINDS: Record<string, FileKind> = {
  md: "markdown",
  markdown: "markdown",
  html: "page",
  htm: "page",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  txt: "text",
  csv: "text",
  json: "text",
  css: "text",
  js: "text",
  mjs: "text",
  ts: "text",
  py: "text",
  sh: "text",
  xml: "text",
  yaml: "text",
  yml: "text",
  toml: "text",
  log: "text",
}

/** Text larger than this is not opened in the page; it would be slow to show and to edit. */
const MAX_TEXT_BYTES = 1024 * 1024

export function kindOf(file: Pick<LibraryFile, "name" | "size">): FileKind {
  const kind = KINDS[file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()] ?? "other"
  return kind !== "image" && kind !== "other" && file.size > MAX_TEXT_BYTES ? "other" : kind
}

/** The folder a path is in, or "" at the top. */
export const dirOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""

/**
 * Where a relative link from a document in `dir` leads within the library, or undefined when it
 * leads somewhere else: another site, a place on the same page, or above the top folder.
 */
export function resolveLink(dir: string, href: string): string | undefined {
  if (href === "" || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return undefined
  const [plain] = href.split(/[?#]/)
  let decoded: string
  try {
    decoded = decodeURIComponent(plain ?? "")
  } catch {
    return undefined
  }
  const parts = decoded.startsWith("/") || dir === "" ? [] : dir.split("/")
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      if (parts.length === 0) return undefined
      parts.pop()
    } else parts.push(part)
  }
  return parts.length === 0 ? undefined : parts.join("/")
}

export type Folder = {
  name: string
  path: string
  folders: Folder[]
  files: LibraryFile[]
}

/** The files as the folders their paths spell out, each level in name order. */
export function treeOf(files: readonly LibraryFile[]): Folder {
  const root: Folder = { name: "", path: "", folders: [], files: [] }
  for (const file of files) {
    let folder = root
    const parts = file.path.split("/")
    for (const part of parts.slice(0, -1)) {
      let next = folder.folders.find((child) => child.name === part)
      if (next === undefined) {
        next = {
          name: part,
          path: folder.path === "" ? part : `${folder.path}/${part}`,
          folders: [],
          files: [],
        }
        folder.folders.push(next)
      }
      folder = next
    }
    folder.files.push(file)
  }
  const sort = (folder: Folder) => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name))
    folder.files.sort((a, b) => a.name.localeCompare(b.name))
    folder.folders.forEach(sort)
  }
  sort(root)
  return root
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const sameDay = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
const otherDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
const full = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

/** A time in as few words as say it: the hour for today, the day for anything older. */
export function formatWhen(at: number, now = Date.now()): string {
  const then = new Date(at)
  return then.toDateString() === new Date(now).toDateString()
    ? sameDay.format(then)
    : otherDay.format(then)
}

export const formatFull = (at: number) => full.format(new Date(at))

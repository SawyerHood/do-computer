// What the library's screens work out from the list of files: which folder holds what, how a
// file is shown, what is shared, and the small edits the format buttons make. Nothing here draws.
import { type LibraryFile, resolveLink, type SiteSummary } from "@durable-computer/protocol"

/** How a file is shown: each kind has a viewer of its own, and `other` only a download. */
export type FileKind = "markdown" | "page" | "image" | "text" | "csv" | "pdf" | "other"

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
  pdf: "pdf",
  csv: "csv",
  txt: "text",
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
  const text = kind === "markdown" || kind === "page" || kind === "text" || kind === "csv"
  return text && file.size > MAX_TEXT_BYTES ? "other" : kind
}

/** The symbol a file of each kind has in a list. */
export const KIND_ICON = {
  markdown: "doc",
  page: "globe",
  image: "photo",
  text: "code",
  csv: "chart",
  pdf: "doc",
  other: "clip",
} as const satisfies Record<FileKind, string>

/** The folder a path is in, or "" at the top. */
export const dirOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""

/** The last part of a path: a file's name, or a folder's. */
export const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1)

export const joinPath = (dir: string, name: string) => (dir === "" ? name : `${dir}/${name}`)

export type FolderEntry = {
  name: string
  path: string
  /** How many things are directly inside: files and folders. */
  count: number
}

/** What is directly inside one folder ("" is the top): its folders, then its files, by name. */
export function contentsOf(
  files: readonly LibraryFile[],
  dir: string,
): { folders: FolderEntry[]; files: LibraryFile[] } {
  const prefix = dir === "" ? "" : `${dir}/`
  const inside = new Map<string, Set<string>>()
  const own: LibraryFile[] = []
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue
    const parts = file.path.slice(prefix.length).split("/")
    const first = parts[0]
    if (first === undefined || first === "") continue
    if (parts.length === 1) own.push(file)
    else {
      const things = inside.get(first) ?? new Set<string>()
      things.add(parts[1] ?? "")
      inside.set(first, things)
    }
  }
  return {
    folders: [...inside.entries()]
      .map(([name, things]) => ({ name, path: `${prefix}${name}`, count: things.size }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    files: own.sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/** Every folder of the library by its path, the top ("") first: where a file can be moved to. */
export function foldersOf(files: readonly LibraryFile[]): string[] {
  const all = new Set<string>()
  for (const file of files) {
    for (let dir = dirOf(file.path); dir !== ""; dir = dirOf(dir)) all.add(dir)
  }
  return ["", ...[...all].sort((a, b) => a.localeCompare(b))]
}

/** The files whose place in the library has the words looked for in it. */
export function matching(files: readonly LibraryFile[], wanted: string): LibraryFile[] {
  const words = wanted.trim().toLowerCase()
  return files
    .filter((file) => file.path.toLowerCase().includes(words))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * What sharing a file shares: the file, or for a folder's front page the folder, since what
 * such a page links to is in there with it.
 */
export function sharedPathOf(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash !== -1 && /^index\.html?$/i.test(path.slice(slash + 1)) ? path.slice(0, slash) : path
}

/** The site a file is shared as, if it is: by itself, or as the front page of a folder. */
export const siteOfFile = (sites: readonly SiteSummary[] | undefined, path: string) =>
  sites?.find((site) => site.path === sharedPathOf(path))

/** The site a folder is shared as, if it is. */
export const siteOfFolder = (sites: readonly SiteSummary[] | undefined, path: string) =>
  sites?.find((site) => site.path === path)

/** A site's address without its scheme, as it is shown. */
export const shownAddress = (url: string) => url.replace(/^https?:\/\//, "")

/** A time in as few words as say it: the hour for today, the day for anything older. */
export function formatWhen(at: number, now = Date.now()): string {
  const then = new Date(at)
  const today = new Date(now)
  if (then.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(then)
  }
  if (then.toDateString() === new Date(now - 86_400_000).toDateString()) return "yesterday"
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(then)
}

/** A time in full: the day and the hour. */
export const formatFull = (at: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at))

/** What each format button writes: its name, and the marks before and after what is chosen. */
export const FORMATS = [
  ["bold", "Bold", "**", "**"],
  ["italic", "Italic", "*", "*"],
  ["heading", "Heading", "## ", ""],
  ["list", "List item", "- ", ""],
  ["checklist", "Task", "- [ ] ", ""],
  ["code", "Code", "`", "`"],
  ["link", "Link", "[", "](https://)"],
] as const

export type Selection = { start: number; end: number }

/**
 * Put a format's marks around what is chosen in the text, or around the word "text" where
 * nothing is. What was wrapped is left chosen, so that typing replaces it.
 */
export function applyFormat(
  text: string,
  chosen: Selection,
  before: string,
  after: string,
): { text: string; selection: Selection } {
  const start = Math.max(0, Math.min(chosen.start, chosen.end, text.length))
  const end = Math.min(text.length, Math.max(chosen.start, chosen.end))
  const inner = text.slice(start, end) || "text"
  return {
    text: text.slice(0, start) + before + inner + after + text.slice(end),
    selection: { start: start + before.length, end: start + before.length + inner.length },
  }
}

/** The rows of a CSV file, with quoted cells read as they are meant. No more than `limit` rows. */
export function parseCsv(text: string, limit = 200): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let at = 0; at < text.length; at++) {
    const char = text[at]
    if (quoted) {
      if (char === '"' && text[at + 1] === '"') {
        cell += '"'
        at++
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"' && cell === "") quoted = true
    else if (char === ",") {
      row.push(cell)
      cell = ""
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[at + 1] === "\n") at++
      row.push(cell)
      cell = ""
      if (row.some((each) => each !== "")) rows.push(row)
      row = []
      if (rows.length >= limit) return rows
    } else cell += char
  }
  row.push(cell)
  if (row.some((each) => each !== "")) rows.push(row)
  return rows
}

/** A name someone typed for a new document, as the name of a Markdown file. */
export function documentName(typed: string): string {
  const name = typed.trim().replace(/[\\/]+/g, "-")
  if (name === "") return "Untitled.md"
  return /\.(md|markdown)$/i.test(name) ? name : `${name}.md`
}

/** A path someone typed for a file, without the slashes and spaces that are not part of it. */
export const tidyPath = (typed: string) =>
  typed
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part !== "" && part !== "." && part !== "..")
    .join("/")

/**
 * A Markdown document with the pictures it takes from the library beside it written as whole
 * addresses, so that they can be fetched: `![chart](chart.svg)` in `reports/q3.md` names the
 * file `reports/chart.svg`. A picture from somewhere else, or one the library has not got, is
 * left as it is written.
 */
export function withPictures(
  text: string,
  dir: string,
  paths: ReadonlySet<string>,
  urlOf: (path: string) => string,
): string {
  return text.replace(
    /(!\[[^\]\n]*\]\(\s*)(?:<([^>\n]*)>|([^)\s]+))/g,
    (whole, before: string, angled: string | undefined, bare: string | undefined) => {
      const path = resolveLink(dir, angled ?? bare ?? "")
      return path !== undefined && paths.has(path) ? `${before}${urlOf(path)}` : whole
    },
  )
}

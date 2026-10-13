/**
 * How a thing is shown, wherever it is shown: each kind has a way of its own, and `other` only
 * a download. A table is a file of rows, and a page is an HTML document.
 */
export type EmbedKind =
  "image" | "video" | "audio" | "page" | "table" | "pdf" | "markdown" | "text" | "other"

/**
 * What each extension stands for: the type it is served and stored as, and the kind it is shown
 * as. The server, the web app and the phone all read this one table, so that none of them takes
 * a file for something the others do not.
 */
const FILES: Record<string, readonly [type: string, kind: EmbedKind]> = {
  txt: ["text/plain", "text"],
  log: ["text/plain", "text"],
  md: ["text/markdown", "markdown"],
  markdown: ["text/markdown", "markdown"],
  csv: ["text/csv", "table"],
  tsv: ["text/tab-separated-values", "table"],
  json: ["application/json", "text"],
  map: ["application/json", "other"],
  html: ["text/html", "page"],
  htm: ["text/html", "page"],
  css: ["text/css", "text"],
  js: ["text/javascript", "text"],
  mjs: ["text/javascript", "text"],
  // Never `video/mp2t`: a `.ts` file in a library is source code.
  ts: ["text/typescript", "text"],
  py: ["text/x-python", "text"],
  sh: ["text/x-shellscript", "text"],
  xml: ["application/xml", "text"],
  yaml: ["text/yaml", "text"],
  yml: ["text/yaml", "text"],
  toml: ["text/toml", "text"],
  pdf: ["application/pdf", "pdf"],
  png: ["image/png", "image"],
  jpg: ["image/jpeg", "image"],
  jpeg: ["image/jpeg", "image"],
  gif: ["image/gif", "image"],
  webp: ["image/webp", "image"],
  avif: ["image/avif", "image"],
  ico: ["image/x-icon", "image"],
  svg: ["image/svg+xml", "image"],
  woff: ["font/woff", "other"],
  woff2: ["font/woff2", "other"],
  ttf: ["font/ttf", "other"],
  wasm: ["application/wasm", "other"],
  zip: ["application/zip", "other"],
  mp3: ["audio/mpeg", "audio"],
  wav: ["audio/wav", "audio"],
  m4a: ["audio/mp4", "audio"],
  ogg: ["audio/ogg", "audio"],
  oga: ["audio/ogg", "audio"],
  flac: ["audio/flac", "audio"],
  aac: ["audio/aac", "audio"],
  mp4: ["video/mp4", "video"],
  m4v: ["video/mp4", "video"],
  mov: ["video/quicktime", "video"],
  webm: ["video/webm", "video"],
  ogv: ["video/ogg", "video"],
}

/** What a name's extension stands for. A name every object answers to is not an extension. */
function known(name: string): readonly [type: string, kind: EmbedKind] | undefined {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
  return Object.hasOwn(FILES, extension) ? FILES[extension] : undefined
}

/** The content type a file's name says it is, or `application/octet-stream` when it says nothing. */
export function contentTypeOf(name: string): string {
  return known(name)?.[0] ?? "application/octet-stream"
}

/**
 * The kind of thing a file is. Its name says, where the extension is one known here. Otherwise
 * the content type does, when it is definite about it: a film, a sound, a picture, a PDF, a
 * page, a document, a table, or some other text.
 */
export function embedKind(name: string, contentType?: string): EmbedKind {
  const named = known(name)
  if (named !== undefined) return named[1]
  // A type may carry a character set after it, and is written in any case.
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase()
  if (type.startsWith("video/")) return "video"
  if (type.startsWith("audio/")) return "audio"
  if (type.startsWith("image/")) return "image"
  if (type === "application/pdf") return "pdf"
  if (type === "text/html") return "page"
  if (type === "text/markdown") return "markdown"
  if (type === "text/csv" || type === "text/tab-separated-values") return "table"
  if (type.startsWith("text/")) return "text"
  return "other"
}

/**
 * The picture types the app's own address serves in place, where nothing may run as a page:
 * pictures made of dots only. An SVG is a document that can hold a script, so it is not one.
 */
export const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

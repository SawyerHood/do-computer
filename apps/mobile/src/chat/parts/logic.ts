import {
  type ChatMessage,
  type ChatState,
  continuesMain,
  foldFailures,
  isShownPart,
  isSiteShare,
  isUse,
  isVisibleMessage,
  type LibraryFile,
  type MessagePart,
  sharedSite,
  type SiteSummary,
} from "@durable-computer/protocol"

// What a transcript works out before it draws anything. Kept apart from the drawing so that it
// can be tested without a device.

/** How the library shows a file: each kind has a viewer of its own, and `other` only a download. */
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

/** Text larger than this is not opened in the page, as on the web. */
const MAX_TEXT_BYTES = 1024 * 1024

export function kindOf(file: Pick<LibraryFile, "name" | "size">): FileKind {
  const kind = KINDS[file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()] ?? "other"
  return kind !== "image" && kind !== "other" && file.size > MAX_TEXT_BYTES ? "other" : kind
}

/** Whether the library can show a file. One sent before it showed documents has no place on record. */
export const isViewable = (file: Pick<LibraryFile, "name" | "size"> & { path?: string }) =>
  file.path !== undefined && kindOf(file) !== "other"

/** Raster images are previewed in the chat; the server serves only these types in place. */
const PREVIEWABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
export const isPreviewable = (file: Pick<LibraryFile, "contentType">) =>
  PREVIEWABLE.has(file.contentType)

/** The symbol a file's card has, by what kind of file it is. */
export function fileIcon(file: Pick<LibraryFile, "name" | "size">) {
  const kind = kindOf(file)
  if (kind === "image") return "photo" as const
  if (kind === "page") return "globe" as const
  if (kind === "markdown") return "note" as const
  if (/\.(js|mjs|ts|py|sh|json|css|xml|ya?ml|toml)$/i.test(file.name)) return "code" as const
  if (/\.csv$/i.test(file.name)) return "chart" as const
  return "doc" as const
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

/** An address as it is read, without the scheme. */
export const shownAddress = (url: string) => url.replace(/^https?:\/\//, "")

/**
 * The messages a transcript shows, each with how many times in a row it failed. A side chat
 * that only carries the mark of where it left the main chat is as empty as a new one; a message
 * whose every shown part is a later step of a screen in use shows nothing, and leaves no gap.
 */
export function shownMessages(
  state: Pick<ChatState, "messages" | "busy">,
  firstSteps: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): { message: ChatMessage; failures: number }[] {
  if (isUntouched(state.messages)) return []
  const shows = (message: ChatMessage) =>
    isVisibleMessage(message) &&
    (message.role !== "assistant" ||
      message.status === "error" ||
      message.status === "aborted" ||
      message.parts.some(
        (part) => isShownPart(part) && (!isUse(part) || firstSteps.has(part.toolCallId)),
      ))
  return foldFailures(state.messages.filter(shows), state.busy)
}

/** Whether nothing has been said in a chat yet, so that it greets like a new one. */
export const isUntouched = (messages: readonly ChatMessage[]) =>
  messages.length === (continuesMain(messages) ? 1 : 0)

/**
 * The parts of an answer that are drawn. A site shared and then opened up in one answer is one
 * card, which says how it stands.
 */
export function shownParts(parts: readonly MessagePart[]): MessagePart[] {
  const seen = new Set<string>()
  return parts.filter((part) => {
    if (!isShownPart(part)) return false
    if (!isSiteShare(part)) return true
    const id = sharedSite(part).id
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/** A message's words, for copying and for the share sheet. */
export const textOf = (message: Pick<ChatMessage, "parts">) =>
  message.parts
    .flatMap((part) => (part.type === "text" && part.text !== "" ? [part.text] : []))
    .join("\n\n")

/**
 * Where a scroll view is, as its scroll events say. `inset` is the room it keeps under its
 * content, which is how the keyboard lifts the last message: the end is that much further on.
 */
export type ScrollPlace = { offset: number; viewport: number; content: number; inset?: number }

/** How far the reader may be from the end and still count as being at it. */
export const END_SLACK = 72

/**
 * Whether the reader is at the end of the transcript: within a little of it, so that the
 * rubber band at the foot and a safe area the events do not report make no difference.
 */
export function isAtEnd(place: ScrollPlace, slack = END_SLACK): boolean {
  return place.content + (place.inset ?? 0) - (place.offset + place.viewport) <= slack
}

/** The time of day, as it is written beside a name. */
export function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

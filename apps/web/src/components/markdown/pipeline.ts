import type { Options } from "react-markdown"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import remarkGfm from "remark-gfm"

/**
 * How Markdown is read, wherever the app shows it: in a reply, in a document of the library,
 * and in a document shared with a link. Nothing here needs a browser, so the server reads a
 * shared document the same way.
 */

type Mdast = {
  type: string
  value?: string
  children?: Mdast[]
  data?: { hProperties?: Record<string, unknown> }
}

type Hast = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: Hast[]
}

/** The kinds of note GitHub writes as `> [!NOTE]`, in the order it lists them. */
export const ALERTS = ["note", "tip", "important", "warning", "caution"] as const
export type Alert = (typeof ALERTS)[number]

const ALERT_MARK = /^\[!(note|tip|important|warning|caution)\][^\S\n]*(?:\n|$)/i

/**
 * A quote whose first line is `[!NOTE]` or one of its kin is a note of that kind: the mark is
 * taken out of its text and kept on the quote, for whatever draws it.
 */
function remarkAlerts() {
  const visit = (node: Mdast) => {
    if (node.type === "blockquote") {
      const first = node.children?.[0]
      const text = first?.type === "paragraph" ? first.children?.[0] : undefined
      const mark = text?.type === "text" ? ALERT_MARK.exec(text.value ?? "") : null
      if (first !== undefined && text !== undefined && mark !== null) {
        text.value = (text.value ?? "").slice(mark[0].length)
        // A mark on a line of its own leaves a break behind it, and a note that is only its
        // mark leaves an empty paragraph.
        if (text.value === "") first.children?.shift()
        if (first.children?.[0]?.type === "break") first.children.shift()
        if (first.children?.length === 0) node.children?.shift()
        node.data = {
          ...node.data,
          hProperties: { ...node.data?.hProperties, dataAlert: mark[1]!.toLowerCase() },
        }
      }
    }
    node.children?.forEach(visit)
  }
  return visit
}

/**
 * What raw HTML in Markdown may be: GitHub's own list, which has folding sections, keys,
 * sub- and superscript and a picture with a size, and has no script, style, frame or form, no
 * handler and no inline style. An id a document gives is kept apart from the app's own.
 */
export const SANITIZE_SCHEMA: NonNullable<Parameters<typeof rehypeSanitize>[0]> = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
  attributes: {
    ...defaultSchema.attributes,
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), ["dataAlert", ...ALERTS]],
  },
}

/** The id GitHub gives a heading, so that `[Setup](#setup)` finds it. */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-")
}

/** The prefix the sanitizer puts on a document's own ids; headings are given theirs with it. */
export const ID_PREFIX = "user-content-"

const textOf = (node: Hast): string =>
  node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(textOf).join("")

const meaningful = (node: Hast) =>
  (node.children ?? []).filter((child) => !(child.type === "text" && child.value?.trim() === ""))

/**
 * After the sanitizer: a heading with no id is given GitHub's, a picture that is alone in its
 * paragraph is marked as one, since it is a figure and not part of a sentence, and the last
 * block of code is marked as the last, which is the one a reply still being written may not
 * have closed.
 */
function rehypeMarks() {
  return (tree: Hast) => {
    const taken = new Map<string, number>()
    let lastCode: Hast | undefined
    const visit = (node: Hast) => {
      if (node.type === "element" && node.tagName === "pre") lastCode = node
      if (node.type === "element" && /^h[1-6]$/.test(node.tagName ?? "")) {
        if (typeof node.properties?.id !== "string") {
          const slug = headingSlug(textOf(node))
          const seen = taken.get(slug) ?? 0
          taken.set(slug, seen + 1)
          if (slug !== "") {
            node.properties = {
              ...node.properties,
              id: `${ID_PREFIX}${seen === 0 ? slug : `${slug}-${seen}`}`,
            }
          }
        }
      }
      if (node.type === "element" && node.tagName === "p") {
        const only = meaningful(node)
        const inner = only.length === 1 && only[0]!.tagName === "a" ? meaningful(only[0]!) : only
        if (only.length === 1 && inner.length === 1 && inner[0]!.tagName === "img") {
          inner[0]!.properties = { ...inner[0]!.properties, dataAlone: "" }
        }
      }
      node.children?.forEach(visit)
    }
    visit(tree)
    if (lastCode !== undefined) lastCode.properties = { ...lastCode.properties, dataLast: "" }
  }
}

export const REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [remarkGfm, remarkAlerts]

export const REHYPE_PLUGINS: NonNullable<Options["rehypePlugins"]> = [
  rehypeRaw,
  [rehypeSanitize, SANITIZE_SCHEMA],
  rehypeMarks,
]

/** Whether the text ends inside a code fence that has not been closed, as a reply being written may. */
export function endsInOpenFence(text: string): boolean {
  let open: { mark: string; size: number } | undefined
  for (const line of text.split("\n")) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence === null) continue
    const mark = fence[1]![0]!
    const size = fence[1]!.length
    if (open === undefined) {
      // A fence of backticks cannot have one in what follows it on the line.
      if (mark === "`" && fence[2]!.includes("`")) continue
      open = { mark, size }
    } else if (mark === open.mark && size >= open.size && fence[2]!.trim() === "") {
      open = undefined
    }
  }
  return open !== undefined
}

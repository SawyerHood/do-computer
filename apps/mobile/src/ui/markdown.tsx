import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from "react-native"
import * as Clipboard from "expo-clipboard"
import { Image } from "expo-image"
import { mono, radius, space, type, useTheme } from "@/lib/theme"
import { haptic } from "@/ui/haptics"
import { Icon } from "@/ui/icon"

/* ---------- blocks ---------- */

/** Which side a table's column is set against; null when the table does not say. */
export type Align = "left" | "center" | "right" | null

/**
 * One piece of a document. Text is kept as it was written: `parseInline` reads emphasis and
 * links out of it when it is drawn, and a quote's `text` is Markdown of its own, read again with
 * `parseBlocks`.
 *
 * A list's `items` holds each item's first paragraph. The other three are only there when the
 * list needs them: `start` when a numbered list does not begin at 1, `checked` when any item is a
 * task (null for an item that is not), and `children` for what an item holds after its first
 * paragraph (more paragraphs, nested lists, code), one array for each item.
 */
export type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "code"; text: string; lang?: string }
  | {
      type: "list"
      ordered: boolean
      items: string[]
      start?: number
      checked?: (boolean | null)[]
      children?: Block[][]
    }
  | { type: "quote"; text: string }
  | { type: "rule" }
  | { type: "table"; head: string[]; align: Align[]; rows: string[][] }
  | { type: "image"; alt: string; src: string; href?: string }

export type PictureBlock = Extract<Block, { type: "image" }>
type ListBlock = Extract<Block, { type: "list" }>
type TableBlock = Extract<Block, { type: "table" }>

/** How deep lists and quotes may sit inside each other before the rest is shown as plain text. */
const MAX_DEPTH = 8

const blank = (line: string) => line.trim() === ""
const indentOf = (line: string) => line.length - line.trimStart().length

type Fence = { mark: string; size: number; indent: number; lang: string }

/** The opening line of fenced code: three or more backticks or tildes, then the language. */
function fenceOf(line: string): Fence | null {
  const match = /^( *)(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return null
  const [, lead = "", run = "", info = ""] = match
  if (run.startsWith("`") && info.includes("`")) return null
  return {
    mark: run.charAt(0),
    size: run.length,
    indent: lead.length,
    lang: info.trim().split(/\s+/)[0] ?? "",
  }
}

/** Whether a line ends the fence: the same mark, at least as many, and nothing else. */
function closes(line: string, fence: Fence) {
  const trimmed = line.trim()
  return trimmed.length >= fence.size && trimmed.replaceAll(fence.mark, "") === ""
}

function headingOf(line: string): Block | null {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/.exec(line)
  if (!match) return null
  // Hashes that close a heading ("## Title ##") are not part of it.
  const text = (match[2] ?? "").replace(/(^|[ \t]+)#+[ \t]*$/, "").trim()
  return { type: "heading", level: (match[1] ?? "#").length, text }
}

const isRule = (line: string) => /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)
const isQuote = (line: string) => /^ {0,3}>/.test(line)
/** The line under a paragraph that makes a heading of it: `===` for the first level, `---`. */
const underline = (line: string) => /^ {0,3}(={2,}|-{3,})[ \t]*$/.exec(line)?.[1]?.charAt(0)

type Marker = { indent: number; ordered: boolean; number: number; content: number; rest: string }

/**
 * The start of a list item. `content` is the column the item's own text begins at, which is how
 * far a later line must be indented to belong to the item.
 */
function markerOf(line: string): Marker | null {
  const match = /^( *)(?:[-*+]|(\d{1,9})[.)])(?:( +)(.*))?$/.exec(line)
  if (!match) return null
  const [, lead = "", digits, gap = "", rest = ""] = match
  const width = lead.length + (digits === undefined ? 1 : digits.length + 1)
  const pad = rest !== "" && gap.length <= 4 ? gap.length : 1
  return {
    indent: lead.length,
    ordered: digits !== undefined,
    number: digits === undefined ? 1 : Number(digits),
    content: width + pad,
    rest,
  }
}

/** A table row's cells. A pipe written as `\|` is part of its cell. */
function cellsOf(line: string): string[] {
  const row = line.trim()
  const cells: string[] = []
  let cell = ""
  for (let at = 0; at < row.length; at++) {
    const char = row.charAt(at)
    if (char === "\\" && row.charAt(at + 1) === "|") {
      cell += "|"
      at++
    } else if (char === "|") {
      cells.push(cell.trim())
      cell = ""
    } else cell += char
  }
  cells.push(cell.trim())
  if (row.startsWith("|")) cells.shift()
  if (row.endsWith("|") && !row.endsWith("\\|") && cells.length > 0) cells.pop()
  return cells
}

/** The row of dashes under a table's header, as each column's alignment. */
function alignsOf(line: string): Align[] | null {
  if (!line.includes("-")) return null
  const cells = cellsOf(line)
  if (cells.length === 0) return null
  const aligns: Align[] = []
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null
    const left = cell.startsWith(":")
    const right = cell.endsWith(":")
    aligns.push(left && right ? "center" : right ? "right" : left ? "left" : null)
  }
  return aligns
}

/**
 * A table that starts at this line: a header row and the row of dashes under it. While a reply
 * is still arriving the dashes may not be there yet, so a header row at the very end (with at
 * most a part of the dashes under it) is a table already, and does not flash by as text.
 */
function tableAt(lines: string[], index: number, end: number) {
  const line = lines[index]
  if (line === undefined || !line.includes("|")) return null
  const head = cellsOf(line)
  if (head.length === 0) return null
  const under = index + 1 < end ? lines[index + 1] : undefined
  if (under !== undefined) {
    const align = alignsOf(under)
    if (align && align.length === head.length) return { head, align, next: index + 2 }
  }
  const row = line.trim()
  const boxed = row.length > 1 && row.startsWith("|") && row.endsWith("|")
  const last = under === undefined || (index + 2 >= end && /^[\s|:-]+$/.test(under))
  if (boxed && last) return { head, align: head.map((): Align => null), next: end }
  return null
}

/** Whether this line starts something of its own, and so ends the paragraph above it. */
function interrupts(lines: string[], index: number, end: number) {
  const line = lines[index] ?? ""
  if (blank(line) || fenceOf(line) || headingOf(line) || isRule(line) || isQuote(line)) return true
  const marker = markerOf(line)
  // "1986. A good year" in the middle of a paragraph is not a list: only a bullet or a 1 is.
  if (marker && marker.rest.trim() !== "" && (!marker.ordered || marker.number === 1)) return true
  return tableAt(lines, index, end) !== null
}

/** Whether a line is running text, which a less indented line under it may carry on. */
const carries = (line: string) =>
  !blank(line) && !fenceOf(line) && !headingOf(line) && !isRule(line)

/** The lines of a quote, without their marks, and the line after it. */
function quoteAt(lines: string[], from: number, end: number): [string, number] {
  const inner: string[] = []
  let fence: Fence | null = null
  let index = from
  while (index < end) {
    const line = lines[index] ?? ""
    if (isQuote(line)) {
      const text = line.replace(/^ {0,3}> ?/, "")
      inner.push(text)
      if (!fence) fence = fenceOf(text)
      else if (closes(text, fence)) fence = null
      index++
      continue
    }
    // A line without the mark still belongs to the paragraph it carries on.
    if (fence || !carries(inner[inner.length - 1] ?? "") || interrupts(lines, index, end)) break
    inner.push(line.trimStart())
    index++
  }
  return [inner.join("\n"), index]
}

/** A list that starts at this line, with everything its items hold, and the line after it. */
function listAt(
  lines: string[],
  from: number,
  end: number,
  depth: number,
  every: boolean,
): [Block, number] {
  const items: string[] = []
  const checked: (boolean | null)[] = []
  const children: Block[][] = []
  let first: Marker | null = null
  let index = from
  while (index < end) {
    const opening = lines[index] ?? ""
    const marker = markerOf(opening)
    if (!marker || isRule(opening) || (first && marker.ordered !== first.ordered)) break
    first ??= marker
    const body = [marker.rest]
    let fence = fenceOf(marker.rest)
    // A line is the item's when it is indented under the item's text, or is a list item that is
    // indented at all past this one's mark (agents often indent a nested list by two).
    const under = (line: string) => {
      const indent = indentOf(line)
      return indent >= marker.content || (indent >= marker.indent + 2 && markerOf(line) !== null)
    }
    index++
    while (index < end) {
      const line = lines[index] ?? ""
      if (blank(line)) {
        // Blank lines stay in the item only when what follows them is still under it.
        let next = index + 1
        while (next < end && blank(lines[next] ?? "")) next++
        if (next >= end || !under(lines[next] ?? "")) break
        for (; index < next; index++) body.push("")
        continue
      }
      if (under(line) && !(fence && indentOf(line) < marker.content)) {
        const text = line.slice(Math.min(indentOf(line), marker.content))
        body.push(text)
        if (!fence) fence = fenceOf(text)
        else if (closes(text, fence)) fence = null
        index++
        continue
      }
      const last = body[body.length - 1] ?? ""
      if (fence || !carries(last) || markerOf(line) || interrupts(lines, index, end)) break
      body.push(line.trimStart())
      index++
    }

    const box = /^\[([ xX])\](?: +|$)/.exec(body[0] ?? "")
    if (box) body[0] = (body[0] ?? "").slice(box[0].length)
    checked.push(box ? box[1] !== " " : null)
    const inner: Block[] =
      depth >= MAX_DEPTH
        ? [{ type: "paragraph", text: body.join("\n").trim() }]
        : blocksOf(body, depth + 1, every)
    const lead = inner[0]
    if (lead?.type === "paragraph") {
      items.push(lead.text)
      children.push(inner.slice(1))
    } else {
      items.push("")
      children.push(inner)
    }

    // Blank lines between two items of the same list do not end it.
    let next = index
    while (next < end && blank(lines[next] ?? "")) next++
    if (next === index) continue
    const sibling = next < end ? markerOf(lines[next] ?? "") : null
    if (!sibling || sibling.ordered !== first.ordered || isRule(lines[next] ?? "")) break
    index = next
  }
  const list: ListBlock = { type: "list", ordered: first?.ordered ?? false, items }
  if (first?.ordered && first.number !== 1) list.start = first.number
  if (checked.some((value) => value !== null)) list.checked = checked
  if (children.some((blocks) => blocks.length > 0)) list.children = children
  return [list, index]
}

const isWeb = (address: string) => /^https?:\/\//i.test(address)

/**
 * A paragraph, with its pictures taken out to stand on their own: a picture cannot sit inside a
 * line of text on a phone. Only pictures on the web are taken out; any other is left in the
 * text, where it is shown as its description, unless `every` picture is wanted: the caller then
 * knows what to make of one that is somewhere else.
 */
function withPictures(text: string, every: boolean): Block[] {
  if (!text.includes("![")) return [{ type: "paragraph", text }]
  const blocks: Block[] = []
  let from = 0
  let at = 0
  const flush = (to: number) => {
    const piece = text.slice(from, to).trim()
    if (piece !== "") blocks.push({ type: "paragraph", text: piece })
  }
  while (at < text.length) {
    const char = text.charAt(at)
    if (char === "\\") {
      at += 2
      continue
    }
    if (char === "`") {
      at = codeAt(text, at)?.end ?? at + 1
      continue
    }
    let found: { alt: string; src: string; end: number; href?: string } | null = null
    if (char === "!") found = imageAt(text, at)
    else if (text.startsWith("[![", at)) {
      // A picture that is a link: [![alt](picture)](where it goes).
      const picture = imageAt(text, at + 1)
      const target = picture && text.charAt(picture.end) === "]" && targetAt(text, picture.end + 1)
      if (picture && target) found = { ...picture, end: target.end, href: target.href }
    }
    if (!found || !(every || isWeb(found.src))) {
      at++
      continue
    }
    flush(at)
    const image: Block = { type: "image", alt: found.alt, src: found.src }
    if (found.href) image.href = found.href
    blocks.push(image)
    at = from = found.end
  }
  flush(text.length)
  return blocks
}

function blocksOf(lines: string[], depth: number, every: boolean): Block[] {
  const blocks: Block[] = []
  let end = lines.length
  while (end > 0 && blank(lines[end - 1] ?? "")) end--
  let index = 0
  while (index < end) {
    const line = lines[index] ?? ""
    if (blank(line)) {
      index++
      continue
    }
    const fence = fenceOf(line)
    if (fence) {
      // A fence that is never closed runs to the end, as it does while a reply is arriving.
      const code: string[] = []
      index++
      while (index < end && !closes(lines[index] ?? "", fence)) {
        const row = lines[index++] ?? ""
        code.push(row.slice(Math.min(indentOf(row), fence.indent)))
      }
      index++
      const block: Block = { type: "code", text: code.join("\n") }
      if (fence.lang) block.lang = fence.lang
      blocks.push(block)
      continue
    }
    const heading = headingOf(line)
    if (heading) {
      blocks.push(heading)
      index++
      continue
    }
    if (isRule(line)) {
      blocks.push({ type: "rule" })
      index++
      continue
    }
    if (isQuote(line)) {
      const [text, next] = quoteAt(lines, index, end)
      blocks.push({ type: "quote", text })
      index = next
      continue
    }
    if (markerOf(line)) {
      const [list, next] = listAt(lines, index, end, depth, every)
      blocks.push(list)
      index = next
      continue
    }
    const table = tableAt(lines, index, end)
    if (table) {
      const rows: string[][] = []
      index = table.next
      while (index < end && (lines[index] ?? "").includes("|")) {
        const cells = cellsOf(lines[index++] ?? "")
        rows.push(table.head.map((_, column) => cells[column] ?? ""))
      }
      blocks.push({ type: "table", head: table.head, align: table.align, rows })
      continue
    }
    const paragraph = [line.trimStart()]
    let level = 0
    index++
    while (index < end) {
      const next = lines[index] ?? ""
      const mark = underline(next)
      if (mark) {
        level = mark === "=" ? 1 : 2
        index++
        break
      }
      if (interrupts(lines, index, end)) break
      paragraph.push(next.trimStart())
      index++
    }
    const text = paragraph.join("\n").trimEnd()
    if (level > 0) blocks.push({ type: "heading", level, text })
    else blocks.push(...withPictures(text, every))
  }
  return blocks
}

/**
 * Split Markdown into blocks: paragraphs, headings, fenced code, lists (nested, numbered, tasks),
 * quotes, rules, tables and pictures. It never throws on Markdown that is only half written, so
 * it can be run on a reply at every step of its arriving. HTML is not read: it stays text.
 * With `every`, a picture is taken out wherever its address is, and not only one on the web.
 */
export function parseBlocks(source: string, every = false): Block[] {
  const lines = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^[ \t]*\t[ \t]*/, (lead) => lead.replaceAll("\t", "    ")))
  try {
    return blocksOf(lines, 0, every)
  } catch {
    // Nothing above is meant to throw; if it ever does, the words are still shown.
    return [{ type: "paragraph", text: source }]
  }
}

/* ---------- inline ---------- */

/** A run of text drawn one way. A span can be several things at once: a bold link, say. */
export type Span = {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  strike?: boolean
  href?: string
}

type Mark = "bold" | "italic" | "strike"

/** What a line of text is read into before emphasis is paired up. */
type Node =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; nodes: Node[] }
  | { kind: "mark"; mark: Mark; nodes: Node[] }
  | Run

/** A run of `*`, `_` or `~` that may open or close emphasis. What is left of it is text. */
type Run = { kind: "run"; char: string; count: number; size: number; open: boolean; close: boolean }

const PUNCTUATION = /[!-/:-@[-`{-~¡-¿‐-‧‰-⁞　-〿]/
const ESCAPED = /\\([!-/:-@[-`{-~])/g
const WEB_ADDRESS = /https?:\/\/[^\s<]+/iy
const ANGLE_ADDRESS = /<((?:https?:\/\/|mailto:)[^\s<>]+)>/iy
const ANGLE_MAIL = /<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/y
/** How far ahead a `[` looks for its `]`, so a page of stray brackets cannot slow a reply down. */
const BRACKET_REACH = 2000

/** How many brackets may sit inside each other in a link's address, as in Markdown's own rule. */
const PAREN_DEPTH = 32

const unescape = (text: string) => text.replace(ESCAPED, "$1")

/** Inline code that starts at these backticks, closed by as many; null when it is never closed. */
function codeAt(text: string, at: number): { text: string; end: number } | null {
  let size = 0
  while (text.charAt(at + size) === "`") size++
  let from = at + size
  for (;;) {
    const close = text.indexOf("`", from)
    if (close < 0) return null
    let run = 0
    while (text.charAt(close + run) === "`") run++
    if (run === size) {
      let inner = text.slice(at + size, close).replace(/\n/g, " ")
      // One space of padding is not part of the code: `` ` `` is a backtick.
      if (inner.trim() !== "" && inner.startsWith(" ") && inner.endsWith(" ")) {
        inner = inner.slice(1, -1)
      }
      return { text: inner, end: close + size }
    }
    from = close + run
  }
}

/** Where the `]` is that closes the `[` at `open`, or -1. */
function closeOf(text: string, open: number) {
  let depth = 0
  const limit = Math.min(text.length, open + BRACKET_REACH)
  for (let at = open; at < limit; at++) {
    const char = text.charAt(at)
    if (char === "\\") at++
    else if (char === "`") at = (codeAt(text, at)?.end ?? at + 1) - 1
    else if (char === "[") depth++
    else if (char === "]" && --depth === 0) return at
  }
  return -1
}

/** The `(address "title")` after a link's text: the address, and where the whole thing ends. */
function targetAt(text: string, at: number): { href: string; end: number } | null {
  if (text.charAt(at) !== "(") return null
  let index = at + 1
  const skip = () => {
    while (/\s/.test(text.charAt(index))) index++
  }
  skip()
  let href: string
  if (text.charAt(index) === "<") {
    const close = text.indexOf(">", index)
    if (close < 0 || text.slice(index, close).includes("\n")) return null
    href = text.slice(index + 1, close)
    index = close + 1
  } else {
    const from = index
    let depth = 0
    for (; index < text.length; index++) {
      const char = text.charAt(index)
      if (char === "\\") index++
      else if (/\s/.test(char)) break
      else if (char === "(") {
        // An address holds brackets only so deep; past that this is not a link, and a page of
        // "[a](" is not read to its end once for every one of them.
        if (++depth > PAREN_DEPTH) return null
      } else if (char === ")" && depth-- === 0) break
    }
    index = Math.min(index, text.length)
    href = unescape(text.slice(from, index))
  }
  skip()
  const quote = text.charAt(index)
  if (quote === '"' || quote === "'" || quote === "(") {
    const close = text.indexOf(quote === "(" ? ")" : quote, index + 1)
    if (close < 0) return null
    index = close + 1
    skip()
  }
  return text.charAt(index) === ")" ? { href, end: index + 1 } : null
}

/** How many pictures' descriptions are being read, one inside another. */
let nested = 0

/** A picture written at `at`: `![what it shows](address)`. */
function imageAt(text: string, at: number): { alt: string; src: string; end: number } | null {
  if (!text.startsWith("![", at)) return null
  const close = closeOf(text, at + 1)
  if (close < 0) return null
  const target = targetAt(text, close + 1)
  if (!target) return null
  const inner = text.slice(at + 2, close)
  // A description may hold marks of its own, but pictures inside pictures are not followed far.
  let alt = inner
  if (nested < 4) {
    nested++
    try {
      alt = spansOf(scan(inner, true, false))
        .map((span) => span.text)
        .join("")
    } finally {
      nested--
    }
  }
  return { alt, src: target.href, end: target.end }
}

/** A bare web address, without the full stop or bracket that ends the sentence it is in. */
function addressAt(text: string, at: number): string | null {
  WEB_ADDRESS.lastIndex = at
  let address = WEB_ADDRESS.exec(text)?.[0] ?? ""
  for (;;) {
    const last = address.charAt(address.length - 1)
    const unopened = last === ")" && address.split(")").length > address.split("(").length
    if (!unopened && !/[?!.,:;*_~'"]/.test(last)) break
    address = address.slice(0, -1)
  }
  return /^https?:\/\/./i.test(address) ? address : null
}

/**
 * Read a line of text into nodes. Inside a link's own text there are no further links. With
 * `breaks`, every new line is kept; without, a new line is a space unless the line before it
 * ends in two spaces or a backslash, as Markdown has it.
 */
function scan(text: string, inLink: boolean, breaks: boolean): Node[] {
  const nodes: Node[] = []
  let buffer = ""
  const flush = () => {
    if (buffer !== "") nodes.push({ kind: "text", text: buffer })
    buffer = ""
  }
  let at = 0
  while (at < text.length) {
    const char = text.charAt(at)
    const next = text.charAt(at + 1)
    if (char === "\\") {
      if (next === "\n") {
        buffer += "\n"
        at += 2
        while (text.charAt(at) === " ") at++
      } else if (next !== "" && PUNCTUATION.test(next) && next.charCodeAt(0) < 128) {
        buffer += next
        at += 2
      } else {
        buffer += char
        at++
      }
      continue
    }
    if (char === "\n") {
      // Counted by hand: a pattern would read the whole of a long paragraph at every new line.
      let kept = buffer.length
      while (kept > 0 && buffer.charAt(kept - 1) === " ") kept--
      const hard = breaks || buffer.length - kept >= 2
      buffer = (kept < buffer.length ? buffer.slice(0, kept) : buffer) + (hard ? "\n" : " ")
      at++
      while (text.charAt(at) === " ") at++
      continue
    }
    if (char === "`") {
      const code = codeAt(text, at)
      if (code) {
        flush()
        nodes.push({ kind: "code", text: code.text })
        at = code.end
      } else {
        while (text.charAt(at) === "`") {
          buffer += "`"
          at++
        }
      }
      continue
    }
    if (char === "!" && next === "[") {
      // A picture inside a line (in a heading or a table) is its description, linked to it.
      const image = imageAt(text, at)
      if (image) {
        flush()
        const shown: Node = { kind: "text", text: image.alt }
        nodes.push(isWeb(image.src) ? { kind: "link", href: image.src, nodes: [shown] } : shown)
        at = image.end
        continue
      }
    }
    if (char === "[" && !inLink) {
      const close = closeOf(text, at)
      const target = close < 0 ? null : targetAt(text, close + 1)
      if (target) {
        flush()
        const inner = scan(text.slice(at + 1, close), true, breaks)
        const shown: Node[] = inner.length > 0 ? inner : [{ kind: "text", text: target.href }]
        nodes.push({ kind: "link", href: target.href, nodes: shown })
        at = target.end
        continue
      }
    }
    if (char === "<" && !inLink) {
      ANGLE_ADDRESS.lastIndex = at
      ANGLE_MAIL.lastIndex = at
      const address = ANGLE_ADDRESS.exec(text)
      const mail = address ? null : ANGLE_MAIL.exec(text)
      const found = address ?? mail
      if (found) {
        flush()
        const shown = found[1] ?? ""
        const href = mail ? `mailto:${shown}` : shown
        nodes.push({ kind: "link", href, nodes: [{ kind: "text", text: shown }] })
        at += found[0].length
        continue
      }
    }
    if ((char === "h" || char === "H") && !inLink && !/\w/.test(text.charAt(at - 1))) {
      const address = addressAt(text, at)
      if (address) {
        flush()
        nodes.push({ kind: "link", href: address, nodes: [{ kind: "text", text: address }] })
        at += address.length
        continue
      }
    }
    if (char === "*" || char === "_" || char === "~") {
      let size = 0
      while (text.charAt(at + size) === char) size++
      const before = at > 0 ? text.charAt(at - 1) : " "
      const after = at + size < text.length ? text.charAt(at + size) : " "
      at += size
      // Only two tildes strike text through: one is "about", as in ~5.
      if (char === "~" && size !== 2) {
        buffer += char.repeat(size)
        continue
      }
      const spaceBefore = /\s/.test(before)
      const spaceAfter = /\s/.test(after)
      const markBefore = PUNCTUATION.test(before)
      const markAfter = PUNCTUATION.test(after)
      const left = !spaceAfter && (!markAfter || spaceBefore || markBefore)
      const right = !spaceBefore && (!markBefore || spaceAfter || markAfter)
      // Underscores only mark emphasis at word edges, so names_like_this stay as written.
      const open = char === "_" ? left && (!right || markBefore) : left
      const close = char === "_" ? right && (!left || markAfter) : right
      flush()
      nodes.push({ kind: "run", char, count: size, size, open, close })
      continue
    }
    buffer += char
    at++
  }
  flush()
  return pair(nodes)
}

/**
 * Pair each closing run of marks with the nearest opening run before it, and wrap what is
 * between them. Marks that find no partner stay in place and are shown as typed.
 */
function pair(nodes: Node[]): Node[] {
  const out: Node[] = []
  // Below this place there is no opening run for a closing run of this sort, as an earlier
  // search found; without it a long line of marks that close nothing is searched over and over.
  const floors = new Map<string, number>()
  for (const node of nodes) {
    if (node.kind !== "run") {
      out.push(node)
      continue
    }
    const closer = node
    const sort = `${closer.char}${closer.size % 3}${closer.open}`
    while (closer.close && closer.count > 0) {
      const floor = floors.get(sort) ?? 0
      let at = out.length - 1
      for (; at >= floor; at--) {
        const candidate = out[at]
        if (candidate?.kind !== "run" || candidate.char !== closer.char || !candidate.open) continue
        // Markdown's rule of three, which keeps *a**b from pairing its first and last star.
        const either = candidate.close || closer.open
        const sum = candidate.size + closer.size
        const odd = sum % 3 === 0 && (candidate.size % 3 !== 0 || closer.size % 3 !== 0)
        if (!(either && odd)) break
      }
      const opener = at >= floor ? out[at] : undefined
      if (opener?.kind !== "run") {
        floors.set(sort, out.length)
        break
      }
      const use = closer.char === "~" || (opener.count >= 2 && closer.count >= 2) ? 2 : 1
      const inner = out.splice(at + 1)
      // What is put back from here on has not been searched, whatever was found before.
      for (const [key, value] of floors) if (value > at) floors.set(key, at)
      opener.count -= use
      closer.count -= use
      if (opener.count === 0) out.pop()
      const mark: Mark = closer.char === "~" ? "strike" : use === 2 ? "bold" : "italic"
      out.push({ kind: "mark", mark, nodes: inner })
    }
    if (closer.count > 0) out.push(closer)
  }
  return out
}

type Look = Omit<Span, "text">

/** Lay the nodes out flat, each run of text with everything that wraps it. */
function spansOf(nodes: Node[], look: Look = {}, spans: Span[] = []): Span[] {
  const add = (text: string, as: Look) => {
    if (text === "") return
    const last = spans[spans.length - 1]
    const same =
      last !== undefined &&
      last.bold === as.bold &&
      last.italic === as.italic &&
      last.code === as.code &&
      last.strike === as.strike &&
      last.href === as.href
    if (same) last.text += text
    else spans.push({ text, ...as })
  }
  for (const node of nodes) {
    if (node.kind === "text") add(node.text, look)
    else if (node.kind === "run") add(node.char.repeat(node.count), look)
    else if (node.kind === "code") add(node.text, { ...look, code: true })
    else if (node.kind === "mark") spansOf(node.nodes, { ...look, [node.mark]: true }, spans)
    else spansOf(node.nodes, look.href || !node.href ? look : { ...look, href: node.href }, spans)
  }
  return spans
}

/**
 * Emphasis, strike-through, code, links and bare web addresses, one inside another to any
 * depth. Unmatched markers are left as typed. With `breaks`, every new line in the text is kept
 * (for words a person typed); without, new lines are spaces, as in a Markdown document.
 */
export function parseInline(text: string, breaks = false): Span[] {
  try {
    return spansOf(scan(text, false, breaks))
  } catch {
    // Nothing above is meant to throw; if it ever does, the words are still shown.
    return text === "" ? [] : [{ text }]
  }
}

/* ---------- drawing ---------- */

/** What every piece of one document is drawn with. It only changes when the caller's props do. */
type Ink = {
  /** The caller's own color for all text, if one was given. */
  color: string | undefined
  selectable: boolean
  breaks: boolean
  open: (href: string) => void
  /** The caller's own way of drawing a picture, if it has one. */
  image: MarkdownProps["image"]
}

type Piece = {
  ink: Ink
  /**
   * How far inside lists and quotes this sits. A list counts one and a quote two, so that a
   * list's bullets, which take turns by depth, are the same inside a quote as outside it.
   */
  depth: number
  /** Inside a quote, where text is quieter. */
  muted: boolean
}

const NONE: Block[] = []

/** Whether two parsed values say the same thing, so a block that did not change is not redrawn. */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  return keys.every((key) => equal(left[key], right[key]))
}

type LineProps = {
  text: string
  ink: Ink
  muted?: boolean
  /** One of the styles below, never one made while drawing: a new one would redraw the line. */
  style?: TextStyle
  align?: Align
  /** A heading's level, from 1 to 6, when the line is one. */
  heading?: number
}

/** One run of text with its emphasis and links. */
const Line = memo(function Line({ text, ink, muted, style, align, heading }: LineProps) {
  const theme = useTheme()
  const spans = useMemo(() => parseInline(text, ink.breaks), [text, ink.breaks])
  const color = ink.color ?? (muted ? theme.ink2 : theme.ink)
  return (
    <Text
      selectable={ink.selectable}
      accessibilityRole={heading ? "header" : undefined}
      // In a browser a heading says which level it is, as the web app's headings do.
      {...(heading && Platform.OS === "web" ? { "aria-level": heading } : null)}
      style={[styles.body, style, { color, textAlign: align ?? undefined }]}
    >
      {spans.map((span, index) => {
        const { href } = span
        if (!span.bold && !span.italic && !span.code && !span.strike && !href) return span.text
        const lines = [
          href && ink.color ? "underline" : "",
          span.strike ? "line-through" : "",
        ].filter(Boolean)
        return (
          <Text
            key={index}
            accessibilityRole={href ? "link" : undefined}
            onPress={href ? () => ink.open(href) : undefined}
            style={[
              span.bold ? styles.bold : null,
              span.italic ? styles.italic : null,
              span.code ? [styles.inlineCode, { backgroundColor: theme.fill }] : null,
              href ? { color: ink.color ?? theme.tint } : null,
              lines.length > 0
                ? { textDecorationLine: lines.join(" ") as TextStyle["textDecorationLine"] }
                : null,
            ]}
          >
            {span.text}
          </Text>
        )
      })}
    </Text>
  )
})

/** Fenced code: its language and a button that copies it, over the code itself. */
function Code({ text, lang, ink }: { text: string; lang?: string; ink: Ink }) {
  const theme = useTheme()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const copy = () => {
    Clipboard.setStringAsync(text)
      .then(() => {
        haptic.done()
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => {})
  }
  const quiet = ink.color ?? theme.ink2
  return (
    <View style={[styles.code, { backgroundColor: theme.fill }]}>
      <View style={[styles.codeBar, { borderBottomColor: theme.sep }]}>
        <Text style={[styles.codeLabel, { color: quiet }]}>{lang || "code"}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy code"
          hitSlop={8}
          onPress={copy}
          style={({ pressed }) => [styles.copy, pressed ? styles.pressed : null]}
        >
          <Icon name={copied ? "check" : "copy"} size={14} color={quiet} />
          <Text style={[styles.codeLabel, { color: quiet }]}>{copied ? "Copied" : "Copy"}</Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.codeBody}
      >
        <Text
          selectable={ink.selectable}
          style={[styles.codeText, { color: ink.color ?? theme.ink }]}
        >
          {text}
        </Text>
      </ScrollView>
    </View>
  )
}

/** The widest and narrowest a table's column is drawn, and about how wide a letter is. */
const COLUMN = { min: 64, max: 240, letter: 8, padding: 26 }

/**
 * A table. Rows are laid out one by one, so each column is given a width from its longest cell
 * for the cells to line up; a table wider than the page scrolls sideways.
 */
function Table({ block, ink, muted }: { block: TableBlock; ink: Ink; muted: boolean }) {
  const theme = useTheme()
  const widths = useMemo(
    () =>
      block.head.map((head, column) => {
        const longest = block.rows.reduce(
          (most, row) => Math.max(most, (row[column] ?? "").length),
          head.length,
        )
        const width = longest * COLUMN.letter + COLUMN.padding
        return Math.min(COLUMN.max, Math.max(COLUMN.min, width))
      }),
    [block],
  )
  const row = (cells: string[], at: number) => (
    <View
      key={at}
      style={[
        styles.row,
        { borderTopColor: theme.sep },
        at < 0 ? { backgroundColor: theme.fill } : styles.rowRule,
      ]}
    >
      {block.head.map((_, column) => (
        <View
          key={column}
          style={[
            styles.cell,
            { width: widths[column], borderLeftColor: theme.sep },
            column > 0 ? styles.cellRule : null,
          ]}
        >
          <Line
            text={cells[column] ?? ""}
            ink={ink}
            muted={muted}
            style={at < 0 ? styles.headCell : styles.cellText}
            align={block.align[column] ?? null}
          />
        </View>
      ))}
    </View>
  )
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.table, { borderColor: theme.sep }]}
    >
      <View>
        {row(block.head, -1)}
        {block.rows.map(row)}
      </View>
    </ScrollView>
  )
}

/** The shape a picture is drawn at before its own is known, and the tallest and widest allowed. */
const SHAPE = { unknown: 16 / 9, tallest: 0.5, widest: 4 }

/**
 * A picture from the web, as wide as the text, or as wide as it really is when that is less (a
 * badge is not blown up to the width of the page). If it cannot be loaded, its description.
 */
function Picture({ block, ink }: { block: PictureBlock; ink: Ink }) {
  const theme = useTheme()
  const [size, setSize] = useState<{ shape: number; width?: number }>({ shape: SHAPE.unknown })
  // How much room there is across, which is as wide as a picture is ever drawn.
  const [room, setRoom] = useState<number>()
  const [failed, setFailed] = useState(false)
  const { href } = block
  if (failed) {
    // Its description, as a link to where the picture is (or to where the picture led).
    const words = (block.alt || block.src).replace(/[\\[\]`*_~<!]/g, "\\$&")
    return <Line text={`[${words}](<${href ?? block.src}>)`} ink={ink} muted />
  }
  // Its width and height are both said once they are known. Left to work out the height from
  // the shape, a phone takes the width for all the room there is, and a small picture is then
  // set in a box far taller than it.
  const wide = room === undefined ? undefined : Math.min(room, size.width ?? room)
  const image = (
    <Image
      source={{ uri: block.src }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={block.alt}
      alt={block.alt}
      contentFit="contain"
      transition={150}
      onError={() => setFailed(true)}
      onLoad={(event) => {
        const { width, height } = event.source
        if (width > 0 && height > 0) {
          const shape = Math.min(SHAPE.widest, Math.max(SHAPE.tallest, width / height))
          setSize({ shape, width })
        }
      }}
      style={[
        styles.picture,
        wide === undefined
          ? { aspectRatio: size.shape }
          : { width: wide, height: wide / size.shape },
        { backgroundColor: theme.fill },
      ]}
    />
  )
  const picture = (
    <View style={styles.pictureRoom} onLayout={(event) => setRoom(event.nativeEvent.layout.width)}>
      {image}
    </View>
  )
  if (!href) return picture
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={block.alt || href}
      onPress={() => ink.open(href)}
    >
      {picture}
    </Pressable>
  )
}

function List({ block, ink, depth, muted }: Piece & { block: ListBlock }) {
  const theme = useTheme()
  const quiet = ink.color ?? theme.ink2
  const from = block.start ?? 1
  // Room for the list's longest number, so the text of every item starts at the same place.
  const room = String(from + block.items.length - 1).length * 10 + 10
  return (
    <View style={styles.list}>
      {block.items.map((text, index) => {
        const done = block.checked?.[index] ?? null
        const rest = block.children?.[index] ?? NONE
        return (
          <View key={index} style={styles.item}>
            {done === null ? (
              <Text
                style={[
                  styles.body,
                  block.ordered ? [styles.number, { minWidth: room }] : styles.bullet,
                  { color: quiet },
                ]}
              >
                {block.ordered ? `${from + index}.` : depth % 2 === 0 ? "•" : "◦"}
              </Text>
            ) : (
              <View
                accessibilityRole="checkbox"
                aria-checked={done}
                aria-disabled
                style={styles.check}
              >
                <Icon
                  name={done ? "checkCircle" : "circle"}
                  size={20}
                  color={done ? (ink.color ?? theme.tint) : (ink.color ?? theme.ink3)}
                />
              </View>
            )}
            <View style={styles.itemBody}>
              {text !== "" ? <Line text={text} ink={ink} muted={muted} /> : null}
              {rest.map((child, at) => (
                <BlockView
                  key={at}
                  block={child}
                  ink={ink}
                  depth={depth + 1}
                  muted={muted}
                  first={at === 0 && text === ""}
                />
              ))}
            </View>
          </View>
        )
      })}
    </View>
  )
}

/** A quote: a rule down the left, and whatever Markdown was quoted beside it. */
function Quote({ text, ink, depth }: Piece & { text: string }) {
  const theme = useTheme()
  const every = ink.image !== undefined
  const blocks = useMemo(
    () => (depth >= MAX_DEPTH * 2 ? null : parseBlocks(text, every)),
    [text, depth, every],
  )
  return (
    <View style={[styles.quote, { borderLeftColor: ink.color ?? theme.sep }]}>
      {blocks ? (
        blocks.map((block, index) => (
          <BlockView
            key={index}
            block={block}
            ink={ink}
            depth={depth + 2}
            muted
            first={index === 0}
          />
        ))
      ) : (
        <Line text={text} ink={ink} muted />
      )}
    </View>
  )
}

const HEADINGS: TextStyle[] = [
  type.title1,
  type.title2,
  type.title3,
  type.headline,
  { ...type.subhead, fontWeight: "600" },
  { ...type.footnote, fontWeight: "600" },
]

type BlockProps = Piece & {
  block: Block
  /** The first block has nothing above it to stand apart from. */
  first: boolean
}

/**
 * One block. It is drawn again only when what it says has changed, so the blocks before the one
 * a reply is still writing cost nothing as each new word arrives.
 */
const BlockView = memo(
  function BlockView({ block, ink, depth, muted, first }: BlockProps) {
    const theme = useTheme()
    switch (block.type) {
      case "heading": {
        const level = Math.min(6, Math.max(1, block.level))
        const above = first ? null : level <= 2 ? styles.aboveTitle : styles.aboveHeading
        return (
          <View style={above}>
            <Line
              text={block.text}
              ink={ink}
              muted={muted || level === 6}
              style={HEADINGS[level - 1]}
              heading={level}
            />
          </View>
        )
      }
      case "code":
        return <Code text={block.text} lang={block.lang} ink={ink} />
      case "list":
        return <List block={block} ink={ink} depth={depth} muted={muted} />
      case "quote":
        return <Quote text={block.text} ink={ink} depth={depth} muted={muted} />
      case "rule":
        return (
          <View
            accessibilityRole="none"
            // On a tinted bubble the rule is the text's own color, let through faintly.
            style={[
              styles.rule,
              { backgroundColor: ink.color ?? theme.sep },
              ink.color ? styles.faint : null,
            ]}
          />
        )
      case "table":
        return <Table block={block} ink={ink} muted={muted} />
      case "image":
        return ink.image === undefined ? (
          <Picture block={block} ink={ink} />
        ) : (
          ink.image(block, (src) => <Picture block={{ ...block, src }} ink={ink} />)
        )
      default:
        return <Line text={block.text} ink={ink} muted={muted} />
    }
  },
  (before, after) =>
    before.ink === after.ink &&
    before.depth === after.depth &&
    before.muted === after.muted &&
    before.first === after.first &&
    equal(before.block, after.block),
)

export type MarkdownProps = {
  text: string
  /** One color for all the text, for words on a tinted bubble. Links are then underlined. */
  color?: string
  /** Whether the text can be selected and copied. It can unless this is false. */
  selectable?: boolean
  /** Keep every new line as typed, for a person's own words. A document's new lines are spaces. */
  breaks?: boolean
  /**
   * Called when a link is tapped. Return true when it was dealt with; otherwise a web or mail
   * address is opened, and anything else an agent wrote is shown, not followed.
   */
  onLink?: (href: string) => boolean
  /**
   * Draws what is written as a picture, wherever its address is, for a caller that knows more
   * of where pictures are than this does: `draw` gives the picture at an address, as it is drawn
   * here. Without it only a picture on the web is drawn, at once. It must be the same function
   * each time, or every block is drawn again.
   */
  image?: (picture: PictureBlock, draw: (src: string) => ReactNode) => ReactNode
}

/**
 * A reply or a document, drawn from Markdown. Raw HTML is shown as text, never interpreted. The
 * text can grow one word at a time: only the block being written is drawn again.
 */
export const Markdown = memo(function Markdown({
  text,
  color,
  selectable = true,
  breaks = false,
  onLink,
  image,
}: MarkdownProps) {
  const every = image !== undefined
  const blocks = useMemo(() => parseBlocks(text, every), [text, every])
  // Kept aside so a caller that makes a new function each time does not redraw every block.
  const handler = useRef(onLink)
  useEffect(() => {
    handler.current = onLink
  }, [onLink])
  const open = useCallback((href: string) => {
    if (handler.current?.(href)) return
    if (/^(https?:\/\/|mailto:)/i.test(href)) Linking.openURL(href).catch(() => {})
  }, [])
  const ink = useMemo<Ink>(
    () => ({ color, selectable, breaks, open, image }),
    [color, selectable, breaks, open, image],
  )
  return (
    <View style={styles.blocks}>
      {blocks.map((block, index) => (
        <BlockView
          key={index}
          block={block}
          ink={ink}
          depth={0}
          muted={false}
          first={index === 0}
        />
      ))}
    </View>
  )
})

const styles = StyleSheet.create({
  blocks: { gap: space(2.75) },
  body: { ...type.body, lineHeight: 24 },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  inlineCode: { fontFamily: mono, fontSize: 15 },
  aboveTitle: { marginTop: space(3.5) },
  aboveHeading: { marginTop: space(2) },
  code: { borderRadius: radius.sm, overflow: "hidden" },
  codeBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: space(3),
    paddingRight: space(2.5),
    paddingVertical: space(1.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  codeLabel: { ...type.footnote },
  copy: { flexDirection: "row", alignItems: "center", gap: space(1) },
  pressed: { opacity: 0.5 },
  codeBody: { padding: space(3) },
  codeText: { fontFamily: mono, fontSize: 14, lineHeight: 20 },
  list: { gap: space(1.5) },
  item: { flexDirection: "row", gap: space(1.5) },
  bullet: { minWidth: 16, textAlign: "center" },
  number: { textAlign: "right", fontVariant: ["tabular-nums"] },
  check: { width: 20, height: 24, alignItems: "center", justifyContent: "center" },
  itemBody: { flex: 1, gap: space(1.5) },
  quote: { borderLeftWidth: 3, paddingLeft: space(3), gap: space(2.5) },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: space(2) },
  faint: { opacity: 0.4 },
  // As wide as its columns, and no wider than the page: past that it scrolls.
  table: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    flexGrow: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
  },
  row: { flexDirection: "row" },
  rowRule: { borderTopWidth: StyleSheet.hairlineWidth },
  cell: { paddingHorizontal: space(2.5), paddingVertical: space(1.75) },
  cellRule: { borderLeftWidth: StyleSheet.hairlineWidth },
  cellText: { ...type.subhead },
  headCell: { ...type.subhead, fontWeight: "600" },
  picture: { width: "100%", borderRadius: radius.sm },
  pictureRoom: { width: "100%" },
})

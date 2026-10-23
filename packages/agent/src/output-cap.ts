/**
 * How much of a tool's text the model is sent: `bash`, `background`'s output and `read`. Every
 * such result stays in the conversation and is read again with each request after it, so a long
 * one costs many times over. Past `OUTPUT_CAP_CHARS` the model is sent the start and the end of
 * it, with a line in the middle that says how much was cut and where all of it is, so it can read
 * the rest selectively (grep, sed, `read` with an offset). Pictures are not touched.
 *
 * This is the one place output is cut for those tools: they hand the harness text under its own
 * limits (50 KB), which then cuts nothing more.
 */
export const OUTPUT_CAP_CHARS = 12_000
/** What is kept of the start and of the end, past the cap. */
export const HEAD_CHARS = 4_000
export const TAIL_CHARS = 7_000

/** What was left out of the middle: characters, whole lines, and which lines (from 1). */
export type Cut = {
  readonly chars: number
  readonly lines: number
  readonly fromLine: number
  readonly toLine: number
  /** The whole text's length, and its lines. */
  readonly totalChars: number
  readonly totalLines: number
}

const newlines = (text: string) => {
  let count = 0
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) count++
  return count
}

const grouped = (value: number) => value.toLocaleString("en-US")

/**
 * The start and end kept, joined by the marker. Each is cut at a line's end where one is near,
 * so no line is shown in part unless it is very long.
 */
function join(
  head: string,
  tail: string,
  totalChars: number,
  totalNewlines: number,
  marker: (cut: Cut) => string,
): string {
  let start = head.slice(0, HEAD_CHARS)
  const lastBreak = start.lastIndexOf("\n")
  if (lastBreak >= HEAD_CHARS * 0.75) start = start.slice(0, lastBreak + 1)
  let end = tail.slice(-TAIL_CHARS)
  const firstBreak = end.indexOf("\n")
  if (end.length === TAIL_CHARS && firstBreak !== -1 && firstBreak <= TAIL_CHARS * 0.25) {
    end = end.slice(firstBreak + 1)
  }
  // Whether the end kept starts a line, or shows the last part of one.
  const endStartsLine = end.length === tail.length || tail[tail.length - end.length - 1] === "\n"
  // Lines are counted as a file's are, from 1; the first not shown whole is the first cut.
  const totalLines = totalNewlines + 1
  const fromLine = newlines(start) + 1
  const lastShown = totalLines - newlines(end)
  const toLine = Math.max(fromLine, endStartsLine ? lastShown - 1 : lastShown)
  const cut: Cut = {
    chars: totalChars - start.length - end.length,
    lines: toLine - fromLine + 1,
    fromLine,
    toLine,
    totalChars,
    totalLines,
  }
  const before = start === "" || start.endsWith("\n") ? "" : "\n"
  const after = end === "" || end.startsWith("\n") ? "" : "\n"
  return `${start}${before}${marker(cut)}${after}${end}`
}

/** The text as the model is sent it: whole under the cap, or its start and end with `marker`. */
export function capText(text: string, marker: (cut: Cut) => string): string {
  if (text.length <= OUTPUT_CAP_CHARS) return text
  return join(text, text, text.length, newlines(text), marker)
}

/**
 * What a stream printed, for when it ends: all of it while it is under the cap, else its start
 * and its end. Holds no more than the cap, however much is printed.
 */
export class OutputCap {
  #head = ""
  #rest = ""
  #chars = 0
  #newlines = 0

  push(text: string): void {
    this.#chars += text.length
    this.#newlines += newlines(text)
    let left = text
    if (this.#head.length < HEAD_CHARS) {
      const room = HEAD_CHARS - this.#head.length
      this.#head += left.slice(0, room)
      left = left.slice(room)
    }
    if (left === "") return
    this.#rest += left
    // Kept to the cap, so that a stream under it can be given back whole.
    const keep = OUTPUT_CAP_CHARS - HEAD_CHARS
    if (this.#rest.length > 2 * keep) this.#rest = this.#rest.slice(-keep)
  }

  /** Output the computer left out before the next chunk: counted, and the end starts after it. */
  skip(chars: number, newlineCount: number): void {
    this.#chars += chars
    this.#newlines += newlineCount
    this.#rest = ""
  }

  /** How much it printed. */
  get chars(): number {
    return this.#chars
  }

  /** Whether it printed more than the model is sent. */
  get over(): boolean {
    return this.#chars > OUTPUT_CAP_CHARS
  }

  /** Its start and end with `marker` between, or undefined where it is under the cap. */
  capped(marker: (cut: Cut) => string): string | undefined {
    if (!this.over) return undefined
    return join(this.#head, this.#rest, this.#chars, this.#newlines, marker)
  }
}

/** The marker for output that is all in a file on a computer. */
export function cutToFile(file: string, computer?: string): (cut: Cut) => string {
  const where = computer === undefined ? file : `${file} on "${computer}"`
  return (cut) =>
    `[… ${grouped(cut.chars)} characters (${grouped(cut.lines)} lines) of ${grouped(cut.totalChars)} were cut here, to keep this short. All of it is in ${where}: search or read the part you need there (grep, sed -n, or read with offset and limit) rather than printing it again.]`
}

/** The marker for output that could not be kept anywhere. */
export const cutUnkept = (cut: Cut): string =>
  `[… ${grouped(cut.chars)} characters (${grouped(cut.lines)} lines) of ${grouped(cut.totalChars)} were cut here, to keep this short, and could not be kept in a file. If you need them, run it again with its output narrowed (grep, head, tail, or into a file).]`

/** The marker for a part of a file that `read` left out: the lines to read next. */
export function cutFromRead(path: string, firstLine: number): (cut: Cut) => string {
  return (cut) => {
    const from = firstLine + cut.fromLine - 1
    const to = firstLine + cut.toLine - 1
    return `[… lines ${grouped(from)}-${grouped(to)} (${grouped(cut.chars)} characters) were cut here, to keep this short. Read them with offset=${from} and a limit, or search ${path} for what you need.]`
  }
}

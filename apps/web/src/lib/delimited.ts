/** The most of a table that is drawn: past this it is a file to open, not a thing to read. */
export const TABLE_ROWS = 100
export const TABLE_COLUMNS = 30

export type DelimitedTable = {
  /** The rows, the first of them the headings, each as wide as the widest. */
  rows: string[][]
  /** There was more than is here: rows, or columns. */
  cut: boolean
}

/**
 * The rows of a CSV or TSV file, as RFC 4180 writes them: a cell in quotes may hold the
 * delimiter, a line break, and a quote written twice. Only the first rows and columns are
 * kept, and reading stops there, so a long file costs no more than a short one. `whole` says
 * whether `text` is all of the file: of one that is only its start, the last row may be half a
 * row, and is left out.
 */
export function parseDelimited(
  text: string,
  delimiter: "," | "\t",
  options: { rows?: number; columns?: number; whole?: boolean } = {},
): DelimitedTable {
  const most = options.rows ?? TABLE_ROWS
  const widest = options.columns ?? TABLE_COLUMNS
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  let cut = false
  let ended = true
  // The mark some files start with is not part of the first cell.
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const endCell = () => {
    if (row.length < widest) row.push(cell)
    else cut = true
    cell = ""
  }
  const endRow = () => {
    endCell()
    // A line with nothing on it is not a row.
    if (row.length > 1 || row[0] !== "") rows.push(row)
    row = []
    ended = true
  }
  for (; at < text.length; at++) {
    if (rows.length >= most) {
      cut = true
      break
    }
    const char = text[at]!
    ended = false
    if (quoted) {
      if (char !== '"') cell += char
      else if (text[at + 1] === '"') {
        cell += '"'
        at++
      } else quoted = false
    } else if (char === '"' && cell === "") quoted = true
    else if (char === delimiter) endCell()
    else if (char === "\n") endRow()
    else if (char === "\r") {
      if (text[at + 1] === "\n") at++
      endRow()
    } else cell += char
  }
  if (!ended && rows.length < most) {
    if (options.whole === false) cut = true
    else endRow()
  }
  const width = Math.max(0, ...rows.map((each) => each.length))
  return { rows: rows.map((each) => [...each, ...Array(width - each.length).fill("")]), cut }
}

/** The delimiter a file's name says it has: a tab for `.tsv`, and otherwise a comma. */
export const delimiterOf = (name: string): "," | "\t" =>
  name.toLowerCase().endsWith(".tsv") ? "\t" : ","

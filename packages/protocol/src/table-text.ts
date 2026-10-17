/** How a table's column is set: what its heading cell says. */
export type ColumnAlign = "left" | "center" | "right" | undefined

/** A table as CSV: a cell with a comma, a quote or a line break in it is quoted. */
export function tableCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => (/[",\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell))
        .join(","),
    )
    .join("\n")
}

/** A table as Markdown, its first row the headings. A cell's bars and line breaks cannot stay. */
export function tableMarkdown(
  rows: readonly (readonly string[])[],
  aligns: readonly ColumnAlign[] = [],
): string {
  const [head, ...body] = rows
  if (head === undefined) return ""
  const cell = (text: string) =>
    text
      .replaceAll("|", "\\|")
      .replace(/\s*\n\s*/g, " ")
      .trim()
  const line = (row: readonly string[]) =>
    `| ${head.map((_, at) => cell(row[at] ?? "")).join(" | ")} |`
  const rule = head.map((_, at) =>
    aligns[at] === "center" ? ":-:" : aligns[at] === "right" ? "--:" : "---",
  )
  return [line(head), `| ${rule.join(" | ")} |`, ...body.map(line)].join("\n")
}

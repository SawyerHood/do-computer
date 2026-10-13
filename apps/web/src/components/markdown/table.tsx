import { ArrowsHorizontalIcon, CheckIcon, CopyIcon } from "@phosphor-icons/react"
import { type ComponentProps, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { type ColumnAlign, tableCsv, tableMarkdown } from "./table-text.ts"
import { useCopied } from "./use-copied.ts"

/** What a table on the page says, row by row, and how each of its columns is set. */
function readTable(table: HTMLTableElement): { rows: string[][]; aligns: ColumnAlign[] } {
  const rows = [...table.rows].map((row) =>
    [...row.cells].map((cell) => (cell.textContent ?? "").trim()),
  )
  const aligns = [...(table.rows[0]?.cells ?? [])].map((cell): ColumnAlign => {
    const align = cell.style.textAlign || cell.getAttribute("align")
    return align === "center" || align === "right" || align === "left" ? align : undefined
  })
  return { rows, aligns }
}

/**
 * A table in Markdown. One wider than the text it is in scrolls sideways by itself, and under
 * it are two buttons: keep each row on one line, for a table whose cells have wrapped into
 * something hard to read across, and copy it, as Markdown or as CSV for a spreadsheet.
 */
export function MarkdownTable({ children, ...props }: ComponentProps<"table">) {
  const table = useRef<HTMLTableElement>(null)
  const [oneLine, setOneLine] = useState(false)
  const [copied, copy] = useCopied()
  const take = (as: "markdown" | "csv") => {
    if (table.current === null) return
    const { rows, aligns } = readTable(table.current)
    copy(as === "csv" ? tableCsv(rows) : tableMarkdown(rows, aligns))
  }
  return (
    <div className="md-table group/table" data-one-line={oneLine || undefined}>
      <div className="md-table-scroll">
        <table ref={table} {...props}>
          {children}
        </table>
      </div>
      <div className="md-table-tools">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-pressed={oneLine}
          aria-label="Keep each row on one line"
          title={oneLine ? "Let cells wrap" : "Keep each row on one line"}
          className={oneLine ? "bg-muted text-foreground" : undefined}
          onClick={() => setOneLine((now) => !now)}
        >
          <ArrowsHorizontalIcon />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={copied ? "Copied" : "Copy table"}
                title="Copy table"
              />
            }
          >
            {copied ? <CheckIcon weight="bold" /> : <CopyIcon />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-40">
            <DropdownMenuItem onClick={() => take("markdown")}>Copy as Markdown</DropdownMenuItem>
            <DropdownMenuItem onClick={() => take("csv")}>Copy as CSV</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

import { type DelimitedTable, TABLE_COLUMNS } from "@/lib/delimited"
import { cn } from "@/lib/utils"

/**
 * The rows of a CSV or TSV file as a table: its first row the headings, which stay in place
 * while the rest scrolls under them. Figures are set to line up.
 */
export function RowsTable({
  table,
  name,
  className,
}: {
  table: DelimitedTable
  name: string
  className?: string
}) {
  const [head, ...body] = table.rows
  if (head === undefined) {
    return <p className="px-1 text-sm text-muted-foreground">{name} has no rows in it.</p>
  }
  return (
    // As wide as the table, up to the room there is: a narrow one is not set in a wide box.
    <div className={cn("w-fit max-w-full overflow-auto", className)}>
      <table aria-label={name} className="border-separate border-spacing-0 text-sm tabular-nums">
        <thead>
          <tr>
            {head.map((cell, column) => (
              <th
                // biome-ignore lint/suspicious/noArrayIndexKey: a column is known by its place
                key={column}
                scope="col"
                className="sticky top-0 z-1 max-w-80 border-b border-input bg-surface px-3 py-1.5 text-left align-bottom font-medium whitespace-pre-wrap text-muted-foreground"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a row is known by its place
            <tr key={at} className="[&:last-child>td]:border-b-0">
              {row.map((cell, column) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: as above
                  key={column}
                  className={cn(
                    "max-w-80 border-b border-border px-3 py-1.5 align-top wrap-anywhere whitespace-pre-wrap",
                    // A figure is set against the right, as figures are.
                    /^[-+($€£]?[\d.,\s]+[%)]?$/.test(cell) && /\d/.test(cell) && "text-right",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** What is said under a table that is not all of its file. */
export function CutNote({ table }: { table: DelimitedTable }) {
  return table.cut ? (
    <p className="px-1 pt-1.5 text-xs text-muted-foreground">
      Showing the first {Math.max(0, table.rows.length - 1)} rows
      {(table.rows[0]?.length ?? 0) >= TABLE_COLUMNS ? ` and ${TABLE_COLUMNS} columns` : ""}.
    </p>
  ) : null
}

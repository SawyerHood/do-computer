import {
  type DelimitedTable,
  delimiterOf,
  type LibraryFile,
  parseDelimited,
} from "@do-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { ScrollView, StyleSheet, View } from "react-native"
import { radius, space, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Text } from "@/ui"
import { useChatScope } from "./shared"

/** How much of a table's file is asked for to draw its first rows. */
const TABLE_BYTES = 256 * 1024

/** The most of a table that is drawn in a chat on a phone: past this it is a file to open. */
const ROWS = 25
const COLUMNS = 12

/** The widest and narrowest a column is drawn, and about how wide a letter is: as a reply's own tables. */
const COLUMN = { min: 64, max: 240, letter: 8, padding: 26 }

/** The first rows of a CSV or TSV file of the library. Only the start of a long one is asked for. */
function useRows(file: LibraryFile, view: string) {
  const { agentId } = useChatScope()
  const { client } = useSession()
  return useQuery({
    // A revision's rows never change, and the address they are asked at is not what they are.
    queryKey: ["agents", agentId, "library", "rows", file.id, file.rev],
    queryFn: async (): Promise<DelimitedTable> => {
      const response = await fetch(
        `${client.agent(agentId).libraryViewUrl(view, file.path)}?v=${file.rev}`,
        { headers: { range: `bytes=0-${TABLE_BYTES - 1}` } },
      )
      if (!response.ok) throw new Error(`${file.name} could not be read.`)
      return parseDelimited(await response.text(), delimiterOf(file.name), {
        // The headings, and then as many rows as are drawn.
        rows: ROWS + 1,
        columns: COLUMNS,
        whole: response.status !== 206 || file.size <= TABLE_BYTES,
      })
    },
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * A table file's first rows, in the look of a table written in a reply: its first row the
 * headings, each column as wide as its longest cell, and the whole scrolling sideways when it
 * is wider than the page. A cell is shown as it is written, not read as Markdown.
 */
export function Rows({ file, view }: { file: LibraryFile; view: string }) {
  const theme = useTheme()
  const { data: table, isError } = useRows(file, view)
  const widths = useMemo(
    () =>
      (table?.rows[0] ?? []).map((_, column) => {
        const longest = table!.rows.reduce((most, row) => Math.max(most, row[column]!.length), 0)
        return Math.min(COLUMN.max, Math.max(COLUMN.min, longest * COLUMN.letter + COLUMN.padding))
      }),
    [table],
  )
  if (isError) {
    return (
      <Text variant="subhead" tone="ink2">
        {file.name} could not be read.
      </Text>
    )
  }
  // Until the rows are here it holds a little room, so that what is under it moves less.
  if (table === undefined) {
    return <View style={[styles.waiting, { backgroundColor: theme.fill }]} />
  }
  if (table.rows.length === 0) {
    return (
      <Text variant="subhead" tone="ink2">
        {file.name} has no rows in it.
      </Text>
    )
  }
  return (
    <View style={styles.whole}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel={file.name}
        style={[styles.table, { borderColor: theme.sep }]}
      >
        <View>
          {table.rows.map((row, at) => (
            <View
              key={at}
              style={[
                styles.row,
                { borderTopColor: theme.sep },
                at === 0 ? { backgroundColor: theme.fill } : styles.rowRule,
              ]}
            >
              {row.map((cell, column) => (
                <View
                  key={column}
                  style={[
                    styles.cell,
                    { width: widths[column], borderLeftColor: theme.sep },
                    column > 0 ? styles.cellRule : null,
                  ]}
                >
                  <Text
                    variant="subhead"
                    weight={at === 0 ? "600" : undefined}
                    selectable
                    // A figure is set against the right, as figures are.
                    style={at > 0 && isFigure(cell) ? styles.figure : null}
                  >
                    {cell}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {table.cut ? (
        <Text variant="footnote" tone="ink2">
          Showing the first {Math.max(0, table.rows.length - 1)} rows
          {(table.rows[0]?.length ?? 0) >= COLUMNS ? ` and ${COLUMNS} columns` : ""}.
        </Text>
      ) : null}
    </View>
  )
}

const isFigure = (cell: string) => /^[-+($€£]?[\d.,\s]+[%)]?$/.test(cell) && /\d/.test(cell)

const styles = StyleSheet.create({
  whole: { gap: space(1.5), maxWidth: "100%" },
  waiting: { height: 96, width: 240, maxWidth: "100%", borderRadius: radius.sm },
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
  figure: { textAlign: "right", fontVariant: ["tabular-nums"] },
})

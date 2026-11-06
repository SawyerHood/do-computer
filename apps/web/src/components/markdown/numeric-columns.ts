/** Infer only unambiguous numeric columns, leaving prose and authored alignment alone. */
export function numericColumns(rows: readonly (readonly string[])[]): number[] {
  const count = Math.max(0, ...rows.map((row) => row.length))
  return Array.from({ length: count }, (_, column) => column).filter((column) => {
    const values = rows.map((row) => row[column]?.trim() ?? '').filter(Boolean)
    return values.length > 0 && values.every((value) =>
      /^[+−-]?[$€£¥]?\s*\d[\d,.]*(?:\s*(?:%|[a-zA-Z]{1,8}))?$/.test(value),
    )
  })
}

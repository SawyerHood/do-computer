import { describe, expect, it } from "vitest"
import { delimiterOf, parseDelimited } from "../src/delimited.ts"

describe("a CSV file as rows", () => {
  it("reads cells, with what quotes hold kept whole", () => {
    const table = parseDelimited(
      'name,note,count\r\nAda,"said ""hi"", twice",2\nBo,"two\nlines",10\n',
      ",",
    )
    expect(table).toEqual({
      rows: [
        ["name", "note", "count"],
        ["Ada", 'said "hi", twice', "2"],
        ["Bo", "two\nlines", "10"],
      ],
      cut: false,
    })
  })

  it("reads a last row with no line break after it, and skips empty lines", () => {
    expect(parseDelimited("a,b\n\n1,2", ",").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
  })

  it("makes every row as wide as the widest, and drops the mark a file may start with", () => {
    expect(parseDelimited("﻿a,b,c\n1\n1,2,3,4", ",").rows).toEqual([
      ["a", "b", "c", ""],
      ["1", "", "", ""],
      ["1", "2", "3", "4"],
    ])
  })

  it("reads tabs for a TSV, where a comma is only a comma", () => {
    expect(delimiterOf("Sales.TSV")).toBe("\t")
    expect(delimiterOf("sales.csv")).toBe(",")
    expect(parseDelimited("a\tb, c\n1\t2", "\t").rows).toEqual([
      ["a", "b, c"],
      ["1", "2"],
    ])
  })

  it("keeps only the first rows and columns, and says there was more", () => {
    const long = Array.from({ length: 50 }, (_, row) => `${row},x,y,z`).join("\n")
    const table = parseDelimited(long, ",", { rows: 10, columns: 2 })
    expect(table.rows).toHaveLength(10)
    expect(table.rows[9]).toEqual(["9", "x"])
    expect(table.cut).toBe(true)
    expect(parseDelimited("a,b\n1,2", ",", { rows: 10, columns: 2 }).cut).toBe(false)
  })

  it("leaves out the last row of a file it was given only the start of", () => {
    const table = parseDelimited("a,b\n1,2\n3,", ",", { whole: false })
    expect(table.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
    expect(table.cut).toBe(true)
  })
})

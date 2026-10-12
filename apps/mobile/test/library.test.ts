import type { LibraryFile } from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import {
  applyFormat,
  contentsOf,
  documentName,
  foldersOf,
  kindOf,
  matching,
  parseCsv,
  sharedPathOf,
  tidyPath,
  withPictures,
} from "../src/library/model.ts"

const file = (path: string, size = 10): LibraryFile => ({
  id: path,
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  size,
  contentType: "text/plain",
  source: "user",
  chatId: null,
  createdAt: 0,
  updatedAt: 0,
  updatedBy: "user",
  rev: 1,
})

const files = [
  file("numbers.csv"),
  file("pricing/plan.md"),
  file("pricing/index.html"),
  file("pricing/old/plan-1.md"),
  file("notes/a.md"),
]

describe("the library's model", () => {
  it("lists what is directly inside a folder, folders first by name", () => {
    const top = contentsOf(files, "")
    expect(top.folders).toEqual([
      { name: "notes", path: "notes", count: 1 },
      { name: "pricing", path: "pricing", count: 3 },
    ])
    expect(top.files.map((each) => each.name)).toEqual(["numbers.csv"])
    const pricing = contentsOf(files, "pricing")
    expect(pricing.folders).toEqual([{ name: "old", path: "pricing/old", count: 1 }])
    expect(pricing.files.map((each) => each.name)).toEqual(["index.html", "plan.md"])
  })

  it("does not take a folder for another whose name it begins", () => {
    expect(contentsOf([file("pricing-old/a.md")], "pricing").files).toEqual([])
  })

  it("knows every folder a file can be moved to", () => {
    expect(foldersOf(files)).toEqual(["", "notes", "pricing", "pricing/old"])
  })

  it("filters the whole library by name", () => {
    expect(matching(files, " PLAN ").map((each) => each.path)).toEqual([
      "pricing/old/plan-1.md",
      "pricing/plan.md",
    ])
  })

  it("tells what kind a file is, and gives up on text too large to show", () => {
    expect(kindOf({ name: "a.MD", size: 1 })).toBe("markdown")
    expect(kindOf({ name: "a.pdf", size: 1 })).toBe("pdf")
    expect(kindOf({ name: "a.zip", size: 1 })).toBe("other")
    expect(kindOf({ name: "a.csv", size: 2 * 1024 * 1024 })).toBe("other")
    expect(kindOf({ name: "a.png", size: 9 * 1024 * 1024 })).toBe("image")
  })

  it("shares a folder for its front page, and a file for itself", () => {
    expect(sharedPathOf("pricing/index.html")).toBe("pricing")
    expect(sharedPathOf("index.html")).toBe("index.html")
    expect(sharedPathOf("pricing/plan.md")).toBe("pricing/plan.md")
  })

  it("wraps what is chosen in a format's marks and leaves it chosen", () => {
    expect(applyFormat("a word here", { start: 2, end: 6 }, "**", "**")).toEqual({
      text: "a **word** here",
      selection: { start: 4, end: 8 },
    })
    expect(applyFormat("", { start: 0, end: 0 }, "[", "](https://)")).toEqual({
      text: "[text](https://)",
      selection: { start: 1, end: 5 },
    })
    expect(applyFormat("ab", { start: 9, end: 9 }, "- ", "").text).toBe("ab- text")
  })

  it("reads a CSV's rows, quoted cells and all", () => {
    expect(parseCsv('a,b\r\n"1,5","say ""hi"""\n\n3,4')).toEqual([
      ["a", "b"],
      ["1,5", 'say "hi"'],
      ["3", "4"],
    ])
    expect(parseCsv("a\nb\nc", 2)).toEqual([["a"], ["b"]])
  })

  it("names a new document and tidies a typed path", () => {
    expect(documentName(" Plan ")).toBe("Plan.md")
    expect(documentName("notes.md")).toBe("notes.md")
    expect(documentName("a/b")).toBe("a-b.md")
    expect(documentName("")).toBe("Untitled.md")
    expect(tidyPath(" /pricing// plan.md ")).toBe("pricing/plan.md")
    expect(tidyPath("../x")).toBe("x")
  })

  it("writes a document's own pictures as addresses that show them", () => {
    const paths = new Set(["reports/chart.svg", "logo.png"])
    const url = (path: string) => `https://x/d/${path}`
    expect(
      withPictures(
        "![a](chart.svg) ![b](../logo.png) ![c](https://y/z.png) ![d](gone.png) [e](chart.svg)",
        "reports",
        paths,
        url,
      ),
    ).toBe(
      "![a](https://x/d/reports/chart.svg) ![b](https://x/d/logo.png) ![c](https://y/z.png) ![d](gone.png) [e](chart.svg)",
    )
  })
})

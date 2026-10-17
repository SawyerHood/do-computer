import { describe, expect, it } from "vitest"
import { dirOf, markdownFiles, markdownTargets, pageShownAt, resolveLink } from "../src/index.ts"

describe("where a link from a document leads", () => {
  it("is a place in the library, from the folder the document is in", () => {
    expect(dirOf("notes/2026/plan.md")).toBe("notes/2026")
    expect(dirOf("plan.md")).toBe("")
    expect(resolveLink("notes", "chart.svg")).toBe("notes/chart.svg")
    expect(resolveLink("notes", "./pics/a%20b.png?v=2#top")).toBe("notes/pics/a b.png")
    expect(resolveLink("notes/2026", "../chart.svg")).toBe("notes/chart.svg")
    expect(resolveLink("notes", "/top.png")).toBe("top.png")
  })

  it("is nowhere in the library, for another site, the same page, or above the top", () => {
    for (const href of [
      "https://example.com/a.png",
      "//example.com/a.png",
      "data:image/png;base64,AA",
      "#top",
      "",
      "../../a.png",
      "%E0%A4%A",
    ]) {
      expect(resolveLink("notes", href), href).toBeUndefined()
    }
  })
})

describe("what a Markdown document refers to", () => {
  const text = [
    "# Plan",
    '![chart](chart.svg) and ![wide](<pics/wide shot.png> "Wide")',
    "[the numbers](data.csv) and ![elsewhere](https://example.com/x.png)",
    "![by name][logo] and ![above](../../up.png)",
    "",
    '[logo]: ../brand/logo.png "The logo"',
    "Not one: (parens.png) and [bracket] alone.",
  ].join("\n")

  it("is every picture and link it names, as written", () => {
    expect(markdownTargets(text)).toEqual([
      "chart.svg",
      "pics/wide shot.png",
      "data.csv",
      "https://example.com/x.png",
      "../../up.png",
      "../brand/logo.png",
    ])
  })

  it("is the files of the library those lead to", () => {
    expect([...markdownFiles("notes/plan.md", text)].sort()).toEqual([
      "brand/logo.png",
      "notes/chart.svg",
      "notes/data.csv",
      "notes/pics/wide shot.png",
    ])
    // From the top of the library, nothing is above it.
    expect([...markdownFiles("plan.md", "![a](../a.png) ![b](b.png)")]).toEqual(["b.png"])
  })
})

describe("when a page last changed as it is seen", () => {
  const at = (path: string, updatedAt: number) => ({ path, updatedAt })

  it("is when anything in its top folder last changed, since a page shows what is beside it", () => {
    const files = [at("boards/launch.html", 1), at("boards/data/tasks.json", 5), at("other.md", 9)]
    expect(pageShownAt(files, files[0]!)).toBe(5)
  })

  it("is when anything in the library changed, for a page at the top", () => {
    const files = [at("index.html", 1), at("notes/plan.md", 7)]
    expect(pageShownAt(files, files[0]!)).toBe(7)
  })
})

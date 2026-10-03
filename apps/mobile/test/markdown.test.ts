import { describe, expect, it, vi } from "vitest"

// The parsers are plain functions; the rendering half of the module needs a device.
vi.mock("react-native", () => ({
  Platform: { select: () => "" },
  StyleSheet: { create: (s: unknown) => s },
}))
vi.mock("@/lib/theme", () => ({ radius: {}, space: () => 0, useTheme: () => ({}) }))

const { parseBlocks, parseInline } = await import("../src/components/markdown.tsx")

describe("mobile Markdown", () => {
  it("splits a reply into blocks", () => {
    const blocks = parseBlocks(
      "# Plan\n\nFirst line\nsecond line\n\n- one\n- two\n\n1. a\n2) b\n\n> quoted\n> more\n\n```js\nconst x = 1\n\nx\n```\ntail",
    )
    expect(blocks).toEqual([
      { type: "heading", level: 1, text: "Plan" },
      { type: "paragraph", text: "First line\nsecond line" },
      { type: "list", ordered: false, items: ["one", "two"] },
      { type: "list", ordered: true, items: ["a", "b"] },
      { type: "quote", text: "quoted\nmore" },
      { type: "code", text: "const x = 1\n\nx" },
      { type: "paragraph", text: "tail" },
    ])
  })

  it("keeps an unfinished code fence as code, as it is while a reply streams", () => {
    expect(parseBlocks("Here:\n```sh\nls -la")).toEqual([
      { type: "paragraph", text: "Here:" },
      { type: "code", text: "ls -la" },
    ])
  })

  it("reads inline emphasis, code and links, and leaves stray markers alone", () => {
    expect(parseInline("a **bold** and *it* with `code` and [site](https://x.dev).")).toEqual([
      { text: "a " },
      { text: "bold", bold: true },
      { text: " and " },
      { text: "it", italic: true },
      { text: " with " },
      { text: "code", code: true },
      { text: " and " },
      { text: "site", href: "https://x.dev" },
      { text: "." },
    ])
    expect(parseInline("2 * 3 * 4 and snake_case")).toEqual([{ text: "2 * 3 * 4 and snake_case" }])
    expect(parseInline("set OPENROUTER_API_KEY and _really_ mean it")).toEqual([
      { text: "set OPENROUTER_API_KEY and " },
      { text: "really", italic: true },
      { text: " mean it" },
    ])
    expect(parseInline("")).toEqual([])
  })
})

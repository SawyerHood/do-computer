import { describe, expect, it, vi } from "vitest"

// The parsers are plain functions; the rendering half of the module needs a device.
vi.mock("react-native", () => ({
  Platform: { select: () => "" },
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
}))
vi.mock("@/lib/theme", () => ({
  mono: "",
  radius: {},
  space: () => 0,
  type: {},
  useTheme: () => ({}),
}))
vi.mock("expo-clipboard", () => ({ setStringAsync: async () => true }))
vi.mock("expo-image", () => ({ Image: () => null }))
vi.mock("@/ui/haptics", () => ({ haptic: { done: () => {} } }))
vi.mock("@/ui/icon", () => ({ Icon: () => null }))
vi.mock("@/ui/menu", () => ({ Menu: () => null }))

const { parseBlocks, parseInline } = await import("../src/ui/markdown.tsx")

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
      { type: "code", text: "const x = 1\n\nx", lang: "js" },
      { type: "paragraph", text: "tail" },
    ])
  })

  it("keeps an unfinished code fence as code, as it is while a reply streams", () => {
    expect(parseBlocks("Here:\n```sh\nls -la")).toEqual([
      { type: "paragraph", text: "Here:" },
      { type: "code", text: "ls -la", lang: "sh", open: true },
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

describe("mobile Markdown: blocks", () => {
  it("reads fenced code with either fence and its language", () => {
    expect(parseBlocks("~~~python\nprint('```')\n~~~\n\n```\nplain\n```")).toEqual([
      { type: "code", text: "print('```')", lang: "python" },
      { type: "code", text: "plain" },
    ])
    // A longer fence holds a shorter one, and the fence's own indent is taken off its lines.
    expect(parseBlocks("````md\n```js\nx\n```\n````")).toEqual([
      { type: "code", text: "```js\nx\n```", lang: "md" },
    ])
    expect(parseBlocks("  ```ts title=a.ts\n  const a = 1\n    b\n  ```")).toEqual([
      { type: "code", text: "const a = 1\n  b", lang: "ts" },
    ])
  })

  it("reads headings of every level, closing hashes and underlined headings", () => {
    expect(parseBlocks("###### Six\n## Two ##\n#hashtag\n#")).toEqual([
      { type: "heading", level: 6, text: "Six" },
      { type: "heading", level: 2, text: "Two" },
      { type: "paragraph", text: "#hashtag" },
      { type: "heading", level: 1, text: "" },
    ])
    expect(parseBlocks("Title\n===\n\nPart\nof it\n---\nbody")).toEqual([
      { type: "heading", level: 1, text: "Title" },
      { type: "heading", level: 2, text: "Part\nof it" },
      { type: "paragraph", text: "body" },
    ])
  })

  it("reads horizontal rules", () => {
    expect(parseBlocks("---\n\n***\n___\n- - -\nabove\n\n* * *")).toEqual([
      { type: "rule" },
      { type: "rule" },
      { type: "rule" },
      { type: "rule" },
      { type: "paragraph", text: "above" },
      { type: "rule" },
    ])
  })

  it("reads a table with its alignment, and evens out its rows", () => {
    const source =
      "Costs:\n| Item | Price | Note |\n|:--|--:|:-:|\n| Tea | 2 | hot \\| iced |\n| Bun |\nafter"
    expect(parseBlocks(source)).toEqual([
      { type: "paragraph", text: "Costs:" },
      {
        type: "table",
        head: ["Item", "Price", "Note"],
        align: ["left", "right", "center"],
        rows: [
          ["Tea", "2", "hot | iced"],
          ["Bun", "", ""],
        ],
      },
      { type: "paragraph", text: "after" },
    ])
    expect(parseBlocks("a | b\n--- | ---\n1 | 2 | 3")).toEqual([
      { type: "table", head: ["a", "b"], align: [null, null], rows: [["1", "2"]] },
    ])
    // Pipes in running text are not a table.
    expect(parseBlocks("a | b\nc | d")).toEqual([{ type: "paragraph", text: "a | b\nc | d" }])
  })

  it("shows a table from its header on, while the rest is still arriving", () => {
    const head = { type: "table", head: ["a", "b"], align: [null, null], rows: [] }
    expect(parseBlocks("| a | b |")).toEqual([head])
    expect(parseBlocks("| a | b |\n")).toEqual([head])
    expect(parseBlocks("| a | b |\n|")).toEqual([head])
    expect(parseBlocks("| a | b |\n|--")).toEqual([head])
    expect(parseBlocks("| a | b |\n|---|")).toEqual([head])
    expect(parseBlocks("| a | b |\n|---|---|\n| 1")).toEqual([{ ...head, rows: [["1", ""]] }])
    // With something else under it, a boxed line is only a line.
    expect(parseBlocks("| a | b |\nnot dashes")).toEqual([
      { type: "paragraph", text: "| a | b |\nnot dashes" },
    ])
  })

  it("reads task lists", () => {
    expect(
      parseBlocks("- [ ] buy tea\n- [x] boil water\n- [X] pour\n- plain\n- [link](x)"),
    ).toEqual([
      {
        type: "list",
        ordered: false,
        items: ["buy tea", "boil water", "pour", "plain", "[link](x)"],
        checked: [false, true, true, null, null],
      },
    ])
    expect(parseBlocks("1. [ ]")).toEqual([
      { type: "list", ordered: true, items: [""], checked: [false] },
    ])
  })

  it("keeps a numbered list's own numbers", () => {
    expect(parseBlocks("3. three\n4. four")).toEqual([
      { type: "list", ordered: true, items: ["three", "four"], start: 3 },
    ])
    // A number in the middle of a paragraph does not start a list; a bullet or a 1 does.
    expect(parseBlocks("It was\n1986. A good year\n- yes\n")).toEqual([
      { type: "paragraph", text: "It was\n1986. A good year" },
      { type: "list", ordered: false, items: ["yes"] },
    ])
  })

  it("nests lists by indentation, to any depth and of either kind", () => {
    const source = [
      "1. first",
      "   - inner a",
      "     1. deep",
      "   - inner b",
      "2. second",
      "  - two spaces is enough",
      "- a new list",
    ].join("\n")
    expect(parseBlocks(source)).toEqual([
      {
        type: "list",
        ordered: true,
        items: ["first", "second"],
        children: [
          [
            {
              type: "list",
              ordered: false,
              items: ["inner a", "inner b"],
              children: [[{ type: "list", ordered: true, items: ["deep"] }], []],
            },
          ],
          [{ type: "list", ordered: false, items: ["two spaces is enough"] }],
        ],
      },
      { type: "list", ordered: false, items: ["a new list"] },
    ])
  })

  it("lets an item hold several lines, paragraphs and other blocks", () => {
    const source = [
      "- first line",
      "carried on",
      "",
      "  second paragraph",
      "",
      "  ```sh",
      "  ls",
      "",
      "  pwd",
      "  ```",
      "  > said",
      "",
      "- next",
      "",
      "after the list",
    ].join("\n")
    expect(parseBlocks(source)).toEqual([
      {
        type: "list",
        ordered: false,
        items: ["first line\ncarried on", "next"],
        children: [
          [
            { type: "paragraph", text: "second paragraph" },
            { type: "code", text: "ls\n\npwd", lang: "sh" },
            { type: "quote", text: "said" },
          ],
          [],
        ],
      },
      { type: "paragraph", text: "after the list" },
    ])
    // An item may begin with something that is not a paragraph.
    expect(parseBlocks("- ```js\n  x\n  ```\n- # Head")).toEqual([
      {
        type: "list",
        ordered: false,
        items: ["", ""],
        children: [
          [{ type: "code", text: "x", lang: "js" }],
          [{ type: "heading", level: 1, text: "Head" }],
        ],
      },
    ])
  })

  it("keeps a quote's Markdown, to be read as blocks of its own", () => {
    const [quote, after] = parseBlocks(
      "> # Title\n> - a\n>   - b\n>\n> > deeper\n> text\ncarried\n\nout",
    )
    expect(quote).toEqual({ type: "quote", text: "# Title\n- a\n  - b\n\n> deeper\ntext\ncarried" })
    expect(after).toEqual({ type: "paragraph", text: "out" })
    expect(parseBlocks(quote?.type === "quote" ? quote.text : "")).toEqual([
      { type: "heading", level: 1, text: "Title" },
      {
        type: "list",
        ordered: false,
        items: ["a"],
        children: [[{ type: "list", ordered: false, items: ["b"] }]],
      },
      { type: "quote", text: "deeper\ntext\ncarried" },
    ])
    // Code in a quote ends with the quote, closed or not.
    expect(parseBlocks("> ```\n> code\nnot quoted")).toEqual([
      { type: "quote", text: "```\ncode" },
      { type: "paragraph", text: "not quoted" },
    ])
  })

  it("takes pictures on the web out of a paragraph, and leaves any other as text", () => {
    expect(
      parseBlocks('Look: ![A cat](https://x.dev/cat.png "Cat") nice\n![](http://x.dev/b.gif)'),
    ).toEqual([
      { type: "paragraph", text: "Look:" },
      { type: "image", alt: "A cat", src: "https://x.dev/cat.png" },
      { type: "paragraph", text: "nice" },
      { type: "image", alt: "", src: "http://x.dev/b.gif" },
    ])
    expect(parseBlocks("[![Build **ok**](https://x.dev/badge.svg)](https://x.dev/ci)")).toEqual([
      { type: "image", alt: "Build ok", src: "https://x.dev/badge.svg", href: "https://x.dev/ci" },
    ])
    const local = "![chart](file:///tmp/chart.png) and `![code](https://x.dev/a.png)`"
    expect(parseBlocks(local)).toEqual([{ type: "paragraph", text: local }])
    expect(parseInline(local)).toEqual([
      { text: "chart and " },
      { text: "![code](https://x.dev/a.png)", code: true },
    ])
    expect(parseBlocks("- ![in a list](https://x.dev/a.png)")).toEqual([
      {
        type: "list",
        ordered: false,
        items: [""],
        children: [[{ type: "image", alt: "in a list", src: "https://x.dev/a.png" }]],
      },
    ])
  })

  it("takes every picture out for a caller that knows where pictures are", () => {
    expect(
      parseBlocks("See ![The chart](charts/q3.png) and ![](data:image/png;base64,AA==)", true),
    ).toEqual([
      { type: "paragraph", text: "See" },
      { type: "image", alt: "The chart", src: "charts/q3.png" },
      { type: "paragraph", text: "and" },
      { type: "image", alt: "", src: "data:image/png;base64,AA==" },
    ])
    expect(parseBlocks("- ![A sound](chime.wav)\n\n  ![rows](signups.csv)", true)).toEqual([
      {
        type: "list",
        ordered: false,
        items: [""],
        children: [
          [
            { type: "image", alt: "A sound", src: "chime.wav" },
            { type: "image", alt: "rows", src: "signups.csv" },
          ],
        ],
      },
    ])
    // What is written as code is still code.
    expect(parseBlocks("`![code](a.png)`", true)).toEqual([
      { type: "paragraph", text: "`![code](a.png)`" },
    ])
  })

  it("shows raw HTML as the text it is", () => {
    const html = '<div onclick="x()">hi</div>\n<script>alert(1)</script>'
    expect(parseBlocks(html)).toEqual([{ type: "paragraph", text: html }])
    expect(parseInline("a <b>bold</b> <img src=x>")).toEqual([
      { text: "a <b>bold</b> <img src=x>" },
    ])
  })

  it("reads Windows line ends and tabs", () => {
    expect(parseBlocks("- a\r\n\t- b\r\n\r\ntext")).toEqual([
      {
        type: "list",
        ordered: false,
        items: ["a"],
        children: [[{ type: "list", ordered: false, items: ["b"] }]],
      },
      { type: "paragraph", text: "text" },
    ])
  })
})

describe("mobile Markdown: inline", () => {
  it("reads strike-through, and leaves single tildes alone", () => {
    expect(parseInline("~~gone~~ and ~5 or ~so~")).toEqual([
      { text: "gone", strike: true },
      { text: " and ~5 or ~so~" },
    ])
  })

  it("nests emphasis, code and links inside each other", () => {
    expect(parseInline("**bold [link](https://x.dev) and `code`**")).toEqual([
      { text: "bold ", bold: true },
      { text: "link", bold: true, href: "https://x.dev" },
      { text: " and ", bold: true },
      { text: "code", bold: true, code: true },
    ])
    expect(parseInline("*see [**the** docs](https://x.dev/a_(b)) now*")).toEqual([
      { text: "see ", italic: true },
      { text: "the", italic: true, bold: true, href: "https://x.dev/a_(b)" },
      { text: " docs", italic: true, href: "https://x.dev/a_(b)" },
      { text: " now", italic: true },
    ])
    expect(parseInline("***both*** __strong__ ~~*gone*~~")).toEqual([
      { text: "both", bold: true, italic: true },
      { text: " " },
      { text: "strong", bold: true },
      { text: " " },
      { text: "gone", strike: true, italic: true },
    ])
    // A mark that closed nothing, inside a pair, does not stop a later pair being found.
    expect(parseInline("~~a b* c d~~*e*")).toEqual([
      { text: "a b* c d", strike: true },
      { text: "e", italic: true },
    ])
    expect(parseInline("**a *b* c** and *x **y***")).toEqual([
      { text: "a ", bold: true },
      { text: "b", bold: true, italic: true },
      { text: " c", bold: true },
      { text: " and " },
      { text: "x ", italic: true },
      { text: "y", italic: true, bold: true },
    ])
  })

  it("links bare web addresses, without the mark that ends the sentence", () => {
    expect(
      parseInline("See https://x.dev/a?b=1. Or (http://y.dev/p_(q)), <https://z.dev>!"),
    ).toEqual([
      { text: "See " },
      { text: "https://x.dev/a?b=1", href: "https://x.dev/a?b=1" },
      { text: ". Or (" },
      { text: "http://y.dev/p_(q)", href: "http://y.dev/p_(q)" },
      { text: "), " },
      { text: "https://z.dev", href: "https://z.dev" },
      { text: "!" },
    ])
    expect(parseInline("**https://x.dev** <me@x.dev> xhttps://no.dev https://")).toEqual([
      { text: "https://x.dev", bold: true, href: "https://x.dev" },
      { text: " " },
      { text: "me@x.dev", href: "mailto:me@x.dev" },
      { text: " xhttps://no.dev https://" },
    ])
    // An address that is a link's own text is one link, to where the link goes.
    expect(parseInline("[https://x.dev](https://y.dev 'title')")).toEqual([
      { text: "https://x.dev", href: "https://y.dev" },
    ])
    expect(parseInline("[](https://x.dev) [a](<https://x.dev/a b>)")).toEqual([
      { text: "https://x.dev", href: "https://x.dev" },
      { text: " " },
      { text: "a", href: "https://x.dev/a b" },
    ])
  })

  it("takes a backslash as making the next mark plain", () => {
    expect(parseInline("\\*not\\* \\_it\\_ \\`code\\` \\[x\\](y) 1\\. C:\\dir \\")).toEqual([
      { text: "*not* _it_ `code` [x](y) 1. C:\\dir \\" },
    ])
  })

  it("reads code spans with backticks inside, and marks inside code as plain", () => {
    expect(parseInline("``a `b` c`` and `**x**` and ` `` `")).toEqual([
      { text: "a `b` c", code: true },
      { text: " and " },
      { text: "**x**", code: true },
      { text: " and " },
      { text: "``", code: true },
    ])
  })

  it("makes a new line a space, unless it is asked for", () => {
    expect(parseInline("one\ntwo  \nthree\\\nfour")).toEqual([{ text: "one two\nthree\nfour" }])
    expect(parseInline("one\ntwo", true)).toEqual([{ text: "one\ntwo" }])
  })

  it("leaves half-written marks as typed", () => {
    expect(parseInline("an **unclosed bold")).toEqual([{ text: "an **unclosed bold" }])
    expect(parseInline("*a ~~b")).toEqual([{ text: "*a ~~b" }])
    expect(parseInline("some `code")).toEqual([{ text: "some `code" }])
    expect(parseInline("a [link](https://x.de")).toEqual([
      { text: "a [link](" },
      { text: "https://x.de", href: "https://x.de" },
    ])
    expect(parseInline("a [link")).toEqual([{ text: "a [link" }])
    expect(parseInline("![pic](https://x")).toEqual([
      { text: "![pic](" },
      { text: "https://x", href: "https://x" },
    ])
    expect(parseInline("**bold** then **")).toEqual([
      { text: "bold", bold: true },
      { text: " then **" },
    ])
  })
})

describe("mobile Markdown: a reply as it arrives", () => {
  const reply = [
    "# Report",
    "",
    "Some **bold** text with a [link](https://x.dev) and `code`.",
    "",
    "1. one",
    "   - [x] nested task",
    "   - [ ] another",
    "2. two",
    "",
    "> quoted *text*",
    "> ```js",
    "> let a = 1",
    "> ```",
    "",
    "| a | b |",
    "|---|:-:|",
    "| 1 | ~~2~~ |",
    "",
    "![pic](https://x.dev/p.png)",
    "",
    "~~~",
    "code",
    "~~~",
    "",
    "---",
    "the end",
  ].join("\n")

  it("can be read at every length without throwing", () => {
    const texts = (blocks: ReturnType<typeof parseBlocks>): string[] =>
      blocks.flatMap((block) => {
        if (block.type === "list") return [...block.items, ...(block.children ?? []).flatMap(texts)]
        if (block.type === "table") return [...block.head, ...block.rows.flat()]
        if (block.type === "quote") return texts(parseBlocks(block.text))
        if (block.type === "paragraph" || block.type === "heading") return [block.text]
        return []
      })
    for (let length = 0; length <= reply.length; length++) {
      const blocks = parseBlocks(reply.slice(0, length))
      for (const text of texts(blocks)) parseInline(text)
    }
    expect(parseBlocks(reply).map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "quote",
      "table",
      "image",
      "code",
      "rule",
      "paragraph",
    ])
  })

  it("leaves the blocks before the last one as they were when more text arrives", () => {
    // What lets a block that is already written not be drawn again.
    const cut = reply.indexOf("| a | b |")
    const before = parseBlocks(reply.slice(0, cut))
    const after = parseBlocks(reply)
    expect(after.slice(0, before.length)).toEqual(before)
  })

  it("survives marks piled up with nothing to close them", () => {
    // What comes before the pile is still read, which it would not be had the reading given up.
    const pile = "[".repeat(3000) + "*_".repeat(3000) + "`".repeat(501) + "![".repeat(2000)
    expect(parseInline(`**b** ${pile}`)[0]).toEqual({ text: "b", bold: true })
    expect(parseInline(`${"a* ".repeat(5000)}**b**`).at(-1)).toEqual({ text: "b", bold: true })
    expect(parseInline(`${"[a](".repeat(5000)} **b**`).at(-1)).toEqual({ text: "b", bold: true })
    expect(parseBlocks(`# h\n\n${pile}`).map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
    ])
    // Past a depth, what is nested is kept as the text it is.
    const deep = Array.from({ length: 200 }, (_, at) => `${"  ".repeat(at)}- ${at}`).join("\n")
    let levels = 0
    for (let block = parseBlocks(deep)[0]; block?.type === "list"; levels++) {
      block = block.children?.[0]?.[0]
    }
    expect(levels).toBe(9)
    expect(parseBlocks(`${">".repeat(5000)} deep`)).toEqual([
      { type: "quote", text: `${">".repeat(4999)} deep` },
    ])
  })

  it("says a block of code is still being written until the reply shuts it", () => {
    expect(parseBlocks("```ts\nconst a = 1")).toEqual([
      { type: "code", text: "const a = 1", lang: "ts", open: true },
    ])
    expect(parseBlocks("```ts\nconst a = 1\n```")).toEqual([
      { type: "code", text: "const a = 1", lang: "ts" },
    ])
  })

  it("reads a quote that begins with one of GitHub's marks as a note of that kind", () => {
    expect(parseBlocks("> [!WARNING]\n> Mind the gap.")).toEqual([
      { type: "quote", text: "Mind the gap.", alert: "warning" },
    ])
    expect(parseBlocks("> [!tip] \n> Short.\n> More.")).toEqual([
      { type: "quote", text: "Short.\nMore.", alert: "tip" },
    ])
    // A mark that is not alone on its line is only words.
    expect(parseBlocks("> [!NOTE] and so on")).toEqual([
      { type: "quote", text: "[!NOTE] and so on" },
    ])
  })

  it("reads a section that folds, with its heading and what is inside it", () => {
    const source =
      "Before\n<details>\n<summary>The full log</summary>\n\n- one\n- two\n\n</details>\nAfter"
    expect(parseBlocks(source)).toEqual([
      { type: "paragraph", text: "Before" },
      { type: "details", summary: "The full log", text: "- one\n- two" },
      { type: "paragraph", text: "After" },
    ])
  })

  it("keeps a folding section whole when another is inside it or it was left open", () => {
    const [outer, after] = parseBlocks(
      "<details open><summary>Outer</summary>\n<details>\n<summary>Inner</summary>\nx\n</details>\ny\n</details>\nz",
    )
    expect(outer).toEqual({
      type: "details",
      summary: "Outer",
      text: "<details>\n<summary>Inner</summary>\nx\n</details>\ny",
      open: true,
    })
    expect(after).toEqual({ type: "paragraph", text: "z" })
    // One a reply has not shut yet runs to the end, and has a heading until it is given one.
    expect(parseBlocks("<details>\nstill arriving")).toEqual([
      { type: "details", summary: "Details", text: "still arriving" },
    ])
  })

  it("does not take a closing mark inside code for the end of a folding section", () => {
    const [block, after] = parseBlocks(
      "<details>\n<summary>Code</summary>\n\n```html\n</details>\n```\n\n</details>\nafter",
    )
    expect(block).toMatchObject({ type: "details", text: "```html\n</details>\n```" })
    expect(after).toEqual({ type: "paragraph", text: "after" })
  })
})

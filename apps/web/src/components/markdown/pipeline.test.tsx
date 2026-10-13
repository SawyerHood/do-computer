import { renderToStaticMarkup } from "react-dom/server"
import ReactMarkdown from "react-markdown"
import { describe, expect, it } from "vitest"
import { endsInOpenFence, headingSlug, REHYPE_PLUGINS, REMARK_PLUGINS } from "./pipeline.ts"
import { tableCsv, tableMarkdown } from "./table-text.ts"

const draw = (text: string) =>
  renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
      {text}
    </ReactMarkdown>,
  )

describe("raw HTML in Markdown", () => {
  it("keeps what a document is written with: folding sections, keys, marks, sized pictures", () => {
    const html = draw(
      [
        "<details open><summary>More</summary>",
        "",
        "Press <kbd>Ctrl</kbd> and H<sub>2</sub>O is <mark>wet</mark>.",
        "",
        "</details>",
        "",
        '<img src="https://example.com/a.png" width="120" height="80" alt="A">',
      ].join("\n"),
    )
    expect(html).toContain("<details open")
    expect(html).toContain("<summary>More</summary>")
    expect(html).toContain("<kbd>Ctrl</kbd>")
    expect(html).toContain("<sub>2</sub>")
    expect(html).toContain("<mark>wet</mark>")
    expect(html).toMatch(/<img[^>]*width="120"[^>]*>/)
  })

  it("drops what could run, frame something, or dress the page", () => {
    const html = draw(
      [
        "<script>window.stolen = document.cookie</script>",
        "<style>body { display: none }</style>",
        '<iframe src="https://example.com"></iframe>',
        '<img src="https://example.com/a.png" onerror="steal()" style="position:fixed">',
        '<a href="javascript:steal()" onclick="steal()">press</a>',
        '<form action="https://example.com"><input name="password"><button>Go</button></form>',
        '<object data="x.swf"></object><embed src="x.swf">',
        '<svg onload="steal()"><script>steal()</script></svg>',
      ].join("\n\n"),
    )
    for (const gone of [
      "<script",
      "<style",
      "<iframe",
      "onerror",
      "onclick",
      "onload",
      "javascript:",
      "position:fixed",
      "<form",
      "<button",
      "<object",
      "<embed",
      "<svg",
      'name="password"',
      "steal()",
    ]) {
      expect(html, gone).not.toContain(gone)
    }
    // What was only dressed up is still there, bare.
    expect(html).toContain('<img src="https://example.com/a.png"')
    expect(html).toContain("press")
  })

  it("keeps a document's ids apart from the app's own", () => {
    expect(draw('<h2 id="root">Top</h2>')).toContain('id="user-content-root"')
  })
})

describe("what the app adds to Markdown", () => {
  it("gives a heading GitHub's id, and a second of the same name the next one", () => {
    const html = draw("# Set up\n\n## Set up\n\n### Ça va, d'accord?")
    expect(html).toContain('<h1 id="user-content-set-up">')
    expect(html).toContain('<h2 id="user-content-set-up-1">')
    expect(html).toContain(`id="user-content-${headingSlug("Ça va, d'accord?")}"`)
    expect(headingSlug("Ça va, d'accord?")).toBe("ça-va-daccord")
  })

  it("reads a quote that says what kind of note it is as that note", () => {
    const html = draw("> [!WARNING]\n> Mind the gap.\n\n> [!tip]\n> Short.\n\n> Just a quote.")
    expect(html).toContain('<blockquote data-alert="warning">')
    expect(html).toContain('<blockquote data-alert="tip">')
    expect(html).not.toContain("[!")
    expect(html).toContain("<p>Mind the gap.</p>")
    expect(html).toContain("<p>Short.</p>")
    expect(html).toContain("<blockquote>\n<p>Just a quote.</p>")
    // As on GitHub, the mark is a line of its own: with words after it, it is only words.
    expect(draw("> [!NOTE] and more")).toContain("<blockquote>\n<p>[!NOTE] and more</p>")
    // Only the five kinds there are: a document cannot write any other.
    expect(draw('<blockquote data-alert="mine">x</blockquote>')).not.toContain("data-alert")
  })

  it("marks a picture alone on its line, and not one in a sentence", () => {
    expect(draw("![Chart](chart.png)")).toContain("data-alone")
    expect(draw("[![Chart](chart.png)](https://example.com)")).toContain("data-alone")
    expect(draw("Built ![badge](badge.svg) today")).not.toContain("data-alone")
  })

  it("marks the last block of code, which is the one that may still be being written", () => {
    const html = draw("```js\none\n```\n\ntext\n\n```js\ntwo\n```")
    expect(html.match(/data-last/g)).toHaveLength(1)
    expect(html.indexOf("data-last")).toBeGreaterThan(html.indexOf("one"))
  })

  it("draws a table and a task list as GitHub writes them", () => {
    const html = draw("| a | b |\n| - | -: |\n| 1 | 2 |\n\n- [x] done\n- [ ] to do")
    expect(html).toContain("<table>")
    expect(html).toContain('<td style="text-align:right">2</td>')
    expect(html).toContain('class="contains-task-list"')
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/)
  })
})

describe("a block of code that is still being written", () => {
  it("is one whose fence has not been closed", () => {
    expect(endsInOpenFence("Here:\n\n```ts\nconst a = 1")).toBe(true)
    expect(endsInOpenFence("Here:\n\n```ts\nconst a = 1\n```")).toBe(false)
    expect(endsInOpenFence("```ts\na\n```\n\nand\n\n~~~\nb")).toBe(true)
    // A shorter run of the same mark, or the other mark, does not close it.
    expect(endsInOpenFence("````md\n```\ninner\n```")).toBe(true)
    expect(endsInOpenFence("````md\n```\ninner\n```\n````")).toBe(false)
    expect(endsInOpenFence("```\n~~~")).toBe(true)
    expect(endsInOpenFence("no code at all")).toBe(false)
  })
})

describe("a table, copied", () => {
  const rows = [
    ["Name", "Note", "Count"],
    ["Ada", 'said "hi", twice', "2"],
    ["Bo", "a | b\nnext line", "10"],
  ]

  it("is CSV a spreadsheet reads, with what needs quoting quoted", () => {
    expect(tableCsv(rows)).toBe(
      'Name,Note,Count\nAda,"said ""hi"", twice",2\nBo,"a | b\nnext line",10',
    )
  })

  it("is Markdown again, with its columns set as they were", () => {
    expect(tableMarkdown(rows, [undefined, "center", "right"])).toBe(
      [
        "| Name | Note | Count |",
        "| --- | :-: | --: |",
        '| Ada | said "hi", twice | 2 |',
        "| Bo | a \\| b next line | 10 |",
      ].join("\n"),
    )
  })
})

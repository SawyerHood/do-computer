import { SITE_LISTING_HEADER, type SiteListing } from "@durable-computer/protocol"
import { describe, expect, it } from "vitest"
import { shownAs } from "./site-pages.tsx"

const SANDBOX = "sandbox allow-scripts allow-downloads"

/** The library's answer for a file, as it serves one of a site's. */
const file = (body: string, type: string) =>
  new Response(body, {
    headers: {
      "content-type": type,
      "content-length": String(new TextEncoder().encode(body).length),
      "content-security-policy": SANDBOX,
      etag: '"f.1"',
    },
  })

/** Someone going to an address, or a page there loading it as `dest`. */
const asked = (dest: string | null, query = "") =>
  new Request(`https://app.example/s/abc/~key/thing${query}`, {
    headers: dest === null ? {} : { "sec-fetch-dest": dest },
  })

const what = { title: "Thing", name: "thing.md", own: "thing.md" }
const show = async (answer: Response, dest: string | null = "iframe", query = "") => {
  const response = await shownAs(asked(dest, query), answer, what)
  return { response, text: await response.text() }
}

describe("what a site's address shows", () => {
  it("is a Markdown document as a page to read, apart from the app like any of its pages", async () => {
    const { response, text } = await show(
      file(
        "# Plan\n\n- [x] done\n\n[out](https://example.com) and [beside](other.md)\n\n<script>alert(1)</script>",
        "text/markdown; charset=utf-8",
      ),
    )
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(response.headers.get("content-security-policy")).toBe(SANDBOX)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("etag")).toBeNull()
    expect(text).toContain("<title>Thing</title>")
    expect(text).toContain("<h1>Plan</h1>")
    expect(text).toContain('type="checkbox"')
    // A link out opens in a new tab; one to a file beside it stays where it is.
    expect(text).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">out</a>',
    )
    expect(text).toContain('<a href="other.md">beside</a>')
    // What is written in it is shown, never run.
    expect(text).not.toContain("<script>alert(1)</script>")
    // It is in the app's colors, as a visual is.
    expect(text).toContain("--muted-foreground")
  })

  it("asks for the pictures beside a document shared by itself by their places in the library", async () => {
    const text = "![chart](chart.svg) ![logo](../brand/a%20b.png) ![out](https://example.com/x.png)"
    const alone = await shownAs(asked("iframe"), file(text, "text/markdown"), {
      ...what,
      alone: "notes/plan.md",
    })
    const page = await alone.text()
    expect(page).toContain('<img alt="chart" src="?picture=notes%2Fchart.svg"/>')
    expect(page).toContain('<img alt="logo" src="?picture=brand%2Fa%20b.png"/>')
    expect(page).toContain('<img alt="out" src="https://example.com/x.png"/>')
    // In a shared folder a picture beside the document is at its own address already.
    const within = await show(file(text, "text/markdown"))
    expect(within.text).toContain('<img alt="chart" src="chart.svg"/>')
    // And the picture asked for that way is the picture, to whoever asks.
    const picture = file("<svg/>", "image/svg+xml")
    expect(await shownAs(asked("iframe", "?picture=notes%2Fchart.svg"), picture, what)).toBe(
      picture,
    )
  })

  it("is the file itself for a page that loads it, and for a browser that does not say", async () => {
    for (const dest of ["image", "style", "script", "empty", null]) {
      const { response, text } = await show(file("# Plan", "text/markdown"), dest)
      expect(text, String(dest)).toBe("# Plan")
      expect(response.headers.get("etag")).toBe('"f.1"')
    }
  })

  it("is a page as the page it is", async () => {
    const { response, text } = await show(
      file("<h1>Hi</h1>", "text/html; charset=utf-8"),
      "document",
    )
    expect(text).toBe("<h1>Hi</h1>")
    expect(response.headers.get("etag")).toBe('"f.1"')
  })

  it("is a picture by itself, loaded from its own address", async () => {
    const { text } = await show(file("PNG", "image/png"))
    expect(text).toContain('<img src="thing.md?raw" alt="Thing"/>')
    expect(text).not.toContain("PNG")
    expect((await show(file("x", "video/mp4"))).text).toContain("<video")
    expect((await show(file("x", "audio/mpeg"))).text).toContain("<audio")
  })

  it("is text as text, with nothing in it taken for markup", async () => {
    const { text } = await show(file('a,b\n<b>1</b>,"2"', "text/csv; charset=utf-8"))
    expect(text).toContain("<pre>a,b\n&lt;b&gt;1&lt;/b&gt;,&quot;2&quot;</pre>")
  })

  it("is a download for what cannot be shown, and for text too long to show", async () => {
    const pdf = await show(file("%PDF", "application/pdf"))
    expect(pdf.text).toContain('<a href="?download" download="thing.md">Download</a>')
    expect(pdf.text).toContain("4 B")
    const long = await show(file("x".repeat(1024 * 1024 + 1), "text/plain"))
    expect(long.text).toContain("Download")
    expect(long.text).not.toContain("xxxx")
  })

  it("hands the file over when asked to, under its own name", async () => {
    const { response, text } = await show(file("%PDF", "application/pdf"), "iframe", "?download")
    expect(text).toBe("%PDF")
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''thing.md",
    )
    expect(response.headers.get("content-security-policy")).toBe(SANDBOX)
  })

  it("is a list of a folder's files for someone going there, and nothing for a page", async () => {
    const listing: SiteListing = {
      folder: "pics",
      entries: [
        { name: "deep & wide", kind: "folder" },
        { name: "one <1>.svg", kind: "file", size: 2048, updatedAt: Date.UTC(2026, 9, 11) },
      ],
    }
    const answer = () =>
      Response.json(listing, {
        headers: { [SITE_LISTING_HEADER]: "1", "content-security-policy": SANDBOX },
      })
    const { text } = await show(answer())
    expect(text).toContain("<h1>pics</h1>")
    expect(text).toContain('<a href="../">')
    expect(text).toContain('<a href="deep%20%26%20wide/">')
    expect(text).toContain('<a href="one%20%3C1%3E.svg">')
    expect(text).toContain("one &lt;1&gt;.svg")
    expect(text).toContain("2.0 KB · Oct 11, 2026")
    expect((await show(answer(), "empty")).response.status).toBe(404)
    expect((await show(answer(), null)).response.status).toBe(404)
  })

  it("leaves alone an answer that is not a file: a redirect, or nothing new", async () => {
    const moved = new Response(null, { status: 302, headers: { location: "pics/" } })
    expect(await shownAs(asked("iframe"), moved, what)).toBe(moved)
    const same = new Response(null, { status: 304 })
    expect(await shownAs(asked("image"), same, what)).toBe(same)
  })
})

import { describe, expect, it } from "vitest"
import {
  appThemeCss,
  DOCUMENT_GUIDE,
  PAGE_STYLE_GUIDE,
  PAGE_THEME_CSS,
  PAGE_THEME_VERSION,
  prepareVisual,
  THEME_TOKEN_NAMES,
  THEME_TOKENS,
  themePage,
  themePageBytes,
  VISUAL_GUIDE,
  visualThemeFragment,
  visualThemeMessage,
} from "../src/index.ts"

const STYLE = '<style id="dc-visual-theme">'
const count = (text: string, part: string) => text.split(part).length - 1
const named = (text: string) => [...new Set(text.match(/--[a-z][a-z0-9-]*/g) ?? [])]

describe("the app's look, said once", () => {
  it("has every variable a page is given in light, and in dark where that differs", () => {
    for (const token of THEME_TOKENS) {
      expect(PAGE_THEME_CSS).toContain(`${token.name}:${token.light}`)
      if (token.dark !== undefined) expect(PAGE_THEME_CSS).toContain(`${token.name}:${token.dark}`)
    }
    // Dark is said twice: for a client that says so, and for a page nobody is showing.
    const dark = "--canvas:oklch(0.212 0.004 212)"
    expect(PAGE_THEME_CSS).toContain(`:where(:root[data-dc-theme="dark"]){${dark}`)
    expect(PAGE_THEME_CSS).toContain(
      `@media (prefers-color-scheme:dark){:where(:root:not([data-dc-theme])){${dark}`,
    )
  })

  it("uses nothing that it does not say", () => {
    const used = [...PAGE_THEME_CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1])
    for (const name of new Set(used)) expect(THEME_TOKEN_NAMES).toContain(name)
  })

  it("does nothing to a page that does not use it", () => {
    // Every rule but a visual's own is in `:where()`, which anything a page says itself beats.
    const rules = PAGE_THEME_CSS.replace(/@font-face\{[^}]*\}/g, "")
      .replace(/@media \([^)]*\)\{/g, "")
      .split("}")
      .map((rule) => rule.slice(0, rule.indexOf("{")))
      .filter((selector) => selector !== "")
    const bare = rules.filter((selector) => !selector.startsWith(":where("))
    expect(bare.every((selector) => selector.startsWith(":root[data-dc-page"))).toBe(true)
    // Nothing but variables is set on a page that has not asked for more.
    const everyPage = /^(.*?):where\(:root\[data-dc-page\]\)/.exec(PAGE_THEME_CSS)![1]!
    const set = [...everyPage.replace(/@font-face\{[^}]*\}/g, "").matchAll(/[{;]([a-z-]+):/g)]
    expect(set.filter(([, property]) => !property!.startsWith("--"))).toEqual([])
  })

  it("names the app's own typefaces first, and loads them from the app, not from elsewhere", () => {
    expect(PAGE_THEME_CSS).toContain('--font-sans:"Geist Variable",')
    expect(PAGE_THEME_CSS).toContain("src:url(/theme/geist.woff2)")
    expect(PAGE_THEME_CSS).not.toMatch(/https?:/)
  })

  it("gives a chart's series colors of their own, which no agent's color changes", () => {
    const series = THEME_TOKENS.filter((token) => /^--chart-[1-6]$/.test(token.name))
    expect(series).toHaveLength(6)
    for (const mode of ["light", "dark"] as const) {
      const colors = series.map((token) => /^oklch\(([\d.]+) ([\d.]+) (\d+)\)$/.exec(token[mode]!)!)
      // Dark enough, or light enough, to be seen on the page; vivid enough to be a color.
      for (const [, lightness, chroma] of colors) {
        expect(Number(lightness)).toBeGreaterThanOrEqual(0.5)
        expect(Number(lightness)).toBeLessThanOrEqual(0.67)
        expect(Number(chroma)).toBeGreaterThanOrEqual(0.1)
      }
      // No two of them the same hue, or near it.
      const hues = colors.map(([, , , hue]) => Number(hue)).sort((a, b) => a - b)
      const gaps = hues.map((hue, at) => (hues[(at + 1) % hues.length]! - hue + 360) % 360)
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(40)
    }
    // The same hues in the dark, stepped for it.
    for (const token of series) {
      expect(/ (\d+)\)$/.exec(token.light)![1]).toBe(/ (\d+)\)$/.exec(token.dark!)![1])
    }
  })

  it("is what the app's own stylesheet is written from", () => {
    const css = appThemeCss()
    expect(css).toContain(":root {\n  --agent-color: oklch(0.5 0.08 195);\n")
    expect(css).toContain(".dark {\n  --canvas: oklch(0.212 0.004 212);\n")
    // The app loads its own typefaces, and names them where its other fonts are.
    expect(css).not.toContain("--font-sans")
  })
})

describe("what an agent is told of how a page should look", () => {
  it("names only variables a page is given", () => {
    for (const guide of [PAGE_STYLE_GUIDE, VISUAL_GUIDE, DOCUMENT_GUIDE]) {
      for (const name of named(guide)) expect(THEME_TOKEN_NAMES).toContain(name)
    }
    // And the ones a page is made of.
    expect(named(PAGE_STYLE_GUIDE)).toEqual(
      expect.arrayContaining([
        "--background",
        "--foreground",
        "--muted-foreground",
        "--card",
        "--border",
        "--primary",
        "--primary-foreground",
        "--chart-1",
        "--chart-6",
        "--radius",
        "--font-sans",
      ]),
    )
  })

  it("says how to lay a page out, set its type and space, and keep it readable", () => {
    for (const subject of ["Type:", "Space:", "Contrast:", "Charts:", "Width:", "320px", "CDN"]) {
      expect(PAGE_STYLE_GUIDE).toContain(subject)
    }
  })

  it("tells a visual from a page kept by itself", () => {
    // A visual is part of a reply: nothing around the whole of it.
    expect(VISUAL_GUIDE).toContain("no card, frame or heading banner around the whole page")
    // A document is a page by itself, which asks for the app's page and is read anywhere.
    expect(DOCUMENT_GUIDE).toContain('<html lang="en" data-dc-page>')
    expect(DOCUMENT_GUIDE).toContain("plain black on white")
  })
})

describe("a page as the library serves it", () => {
  it("is given the app's look at the start of its head, and is otherwise as it was written", () => {
    const written =
      "<!doctype html><html lang=en><head><title>T</title><style>p{color:red}</style></head><body><p>x</p></body></html>"
    const page = themePage(written)
    expect(page.indexOf(STYLE)).toBe(written.indexOf("<head>") + "<head>".length)
    expect(page.indexOf(STYLE)).toBeLessThan(page.indexOf("p{color:red}"))
    // It is not made a visual, and nothing is added to it but the one block.
    expect(page).toContain("<html lang=en>")
    expect(page).not.toContain("viewport")
    const block = page.slice(page.indexOf(STYLE), page.indexOf("<title>"))
    expect(page.replace(block, "")).toBe(written)
  })

  it("leaves a page with no doctype without one, so it is laid out as it was", () => {
    expect(themePage("<h1>Launch plan</h1>")).toMatch(
      /^<head><style id=.*<\/head><h1>Launch plan<\/h1>$/s,
    )
    expect(themePage("<html><body>x</body></html>")).toMatch(
      /^<html><head><style id=.*<\/head><body>x<\/body><\/html>$/s,
    )
  })

  it("asks for the app's page only where the page asked for it", () => {
    const asked = themePage('<!doctype html><html lang="en" data-dc-page><body>x</body></html>')
    expect(asked).toContain('<html lang="en" data-dc-page><head>')
    expect(themePage("<!doctype html><html><body>x</body></html>")).toContain("<html><head>")
  })

  it("is the same page however many times it is given it", () => {
    for (const written of [
      "<p>just this</p>",
      "<!doctype html><html><head><title>x</title></head><body></body></html>",
    ]) {
      const once = themePage(written)
      expect(themePage(once)).toBe(once)
      expect(count(themePage(themePage(once)), STYLE)).toBe(1)
      const visual = prepareVisual(written)
      expect(prepareVisual(visual)).toBe(visual)
      // And a visual stays a visual when it is served.
      expect(themePage(visual)).toBe(visual)
    }
  })

  it("puts the look as it is now in a visual that was kept with an older one", () => {
    // As a visual was kept before every page was given the look when served.
    const old =
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<style id="dc-visual-theme">:root{--canvas:oklch(0.985 0.003 212)}html{font-size:14px}</style>' +
      "<script>(function(){var old=1})();</script><title>Old</title></head><body><p>x</p></body></html>"
    const page = themePage(old)
    expect(page).not.toContain("oklch(0.985 0.003 212)")
    expect(page).not.toContain("var old=1")
    expect(page).toContain("--canvas:oklch(0.997 0.001 212)")
    expect(count(page, STYLE)).toBe(1)
    // It was a visual, and still is: it has a visual's margins when shown by itself.
    expect(page).toContain('<html data-dc-page="visual">')
    expect(page).toContain("<title>Old</title></head><body><p>x</p></body></html>")
  })

  it("is the same as bytes, whatever the page has after its head", () => {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    for (const written of [
      "<!doctype html><html><head><title>Café ☕</title></head><body><p>naïve — 日本語</p></body></html>",
      "﻿<!doctype html><p>ünïcode before any head</p>",
      "<p>short</p>",
      prepareVisual("<p>a visual, kept</p>"),
      `<!doctype html><html><head></head><body>${"é".repeat(90_000)}</body></html>`,
    ]) {
      expect(decoder.decode(themePageBytes(encoder.encode(written)))).toBe(
        // The mark a file starts with is not text, and is not kept as text.
        themePage(written).replace(/^﻿/, ""),
      )
    }
    // Bytes that are not text at all are carried over as they are.
    const odd = new Uint8Array([0x3c, 0x70, 0x3e, 0xff, 0xfe, 0x00, 0x80])
    const page = themePageBytes(odd)
    expect([...page.subarray(page.length - odd.length)]).toEqual([...odd])
  })

  it("changes its version only when what is put in changes", () => {
    expect(PAGE_THEME_VERSION).toMatch(/^[a-z0-9]{4,8}$/)
  })
})

/**
 * Run the few lines a page is given, in a page that is only what they touch: its root, its
 * address, and the window around it.
 */
function open(options: { page?: string; hash?: string; framed?: boolean }) {
  const script = /<script id="dc-visual-host">([\s\S]*?)<\/script>/.exec(themePage("<p>x</p>"))![1]!
  const attributes = new Map<string, string>()
  if (options.page !== undefined) attributes.set("data-dc-page", options.page)
  const variables = new Map<string, string>()
  const posted: unknown[] = []
  const heard = new Map<string, ((event: unknown) => void)[]>()
  const listen = (kind: string) => (type: string, listener: (event: unknown) => void) =>
    heard.set(`${kind}:${type}`, [...(heard.get(`${kind}:${type}`) ?? []), listener])
  const parent = { postMessage: (data: unknown) => posted.push(data) }
  const window: Record<string, unknown> = { addEventListener: listen("window") }
  window.parent = options.framed === false ? window : parent
  const address = { replaced: undefined as string | undefined }
  const root = {
    hasAttribute: (name: string) => attributes.has(name),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    style: { setProperty: (name: string, value: string) => variables.set(name, value) },
    scrollHeight: 312,
    clientHeight: 240,
    getBoundingClientRect: () => ({ height: 312 }),
  }
  const document = { documentElement: root, body: {}, addEventListener: listen("document") }
  const location = {
    hash: options.hash ?? "",
    pathname: "/d/agent/key/page.html",
    search: "?v=3",
    href: `https://app.example/d/agent/key/page.html?v=3${options.hash ?? ""}`,
  }
  const history = {
    state: null,
    replaceState: (_state: unknown, _title: string, url: string) => {
      address.replaced = url
    },
  }
  new Function("window", "document", "location", "history", script)(
    window,
    document,
    location,
    history,
  )
  const say = (data: unknown, source: unknown = parent) => {
    for (const listener of heard.get("window:message") ?? []) listener({ data, source })
  }
  return { attributes, variables, posted, heard, address, say, parent }
}

describe("the few lines a page is given", () => {
  const dark = { appearance: "dark", color: "oklch(0.6 0.1 150)" } as const

  it("take the client's colors from the address, and drop them from it", () => {
    const page = open({ hash: visualThemeFragment(dark) })
    expect(page.attributes.get("data-dc-theme")).toBe("dark")
    expect(page.variables.get("--agent-color")).toBe("oklch(0.6 0.1 150)")
    expect(page.address.replaced).toBe("/d/agent/key/page.html?v=3")
  })

  it("follow the client when its colors change, without the page loading again", () => {
    const page = open({ hash: visualThemeFragment(dark) })
    page.say(visualThemeMessage({ appearance: "light", color: "#b8674a" }))
    expect(page.attributes.get("data-dc-theme")).toBe("light")
    expect(page.variables.get("--agent-color")).toBe("#b8674a")
    page.say(visualThemeMessage({ appearance: "dark" }))
    expect(page.attributes.get("data-dc-theme")).toBe("dark")
    // A color that was not said is left as it was.
    expect(page.variables.get("--agent-color")).toBe("#b8674a")
  })

  it("leave a page to the device's light or dark where the client says neither", () => {
    const page = open({ hash: visualThemeFragment({ color: "#3f7f9c" }) })
    expect(page.attributes.has("data-dc-theme")).toBe(false)
    expect(page.variables.get("--agent-color")).toBe("#3f7f9c")
  })

  it("hear only the window the page is shown in, and only what a color can be", () => {
    const page = open({})
    page.say(visualThemeMessage(dark), { postMessage() {} })
    expect(page.attributes.has("data-dc-theme")).toBe(false)
    page.say({ jsonrpc: "2.0", method: "something/else", params: { theme: "dark" } })
    expect(page.attributes.has("data-dc-theme")).toBe(false)
    for (const color of [
      "red;background:url(https://evil.example/x)",
      "url(https://evil.example/x)",
      "x".repeat(200),
      'red"><script>',
    ]) {
      page.say(visualThemeMessage({ appearance: "dark", color }))
      expect(page.variables.has("--agent-color")).toBe(false)
    }
    const bad = open({ hash: "#dc-theme=%7Bnot json" })
    expect(bad.attributes.size).toBe(0)
  })

  it("do no more than that in a page that has not asked for the app's look", () => {
    const page = open({ hash: visualThemeFragment({ ...dark, inline: true }) })
    expect(page.attributes.has("data-dc-inline")).toBe(false)
    expect(page.posted).toEqual([])
    expect([...page.heard.keys()]).toEqual(["window:message"])
  })

  it("say how tall a page that asked is, and lay a visual out as part of an answer", () => {
    const page = open({ page: "visual", hash: visualThemeFragment({ ...dark, inline: true }) })
    expect(page.attributes.has("data-dc-inline")).toBe(true)
    for (const listener of page.heard.get("window:load") ?? []) listener({})
    expect(page.posted).toEqual([
      { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: 312 } },
    ])
    // By itself, in a tab, it is a page: not part of anything, and it says nothing to anyone.
    const alone = open({
      page: "visual",
      framed: false,
      hash: visualThemeFragment({ ...dark, inline: true }),
    })
    expect(alone.attributes.has("data-dc-inline")).toBe(false)
    expect(alone.heard.has("window:load")).toBe(false)
  })

  it("read nothing of the page, the person or the app", () => {
    const script = /<script id="dc-visual-host">([\s\S]*?)<\/script>/.exec(
      themePage("<p>x</p>"),
    )![1]!
    for (const reach of [
      "cookie",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "innerHTML",
      "textContent",
      "referrer",
      "eval(",
      "import(",
    ]) {
      expect(script).not.toContain(reach)
    }
    // All it ever sends is a height, and a link the reader clicked.
    expect(count(script, "postMessage(")).toBe(2)
  })
})

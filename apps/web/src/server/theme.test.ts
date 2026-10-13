import { readFileSync } from "node:fs"
import { appThemeCss, PAGE_THEME_CSS, THEME_FONTS, THEME_TOKENS } from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import { themeFont } from "./theme-fonts.ts"

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("the app's own colors", () => {
  it("are the ones every page of the library is given", () => {
    // The stylesheet is written out from the one table: `pnpm --filter @do-computer/web theme`.
    expect(read("../theme-tokens.css")).toBe(appThemeCss())
    const styles = read("../styles.css")
    expect(styles).toContain('@import "./theme-tokens.css";')
    // And nowhere else: one said again in the stylesheet would be the one that wins.
    const said = styles.match(/^\s*(--[a-z0-9-]+):/gm)?.map((line) => line.trim().slice(0, -1))
    for (const token of THEME_TOKENS) {
      if (token.pageOnly !== true) expect(said).not.toContain(token.name)
    }
  })

  it("are set in the same typefaces, which a page loads from the app", async () => {
    const styles = read("../styles.css")
    for (const family of Object.values(THEME_FONTS)) {
      expect(styles).toContain(family)
      expect(PAGE_THEME_CSS).toContain(`font-family:${family}`)
    }
    for (const name of Object.keys(THEME_FONTS)) {
      const font = themeFont(name)
      expect(font.status).toBe(200)
      expect(font.headers.get("content-type")).toBe("font/woff2")
      // A page's origin is nobody's, so the font has to say that anyone may have it.
      expect(font.headers.get("access-control-allow-origin")).toBe("*")
      const bytes = new Uint8Array(await font.arrayBuffer())
      expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("wOF2")
      expect(PAGE_THEME_CSS).toContain(`url(/theme/${name})`)
    }
    expect(themeFont("../styles.css").status).toBe(404)
    expect(themeFont("constructor").status).toBe(404)
  })
})

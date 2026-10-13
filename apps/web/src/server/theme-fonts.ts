import { THEME_FONTS, type ThemeFont } from "@do-computer/protocol"
import geistMono from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?inline"
import geist from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline"

/** The files the app's own stylesheet loads, by the names a page asks for them under. */
const FILES: Record<ThemeFont, string> = { "geist.woff2": geist, "geist-mono.woff2": geistMono }

const decoded = new Map<string, Uint8Array<ArrayBuffer>>()

/** A font's bytes, from the address the build made of its file. */
function bytesOf(name: ThemeFont): Uint8Array<ArrayBuffer> {
  let bytes = decoded.get(name)
  if (bytes === undefined) {
    const text = atob(FILES[name].slice(FILES[name].indexOf(",") + 1))
    bytes = new Uint8Array(text.length)
    for (let at = 0; at < text.length; at++) bytes[at] = text.charCodeAt(at)
    decoded.set(name, bytes)
  }
  return bytes
}

/**
 * `GET /theme/<name>`: a typeface of the app's, to any page that asks. A page of the library
 * has an origin that is nobody's, and a font is only ever given to another origin that the
 * answer names, so this one names them all. It is the same file for everyone and says nothing
 * of who asks.
 */
export function themeFont(name: string): Response {
  if (!Object.hasOwn(THEME_FONTS, name)) return new Response("Not found", { status: 404 })
  return new Response(bytesOf(name as ThemeFont), {
    headers: {
      "content-type": "font/woff2",
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "x-content-type-options": "nosniff",
    },
  })
}

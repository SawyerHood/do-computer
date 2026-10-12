// Packs the built page into one SVG file whose text a few lines of script can unpack. T3 Code's
// html_render takes a page of at most 512,000 characters but puts any local picture it names
// into the page itself, so the mock-up travels as a "picture". `node pack.mjs <folder>`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
const here = new URL(".", import.meta.url)
const out = process.argv[2] ?? "/tmp/dc-ios-app"
const page = readFileSync(new URL("index.html", here), "utf8")
const css = page.match(/<style>([\s\S]*?)<\/style>/)[1]
const body = page.match(/<body>\n([\s\S]*?)\n<script>/)[1]
const js = page.match(/<script>([\s\S]*?)<\/script>\n<\/body>/)[1]
const payload = Buffer.from(JSON.stringify({ css, body, js }), "utf8").toString("base64")
mkdirSync(out, { recursive: true })
writeFileSync(`${out}/payload.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><desc>${payload}</desc></svg>`)
console.log(`Packed ${out}/payload.svg (${payload.length} characters).`)

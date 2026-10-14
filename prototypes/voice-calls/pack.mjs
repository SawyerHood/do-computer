// Packs the built page into one SVG file whose text a few lines of script can unpack, as
// prototypes/ios-app/pack.mjs does, so the page can be shown in a T3 Code thread without being
// typed into the call: html_render puts any local picture a page names into the page itself.
// `node pack.mjs <folder> [preface.html] [scene]` writes payload.svg and the small page that
// unpacks it, loader.html. A preface is put above the mock-up; it is for that thread and is not
// kept here. A scene's name opens the page on that scene.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
const here = new URL(".", import.meta.url)
const out = process.argv[2] ?? "/tmp/dc-voice-calls"
const preface = process.argv[3] ? readFileSync(process.argv[3], "utf8") : ""
const page = readFileSync(new URL("index.html", here), "utf8")
const head = page.match(/<link[^>]*>/g).join("")
const css = page.match(/<style>([\s\S]*?)<\/style>/)[1]
const body = preface + page.match(/<body>\n([\s\S]*?)\n<script/)[1]
const src = [...page.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1])
const start = process.argv[4] ? `window.START = ${JSON.stringify(process.argv[4])}\n;\n` : ""
const js = start + [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n;\n")
const payload = Buffer.from(JSON.stringify({ head, css, body, src, js }), "utf8").toString("base64")
mkdirSync(out, { recursive: true })
writeFileSync(`${out}/payload.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><desc>${payload}</desc></svg>`)
writeFileSync(
  `${out}/loader.html`,
  `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><script>
(() => {
const u = "${out}/payload.svg"
const raw = u.includes(";base64,") ? atob(u.slice(u.indexOf(",") + 1)) : decodeURIComponent(u.slice(u.indexOf(",") + 1))
const text = atob(raw.slice(raw.indexOf("<desc>") + 6, raw.indexOf("</desc>")))
const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(text, (c) => c.charCodeAt(0))))
document.head.insertAdjacentHTML("beforeend", p.head)
const style = document.createElement("style"); style.textContent = p.css; document.head.append(style)
document.body.insertAdjacentHTML("afterbegin", p.body)
const run = () => { const script = document.createElement("script"); script.textContent = p.js; document.body.append(script) }
const next = (i) => { if (i >= p.src.length) return run(); const s = document.createElement("script"); s.src = p.src[i]; s.onload = s.onerror = () => next(i + 1); document.head.append(s) }
next(0)
})()
</script></body></html>
`,
)
console.log(`Packed ${out}/payload.svg (${payload.length} characters) and ${out}/loader.html.`)

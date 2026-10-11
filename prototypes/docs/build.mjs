// Builds the docs mock-up into one self-contained page. The guide is real Markdown
// (docs/self-hosting.md, the one the app serves), drawn with the app's own Markdown renderer,
// and the same text is what
// the "what an agent gets" scene shows. `node build.mjs` writes index.html next to this file,
// which opens straight from the file system. It needs `pnpm install` to have been run, and the
// network once, for its fonts.
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const here = new URL(".", import.meta.url)
const read = (p) => readFileSync(new URL(p, here), "utf8").replace(/\s+$/, "")
const web = createRequire(new URL("../../apps/web/package.json", here))
const load = (name) => import(pathToFileURL(web.resolve(name)).href)

const { createElement } = web("react")
const { renderToStaticMarkup } = web("react-dom/server")
const { default: ReactMarkdown } = await load("react-markdown")
const { default: remarkGfm } = await load("remark-gfm")

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

const guide = read("../../docs/self-hosting.md")
const sections = []
const html = renderToStaticMarkup(
  createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, guide),
)
  // What the app would do with components of its own: an address for each heading, a mark on
  // the steps that need the person, and a tick before each check.
  .replace(/<h2>(.*?)<\/h2>/g, (_, text) => {
    sections.push({ id: slug(text), text })
    return `<h2 id="${slug(text)}">${text}</h2>`
  })
  .replaceAll("<strong>Needs you:</strong>", '<span class="needs">Needs you</span>')
  .replace(/<p>Check: /g, '<p class="check">')

// The title and the line under it stand above the rest, beside the card for agents.
const split = html.indexOf("</p>") + 4
const head = html.slice(0, split)
const body = html.slice(split)

const logo = `data:image/svg+xml;base64,${readFileSync(new URL("../../apps/web/public/favicon.svg", here)).toString("base64")}`

const page = read("src/page.html")
  .replace("SIZE", () => `${(Buffer.byteLength(guide) / 1024).toFixed(1)} KB`)
  .replace("/*STYLE*/", () => read("src/style.css"))
  .replace("<!--HEAD-->", () => head)
  .replace("<!--BODY-->", () => body)
  .replace(
    "/*SCRIPT*/",
    () =>
      `var GUIDE = ${JSON.stringify(guide)};\nvar SECTIONS = ${JSON.stringify(sections)};\nvar LOGO = ${JSON.stringify(logo)};\n${read("src/app.js")}`,
  )
writeFileSync(new URL("index.html", here), page)
console.log(`Built index.html (${page.length} bytes).`)

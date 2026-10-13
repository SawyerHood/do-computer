/**
 * A visual is a page an agent draws into a chat: a chart, a dashboard, a mock-up. The agent
 * writes one self-contained HTML document. It is kept in the library, with a few lines put in its head
 * that give it the app's colors and let it speak to whatever shows it, and a client shows it in
 * a frame kept apart from the app, on the chat's own background and as tall as the page is.
 *
 * The page and its frame speak the MCP Apps messages (JSON-RPC over `postMessage`), so that a
 * page written for one host that speaks them is at home in another:
 * https://github.com/modelcontextprotocol/ext-apps
 */

import { INLINE_ATTRIBUTE, PAGE_ATTRIBUTE, PAGE_THEME_CSS, THEME_ATTRIBUTE } from "./theme.ts"

/** The tool an agent draws a visual with. */
export const VISUAL_TOOL = "visual"
/** The folder of the library visuals are kept in. */
export const VISUALS_FOLDER = "visuals"
/** The largest page an agent can draw. */
export const MAX_VISUAL_BYTES = 512 * 1024
export const MAX_VISUAL_TITLE = 120
/** How tall a visual's frame can be. A page taller than the most scrolls inside it. */
export const VISUAL_MIN_HEIGHT = 40
export const VISUAL_MAX_HEIGHT = 1600
/** How tall the frame is until the page has said how tall it is. */
export const VISUAL_DEFAULT_HEIGHT = 240

/** What a client tells a visual about where it is shown. */
export type VisualTheme = {
  /** Left out, the page follows the light or dark of the device it is on. */
  appearance?: "light" | "dark"
  /** The color of the agent whose chat it is in, which the accent takes its hue from. */
  color?: string
  /**
   * It is shown in a chat, as part of an answer: the page then has no margin of its own, says
   * how tall it is, and asks for its links to be opened. Anywhere else it is a page by itself.
   */
  inline?: boolean
}

const HOST_CONTEXT_CHANGED = "ui/notifications/host-context-changed"
const SIZE_CHANGED = "ui/notifications/size-changed"
const OPEN_LINK = "ui/open-link"
const THEME_KEY = "dc-theme"
const STYLE_ID = "dc-visual-theme"
const SCRIPT_ID = "dc-visual-host"

/**
 * Runs in the head, before the page's own styles and body, so the first paint is already in the
 * client's colors. The theme arrives in the address's fragment, which is then dropped so that a
 * page's own use of the fragment never meets it, and again by message whenever it changes. That
 * is all it does in a page that has not asked for the app's look.
 *
 * In one that has, a page in a frame says how tall it is, so the frame can fit it, and a link
 * to somewhere else never replaces the page where it is shown: in a chat the client is asked to
 * open it, and anywhere else it opens in a new tab.
 *
 * It reads nothing of the page and sends nothing but a height and a link the reader clicked.
 */
const BOOTSTRAP_SCRIPT =
  `(function(){var r=document.documentElement,f=window.parent!==window,g=r.hasAttribute("${PAGE_ATTRIBUTE}"),k=false,n=0,h,o;` +
  `function a(t){if(!t||typeof t!=="object")return;` +
  `if(t.inline===true&&f&&g){k=true;r.setAttribute("${INLINE_ATTRIBUTE}","");}` +
  `if(t.appearance==="light"||t.appearance==="dark")r.setAttribute("${THEME_ATTRIBUTE}",t.appearance);` +
  `if(typeof t.color==="string"&&/^[a-z0-9 .,%()#-]{1,80}$/i.test(t.color))r.style.setProperty("--agent-color",t.color);}` +
  `try{var m=/[#&]${THEME_KEY}=([^&]*)/.exec(location.hash);if(m){a(JSON.parse(decodeURIComponent(m[1])));` +
  `history.replaceState(history.state,"",location.pathname+location.search);}}catch(e){}` +
  `window.addEventListener("message",function(e){var d=e.data,p=d&&d.params;` +
  `if(e.source!==window.parent||!d||d.jsonrpc!=="2.0"||d.method!==${JSON.stringify(HOST_CONTEXT_CHANGED)}||!p)return;` +
  `a({appearance:p.theme,color:p.styles&&p.styles.variables&&p.styles.variables["--agent-color"]});});` +
  `if(!g)return;` +
  `document.addEventListener("click",function(e){var l=e.isTrusted&&e.composedPath?e.composedPath().find(function(t){` +
  `return t&&t.matches&&t.matches("a[href]");}):null,u;if(!l)return;` +
  `try{u=new URL(l.getAttribute("href"),document.baseURI);}catch(x){return;}` +
  `if(!/^https?:$/.test(u.protocol)||u.href.split("#")[0]===location.href.split("#")[0])return;` +
  `if(k){e.preventDefault();window.parent.postMessage({jsonrpc:"2.0",id:"dc-link-"+(++n),` +
  `method:${JSON.stringify(OPEN_LINK)},params:{url:u.href}},"*");}` +
  `else if(u.origin!==location.origin){l.setAttribute("target","_blank");l.setAttribute("rel","noopener");}},true);` +
  `if(f){var z=function(){var v=Math.ceil(r.scrollHeight>r.clientHeight?r.scrollHeight:r.getBoundingClientRect().height);` +
  `if(v===h)return;h=v;window.parent.postMessage({jsonrpc:"2.0",method:${JSON.stringify(SIZE_CHANGED)},params:{height:v}},"*");};` +
  `if(window.ResizeObserver){o=new ResizeObserver(z);o.observe(r);}` +
  `document.addEventListener("DOMContentLoaded",function(){if(o&&document.body)o.observe(document.body);z();});` +
  `window.addEventListener("load",z);}})();`

/** What is put at the start of a page's head: the app's look, and the few lines that hear of it. */
const THEME_BLOCK =
  `<style id="${STYLE_ID}">${PAGE_THEME_CSS}</style>` +
  `<script id="${SCRIPT_ID}">${BOOTSTRAP_SCRIPT}</script>`

/**
 * The block as it is in a page that was given it before, whichever version of it that was. The
 * first of them had no name on its script, and was only ever put in a visual.
 */
const KEPT_BLOCK = new RegExp(
  `<style id="${STYLE_ID}">[^<]*</style><script( id="${SCRIPT_ID}")?>[\\s\\S]*?</script>`,
)

/** Changes with what is put in a page, so that a page kept by a browser is asked for again. */
export const PAGE_THEME_VERSION = (() => {
  let hash = 5381
  for (let at = 0; at < THEME_BLOCK.length; at++) {
    hash = ((hash << 5) + hash + THEME_BLOCK.charCodeAt(at)) >>> 0
  }
  return hash.toString(36)
})()

/**
 * The same text with everything that is not markup made blank, at the same length: comments,
 * and what is inside the elements whose content is not read as tags. What is found in it is
 * where it is in the page.
 */
function markupOf(html: string): string {
  return html.replace(
    /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|noscript|template)\b[\s\S]*?(?:<\/\1\s*>|$)/gi,
    (match) => " ".repeat(match.length),
  )
}

/** How much of a page is looked through for its head, which is at its start. */
const HEAD_SCAN = 64 * 1024

/** Something to put into a page at `at`, in place of the `remove` characters there. */
type Splice = { readonly at: number; readonly remove: number; readonly insert: string }

/**
 * What to change at the start of a page for it to have the app's look: the block goes at the
 * start of its head, before anything of the page's own, and where the page was given one
 * before, in that one's place. `start` is the page's first characters.
 *
 * A visual is also marked as one on its root, and given a doctype, a charset and a viewport
 * where it has none. Any other page is left as it was written but for the block.
 */
function themeSplices(start: string, asVisual: boolean | undefined): Splice[] {
  const kept = KEPT_BLOCK.exec(start)
  // A visual says that it is one on its root. One kept before they did is known by its block.
  const visual = asVisual ?? (kept !== null && kept[1] === undefined)
  const scan = markupOf(start)
  const after = (match: RegExpExecArray) => match.index + match[0].length
  const htmlOpen = /<html(?:\s[^>]*)?>/i.exec(scan)
  const splices: Splice[] = []
  const mark = `${PAGE_ATTRIBUTE}="visual"`
  if (visual && htmlOpen !== null && !htmlOpen[0].includes(mark)) {
    const own = new RegExp(`\\s${PAGE_ATTRIBUTE}(?:=(?:"[^"]*"|'[^']*'|[^\\s>]*))?`, "i").exec(
      htmlOpen[0],
    )
    splices.push(
      own === null
        ? { at: htmlOpen.index + 5, remove: 0, insert: ` ${mark}` }
        : { at: htmlOpen.index + own.index, remove: own[0].length, insert: ` ${mark}` },
    )
  }
  if (kept !== null) {
    splices.push({ at: kept.index, remove: kept[0].length, insert: THEME_BLOCK })
    return splices
  }
  const head =
    (!visual || /<meta\s[^>]*charset/i.test(scan.slice(0, 4096)) ? "" : '<meta charset="utf-8">') +
    (!visual || /<meta\s[^>]*name\s*=\s*["']?viewport/i.test(scan)
      ? ""
      : '<meta name="viewport" content="width=device-width, initial-scale=1">') +
    THEME_BLOCK
  const headOpen = /<head(?:\s[^>]*)?>/i.exec(scan)
  if (headOpen !== null) return [...splices, { at: after(headOpen), remove: 0, insert: head }]
  if (htmlOpen !== null) {
    return [...splices, { at: after(htmlOpen), remove: 0, insert: `<head>${head}</head>` }]
  }
  // A page with no root of its own is given one only to say that it is a visual.
  const root = visual ? `<html ${mark}>` : ""
  // The mark some files start with comes before everything, as three bytes or as one character.
  const doctype = /^(?:﻿|ï»¿)?\s*<!doctype[^>]*>/i.exec(start)
  if (doctype !== null) {
    return [{ at: doctype[0].length, remove: 0, insert: `${root}<head>${head}</head>` }]
  }
  return [
    { at: 0, remove: 0, insert: `${visual ? "<!doctype html>" : ""}${root}<head>${head}</head>` },
  ]
}

/**
 * A page as it is served: what was written, with the app's look put at the start of its head.
 * Every page of the library is given it, so the variables are there for any that uses them, and
 * are the app's as it is now however long ago the page was written. A page that was drawn as a
 * visual stays one. Giving it to a page twice changes nothing.
 */
export function themePage(html: string, options: { visual?: boolean } = {}): string {
  let page = html
  // From the end, so that what is put in does not move what is still to be changed.
  const splices = themeSplices(html.slice(0, HEAD_SCAN), options.visual).sort((a, b) => b.at - a.at)
  for (const { at, remove, insert } of splices) {
    page = page.slice(0, at) + insert + page.slice(at + remove)
  }
  return page
}

/**
 * The same for a page as bytes, which is how the library keeps one. Only its start is read as
 * text, and what follows is carried over as it is, so a large page costs no more than a small one.
 */
export function themePageBytes(bytes: Uint8Array): Uint8Array {
  // One character to a byte, so that a place in the text is the same place in the bytes.
  let start = ""
  const scanned = Math.min(bytes.length, HEAD_SCAN)
  for (let at = 0; at < scanned; at += 8192) {
    start += String.fromCharCode(...bytes.subarray(at, Math.min(at + 8192, scanned)))
  }
  const splices = themeSplices(start, undefined).sort((a, b) => a.at - b.at)
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  let from = 0
  for (const { at, remove, insert } of splices) {
    parts.push(bytes.subarray(from, at), encoder.encode(insert))
    from = at + remove
  }
  parts.push(bytes.subarray(from))
  const page = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    page.set(part, offset)
    offset += part.length
  }
  return page
}

/**
 * A visual's page as it is kept: what the agent wrote, with the app's look and the few lines
 * that speak to a client put at the start of its head, before anything of the page's own. It is
 * kept with them so that the file is whole wherever it is opened; the library puts the app's
 * look as it is now in their place each time it serves the page.
 */
export function prepareVisual(html: string): string {
  return themePage(html, { visual: true })
}

/**
 * A page of the app's own making in the same look, for showing something by itself that is
 * not a page: a document, a picture, a list of files. It follows the reader's light or dark,
 * and has the margins and measure a visual has when it is shown by itself. `style` comes after
 * the theme, and `body` is markup that is already safe to put in a page.
 */
export function themedPage(page: { title: string; style?: string; body: string }): string {
  const escaped = page.title.replace(
    /[&<>"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!,
  )
  return (
    `<!doctype html><html lang="en" ${PAGE_ATTRIBUTE}="visual"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escaped}</title>` +
    `<style>${PAGE_THEME_CSS}${page.style ?? ""}</style></head><body>${page.body}</body></html>`
  )
}

/** What goes on the end of a visual's address, so that its first paint is in the client's colors. */
export function visualThemeFragment(theme: VisualTheme): string {
  return `#${THEME_KEY}=${encodeURIComponent(JSON.stringify(theme))}`
}

/** What a client posts into a visual it is showing, at first and whenever its colors change. */
export function visualThemeMessage(theme: VisualTheme) {
  return {
    jsonrpc: "2.0",
    method: HOST_CONTEXT_CHANGED,
    params: {
      theme: theme.appearance,
      styles: { variables: theme.color === undefined ? {} : { "--agent-color": theme.color } },
    },
  } as const
}

/** How tall a visual says its page is, where `data` is it saying so. */
export function readVisualHeight(data: unknown): number | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const { jsonrpc, method, params } = data as Record<string, unknown>
  if (jsonrpc !== "2.0" || method !== SIZE_CHANGED) return undefined
  const height =
    typeof params === "object" && params !== null
      ? (params as { height?: unknown }).height
      : undefined
  return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : undefined
}

/** The link a visual asks its client to open, where `data` is it asking. Only ever a web address. */
export function readVisualLink(
  data: unknown,
): { readonly id: string | number; readonly url: string } | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const { jsonrpc, id, method, params } = data as Record<string, unknown>
  if (jsonrpc !== "2.0" || method !== OPEN_LINK) return undefined
  if (typeof id !== "string" && typeof id !== "number") return undefined
  const url =
    typeof params === "object" && params !== null ? (params as { url?: unknown }).url : undefined
  return typeof url === "string" && /^https?:\/\//i.test(url) ? { id, url } : undefined
}

/** The answer a client gives a visual's request, which has nothing in it. */
export function visualResult(id: string | number) {
  return { jsonrpc: "2.0", id, result: {} } as const
}

/** How tall the frame of a visual is, for a page that says it is `height` tall. */
export function visualFrameHeight(height: number | undefined): number {
  return Math.min(
    VISUAL_MAX_HEIGHT,
    Math.max(VISUAL_MIN_HEIGHT, Math.round(height ?? VISUAL_DEFAULT_HEIGHT)),
  )
}

/** The file name a visual is kept under: its title in letters, digits and dashes. */
export function visualFileName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "")
  return `${slug === "" ? "visual" : slug}.html`
}

/**
 * What an agent is told of a page that is drawn into a chat, in the tool's description. How any
 * page should look is `PAGE_STYLE_GUIDE`, which it is told once for every kind of page.
 */
export const VISUAL_GUIDE = [
  "The page is shown with no border on the chat's own background, as wide as your reply (about 720px on a computer, about 340px on a phone), with its left edge where your text begins.",
  "So leave html and body with no background, use a fluid width with no padding on the outermost element, and put no card, frame or heading banner around the whole page: it is part of your reply.",
  "A box that needs a background of its own gets at least 16px of padding and var(--radius) corners.",
  "Let the content set the height: no 100vh, and no height:100% on html or body. Give a chart a fixed height in pixels. The frame grows to fit the page; past 1600px it scrolls.",
  "It starts from the app's own page, in the app's colors and type, and is styled as your instructions on pages say.",
  "Scripts run, but the page is kept apart from the app: it has no storage and cannot reach the person's session. A link to another site opens in a new tab.",
].join(" ")

/**
 * What an agent is told its reply itself can show, so that it does not draw a page for what
 * Markdown says as well: a reply's Markdown is drawn with tables, code in its colors and
 * diagrams.
 */
export const REPLY_GUIDE = [
  "Your reply is Markdown, and the chat draws it well, so put these in the reply itself and not in a page:",
  "a table, as a Markdown table, which the person can scroll and copy into a spreadsheet;",
  "code, in a fenced block with its language;",
  "a flowchart, sequence or other simple diagram, as a fenced `mermaid` block;",
  "a note that must not be missed, as `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]` or `> [!CAUTION]`;",
  "and detail most readers will skip, inside `<details><summary>…</summary>` with a blank line after the summary.",
  "A picture, a film, a sound file or a CSV that is in the library is shown where you name it, on a line of its own, as `![what it is](its/path/in/the/library.mp4)`: the picture is drawn, the film or sound gets a player, the CSV its first rows as a table.",
  "Something at a web address can be written the same way, but the person has to press to load it, so say what it is in the square brackets.",
].join(" ")

/**
 * What an agent is told of a page that is a file of the library: one read by itself, in a
 * window, beside a chat, on a phone, or by whoever is sent its link.
 */
export const DOCUMENT_GUIDE = [
  `An HTML file in the library is a page by itself. Start it with <!doctype html><html lang="en" ${PAGE_ATTRIBUTE}> and a viewport meta: the attribute starts it from the app's own page, with its background, text, typeface and the way it sets a table or a field, all of which your own styles can change.`,
  "Give it a centered column of its own: max-width about 720px for writing and up to 1120px for a dashboard, with margin: 0 auto. The page already has padding.",
  "The variables are put in whenever the app serves the page: in the library, beside a chat, pinned, and to whoever opens its link, where it follows their device's light or dark. A copy the person downloads from the app takes them with it. Only the bare file, as it is on a machine, has none: there it is drawn in the browser's plain black on white, and a mark colored only by a variable is not drawn at all. So use the variables in their pairs, never write white on a variable's color, give a chart's marks a fallback as in var(--chart-1, currentColor), and do not add colors of your own to make the bare file look right.",
].join(" ")

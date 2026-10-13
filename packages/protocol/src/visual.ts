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

import {
  INLINE_ATTRIBUTE,
  PAGE_ATTRIBUTE,
  PAGE_THEME_CSS,
  THEME_ATTRIBUTE,
  THEME_TOKENS,
} from "./theme.ts"

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
const MESSAGE = "ui/message"
const DISPLAY_MODE = "ui/request-display-mode"
const DOWNLOAD_FILE = "ui/download-file"
/** MCP's own way for one side to tell the other something for its log: here, that a script failed. */
const LOG = "notifications/message"
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
 * A page in a chat can also speak to the chat, through `window.dc`: `dc.say(text)` puts words
 * in the message box for the person to send, `dc.expand()` shows the page large and
 * `dc.expand(false)` puts it back, and `dc.save(name, text, type)` hands the person a file.
 * And when a script of the page's fails, the client is told, so that the person is not left
 * looking at half a page with nothing said. Out of a chat, `dc` is there and does nothing.
 *
 * It reads nothing of the page, and sends only what is named here.
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
  `a({appearance:p.theme,color:p.styles&&p.styles.variables&&p.styles.variables["--agent-color"]});` +
  // Shown large, a page in a chat is a page by itself for as long as it is.
  `if(k&&p.displayMode==="fullscreen")r.removeAttribute("${INLINE_ATTRIBUTE}");` +
  `if(k&&p.displayMode==="inline")r.setAttribute("${INLINE_ATTRIBUTE}","");});` +
  `if(!g)return;` +
  // Everything said to the client goes through here. `i` asks for an answer.
  `var q=function(m,p,i){if(!f)return false;var d={jsonrpc:"2.0",method:m,params:p};if(i)d.id="dc-"+(++n);` +
  `window.parent.postMessage(d,"*");return true;},c=0,` +
  `w=function(m){if(k&&c++<3)q(${JSON.stringify(LOG)},{level:"error",data:String(m).slice(0,500)});};` +
  `window.dc={say:function(t){return k&&q(${JSON.stringify(MESSAGE)},{role:"user",content:[{type:"text",text:String(t)}]},1);},` +
  `expand:function(b){return k&&q(${JSON.stringify(DISPLAY_MODE)},{mode:b===false?"inline":"fullscreen"},1);},` +
  `save:function(b,t,y){return k&&q(${JSON.stringify(DOWNLOAD_FILE)},{contents:[{type:"resource",resource:{` +
  `uri:"file:///"+encodeURIComponent(String(b)),mimeType:y?String(y):"text/plain",text:String(t)}}]},1);}};` +
  `window.addEventListener("error",function(e){w(e&&e.message?e.message+(e.lineno?" (line "+e.lineno+")":""):"A script failed");});` +
  `window.addEventListener("unhandledrejection",function(e){var v=e&&e.reason;w(v&&v.message?v.message:v);});` +
  `document.addEventListener("click",function(e){var l=e.isTrusted&&e.composedPath?e.composedPath().find(function(t){` +
  `return t&&t.matches&&t.matches("a[href]");}):null,u;if(!l)return;` +
  `try{u=new URL(l.getAttribute("href"),document.baseURI);}catch(x){return;}` +
  `if(!/^https?:$/.test(u.protocol)||u.href.split("#")[0]===location.href.split("#")[0])return;` +
  `if(k){e.preventDefault();q(${JSON.stringify(OPEN_LINK)},{url:u.href},1);}` +
  `else if(u.origin!==location.origin){l.setAttribute("target","_blank");l.setAttribute("rel","noopener");}},true);` +
  `if(f){var z=function(){var v=Math.ceil(r.scrollHeight>r.clientHeight?r.scrollHeight:r.getBoundingClientRect().height);` +
  `if(v===h)return;h=v;q(${JSON.stringify(SIZE_CHANGED)},{height:v});};` +
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

/** The answer a client gives a visual's request: nothing, or what the request says it gets. */
export function visualResult(id: string | number, result: Record<string, string> = {}) {
  return { jsonrpc: "2.0", id, result } as const
}

/** The answer to a request the client will not do, with why. */
export function visualRefusal(id: string | number, message: string) {
  return { jsonrpc: "2.0", id, error: { code: -32000, message } } as const
}

/** What a visual asks of its client, where `data` is one of the things it asks. */
function readRequest(
  data: unknown,
  method: string,
): { id: string | number; params: Record<string, unknown> } | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const { jsonrpc, id, method: asked, params } = data as Record<string, unknown>
  if (jsonrpc !== "2.0" || asked !== method) return undefined
  if (typeof id !== "string" && typeof id !== "number") return undefined
  return {
    id,
    params:
      typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {},
  }
}

/** The longest thing a visual can put in the message box. */
export const MAX_VISUAL_SAY = 4_000

/**
 * What a visual asks to have put in the message box, where `data` is it asking: words, as the
 * person would have typed them. Anything that is not plain words is not read.
 */
export function readVisualSay(
  data: unknown,
): { readonly id: string | number; readonly text: string } | undefined {
  const request = readRequest(data, MESSAGE)
  if (request === undefined || request.params.role !== "user") return undefined
  const content = request.params.content
  const blocks = Array.isArray(content) ? content : [content]
  const words = blocks.map((block) => {
    const { type, text } = (block ?? {}) as { type?: unknown; text?: unknown }
    return type === "text" && typeof text === "string" ? text : undefined
  })
  if (words.length === 0 || words.includes(undefined)) return undefined
  const text = words.join("\n").trim().slice(0, MAX_VISUAL_SAY)
  return text === "" ? undefined : { id: request.id, text }
}

/** Whether a visual asks to be shown large or put back, where `data` is it asking. */
export function readVisualMode(
  data: unknown,
): { readonly id: string | number; readonly mode: "inline" | "fullscreen" } | undefined {
  const request = readRequest(data, DISPLAY_MODE)
  const mode = request?.params.mode
  return request !== undefined && (mode === "inline" || mode === "fullscreen")
    ? { id: request.id, mode }
    : undefined
}

/** The largest file a visual can hand the person. */
export const MAX_VISUAL_SAVE_BYTES = 10 * 1024 * 1024

/**
 * The file a visual asks to hand the person, where `data` is it asking: its name, its type, and
 * its text. A name is only ever a name, never a place.
 */
export function readVisualSave(data: unknown):
  | {
      readonly id: string | number
      readonly name: string
      readonly type: string
      readonly text: string
    }
  | undefined {
  const request = readRequest(data, DOWNLOAD_FILE)
  const contents = request?.params.contents
  const first = Array.isArray(contents) ? contents[0] : undefined
  const resource = (first as { type?: unknown; resource?: unknown } | undefined)?.resource
  if (request === undefined || typeof resource !== "object" || resource === null) return undefined
  const { uri, mimeType, text } = resource as Record<string, unknown>
  if (typeof uri !== "string" || typeof text !== "string") return undefined
  if (text.length > MAX_VISUAL_SAVE_BYTES) return undefined
  let name = uri.slice(uri.lastIndexOf("/") + 1)
  try {
    name = decodeURIComponent(name)
  } catch {
    // Kept as it was written.
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  name = (name.split(/[\\/]/).at(-1) ?? "")
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim()
    .slice(0, 120)
  return {
    id: request.id,
    name: name === "" || name === "." || name === ".." ? "file.txt" : name,
    type:
      typeof mimeType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(mimeType)
        ? mimeType
        : "text/plain",
    text,
  }
}

/** What a visual says went wrong in it, where `data` is it saying so. */
export function readVisualError(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const { jsonrpc, method, params } = data as Record<string, unknown>
  if (jsonrpc !== "2.0" || method !== LOG || typeof params !== "object" || params === null) {
    return undefined
  }
  const { level, data: said } = params as { level?: unknown; data?: unknown }
  return level === "error" && typeof said === "string" && said.trim() !== ""
    ? said.trim().slice(0, 500)
    : undefined
}

/** What a client tells a visual when it is shown large, or put back in the reply. */
export function visualModeMessage(mode: "inline" | "fullscreen") {
  return { jsonrpc: "2.0", method: HOST_CONTEXT_CHANGED, params: { displayMode: mode } } as const
}

/** How tall the frame of a visual is, for a page that says it is `height` tall. */
export function visualFrameHeight(height: number | undefined): number {
  return Math.min(
    VISUAL_MAX_HEIGHT,
    Math.max(VISUAL_MIN_HEIGHT, Math.round(height ?? VISUAL_DEFAULT_HEIGHT)),
  )
}

/**
 * What can be seen to be wrong with a page before anyone looks at it. `stops` are things that
 * break a page in a chat, and the page is not shown until they are gone: storage, which a page
 * kept apart from the app does not have and which throws, and a height taken from the window,
 * which the frame grows to fit, and then grows again. `notes` are things that will make it
 * look out of place, and are for the agent to weigh.
 */
export function visualProblems(html: string): { stops: string[]; notes: string[] } {
  const stops: string[] = []
  const notes: string[] = []
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)(?:<\/script\s*>|$)/gi)]
    .map((match) => match[1])
    .join("\n")
  // Everything that is not a script: the markup and its styles, where a color is written.
  const rest = html.replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, "")
  const styles =
    [...rest.matchAll(/<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi)].map((m) => m[1]).join("\n") +
    [...rest.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[1] ?? m[2]).join(";")

  const kept = /\b(localStorage|sessionStorage|indexedDB)\b|document\.cookie/.exec(scripts)
  if (kept !== null) {
    stops.push(
      `The script uses ${kept[0]}. A page in a chat is kept apart from the app and has no storage: the call throws and the rest of the script does not run. Keep what you need in variables.`,
    )
  }
  if (
    /\b100[dsl]?vh\b/.test(styles) ||
    /\b(?:html|body)\b[^{}]*\{[^{}]*\bheight\s*:\s*100%/i.test(styles)
  ) {
    stops.push(
      "A style takes its height from the window (100vh, or height:100% on html or body). The frame grows to fit the page, so the page grows again. Give it a height in pixels, or let what is in it set the height.",
    )
  }

  // A color written out, and not as a fallback inside var(): it will not follow light and dark.
  const bare = styles.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "")
  const colors = [
    ...new Set(
      [...bare.matchAll(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/gi)].map((match) => match[0]),
    ),
  ]
  if (colors.length > 0) {
    notes.push(
      `Colors are written out (${colors.slice(0, 3).join(", ")}${colors.length > 3 ? ", …" : ""}). They will not follow light and dark or the person's color: use the variables.`,
    )
  }
  if (
    /\b(?:html|body)\b[^{}]*\{[^{}]*\bbackground(?:-color)?\s*:(?!\s*(?:transparent|none|inherit))/i.test(
      styles,
    )
  ) {
    notes.push(
      "html or body is given a background. In a chat the page sits on the chat's own background: leave it with none.",
    )
  }
  const loaded = [
    ...new Set(
      [
        ...html.matchAll(
          /<(?:script|link|img|iframe|video|audio|source)\b[^>]*?\s(?:src|href)\s*=\s*["']?(https?:)?\/\/([^\s"'/>]+)/gi,
        ),
      ].map((match) => match[2]!),
    ),
  ]
  if (loaded.length > 0) {
    notes.push(
      `It loads from ${loaded.slice(0, 3).join(", ")}. Write the page whole unless the person asked for something that needs this: what is loaded from elsewhere may not arrive, and tells that site who is reading.`,
    )
  }
  const wide = /\b(?:min-)?width\s*:\s*(\d{3,})px/i.exec(styles)
  if (wide !== null && Number(wide[1]) > 600) {
    notes.push(
      `Something is ${wide[1]}px wide. The reply is about 720px wide on a computer and 340px on a phone: use fluid widths.`,
    )
  }
  return { stops, notes }
}

/**
 * The widths a visual's height is measured at, from a small phone to a reply on a computer.
 * A reply is about 350 wide on a phone and about 690 on a computer, so those are measured on
 * either side, and a few between for a window made narrow.
 */
export const VISUAL_MEASURED_WIDTHS = [320, 360, 440, 560, 680, 760] as const
/** What a reply is on a phone and on a computer, of those: what an agent is told the height at. */
export const VISUAL_PHONE_WIDTH = 360
export const VISUAL_COMPUTER_WIDTH = 680

/** How tall a page was measured to be, at each of some widths: narrowest first. */
export type VisualHeights = readonly (readonly [width: number, height: number])[]

/** What was measured, where `value` is that: a few pairs of whole numbers within bounds. */
export function readVisualHeights(value: unknown): VisualHeights | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return undefined
  const heights: [number, number][] = []
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2) return undefined
    const [width, height] = pair as unknown[]
    if (typeof width !== "number" || typeof height !== "number") return undefined
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      return undefined
    }
    heights.push([Math.round(width), visualFrameHeight(height)])
  }
  return heights.sort((a, b) => a[0] - b[0])
}

/**
 * How tall a page is taken to be at `width`, from what was measured: the taller of the two
 * measured widths it lies between, since a page that changes its layout somewhere between
 * them may be as tall as either.
 */
export function visualHeightAt(heights: VisualHeights, width: number): number | undefined {
  if (heights.length === 0) return undefined
  const above = heights.findIndex(([measured]) => measured >= width)
  const high = above === -1 ? heights.length - 1 : above
  const low = heights[high]![0] === width ? high : Math.max(0, high - 1)
  return Math.max(heights[low]![1], heights[high]![1])
}

/**
 * The document a browser is given to draw a visual the way a chat shows it, for the agent to
 * look at before the person does: the page as it would be kept, in a frame kept apart as the
 * chat's is, on the chat's background, as tall as the page says it is. So what the agent sees
 * is what the person will, and a page that would break in the chat breaks here.
 *
 * `base` is the app's address, for the typefaces the page is given to load from. The document
 * says when it is ready with `window.dcReady`: once the page has loaded and had a moment to
 * draw what its scripts draw.
 */
export function visualPreviewDocument(
  html: string,
  options: { appearance: "light" | "dark"; base?: string },
): string {
  const canvas = THEME_TOKENS.find((token) => token.name === "--canvas")!
  const background = options.appearance === "dark" ? (canvas.dark ?? canvas.light) : canvas.light
  // As a chat's frame tells it: in the reply, in these colors. There is no address to say so by.
  let page = prepareVisual(html).replace(
    `${PAGE_ATTRIBUTE}="visual"`,
    `${PAGE_ATTRIBUTE}="visual" ${INLINE_ATTRIBUTE} ${THEME_ATTRIBUTE}="${options.appearance}"`,
  )
  if (options.base !== undefined && /^https?:\/\/[^\s"'<>]+$/.test(options.base)) {
    page = page.replace(
      `<style id="${STYLE_ID}">`,
      `<base href="${options.base.replace(/\/*$/, "/")}"><style id="${STYLE_ID}">`,
    )
  }
  // Written into a script, where the one thing it must not say is that the script has ended.
  const written = JSON.stringify(page).replace(/</g, "\\u003c")
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `html,body{margin:0;background:${background}}` +
    `iframe{display:block;width:100%;height:${VISUAL_DEFAULT_HEIGHT}px;border:0;color-scheme:${options.appearance}}` +
    `</style></head><body><iframe id="page" sandbox="allow-scripts allow-popups allow-forms allow-modals"></iframe>` +
    `<script>(function(){var f=document.getElementById("page");` +
    `window.dcReady=new Promise(function(done){f.addEventListener("load",function(){setTimeout(done,350)})});` +
    `window.addEventListener("message",function(e){var d=e.data,h=d&&d.params&&d.params.height;` +
    `if(e.source!==f.contentWindow||!d||d.method!==${JSON.stringify(SIZE_CHANGED)}||typeof h!=="number"||!(h>0))return;` +
    `f.style.height=Math.min(${VISUAL_MAX_HEIGHT},Math.max(${VISUAL_MIN_HEIGHT},Math.round(h)))+"px";});` +
    `f.srcdoc=${written};})();</script></body></html>`
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
  "Scripts run, but the page is kept apart from the app: it has no storage and cannot reach the person's session or the library's other files, so put the data it shows in the page. A link to another site opens in a new tab.",
  "The page can speak to the chat through window.dc: dc.say(text) puts text in the person's message box for them to send, which is how a choice they press in the page reaches you; dc.expand() shows the page large and dc.expand(false) puts it back; dc.save(name, text, type) hands them a file, such as the CSV behind a chart.",
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

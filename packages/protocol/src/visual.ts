/**
 * A visual is a page an agent draws into a chat: a chart, a table, a diagram. The agent writes
 * one self-contained HTML document. It is kept in the library, with a few lines put in its head
 * that give it the app's colors and let it speak to whatever shows it, and a client shows it in
 * a frame kept apart from the app, on the chat's own background and as tall as the page is.
 *
 * The page and its frame speak the MCP Apps messages (JSON-RPC over `postMessage`), so that a
 * page written for one host that speaks them is at home in another:
 * https://github.com/modelcontextprotocol/ext-apps
 */

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
  appearance: "light" | "dark"
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

/**
 * The app's own colors, as the app's stylesheet has them: every surface is the canvas with some
 * ink mixed in, and the one accent takes its hue from the agent's color.
 */
const SHARED_VARIABLES =
  "--background:var(--canvas);--foreground:var(--ink);--card:var(--canvas);--card-foreground:var(--ink);" +
  "--popover-foreground:var(--ink);--secondary-foreground:var(--ink);--accent-foreground:var(--ink);" +
  "--muted-foreground:color-mix(in oklch,var(--ink) 62%,var(--canvas));" +
  "--border:color-mix(in oklch,var(--ink) 13%,var(--canvas));--ring:var(--primary);--chart-1:var(--primary);" +
  "--radius:0.5rem;--font-sans:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;" +
  "--font-mono:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;"
const LIGHT_VARIABLES =
  "color-scheme:light;--canvas:oklch(0.985 0.003 212);--ink:oklch(0.27 0.008 212);--popover:var(--canvas);" +
  "--primary:oklch(from var(--agent-color) 0.5 c h);--primary-foreground:oklch(from var(--agent-color) 0.985 0.01 h);" +
  "--secondary:color-mix(in oklch,var(--ink) 7%,var(--canvas));--muted:color-mix(in oklch,var(--ink) 6%,var(--canvas));" +
  "--accent:color-mix(in oklch,var(--ink) 8%,var(--canvas));--input:color-mix(in oklch,var(--ink) 22%,var(--canvas));" +
  "--surface:color-mix(in oklch,var(--ink) 4%,var(--canvas));--destructive:oklch(0.5 0.19 26);" +
  "--success:oklch(0.52 0.13 155);--warning:oklch(0.6 0.13 75);" +
  "--chart-2:oklch(0.62 0.15 60);--chart-3:oklch(0.52 0.19 300);--chart-4:oklch(0.56 0.2 15);" +
  "--chart-5:oklch(0.58 0.15 135);--chart-6:oklch(0.55 0.14 245);"
const DARK_VARIABLES =
  "color-scheme:dark;--canvas:oklch(0.19 0.004 212);--ink:oklch(0.9 0.006 212);" +
  "--popover:color-mix(in oklch,var(--ink) 5%,var(--canvas));" +
  "--primary:oklch(from var(--agent-color) 0.52 c h);--primary-foreground:oklch(from var(--agent-color) 0.97 0.012 h);" +
  "--secondary:color-mix(in oklch,var(--ink) 9%,var(--canvas));--muted:color-mix(in oklch,var(--ink) 8%,var(--canvas));" +
  "--accent:color-mix(in oklch,var(--ink) 11%,var(--canvas));--input:color-mix(in oklch,var(--ink) 20%,var(--canvas));" +
  "--surface:color-mix(in oklch,var(--ink) 5%,var(--canvas));--destructive:oklch(0.7 0.17 24);" +
  "--success:oklch(0.74 0.14 155);--warning:oklch(0.8 0.13 80);" +
  "--chart-2:oklch(0.8 0.14 80);--chart-3:oklch(0.74 0.15 300);--chart-4:oklch(0.72 0.16 15);" +
  "--chart-5:oklch(0.8 0.16 130);--chart-6:oklch(0.74 0.12 240);"

/**
 * The stylesheet a visual starts from. A client says whether it is light or dark by an attribute
 * on the root; a page nobody is showing, such as one opened from a download, follows the system.
 * The page's own styles come after this and win. The scrollbar is hidden because one inside a
 * reply reads as a box within the chat.
 */
const THEME_CSS =
  `:root{--agent-color:oklch(0.5 0.08 195);${SHARED_VARIABLES}${LIGHT_VARIABLES}}` +
  `:root[data-${THEME_KEY}="dark"]{${DARK_VARIABLES}}` +
  `@media (prefers-color-scheme:dark){:root:not([data-${THEME_KEY}]){${DARK_VARIABLES}}}` +
  "html{background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-size:14px;" +
  "line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;scrollbar-width:none}" +
  "html::-webkit-scrollbar{display:none}body{margin:0}" +
  // By itself, in a tab or a viewer, it is a page with margins and a measure. In a chat it has
  // neither: the answer around it gives it both.
  ":root:not([data-dc-inline]) body{max-width:720px;margin:0 auto;padding:24px}" +
  "code,kbd,pre,samp{font-family:var(--font-mono)}" +
  "a{color:inherit;text-underline-offset:3px}"

/**
 * Runs in the head, before the page's own styles and body, so the first paint is already in the
 * client's colors. The theme arrives in the address's fragment, which is then dropped so that a
 * page's own use of the fragment never meets it, and again by message whenever it changes. A
 * page in a frame says how tall it is, so the frame can fit it. A link to somewhere else never
 * replaces the page where it is shown: in a chat the client is asked to open it, and anywhere
 * else it opens in a new tab.
 */
const BOOTSTRAP_SCRIPT =
  `(function(){var r=document.documentElement,f=window.parent!==window,k=false,n=0,h,o;` +
  `function a(t){if(!t||typeof t!=="object")return;` +
  `if(t.inline===true&&f){k=true;r.setAttribute("data-dc-inline","");}` +
  `if(t.appearance==="light"||t.appearance==="dark")r.setAttribute("data-${THEME_KEY}",t.appearance);` +
  `if(typeof t.color==="string"&&/^[a-z0-9 .,%()#-]{1,80}$/i.test(t.color))r.style.setProperty("--agent-color",t.color);}` +
  `try{var m=/[#&]${THEME_KEY}=([^&]*)/.exec(location.hash);if(m){a(JSON.parse(decodeURIComponent(m[1])));` +
  `history.replaceState(history.state,"",location.pathname+location.search);}}catch(e){}` +
  `window.addEventListener("message",function(e){var d=e.data,p=d&&d.params;` +
  `if(e.source!==window.parent||!d||d.jsonrpc!=="2.0"||d.method!==${JSON.stringify(HOST_CONTEXT_CHANGED)}||!p)return;` +
  `a({appearance:p.theme,color:p.styles&&p.styles.variables&&p.styles.variables["--agent-color"]});});` +
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

/**
 * A visual's page as it is kept: what the agent wrote, with the app's colors and the few lines
 * that speak to a client put at the start of its head, before anything of the page's own. A page
 * that has them already is left as it is.
 */
export function prepareVisual(html: string): string {
  if (html.includes(`id="${STYLE_ID}"`)) return html
  const scan = markupOf(html)
  const head = [
    /<meta\s[^>]*charset/i.test(scan.slice(0, 4096)) ? "" : '<meta charset="utf-8">',
    /<meta\s[^>]*name\s*=\s*["']?viewport/i.test(scan)
      ? ""
      : '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style id="${STYLE_ID}">${THEME_CSS}</style>`,
    `<script>${BOOTSTRAP_SCRIPT}</script>`,
  ].join("")
  const after = (match: RegExpExecArray) => match.index + match[0].length
  const headOpen = /<head(?:\s[^>]*)?>/i.exec(scan)
  if (headOpen !== null) {
    return html.slice(0, after(headOpen)) + head + html.slice(after(headOpen))
  }
  const htmlOpen = /<html(?:\s[^>]*)?>/i.exec(scan)
  if (htmlOpen !== null) {
    return `${html.slice(0, after(htmlOpen))}<head>${head}</head>${html.slice(after(htmlOpen))}`
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  if (doctype !== null) {
    return `${doctype[0]}<head>${head}</head>${html.slice(doctype[0].length)}`
  }
  return `<!doctype html><head>${head}</head>${html}`
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

/** What an agent is told a visual's page is given, in the tool's description. */
export const VISUAL_GUIDE = [
  "The page is shown with no border on the chat's own background, as wide as your reply (about 720px on a computer, about 340px on a phone), with its left edge where your text begins.",
  "So leave html and body with no background, use a fluid width with no padding on the outermost element, and put no card, frame or heading banner around the whole page: it is part of your reply.",
  "A box that needs a background of its own gets at least 16px of padding and var(--radius) corners.",
  "Let the content set the height: no 100vh, and no height:100% on html or body. Give a chart a fixed height in pixels. The frame grows to fit the page; past 1600px it scrolls.",
  "The app's colors are set on :root as CSS variables, and follow the person's light or dark mode: --background, --foreground, --muted, --muted-foreground, --card, --surface, --border, --input, --primary, --primary-foreground (the accent), --secondary, --accent (a quiet hover surface), --destructive, --success, --warning, --chart-1 to --chart-6 (a series of colors for charts), --radius, --font-sans, --font-mono.",
  "Use them for every color, so the page is right in both modes; text is already --foreground in --font-sans at 14px.",
  "Scripts run, and the page can load a library from a CDN, but it is kept apart from the app: it has no storage and cannot reach the person's session. A link to another site opens in a new tab.",
].join(" ")

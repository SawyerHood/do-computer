/**
 * The app's look, said once: its colors, shapes and type, as the CSS variables everything is
 * drawn with. The web app's own stylesheet is written out from this table
 * (`apps/web/src/theme-tokens.css`), every page of the library is given it when it is served,
 * and what an agent is told about writing a page names what is in it. So the three cannot come
 * to differ.
 *
 * A cool neutral ramp: every surface is the canvas with some ink mixed in, so light and dark
 * stay in step. The one accent is used for the user's own messages and primary actions. It
 * takes its hue from --agent-color, which is teal until an agent is open and that agent's color
 * after: only the hue and how vivid it is are taken, so the accent is as readable for a pale
 * agent as a dark one.
 *
 * There are three levels above the frame the app sits in, and each is a hairline with a shadow
 * under it: raised, for what is chosen in a list; card, for the page; and float, for what is
 * over the page, such as the message box, a menu or a window. In the dark, where a shadow is
 * not seen, each level is a step lighter than the one under it.
 */

export type ThemeToken = {
  readonly name: string
  readonly light: string
  /** What it is in the dark, where that is something else. */
  readonly dark?: string
  /** Given to pages only: the app's stylesheet has it some other way. */
  readonly pageOnly?: true
}

/** A surface: the canvas with this much ink in it. */
const mix = (ink: number) => `color-mix(in oklch, var(--ink) ${ink}%, var(--canvas))`

export const THEME_TOKENS: readonly ThemeToken[] = [
  { name: "--agent-color", light: "oklch(0.5 0.08 195)" },
  { name: "--canvas", light: "oklch(0.997 0.001 212)", dark: "oklch(0.212 0.004 212)" },
  { name: "--ink", light: "oklch(0.27 0.008 212)", dark: "oklch(0.9 0.006 212)" },
  {
    name: "--frame",
    light: "color-mix(in oklch, var(--ink) 4.5%, var(--canvas))",
    dark: "oklch(0.168 0.004 212)",
  },
  {
    name: "--hairline",
    light: "color-mix(in oklch, var(--ink) 10%, transparent)",
    dark: "color-mix(in oklch, var(--ink) 11%, transparent)",
  },
  { name: "--shade", light: "oklch(0.27 0.02 212)" },
  {
    name: "--elevation-raised",
    light: "0 0 0 1px var(--hairline), 0 1px 2px oklch(from var(--shade) l c h / 0.07)",
    dark: "0 0 0 1px var(--hairline), inset 0 1px 0 oklch(1 0 0 / 0.04)",
  },
  {
    name: "--elevation-card",
    light:
      "0 0 0 1px var(--hairline), 0 1px 2px oklch(from var(--shade) l c h / 0.04), " +
      "0 10px 28px -14px oklch(from var(--shade) l c h / 0.12)",
    dark: "0 0 0 1px var(--hairline)",
  },
  {
    name: "--elevation-float",
    light:
      "0 0 0 1px var(--hairline), 0 2px 5px oklch(from var(--shade) l c h / 0.05), " +
      "0 22px 48px -22px oklch(from var(--shade) l c h / 0.26)",
    dark:
      "0 0 0 1px var(--hairline), inset 0 1px 0 oklch(1 0 0 / 0.05), " +
      "0 22px 48px -22px oklch(0 0 0 / 0.7)",
  },
  { name: "--background", light: "var(--canvas)" },
  { name: "--foreground", light: "var(--ink)" },
  { name: "--card", light: "var(--canvas)", dark: mix(4) },
  { name: "--card-foreground", light: "var(--ink)" },
  { name: "--popover", light: "var(--canvas)", dark: mix(5) },
  { name: "--popover-foreground", light: "var(--ink)" },
  {
    name: "--primary",
    light: "oklch(from var(--agent-color) 0.5 c h)",
    dark: "oklch(from var(--agent-color) 0.52 c h)",
  },
  {
    name: "--primary-foreground",
    light: "oklch(from var(--agent-color) 0.985 0.01 h)",
    dark: "oklch(from var(--agent-color) 0.97 0.012 h)",
  },
  { name: "--secondary", light: mix(7), dark: mix(9) },
  { name: "--secondary-foreground", light: "var(--ink)" },
  { name: "--muted", light: mix(6), dark: mix(8) },
  { name: "--muted-foreground", light: mix(62) },
  { name: "--accent", light: mix(8), dark: mix(11) },
  { name: "--accent-foreground", light: "var(--ink)" },
  { name: "--destructive", light: "oklch(0.5 0.19 26)", dark: "oklch(0.7 0.17 24)" },
  { name: "--success", light: "oklch(0.52 0.13 155)", dark: "oklch(0.74 0.14 155)" },
  { name: "--warning", light: "oklch(0.6 0.13 75)", dark: "oklch(0.8 0.13 80)" },
  { name: "--border", light: mix(13) },
  { name: "--input", light: mix(22), dark: mix(20) },
  { name: "--ring", light: "var(--primary)" },
  {
    name: "--rail",
    light: mix(3),
    dark: "color-mix(in oklch, black 22%, var(--canvas))",
  },
  { name: "--surface", light: mix(4), dark: mix(5) },
  // A chart's series: six hues in an order that is kept, starting from the app's own teal.
  // They are the same whichever color the agent is, since a series is known by its color.
  // Each pair that is side by side was measured to be told apart by someone who does not see
  // red from green, in light and in dark, and each shows at 3:1 or better on the page.
  { name: "--chart-1", light: "oklch(0.62 0.105 195)", dark: "oklch(0.63 0.105 195)" },
  { name: "--chart-2", light: "oklch(0.54 0.109 90)", dark: "oklch(0.65 0.132 90)" },
  { name: "--chart-3", light: "oklch(0.58 0.15 270)", dark: "oklch(0.58 0.14 270)" },
  { name: "--chart-4", light: "oklch(0.62 0.15 30)", dark: "oklch(0.65 0.14 30)" },
  { name: "--chart-5", light: "oklch(0.58 0.15 315)", dark: "oklch(0.62 0.14 315)" },
  { name: "--chart-6", light: "oklch(0.54 0.148 150)", dark: "oklch(0.55 0.14 150)" },
  // Code in its colors: what each kind of word in a program is written in. Each was measured
  // in a browser at 4.5:1 or better on the fill a block of code has, in light and in dark.
  { name: "--syntax-keyword", light: "oklch(0.5 0.17 305)", dark: "oklch(0.79 0.12 305)" },
  { name: "--syntax-constant", light: "oklch(0.5 0.14 250)", dark: "oklch(0.79 0.1 245)" },
  { name: "--syntax-string", light: "oklch(0.49 0.12 150)", dark: "oklch(0.8 0.12 150)" },
  { name: "--syntax-function", light: "oklch(0.52 0.12 60)", dark: "oklch(0.82 0.11 80)" },
  { name: "--syntax-parameter", light: "oklch(0.52 0.14 30)", dark: "oklch(0.79 0.1 30)" },
  { name: "--syntax-comment", light: mix(65) },
  { name: "--syntax-punctuation", light: mix(74) },
  { name: "--radius", light: "0.5rem" },
  // The app's own typefaces, then what a device has. The app's stylesheet names them where
  // its other fonts are, and loads them itself.
  {
    name: "--font-sans",
    light:
      '"Geist Variable", "Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, ' +
      '"Segoe UI", sans-serif',
    pageOnly: true,
  },
  {
    name: "--font-mono",
    light: '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    pageOnly: true,
  },
]

const declarations = (tokens: readonly ThemeToken[], mode: "light" | "dark", between = "") =>
  tokens
    .filter((token) => mode === "light" || token.dark !== undefined)
    .map((token) => `${token.name}:${between}${mode === "light" ? token.light : token.dark}`)

/** The app's own stylesheet for its colors, as it is kept in `apps/web/src/theme-tokens.css`. */
export function appThemeCss(): string {
  const own = THEME_TOKENS.filter((token) => token.pageOnly !== true)
  const block = (selector: string, mode: "light" | "dark") =>
    `${selector} {\n${declarations(own, mode, " ")
      .map((line) => `  ${line};\n`)
      .join("")}}\n`
  return (
    "/*\n * Written out from packages/protocol/src/theme.ts, which says what each of these is.\n" +
    " * Change them there, then run `pnpm --filter @do-computer/web theme`.\n */\n" +
    `${block(":root", "light")}\n${block(".dark", "dark")}`
  )
}

/** Where the app serves its typefaces from, for a page that is not the app to load. */
export const THEME_FONTS = {
  "geist.woff2": '"Geist Variable"',
  "geist-mono.woff2": '"Geist Mono Variable"',
} as const
export type ThemeFont = keyof typeof THEME_FONTS
export const THEME_FONT_PATH = "/theme"

/** The letters the fonts served have: Latin. Anything else is drawn in the device's own. */
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329," +
  "U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"

// A page is served from the app's own address, so the path alone finds the font. A copy of the
// page opened from somewhere else finds none and is drawn in the device's own.
const FONT_FACES = Object.entries(THEME_FONTS)
  .map(
    ([file, family]) =>
      `@font-face{font-family:${family};font-style:normal;font-weight:100 900;font-display:swap;` +
      `src:url(${THEME_FONT_PATH}/${file}) format("woff2");unicode-range:${LATIN}}`,
  )
  .join("")

/** What a page's root says of itself, and is told. */
export const PAGE_ATTRIBUTE = "data-dc-page"
export const THEME_ATTRIBUTE = "data-dc-theme"
export const INLINE_ATTRIBUTE = "data-dc-inline"

const DARK = declarations(THEME_TOKENS, "dark").join(";")
const BASE = `:root[${PAGE_ATTRIBUTE}]`

/**
 * What is put in a page for it to be in the app's look.
 *
 * The variables are there for every page, and do nothing to one that does not use them: each
 * rule is in `:where()`, which is beaten by anything a page says itself. Whoever shows the page
 * says whether it is light or dark by an attribute on the root; a page nobody is showing, such
 * as one opened in a tab of its own, follows the system.
 *
 * A page that asks for it, by `data-dc-page` on its root, also starts from the app's own page:
 * its background, its text and the way it sets a table or a field. Those are in `:where()` too,
 * so the page's own styles win wherever it has any.
 *
 * A visual is a page written to be part of an answer. Shown by itself, in a tab or a viewer, it
 * is given margins and a measure; in a chat it has neither, since the answer around it gives it
 * both, and its scrollbar is hidden because one inside a reply reads as a box within the chat.
 */
export const PAGE_THEME_CSS =
  FONT_FACES +
  `:where(:root){${declarations(THEME_TOKENS, "light").join(";")}}` +
  `:where(:root[${THEME_ATTRIBUTE}="dark"]){${DARK}}` +
  `@media (prefers-color-scheme:dark){:where(:root:not([${THEME_ATTRIBUTE}])){${DARK}}}` +
  `:where(${BASE}){color-scheme:light;background:var(--background);color:var(--foreground);` +
  "font-family:var(--font-sans);font-size:14px;line-height:1.5;letter-spacing:-0.006em;" +
  "-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}" +
  `:where(${BASE}[${THEME_ATTRIBUTE}="dark"]){color-scheme:dark}` +
  `@media (prefers-color-scheme:dark){:where(${BASE}:not([${THEME_ATTRIBUTE}])){color-scheme:dark}}` +
  `:where(${BASE} *,${BASE} ::before,${BASE} ::after){box-sizing:border-box}` +
  `:where(${BASE} body){margin:0}` +
  `:where(${BASE}:not([${INLINE_ATTRIBUTE}]) body){padding:clamp(16px,4vw,32px)}` +
  `:where(${BASE}) :where(h1,h2,h3,h4){font-weight:600;line-height:1.25;letter-spacing:-0.01em}` +
  `:where(${BASE}) :where(code,kbd,pre,samp){font-family:var(--font-mono)}` +
  `:where(${BASE}) :where(a){color:inherit;text-underline-offset:3px}` +
  `:where(${BASE}) :where(img,svg,video,canvas){max-width:100%}` +
  `:where(${BASE}) :where(table){border-collapse:collapse;font-variant-numeric:tabular-nums}` +
  `:where(${BASE}) :where(th,td){padding:8px 12px;border-bottom:1px solid var(--border);text-align:left}` +
  `:where(${BASE}) :where(th){font-weight:500;color:var(--muted-foreground)}` +
  `:where(${BASE}) :where(hr){border:0;border-top:1px solid var(--border)}` +
  `:where(${BASE}) :where(button,input,select,textarea){font:inherit;color:inherit}` +
  `:where(${BASE}) :where(:focus-visible){outline:2px solid var(--ring);outline-offset:2px}` +
  `${BASE}[${INLINE_ATTRIBUTE}]{scrollbar-width:none}${BASE}[${INLINE_ATTRIBUTE}]::-webkit-scrollbar{display:none}` +
  `:root[${PAGE_ATTRIBUTE}="visual"]:not([${INLINE_ATTRIBUTE}]) body{max-width:720px;margin:0 auto;padding:24px}`

/** The names of the variables a page is given. */
export const THEME_TOKEN_NAMES: readonly string[] = THEME_TOKENS.map((token) => token.name)

/**
 * How a page should look, as an agent is told it: the same for a page drawn into a chat and
 * for one kept in the library. It names only what `THEME_TOKENS` has.
 */
export const PAGE_STYLE_GUIDE = [
  "The app gives every page it shows its own design tokens, as CSS variables on :root. They follow the person's light or dark mode and your own color while the page is open, so use them for every color and write no hex, rgb or named color of your own.",
  "Surfaces: --background (the page), --card (a raised box), --surface and --muted (quiet fills), --accent (a hover or a chosen row).",
  "Text: --foreground, and --muted-foreground for labels, captions and axes.",
  "Lines: --border, --input for the edge of a field, --ring for focus.",
  "The accent: --primary for a fill, with --primary-foreground for what is written on it; it is too dim for text on the page.",
  "Meaning: --success, --warning, --destructive.",
  "Charts: --chart-1 to --chart-6, one per series and always in that order; they are for marks, never for text.",
  "Shape and type: --radius for corners, --elevation-card and --elevation-float as a box-shadow, --font-sans, --font-mono.",
  "Type: text is 14px in --font-sans; use three sizes at most (20px a title, 16px a heading, 12 or 13px a label), weight 600 for headings and 500 for labels, and font-variant-numeric: tabular-nums wherever figures line up.",
  "Space: steps of 4px. 8 within a group, 16 between groups and as a box's padding, 24 to 32 between sections.",
  "Contrast: write only in --foreground or --muted-foreground on a surface, and on a filled color only in its own -foreground. Never let color alone carry a meaning: name a series beside its line or in a legend, and put a word or a sign with a good or bad figure.",
  "Charts: draw them yourself as inline SVG with a viewBox and width:100%, grid lines in --border, axis labels in --muted-foreground at 12px, and a table of the figures where they matter.",
  "Width: the page is read at 320px and at 1200px. Use fluid widths, grid with repeat(auto-fit, minmax(…)), and overflow-x:auto around a wide table; nothing should scroll sideways.",
  "Write the page whole, with its styles, scripts and drawings inline: load nothing from a CDN unless the person asks for something that needs it.",
].join(" ")

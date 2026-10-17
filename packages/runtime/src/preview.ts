/**
 * A page as a browser draws it, for an agent to look at: a picture of it, how tall it is at
 * the widths it will be read at, and what it wrote to its console. The page is one the agent
 * is about to show, given whole, or one that is already served somewhere, given by its address.
 *
 * Where the browser is depends on where the server runs: Cloudflare's own on a Worker, a Chrome
 * on the machine under Node. Both are driven through Puppeteer, so what is done with a page is
 * written once, here, against the little of Puppeteer's `Page` that it needs.
 */

export type PreviewLine = {
  readonly level: "log" | "info" | "warning" | "error"
  readonly text: string
}

export type PagePreview = {
  /** A picture of the page from its top, as base64, at `width`. */
  readonly picture: string
  /** What kind of picture it is: a JPEG from a browser, which is a fraction of a PNG of a page. */
  readonly mimeType: "image/jpeg" | "image/png"
  readonly width: number
  /** How much of the page's height is in the picture. */
  readonly pictured: number
  /** How far down the page the picture starts, where that is not its top. */
  readonly top?: number
  /** How tall the page is at each width that was asked, narrowest first. */
  readonly heights: readonly (readonly [width: number, height: number])[]
  /** What the page wrote to its console, and what failed in it, in order. */
  readonly console: readonly PreviewLine[]
}

/**
 * What to draw: a document given whole, or the address of one that is served somewhere. Either
 * may say when it is ready to be looked at by keeping a promise in `window.dcReady`; one that
 * keeps none is looked at once it has loaded.
 */
type Drawn =
  | { readonly html: string; readonly url?: undefined }
  /** Gone to as a reader would go to it, in a window, so it is as tall as its window at least. */
  | { readonly url: string; readonly html?: undefined }

export type PreviewRequest = Drawn & {
  /** The width the picture is taken at. */
  readonly width: number
  /** The widths its height is measured at. */
  readonly widths: readonly number[]
  /** How far down the page the picture starts. Its top, unless this says. */
  readonly top?: number
  /** The most of the page's height to picture, where that is less than is ever pictured. */
  readonly most?: number
  /** Whether the reader's device is light or dark, for a page that follows it. */
  readonly appearance?: "light" | "dark"
}

export interface PagePreviewer {
  preview(request: PreviewRequest): Promise<PagePreview>
}

/** A preview that could not be made, with why, in words for whoever asked. */
export class PreviewError extends Error {}

/**
 * How good the JPEG of a page is. The agent keeps every picture it was shown for as long as its
 * chat lasts, and sends them all with every request, so a page's picture is a JPEG, several
 * times smaller than a PNG of it, at a quality whose words still read clearly.
 */
const PICTURE_QUALITY = 80
/** The most of a page's height that is pictured. */
export const MAX_PICTURED_HEIGHT = 2000
/** How tall the window is that a page is drawn in. */
export const PREVIEW_WINDOW_HEIGHT = 800
/** How long a page has to load. */
const LOAD_MS = 8_000
const MAX_LINES = 30
const MAX_LINE_CHARS = 400

/** The part of Puppeteer's `Page` a preview uses, as both Puppeteers in use here have it. */
export type PreviewPage = {
  setViewport(viewport: {
    width: number
    height: number
    deviceScaleFactor: number
  }): Promise<unknown>
  // biome-ignore lint/suspicious/noExplicitAny: what is heard differs by what is listened for
  on(event: "console" | "pageerror", listener: (heard: any) => void): unknown
  setContent(html: string, options: { waitUntil: "load"; timeout: number }): Promise<unknown>
  goto(
    url: string,
    options: { waitUntil: "load"; timeout: number },
  ): Promise<{ status(): number } | null>
  emulateMediaFeatures(features: { name: string; value: string }[]): Promise<unknown>
  evaluate(script: string): Promise<unknown>
  screenshot(options: {
    type: "jpeg"
    quality: number
    encoding: "base64"
    clip: { x: number; y: number; width: number; height: number }
  }): Promise<unknown>
}

const LEVELS: Record<string, PreviewLine["level"]> = {
  log: "log",
  debug: "log",
  info: "info",
  warn: "warning",
  warning: "warning",
  error: "error",
  assert: "error",
}

/**
 * Wait for the page to say it is ready, and then for it to be drawn. Answers how tall what is
 * in it is: its body, since the document itself is never shorter than the window.
 */
const SETTLED =
  "Promise.resolve(window.dcReady).catch(function(){}).then(function(){return new Promise(function(done){" +
  "requestAnimationFrame(function(){requestAnimationFrame(function(){setTimeout(function(){" +
  "done(Math.ceil(document.body.getBoundingClientRect().height))},120)})})})})"

/**
 * The same for a page gone to at its address, which nobody wrote to be looked at here: its
 * typefaces are waited for a while, and what its scripts draw once it has loaded is given a
 * moment. Answers how far the page scrolls, which is its window's height where it all fits.
 */
const SETTLED_IN_WINDOW =
  "Promise.resolve(window.dcReady).catch(function(){}).then(function(){return Promise.race([" +
  "document.fonts?document.fonts.ready:0,new Promise(function(late){setTimeout(late,1500)})])})" +
  ".catch(function(){}).then(function(){return new Promise(function(done){" +
  "requestAnimationFrame(function(){requestAnimationFrame(function(){setTimeout(function(){" +
  "done(Math.ceil(document.documentElement.scrollHeight))},350)})})})})"

/**
 * Draw `request` in `page`, which is a new one that nothing has been loaded in. The page is
 * loaded once, and then made each width in turn, as a reader's window would be.
 */
export async function previewIn(page: PreviewPage, request: PreviewRequest): Promise<PagePreview> {
  const lines: PreviewLine[] = []
  const note = (level: PreviewLine["level"], text: string) => {
    if (lines.length < MAX_LINES) lines.push({ level, text: text.slice(0, MAX_LINE_CHARS) })
  }
  page.on("console", (message: { type(): string; text(): string }) => {
    const level = LEVELS[String(message.type())]
    if (level !== undefined) note(level, String(message.text()))
  })
  page.on("pageerror", (error: unknown) =>
    note("error", error instanceof Error ? error.message : String(error)),
  )
  const widths = [...new Set([...request.widths, request.width])].sort((a, b) => a - b)
  const window = (width: number) =>
    page.setViewport({ width, height: PREVIEW_WINDOW_HEIGHT, deviceScaleFactor: 1 })
  if (request.appearance !== undefined) {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: request.appearance }])
  }
  await window(request.width)
  if (request.url === undefined) {
    try {
      await page.setContent(request.html, { waitUntil: "load", timeout: LOAD_MS })
    } catch (error) {
      throw new PreviewError(
        `The page did not finish loading in ${LOAD_MS / 1000} seconds: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  } else {
    let answer: { status(): number } | null
    try {
      answer = await page.goto(request.url, { waitUntil: "load", timeout: LOAD_MS })
    } catch (error) {
      // Its address is the permission to read it, and is not said again in what is told of it.
      const why = (error instanceof Error ? error.message : String(error))
        .split("\n")[0]!
        .replace(/ at https?:\/\/\S+/, "")
      throw new PreviewError(
        /timeout/i.test(why)
          ? `The page did not finish loading in ${LOAD_MS / 1000} seconds.`
          : `The browser could not open it where the app serves it: ${why}`,
      )
    }
    const status = answer?.status() ?? 0
    if (status >= 400) {
      throw new PreviewError(`Where the app serves it, the browser was answered with ${status}.`)
    }
  }
  const settled = request.url === undefined ? SETTLED : SETTLED_IN_WINDOW
  const heights: [number, number][] = []
  for (const width of widths) {
    await window(width)
    heights.push([width, Number(await page.evaluate(settled)) || 0])
  }
  // The picture is taken last, at the width it was asked for, of the page as it then is.
  await window(request.width)
  const tall = Number(await page.evaluate(settled)) || 0
  const top = Math.max(0, Math.min(Math.round(request.top ?? 0), tall - 1))
  const most = Math.min(MAX_PICTURED_HEIGHT, Math.max(1, Math.round(request.most ?? Infinity)))
  const pictured = Math.max(1, Math.min(tall - top, most))
  const picture = await page.screenshot({
    type: "jpeg",
    quality: PICTURE_QUALITY,
    encoding: "base64",
    clip: { x: 0, y: top, width: request.width, height: pictured },
  })
  if (typeof picture !== "string") {
    throw new PreviewError("The browser gave no picture of the page.")
  }
  return {
    picture,
    mimeType: "image/jpeg",
    width: request.width,
    pictured,
    ...(top === 0 ? {} : { top }),
    heights,
    console: lines,
  }
}

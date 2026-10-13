/**
 * A page as a browser draws it, for an agent to look at before the person does: a picture of
 * it, how tall it is at the widths it will be read at, and what it wrote to its console.
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
  /** A PNG of the page from its top, as base64, at `width`. */
  readonly png: string
  readonly width: number
  /** How much of the page's height is in the picture. */
  readonly pictured: number
  /** How tall the page is at each width that was asked, narrowest first. */
  readonly heights: readonly (readonly [width: number, height: number])[]
  /** What the page wrote to its console, and what failed in it, in order. */
  readonly console: readonly PreviewLine[]
}

export type PreviewRequest = {
  /**
   * The document to draw, whole. It may say when it is ready to be looked at by keeping a
   * promise in `window.dcReady`; one that keeps none is looked at once it has loaded.
   */
  readonly html: string
  /** The width the picture is taken at. */
  readonly width: number
  /** The widths its height is measured at. */
  readonly widths: readonly number[]
}

export interface PagePreviewer {
  preview(request: PreviewRequest): Promise<PagePreview>
}

/** A preview that could not be made, with why, in words for whoever asked. */
export class PreviewError extends Error {}

/** The most of a page's height that is pictured. */
export const MAX_PICTURED_HEIGHT = 2000
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
  evaluate(script: string): Promise<unknown>
  screenshot(options: {
    type: "png"
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
  await page.setViewport({ width: request.width, height: 800, deviceScaleFactor: 1 })
  try {
    await page.setContent(request.html, { waitUntil: "load", timeout: LOAD_MS })
  } catch (error) {
    throw new PreviewError(
      `The page did not finish loading in ${LOAD_MS / 1000} seconds: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const heights: [number, number][] = []
  for (const width of widths) {
    await page.setViewport({ width, height: 800, deviceScaleFactor: 1 })
    heights.push([width, Number(await page.evaluate(SETTLED)) || 0])
  }
  // The picture is taken last, at the width it was asked for, of the page as it then is.
  await page.setViewport({ width: request.width, height: 800, deviceScaleFactor: 1 })
  const tall = Number(await page.evaluate(SETTLED)) || 0
  const pictured = Math.max(1, Math.min(tall, MAX_PICTURED_HEIGHT))
  const png = await page.screenshot({
    type: "png",
    encoding: "base64",
    clip: { x: 0, y: 0, width: request.width, height: pictured },
  })
  if (typeof png !== "string") throw new PreviewError("The browser gave no picture of the page.")
  return { png, width: request.width, pictured, heights, console: lines }
}

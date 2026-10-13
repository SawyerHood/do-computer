import puppeteer, { type Browser } from "@cloudflare/puppeteer"
import { type PagePreviewer, PreviewError, previewIn } from "../preview.ts"

/** How many previews share one browser before another is started. */
const PAGES_A_BROWSER = 6

/**
 * A browser of Cloudflare's to draw in: one that is already running and has room, and
 * otherwise a new one. Browsers are counted at once and paid for by the hour, so previews
 * share one, each in a context of its own, and nobody keeps one running: left alone it stops
 * by itself after a minute.
 */
async function browserWithRoom(binding: Fetcher): Promise<Browser> {
  const running = await puppeteer.sessions(binding).catch(() => [])
  // The ones nobody is connected to first: a browser takes one driver at a time.
  for (const session of running.filter((each) => each.connectionId === undefined)) {
    try {
      const browser = await puppeteer.connect(binding, session.sessionId)
      if (browser.browserContexts().length <= PAGES_A_BROWSER) return browser
      browser.disconnect()
    } catch {
      // It stopped, or another preview took it, since it was listed.
    }
  }
  return puppeteer.launch(binding)
}

/**
 * Previews drawn by Browser Run, Cloudflare's headless browser, through the `browser` binding
 * of the Worker. Each preview has a context of its own in a shared browser, closed after, so
 * one page leaves nothing for the next.
 */
export function browserRunPreviewer(binding: Fetcher): PagePreviewer {
  return {
    async preview(request) {
      let browser: Browser
      try {
        browser = await browserWithRoom(binding)
      } catch (error) {
        // Too many at once, or too many started in a short while: the account's limits.
        throw new PreviewError(
          `No browser could be had just now: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      const context = await browser.createBrowserContext()
      try {
        return await previewIn(await context.newPage(), request)
      } finally {
        await context.close().catch(() => {})
        // Left running for the next preview, and to stop by itself when none comes.
        browser.disconnect()
      }
    },
  }
}

import { existsSync } from "node:fs"
import puppeteer from "puppeteer-core"
import { type PagePreviewer, PreviewError, previewIn } from "../preview.ts"

/** Where a Chrome usually is, on the systems a server is run on. */
const USUAL_PLACES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
]

/** The Chrome on this machine: the one named, or the first that is where one usually is. */
export function findChrome(named?: string): string | undefined {
  if (named !== undefined && named !== "") return existsSync(named) ? named : undefined
  return USUAL_PLACES.find((place) => existsSync(place))
}

/** How many pages are drawn at once: each is a browser of its own. */
const AT_ONCE = 2

/**
 * Previews drawn by a Chrome on this machine. Each is a browser started for it and stopped
 * after, with a profile of its own that is thrown away: a page that is looked at leaves
 * nothing for the next.
 */
export function chromePreviewer(executablePath: string): PagePreviewer {
  let busy = 0
  const waiting: (() => void)[] = []
  return {
    async preview(request) {
      if (busy >= AT_ONCE) await new Promise<void>((turn) => waiting.push(turn))
      busy++
      let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined
      try {
        browser = await puppeteer
          .launch({
            executablePath,
            // A Chrome that is only ever headless is started the way it knows.
            headless: /headless[-_]shell/i.test(executablePath) ? "shell" : true,
            // A server is often run as root in a container, where Chrome will not start in
            // its own sandbox. The page is kept apart by the frame it is drawn in.
            args: ["--no-sandbox", "--hide-scrollbars", "--disable-gpu", "--no-first-run"],
          })
          .catch((error: unknown) => {
            throw new PreviewError(
              `The browser on this machine would not start: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
            )
          })
        return await previewIn(await browser.newPage(), request)
      } finally {
        await browser?.close().catch(() => {})
        busy--
        waiting.shift()?.()
      }
    },
  }
}

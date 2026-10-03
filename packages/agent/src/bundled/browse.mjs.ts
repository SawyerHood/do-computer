/**
 * The script shipped with the browsing skill, as text. It runs on the agent's computer, not here,
 * so it is plain JavaScript with no dependency beyond Playwright, which the skill installs.
 */
export const BROWSE_SCRIPT = `#!/usr/bin/env node
// Drive a headless browser from the command line. See SKILL.md in this folder.
import { chromium } from "playwright"

const [command, url, ...rest] = process.argv.slice(2)
const usage = \`usage:
  node browse.mjs text <url>                 the page's title and readable text
  node browse.mjs links <url>                every link on the page, as "text -> address"
  node browse.mjs html <url>                 the page's HTML after scripts have run
  node browse.mjs screenshot <url> <file>    a full-page PNG
  node browse.mjs pdf <url> <file>           the page as a PDF
  node browse.mjs eval <url> <expression>    the JSON of a JavaScript expression run in the page\`

if (!command || !url) {
  console.error(usage)
  process.exit(2)
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  // A container has no user namespace for Chromium's own sandbox.
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(30_000)
  const response = await page.goto(url, { waitUntil: "domcontentloaded" })
  // Let late content arrive, without waiting forever on a page that never goes quiet.
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {})
  const status = response ? response.status() : 0
  if (status >= 400) console.error(\`note: the page answered with HTTP \${status}\`)

  switch (command) {
    case "text": {
      const title = await page.title()
      const text = await page.evaluate(() => document.body?.innerText ?? "")
      console.log(\`# \${title}\\n\${page.url()}\\n\\n\${text.replace(/\\n{3,}/g, "\\n\\n").trim()}\`)
      break
    }
    case "links": {
      const links = await page.evaluate(() =>
        [...document.querySelectorAll("a[href]")].map((a) => [a.innerText.trim().replace(/\\s+/g, " "), a.href]),
      )
      const seen = new Set()
      for (const [text, href] of links) {
        if (seen.has(href) || !/^https?:/.test(href)) continue
        seen.add(href)
        console.log(\`\${text || "(no text)"} -> \${href}\`)
      }
      break
    }
    case "html":
      console.log(await page.content())
      break
    case "screenshot": {
      const file = rest[0] ?? "screenshot.png"
      await page.screenshot({ path: file, fullPage: true })
      console.log(\`saved \${file}\`)
      break
    }
    case "pdf": {
      const file = rest[0] ?? "page.pdf"
      await page.pdf({ path: file, printBackground: true })
      console.log(\`saved \${file}\`)
      break
    }
    case "eval": {
      if (!rest[0]) throw new Error("eval needs an expression")
      console.log(JSON.stringify(await page.evaluate(rest.join(" ")), null, 2))
      break
    }
    default:
      console.error(usage)
      process.exitCode = 2
  }
} finally {
  await browser.close()
}
`

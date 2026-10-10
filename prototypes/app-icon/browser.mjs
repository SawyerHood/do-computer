// Starts a Chromium with the creature's drawing code, its wardrobe and the first run's sky on
// an empty page, as scripts/icons.mjs does.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const here = path.dirname(fileURLToPath(import.meta.url))
export const root = path.join(here, "../..")
const need = createRequire(path.join(root, "apps/web/package.json"))
const { chromium } = need("@playwright/test")

export async function withPage(run) {
  const core = readFileSync(path.join(root, "packages/mascot/src/orb-core.js"), "utf8").replace(
    /\nexport \{ AgentOrbCore \}\s*$/,
    "\n",
  )
  // The sky of the first run, and the island an egg lands on.
  const sky = readFileSync(path.join(root, "packages/mascot/src/sky.js"), "utf8").replace(
    /\nexport \{ AgentOrbSky \}\s*$/,
    "\n",
  )
  const open = sky
  // What a creature can wear.
  const wardrobe = readFileSync(path.join(root, "packages/mascot/src/wardrobe.js"), "utf8").replace(
    /\nexport \{ AgentOrbWardrobe \}\s*$/,
    "\n",
  )
  const three = readFileSync(need.resolve("three/build/three.min.js"), "utf8")
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH ??
      `${process.env.HOME}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  })
  try {
    const page = await browser.newPage()
    page.on("pageerror", (error) => console.error(error))
    await page.setContent(`<!doctype html><script>${three}</script><script>${core}</script><script>${open}</script><script>${wardrobe}</script>`)
    return await run(page, browser)
  } finally {
    await browser.close()
  }
}

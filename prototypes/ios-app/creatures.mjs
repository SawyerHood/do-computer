// Draws the creatures the mock-up shows, with the app's own drawing code, and keeps each as a
// still picture in src/creatures.json. Which creatures, and what each wears, is in
// src/creatures-specs.json. Run it again when the specs change: `node creatures.mjs`.
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
const here = new URL(".", import.meta.url)
const require = createRequire(new URL("../../apps/web/package.json", here))
const { chromium } = require("@playwright/test")
const read = (p) => readFileSync(new URL(p, here), "utf8")
const three = readFileSync(require.resolve("three").replace(/build\/.*$/, "build/three.min.js"), "utf8")
const core = read("../../packages/mascot/src/orb-core.js").replace(/\nexport \{ AgentOrbCore \}\s*$/, "\n")
const wardrobe = read("../../packages/mascot/src/wardrobe.js").replace(/\nexport \{ AgentOrbWardrobe \}\s*$/, "\n")
const specs = JSON.parse(read("src/creatures-specs.json"))
const pagePath = `${tmpdir()}/dc-ios-creatures.html`
writeFileSync(pagePath, `<!doctype html><body><script>${three}</script><script>${core}</script><script>${wardrobe}</script></body>`)

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
})
// A creature that is off the screen is not drawn, so the page is tall enough to hold them all.
const page = await browser.newPage({ viewport: { width: 1400, height: 400 + 340 * Math.ceil(specs.length / 4) } })
page.on("pageerror", (error) => console.log("error:", error.message))
await page.goto(`file://${pagePath}`)
const pictures = await page.evaluate(async (specs) => {
  const core = window.AgentOrbCore(window.THREE)
  const wardrobe = window.AgentOrbWardrobe(window.THREE, core)
  const made = specs.map((spec) => {
    const canvas = document.createElement("canvas")
    canvas.style.cssText = `width:${spec.size}px;height:${spec.size}px`
    document.body.appendChild(canvas)
    const orb = core.createOrb(canvas, { seed: spec.seed, color: spec.color, size: spec.size, notice: false })
    if (spec.wear) wardrobe.dress(orb, spec.wear)
    if (spec.state) orb.setState(spec.state, spec.variant)
    return [spec.key, canvas]
  })
  await new Promise((done) => setTimeout(done, 2600))
  return Object.fromEntries(made.map(([key, canvas]) => [key, canvas.toDataURL("image/png")]))
}, specs)
await browser.close()
for (const [key, url] of Object.entries(pictures)) if (url.length < 2000) console.log(`${key} came out empty.`)
writeFileSync(new URL("src/creatures.json", here), JSON.stringify(pictures))
console.log(`Drew ${Object.keys(pictures).length} creatures.`)

// Draws Juniper as it looks at each moment of a call, with the app's own drawing code, and keeps
// each as a still picture in src/stills.json. The page shows the stills only where it cannot draw
// the creature itself (no WebGL). Run it again if the creature's code changes: `node creatures.mjs`.
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
const here = new URL(".", import.meta.url)
const require = createRequire(new URL("../../apps/web/package.json", here))
const { chromium } = require("@playwright/test")
const read = (p) => readFileSync(new URL(p, here), "utf8")
const three = readFileSync(require.resolve("three").replace(/build\/.*$/, "build/three.min.js"), "utf8")
const core = read("../../packages/mascot/src/orb-core.js").replace(/\nexport \{ AgentOrbCore \}\s*$/, "\n")
const who = { seed: "Tarn", color: "#2f8f8a", size: 220 }
const specs = [
  { key: "idle", state: "idle" },
  { key: "listening", state: "listening" },
  { key: "speaking", state: "speaking" },
  { key: "working", state: "working", variant: "search" },
  { key: "thinking", state: "thinking" },
]
const pagePath = `${tmpdir()}/dc-voice-creatures.html`
writeFileSync(pagePath, `<!doctype html><body><script>${three}</script><script>${core}</script></body>`)

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
})
const page = await browser.newPage({ viewport: { width: 1400, height: 700 } })
page.on("pageerror", (error) => console.log("error:", error.message))
await page.goto(`file://${pagePath}`)
const pictures = await page.evaluate(
  async ({ who, specs }) => {
    const core = window.AgentOrbCore(window.THREE)
    const made = specs.map((spec) => {
      const canvas = document.createElement("canvas")
      canvas.style.cssText = `width:${who.size}px;height:${who.size}px`
      document.body.appendChild(canvas)
      const orb = core.createOrb(canvas, { seed: who.seed, color: who.color, size: who.size, notice: false })
      orb.setState(spec.state, spec.variant)
      return [spec.key, canvas, orb]
    })
    // Someone speaking has its mouth open only while words come.
    const talk = setInterval(() => made.forEach(([key, , orb]) => key === "speaking" && orb.feed("token", 0.9)), 60)
    await new Promise((done) => setTimeout(done, 2600))
    clearInterval(talk)
    return Object.fromEntries(made.map(([key, canvas]) => [key, canvas.toDataURL("image/png")]))
  },
  { who, specs },
)
await browser.close()
for (const [key, url] of Object.entries(pictures)) if (url.length < 2000) console.log(`${key} came out empty.`)
writeFileSync(new URL("src/stills.json", here), JSON.stringify(pictures))
console.log(`Drew ${Object.keys(pictures).length} stills.`, Object.entries(pictures).map(([k, v]) => `${k}:${v.length}`).join(" "))

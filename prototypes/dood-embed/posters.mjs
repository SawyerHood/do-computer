// Makes the still pictures X shows before a Dood's page is played in a post, into
// apps/web/public/dood: `hatch.jpg` for /hatch, and `meet-<color>.jpg` for a Dood of each color.
// A Dood's own look cannot be drawn by the server, so a Dood's picture is one of its color and
// not of itself. Run from the repository's root, after `pnpm install`:
//
//   PLAYWRIGHT_CHROMIUM_PATH=<a Chromium> node prototypes/dood-embed/posters.mjs
//
// It needs the network once, for three.js and its font.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
const here = new URL(".", import.meta.url)
const web = new URL("../../apps/web/", here)
const { chromium } = createRequire(web)("@playwright/test")
const read = (p) => readFileSync(new URL(p, here), "utf8").replace(/\s+$/, "")
const plain = (file, name) => {
  const source = read(`../../packages/mascot/src/${file}`)
  const at = source.lastIndexOf(`\nexport { ${name} }`)
  if (at < 0) throw new Error(`${file}: its export line was not found where expected.`)
  return source.slice(0, at).replace(/\n\/\/ The demo page's build drops this line[^\n]*$/, "")
}
const SIDE = 960
const page_ = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@800&display=swap" rel="stylesheet">
<style>
html, body { margin: 0; background: #05071a; }
#app { position: relative; width: ${SIDE}px; height: ${SIDE}px; overflow: hidden; font-family: Inter, system-ui, sans-serif; }
canvas.sky { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }
.egg { position: absolute; top: 0; left: 0; }
.egg canvas { display: block; width: 100%; height: 100%; }
h1 { position: absolute; inset-inline: 0; bottom: 7%; margin: 0; text-align: center; color: #fff; font-size: 76px; font-weight: 800; letter-spacing: -0.02em; text-shadow: 0 5px 0 rgb(0 0 0 / 0.3); }
</style></head><body><div id="app"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>${plain("orb-core.js", "AgentOrbCore")}</script>
<script>${plain("sky.js", "AgentOrbSky")}</script>
<script>${read("src/poster.js")}</script>
</body></html>`
const COLORS = [...read("../../packages/protocol/src/avatars.ts").matchAll(/id: "(\w+)", label: "\w+", hex: "(#\w+)"/g)]
if (COLORS.length !== 8) throw new Error("The colors were not found where expected.")
const out = new URL("public/dood/", web)
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
})
const page = await browser.newPage({ viewport: { width: SIDE, height: SIDE }, deviceScaleFactor: 1 })
await page.setContent(page_, { waitUntil: "networkidle" })
await page.evaluate(() => document.fonts.ready)
const take = async (name, look) => {
  await page.evaluate((o) => window.poster(o), look)
  await page.waitForFunction(() => window.done === true)
  writeFileSync(new URL(name, out), await page.locator("#app").screenshot({ type: "jpeg", quality: 86 }))
  console.log(name)
}
await take("hatch.jpg", { color: "#3f7f9c", seed: "hatch", egg: true, title: "Hatch a Dood" })
for (const [, id, hex] of COLORS) await take(`meet-${id}.jpg`, { color: hex, seed: "pip-7kq2", egg: false })
await browser.close()

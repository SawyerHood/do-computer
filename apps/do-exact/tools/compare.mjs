// Puts each of the React app's pictures (tools/react-shots.mjs) beside this app's of the same
// name (tools/shots.sh), React on the left, into one picture per screen:
//   node tools/compare.mjs     → .exact/shots/compare/<name>.png
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"

const here = new URL(".", import.meta.url).pathname
const shots = resolve(here, "../.exact/shots")
const { chromium } = createRequire(resolve(here, "../../web/package.json"))("@playwright/test")
const out = join(shots, "compare")
mkdirSync(out, { recursive: true })
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
const data = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`
let made = 0
for (const name of readdirSync(join(shots, "react")).filter((n) => n.endsWith(".png"))) {
  const exact = join(shots, "exact", name)
  if (!existsSync(exact)) continue
  await page.setContent(`<body style="margin:0;display:flex;gap:12px;padding:12px;background:#888;font:600 14px system-ui">
    ${[["React", join(shots, "react", name)], ["Exact", exact]].map(([label, file]) => `<figure style="margin:0"><figcaption style="color:#fff;padding:0 0 6px">${label}</figcaption><img src="${data(file)}"></figure>`).join("")}
  </body>`)
  await page.screenshot({ path: join(out, name), fullPage: true })
  made++
}
await browser.close()
console.log(`compare: ${made} pictures in ${out}`)

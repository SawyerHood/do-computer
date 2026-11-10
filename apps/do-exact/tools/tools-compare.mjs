// Side-by-side contact sheets of tools-check.mjs screenshots, Exact and React.
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
const { chromium } = createRequire(new URL("../../web/package.json", import.meta.url))(
  "@playwright/test",
)
const p = new URL(process.argv[2] ?? "../.exact/shots/tools-merged/", import.meta.url).pathname
const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  args: ["--no-sandbox"],
})
const page = await browser.newPage()
for (const size of ["wide", "phone"])
  for (const scheme of ["light", "dark"]) {
    const w = size === "wide" ? 640 : 390
    await page.setViewportSize({ width: w * 2, height: 800 })
    let html =
      "<style>body{margin:0;background:#aaa;font:12px sans-serif}main{display:grid;grid-template-columns:1fr 1fr}figure{margin:0}img{display:block;width:100%}figcaption{padding:4px}</style><main>"
    for (const area of ["skills", "connectors", "computers", "automations", "slack"])
      for (const app of ["exact", "react"])
        html += `<figure><figcaption>${app} ${area} ${size} ${scheme}</figcaption><img src="data:image/png;base64,${readFileSync(p + `${app}-${size}-${scheme}-${area}.png`).toString("base64")}"></figure>`
    await page.setContent(html + "</main>")
    await page.screenshot({
      path: p + `compare-${size}-${scheme}.jpg`,
      fullPage: true,
      type: "jpeg",
      quality: 85,
    })
  }
await browser.close()

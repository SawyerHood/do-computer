// Temporary: asks the app whether it can draw with WebGL, and what its GPU process says.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron as electron } from "@playwright/test"

const packed = process.env.DC_DESKTOP_APP
const extra = (process.env.PROBE_ARGS ?? "").split(" ").filter(Boolean)
const label = `${packed ? "packed" : "unpacked"} ${extra.join(" ")}`
const app = await electron.launch({
  ...(packed ? { executablePath: packed } : {}),
  args: [...(packed ? [] : ["dist/main.cjs"]), "--enable-logging=stderr", ...extra],
  env: { ...process.env, DC_DESKTOP_DATA: mkdtempSync(join(tmpdir(), "dc-probe-")) },
})
let stderr = ""
app.process().stderr?.on("data", (chunk) => (stderr += chunk))
try {
  const page = await app.firstWindow()
  await page.waitForLoadState()
  const web = await page.evaluate(() => {
    const out = {}
    for (const kind of ["webgl2", "webgl"]) {
      const canvas = document.createElement("canvas")
      let error = ""
      canvas.addEventListener("webglcontextcreationerror", (event) => {
        error = event.statusMessage
      })
      const gl = canvas.getContext(kind, {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        powerPreference: "low-power",
      })
      if (!gl) out[kind] = { error }
      else {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info")
        out[kind] = {
          renderer: gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
          vendor: gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
        }
      }
    }
    return out
  })
  const main = await app.evaluate(async ({ app }) => ({
    arch: process.arch,
    version: process.versions.electron,
    chrome: process.versions.chrome,
    status: app.getGPUFeatureStatus(),
    info: await app.getGPUInfo("basic"),
    processes: app.getAppMetrics().map((metric) => `${metric.type}${metric.name ? `:${metric.name}` : ""}`),
  }))
  console.log(`===== ${label}\n${JSON.stringify({ web, main }, null, 2)}`)
} finally {
  await app.close().catch(() => {})
  console.log(`----- stderr of ${label}\n${stderr.slice(0, 6000)}`)
}

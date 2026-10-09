import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { _electron as electron, expect, test } from "@playwright/test"

// The driver that uses the screen for agents is programs made for one system, packed beside
// the app and loaded into it. Whether that works is a fact about each system, and the other
// tests pretend the screen. This one loads the real driver in the real app and asks it the one
// thing that touches nothing and needs nobody's leave: how large the screen is.
const appEntry = fileURLToPath(new URL("../dist/main.cjs", import.meta.url))
const packed = process.env.DC_DESKTOP_APP
const scratch = mkdtempSync(join(tmpdir(), "dc-desktop-driver-"))
const said = join(scratch, "said.txt")

test("the driver that came with the app loads here, and can say how large the screen is", async () => {
  const app = await electron.launch({
    ...(packed ? { executablePath: packed } : {}),
    args: [...(packed ? [] : [appEntry]), "--no-sandbox", "--disable-gpu"],
    env: {
      ...process.env,
      HOME: join(scratch, "home"),
      USERPROFILE: join(scratch, "home"),
      DC_DESKTOP_DATA: join(scratch, "app"),
      DC_DESKTOP_PROBE_DRIVER: said,
    },
  })
  try {
    const read = () => {
      try {
        return readFileSync(said, "utf8")
      } catch {
        return ""
      }
    }
    await expect.poll(read, { timeout: 60_000 }).not.toBe("")
    expect(read()).toMatch(/^ok: .*\d+\s*x\s*\d+/s)
  } finally {
    await app.close().catch(() => {})
  }
})

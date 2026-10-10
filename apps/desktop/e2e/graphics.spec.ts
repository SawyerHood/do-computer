import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { _electron as electron, type ElectronApplication, expect, test } from "@playwright/test"

const appEntry = fileURLToPath(new URL("../dist/main.cjs", import.meta.url))
const packed = process.env.DC_DESKTOP_APP
const scratch = mkdtempSync(join(tmpdir(), "dc-desktop-graphics-"))

let server: Server
let app: ElectronApplication

test.beforeAll(async () => {
  // A page is all the window needs of a deployment here.
  server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html")
    response.end("<!doctype html><title>A page</title>")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const data = join(scratch, "app")
  mkdirSync(data, { recursive: true })
  writeFileSync(
    join(data, "settings.json"),
    JSON.stringify({
      server: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      share: false,
      openAtLogin: false,
    }),
  )
  app = await electron.launch({
    ...(packed ? { executablePath: packed } : {}),
    // Unlike the other tests' app, this one draws in 3D: in software, so that a machine with no
    // graphics card can run it too.
    args: [
      ...(packed ? [] : [appEntry]),
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
    env: {
      ...process.env,
      HOME: join(scratch, "home"),
      USERPROFILE: join(scratch, "home"),
      DC_DESKTOP_DATA: data,
    },
  })
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
  server?.close()
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5 })
})

test("the window can still draw in 3D after the graphics card's process has died twice", async () => {
  await expect.poll(() => app.windows().some((page) => page.url().startsWith("http"))).toBe(true)
  const main = app.windows().find((page) => page.url().startsWith("http"))!
  const draws = () =>
    main.evaluate(() => document.createElement("canvas").getContext("webgl") !== null)
  expect(await draws()).toBe(true)
  // Twice in a few seconds is what makes Chromium refuse 3D to a page from then on. A browser
  // then offers to load the page again; the app has nothing that would.
  for (let times = 0; times < 2; times++) {
    const graphics = await app.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .filter((entry) => entry.type === "GPU")
        .map((entry) => entry.pid),
    )
    expect(graphics.length).toBeGreaterThan(0)
    for (const pid of graphics) process.kill(pid, "SIGKILL")
    await expect
      .poll(() =>
        app.evaluate(
          ({ app }, before) =>
            app
              .getAppMetrics()
              .some((entry) => entry.type === "GPU" && !before.includes(entry.pid)),
          graphics,
        ),
      )
      .toBe(true)
  }
  await expect.poll(draws, { timeout: 15_000 }).toBe(true)
  // And goes on being able to, which a page that had been refused would not.
  await new Promise((resolve) => setTimeout(resolve, 2_000))
  expect(await draws()).toBe(true)
})

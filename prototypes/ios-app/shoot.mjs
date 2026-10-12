// Takes pictures, at a phone's size, of the web app and of the native app's web build, so the
// two can be put side by side. It needs a built server with prototypes/polish/setup.mjs run
// against it, and `pnpm --filter @durable-computer/mobile export:web:test`. See README.md.
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
const here = new URL(".", import.meta.url)
const require = createRequire(new URL("../../apps/web/package.json", here))
const { chromium } = require("@playwright/test")

const base = process.env.DC_URL ?? "http://127.0.0.1:3391"
const work = process.env.DC_WORK ?? "/tmp/dc-polish-work"
const out = process.env.DC_SHOTS ?? new URL("shots/", here).pathname
const only = process.argv[2]
const [juniper, moss] = JSON.parse(readFileSync(`${work}/ids.json`, "utf8"))
const chats = JSON.parse(readFileSync(`${work}/side.json`, "utf8"))
const mobileDist = fileURLToPath(new URL("../../apps/mobile/dist-web-test/", here))
mkdirSync(out, { recursive: true })

const chat = `/a/${juniper}/c/${chats.main}`
const settle = (page, ms = 900) => page.waitForTimeout(ms)
const ready = async (page) => {
  await page.getByRole("textbox", { name: "Message" }).waitFor()
  await settle(page, 700)
}

/** The web app. Each: where to go and what to press before the picture. */
const web = {
  chat: async (page) => {
    await page.goto(base + chat)
    await ready(page)
  },
  "chat-empty": async (page) => {
    await page.goto(`${base}/a/${moss}`)
    await ready(page)
  },
  "chat-side": async (page) => {
    await page.goto(`${base}/a/${juniper}/c/${chats.side}`)
    await ready(page)
  },
  drawer: async (page) => {
    await web.chat(page)
    await page.getByRole("button", { name: "Show the sidebar" }).first().click()
  },
  account: async (page) => {
    await web.drawer(page)
    await page.getByRole("button", { name: /settings and signing out$/ }).click()
  },
  pages: async (page) => {
    await web.chat(page)
    await page.getByRole("button", { name: /: (pages and other agents|another agent)$/ }).click()
  },
  "side-chats": async (page) => {
    await web.chat(page)
    await page.getByRole("button", { name: /'s side chats$/ }).click()
  },
  wardrobe: async (page) => {
    await web.chat(page)
    await page.getByRole("button", { name: /'s wardrobe/ }).first().click()
    await settle(page, 1500)
  },
  ...Object.fromEntries(
    ["library", "automations", "skills", "computers", "connectors", "permissions", "profile", "settings"].map(
      (name) => [
        name,
        async (page) => {
          await page.goto(`${base}/a/${juniper}/${name}`)
          await settle(page, 1500)
        },
      ],
    ),
  ),
  "library-file": async (page) => {
    await page.goto(`${base}/a/${juniper}/library`)
    await page.getByRole("link", { name: "plan.md" }).first().click()
    await settle(page, 1200)
  },
  login: async (page) => {
    await page.goto(`${base}/login`)
    await page.getByLabel("Email").waitFor()
  },
  welcome: async (page) => {
    await page.goto(`${base}/welcome`)
    await settle(page, 3500)
  },
}

/** The native app, as react-native-web draws it under /__mobile. */
const tab = (name) => async (page) => {
  await page.goto(`${base}/__mobile/`)
  await page.getByRole("button", { name: "New chat" }).waitFor()
  if (name) await page.getByRole("tab", { name }).click()
  await settle(page, 1200)
}
const native = {
  chats: tab(null),
  automations: tab("Automations"),
  skills: tab("Skills"),
  library: tab("Library"),
  you: tab("You"),
  chat: async (page) => {
    await page.goto(`${base}/__mobile/chat/${chats.main}`)
    await page.getByLabel("Message", { exact: true }).waitFor()
    await settle(page, 1500)
  },
  "chat-side": async (page) => {
    await page.goto(`${base}/__mobile/chat/${chats.side}`)
    await page.getByLabel("Message", { exact: true }).waitFor()
    await settle(page, 1500)
  },
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
})
const sets = { web, native }
for (const [set, pictures] of Object.entries(sets)) {
  for (const name of Object.keys(pictures)) {
    const file = `${set}-${name}`
    if (only !== undefined && !file.startsWith(only)) continue
    const signedOut = name === "login" || name === "welcome"
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      colorScheme: "light",
      ...(signedOut ? {} : { storageState: `${work}/state.json` }),
    })
    await context.addInitScript(() => localStorage.setItem("dc-theme", "light"))
    const page = await context.newPage()
    if (set === "native") {
      await page.route(/\/__mobile(\/.*)?$/, async (route) => {
        const relative = new URL(route.request().url()).pathname.replace(/^\/__mobile\/?/, "")
        const path = join(mobileDist, relative)
        const isFile = relative !== "" && existsSync(path) && statSync(path).isFile()
        await route.fulfill({ path: isFile ? path : join(mobileDist, "index.html") })
      })
    }
    try {
      await pictures[name](page)
      await page.evaluate(() => document.fonts.ready)
      await settle(page)
      await page.screenshot({ path: `${out}${file}.png` })
      console.log(file)
    } catch (error) {
      await page.screenshot({ path: `${out}${file}-FAILED.png` }).catch(() => {})
      console.log(`${file}: not taken. ${String(error).split("\n")[0]}`)
    }
    await context.close()
  }
}
await browser.close()

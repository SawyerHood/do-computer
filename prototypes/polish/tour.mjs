// Takes a picture of every page of the app as the running server draws it. Run it once against
// a build of the app as it is and once against a build with the restyle, and the two sets can be
// put side by side: `node tour.mjs today`, `node tour.mjs proposed`. A third word takes only the
// pictures whose names start with it. See README.md for what has to be running first.
import { mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
const here = new URL(".", import.meta.url)
const require = createRequire(new URL("../../apps/web/package.json", here))
const { chromium } = require("@playwright/test")

const base = process.env.DC_URL ?? "http://127.0.0.1:3391"
const work = process.env.DC_WORK ?? "/tmp/dc-polish-work"
const state = `${work}/state.json`
const [juniper, moss] = JSON.parse(readFileSync(`${work}/ids.json`, "utf8"))
const chats = JSON.parse(readFileSync(`${work}/side.json`, "utf8"))
const set = process.argv[2] ?? "today"
const only = process.argv[3]
const out = new URL(`shots/${set}/`, here).pathname
mkdirSync(out, { recursive: true })

// What is said in the pictures. The echo model's own answers are swapped for these.
const said = {
  asks: [
    "Can you look at how the pricing page is doing since the redesign and tell me what to change?",
    "Yes, draft the new copy for the middle plan please",
  ],
  answers: [
    `<p>I went through the last 30 days of the analytics export. The redesign helped the top of the page and hurt the middle of it.</p>
<ul>
<li><strong>Visits are up 22%</strong>, 18,240 against 14,950, mostly from the new comparison links.</li>
<li><strong>Sign-ups are flat</strong> at 612, so the rate fell from 4.1% to 3.4%.</li>
<li><strong>The Team plan lost half its clicks.</strong> It took 17% of plan clicks before and takes 9% now.</li>
</ul>
<p>The Team card moved below the fold on a laptop, and its button now says <code>Contact us</code> where it said <code>Start free</code>. I would put the three plans back in one row and give Team its old button. My notes are in <code>library/pricing-notes.md</code>. Shall I draft the new copy for the middle plan?</p>`,
    `<p>Here is a draft for the Team card. It keeps the price where it is and says who the plan is for in the first line.</p>
<blockquote><p><strong>Team</strong>, for groups of 3 to 20. Everyone shares the same agents, files and computers. $24 a person each month, and the first two weeks are free.</p></blockquote>
<p>The button reads <code>Start free</code>. I left the feature list as it was, since nobody clicks past the third line of it.</p>`,
  ],
}
const sideSaid = {
  side: `<p>I wrote the plan down. It has what changes, the numbers to watch and the steps, and it is in the library under <code>pricing</code>.</p>`,
}

/** Puts the mock-up's words in a transcript, and hides what the tools said between them. */
async function swap(page, within, words) {
  await page.evaluate(
    ({ within, words }) => {
      const root = document.querySelector(within)
      // A side chat beside the main one is inside the same page, and is not the main chat's.
      const beside = "aside[aria-label^='Side chat']"
      const items = [...root.querySelectorAll("[data-slot=message-scroller-item]")].filter(
        (item) => root.matches(beside) || item.closest(beside) === null,
      )
      const asks = items.filter((item) => item.querySelector("[data-align=end]"))
      const answers = items.filter((item) => item.querySelector("[data-align=start]"))
      const keep = words.side
        ? [asks[0], answers[0], ...items.filter((item) => item.querySelector("button[title='Open beside the chat']"))]
        : [asks[0], answers[0], asks.at(-1), answers.at(-1)]
      for (const item of items) if (!keep.includes(item)) item.style.display = "none"
      const content = (item) => item.querySelector("[data-slot=bubble-content]")
      const prose = (item) => item.querySelector(".prose-chat") ?? content(item)
      if (words.side) {
        prose(keep[1]).innerHTML = words.side
        for (const item of keep.slice(2)) {
          const text = item.querySelector(".prose-chat")
          if (text) text.closest("[data-slot=bubble]").style.display = "none"
        }
      } else {
        content(keep[0]).textContent = words.asks[0]
        content(keep[2]).textContent = words.asks[1]
        prose(keep[1]).innerHTML = words.answers[0]
        prose(keep[3]).innerHTML = words.answers[1]
      }
      const view = root.querySelector("[data-slot=message-scroller-viewport]")
      view.scrollTop = view.scrollHeight
    },
    { within, words },
  )
}

const settle = (page, ms = 900) => page.waitForTimeout(ms)
const chat = `/a/${juniper}/c/${chats.main}`

/** Each picture: where to go and what to do there before it is taken. */
const pictures = {
  chat: async (page) => {
    await page.goto(base + chat)
    await page.getByText("built-in echo model").last().waitFor()
    await swap(page, "main", said)
  },
  "chat-empty": async (page) => {
    await page.goto(`${base}/a/${moss}`)
    await page.getByRole("textbox", { name: "Message" }).waitFor()
  },
  "chat-side": async (page) => {
    await page.goto(`${base}${chat}?side=${chats.side}`)
    await page.getByRole("complementary", { name: /^Side chat/ }).getByText("Successfully wrote").first().waitFor()
    await swap(page, "main", said)
    await swap(page, "aside[aria-label^='Side chat']", sideSaid)
  },
  "chat-doc": async (page) => {
    await page.goto(`${base}/a/${juniper}/c/${chats.side}`)
    await page.getByTitle("Open beside the chat").first().click()
    await page.getByRole("complementary", { name: "Document" }).getByRole("heading", { level: 1 }).waitFor()
    await swap(page, "main", sideSaid)
  },
  library: async (page) => {
    await page.goto(`${base}/a/${juniper}/library`)
    const files = page.getByRole("navigation", { name: "Files" })
    await files.getByRole("link", { name: "plan.md" }).click()
    await page.getByRole("heading", { name: "Pricing page relaunch", level: 1 }).waitFor()
  },
  "library-edit": async (page) => {
    await pictures.library(page)
    await page.getByRole("button", { name: "Split" }).click()
    await page.getByRole("textbox", { name: "Edit plan.md" }).waitFor()
  },
  automations: async (page) => {
    await page.goto(`${base}/a/${juniper}/automations`)
    await page.getByText("Morning inbox").first().waitFor()
  },
  ...Object.fromEntries(
    ["identity", "memory", "model", "skills", "connectors", "permissions", "usage", "manage"].map((section) => [
      `agent-${section}`,
      async (page) => {
        await page.goto(`${base}${chat}?settings=${section}`)
        await page.getByRole("dialog").waitFor()
        await swap(page, "main", said)
      },
    ]),
  ),
  ...Object.fromEntries(
    ["computers", "models", "agents", "notifications"].map((section) => [
      `workspace-${section}`,
      async (page) => {
        await page.goto(`${base}${chat}?workspace=${section}`)
        await page.getByRole("dialog").waitFor()
        await swap(page, "main", said)
      },
    ]),
  ),
  "menu-account": async (page) => {
    await pictures.chat(page)
    await page.getByRole("button", { name: /settings and signing out$/ }).click()
  },
  "menu-agents": async (page) => {
    await pictures.chat(page)
    await page.getByRole("button", { name: /: another agent$/ }).click()
  },
  "menu-side-chats": async (page) => {
    await pictures.chat(page)
    await page.getByRole("button", { name: /'s side chats$/ }).click()
  },
  wardrobe: async (page) => {
    await pictures.chat(page)
    await page.getByRole("complementary", { name: /^About/ }).getByRole("button", { name: /'s wardrobe$/ }).click()
    await page.getByRole("dialog").waitFor()
    await settle(page, 1500)
  },
  login: async (page) => {
    await page.goto(`${base}/login`)
    await page.getByLabel("Email").waitFor()
  },
  welcome: async (page) => {
    await page.goto(`${base}/welcome`)
    await page.getByRole("button", { name: "Hello!" }).waitFor()
    await settle(page, 2500)
  },
}

/** Which pictures are taken at which size and in which theme, and signed in or not. */
const rounds = [
  { suffix: "", viewport: { width: 1440, height: 900 }, theme: "light", names: Object.keys(pictures) },
  { suffix: "-dark", viewport: { width: 1440, height: 900 }, theme: "dark", names: ["chat", "library", "automations", "agent-identity", "menu-account", "login"] },
  { suffix: "-phone", viewport: { width: 390, height: 844 }, theme: "light", names: ["chat", "chat-empty", "library", "automations", "agent-identity", "login"] },
]

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined })
for (const round of rounds) {
  for (const name of round.names) {
    const file = `${name}${round.suffix}`
    if (only !== undefined && !file.startsWith(only)) continue
    const signedOut = name === "login" || name === "welcome"
    const context = await browser.newContext({
      viewport: round.viewport,
      deviceScaleFactor: 2,
      colorScheme: round.theme,
      ...(signedOut ? {} : { storageState: state }),
    })
    await context.addInitScript((theme) => {
      localStorage.setItem("dc-chat-list", "open")
      localStorage.setItem("dc-theme", theme)
    }, round.theme)
    const page = await context.newPage()
    try {
      await pictures[name](page)
      await page.evaluate(() => document.fonts.ready)
      await settle(page)
      await page.screenshot({ path: `${out}${file}.png` })
      console.log(file)
    } catch (error) {
      console.log(`${file}: not taken. ${String(error).split("\n")[0]}`)
    }
    await context.close()
  }
}
await browser.close()

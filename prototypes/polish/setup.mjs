// Gives a fresh server something to take pictures of: an account, four agents with names, a
// conversation with the first, and a side chat in which it wrote files to its library and set
// up two automations. It leaves the sign-in and what it made where tour.mjs looks for them.
import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url))
const { chromium } = require("@playwright/test")

const base = process.env.DC_URL ?? "http://127.0.0.1:3391"
const work = process.env.DC_WORK ?? "/tmp/dc-polish-work"
mkdirSync(work, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
})
const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const account = { name: "Sawyer", email: "owner@example.com", password: "correct horse battery" }
const made = await page.request.post("/api/auth/sign-up/email", { data: account })
if (made.status() !== 200) throw new Error(`Signing up answered ${made.status()}. Is DC_SIGNUP=open?`)

const agents = [
  ["Juniper", "Research and writing"],
  ["Moss", "Keeps the deploys green"],
  ["Pixel", "Design reviews"],
  ["Otto", "Inbox and calendar"],
]
const ids = []
for (const [name, tagline] of agents) {
  const { agent } = await (await page.request.post("/api/agents")).json()
  await page.request.patch(`/api/agents/${agent.id}`, { data: { name, tagline } })
  ids.push(agent.id)
}

const box = page.getByRole("textbox", { name: "Message" })
const say = async (text, answer) => {
  await box.fill(text)
  await page.keyboard.press("Enter")
  await page.getByText(answer).first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(500)
}
const tool = (name, args) => `/tool ${name} ${JSON.stringify(args)}`

// The main chat: two things said and two answered. tour.mjs puts its own words in their place.
await page.goto(`/a/${ids[0]}`)
await page.waitForURL(/\/c\/\d+/)
const main = page.url()
await say("One", "You said: One")
await say("Two", "You said: Two")

// A side chat, given the whole page so that there is one box to write in.
await page.getByRole("button", { name: /'s side chats$/ }).click()
await page.getByRole("menuitem", { name: "New side chat" }).click()
await page.waitForURL((url) => url.searchParams.has("side"))
await page.waitForTimeout(1500)
await page.getByRole("link", { name: "Give it the whole chat" }).click()
await page.waitForURL((url) => !url.searchParams.has("side") && url.href !== main)
await page.waitForTimeout(1500)
const side = page.url()

const plan = `# Pricing page relaunch

The redesign lifted visits and hurt sign-ups. This is the plan to get both.

## What changes

- The three plans go back in one row on a laptop.
- The Team card gets its old button, \`Start free\`.
- The comparison table moves under the plans.

## Numbers to watch

| Measure | Before | Now | Goal |
| --- | --- | --- | --- |
| Visits a month | 14,950 | 18,240 | 18,000 |
| Sign-up rate | 4.1% | 3.4% | 4.5% |
| Team plan clicks | 17% | 9% | 18% |

## Steps

- [x] Pull thirty days of analytics
- [x] Draft the new Team copy
- [ ] Build the one-row layout
- [ ] Run it against the old page for two weeks

> Keep the price where it is. The copy is what changed, so the copy is what is tested.

\`\`\`sh
pnpm --filter site build && pnpm --filter site preview
\`\`\`
`
await say("Plan the pricing page relaunch", "You said: Plan the pricing page relaunch")
const files = {
  "library/pricing/plan.md": plan,
  "library/pricing/team-copy.md": "# Team card copy\n\n**Team**, for groups of 3 to 20.\n",
  "library/notes/monday.md": "# Monday\n\n- Call with design at ten\n",
  "library/numbers.csv": "measure,before,now\nvisits,14950,18240\nrate,4.1,3.4\n",
}
for (const [path, content] of Object.entries(files)) {
  await say(tool("write", { path, content }), `Successfully wrote to ${path}`)
}
const automations = [
  ["every 6h", "Check the pricing page numbers and say what moved", "Pricing page numbers"],
  ["every 24h", "Read the inbox and list what needs an answer today", "Morning inbox"],
]
for (const [schedule, prompt, title] of automations) {
  await say(tool("schedule", { action: "create", schedule, prompt, title }), `"${title}"`)
}
await box.fill(tool("send_file", { path: "library/pricing/plan.md" }))
await page.keyboard.press("Enter")
await page.getByTitle("Open beside the chat").first().waitFor({ timeout: 20_000 })

const chat = (address) => address.match(/\/c\/(\d+)/)[1]
await context.storageState({ path: `${work}/state.json` })
writeFileSync(`${work}/ids.json`, JSON.stringify(ids))
writeFileSync(`${work}/side.json`, JSON.stringify({ main: chat(main), side: chat(side) }))
console.log(`Ready: ${base}/a/${ids[0]}`)
await browser.close()

import { expect, type Page } from "@playwright/test"
import { test } from "./fixtures.ts"
import {
  asOwner,
  nameMenu,
  composer,
  newChat,
  signIn,
  tab,
  panelSwitch,
  fromNameMenu,
} from "./helpers.ts"

asOwner()

// Calls are open to everyone on this server, and have no voice: the server hands the page a
// script to play, in which the voice hears a question, hands it on to the Dood, says what the
// Dood answers, and then says goodbye. The Dood is the echo model, so nothing leaves the machine.
//
// A call is held in the main chat, where what it hands on goes, and where the Dood sends what
// its voice says. A call whose work goes to a sub-agent is in `calls-work.spec.ts`.
test.use({ settings: { DC_CALLS: "on", DC_CALLS_SCRIPT: "1" } })

const panelOf = (page: Page) => page.getByRole("complementary", { name: "About Juniper" })

/** A chat with something said in it, on a screen wide enough for the Dood's panel. */
async function talking(page: Page) {
  await page.addInitScript(() => localStorage.setItem("dc-agent-panel", "open"))
  await page.setViewportSize({ width: 1500, height: 900 })
  await signIn(page)
  await newChat(page)
  await composer(page).fill("The launch is on Friday.")
  await composer(page).press("Enter")
  await expect(page.getByText("You said: The launch is on Friday.")).toBeVisible()
}

test("a Dood is called: its voice hands on what was asked, says the answer, and the chat keeps the call", async ({
  page,
}) => {
  await talking(page)
  const panel = panelOf(page)
  await panel.getByRole("button", { name: "Call" }).click()

  // The call happens where the Dood's face is: its panel says so, with a clock and the buttons of a call.
  await expect(panel.getByText("On a call")).toBeVisible()
  await expect(panel.getByRole("button", { name: "Mute" })).toBeVisible()
  // The chat holds it as one live card.
  const live = page.getByRole("region", { name: "The call" })
  await expect(live).toContainText("On a call with Juniper")
  await expect(live).toContainText("What did I say before the call?")

  // What the voice handed on is a message in the main chat, where the call is held, marked as
  // said out loud, and the Dood sends its answer there as it would to a typed one. There is no
  // other chat to open.
  await expect(page.getByText("Said on a call")).toBeVisible()
  await expect(live.getByRole("button", { name: "Open it" })).toHaveCount(0)
  await expect(page.getByText("You said: What did I say before the call?")).toHaveCount(2)
  // Its answer went back to the voice, which said it, and the call went on to its end.
  await expect(live).toContainText("You said: What did I say before the call?")
  await expect(live).toContainText("Any time.")
  // The words are under its face too, until they are hidden.
  await expect(panel.getByText("Any time.")).toBeVisible()
  await page.screenshot({ path: "test-results/call.png" })
  await panel.getByRole("button", { name: "Hide words" }).click()
  await expect(panel.getByText("Any time.")).toHaveCount(0)
  await panel.getByRole("button", { name: "Show words" }).click()

  // Muting is said plainly, and taken back.
  await panel.getByRole("button", { name: "Mute" }).click()
  await expect(panel.getByRole("status")).toHaveText("You’re muted")
  await panel.getByRole("button", { name: "Unmute" }).click()

  await panel.getByRole("button", { name: "End" }).click()
  // The panel is the Dood's again, and the chat has one record of the call.
  await expect(panel.getByRole("button", { name: "Call" })).toBeVisible()
  await expect(live).toHaveCount(0)
  const record = page.getByRole("region", { name: "A call" })
  await expect(record).toContainText("Call with Juniper")
  // What was said is folded inside it.
  await expect(record.getByText("Any time.")).toHaveCount(0)
  await record.getByRole("button", { name: "Show what was said" }).click()
  await expect(record).toContainText("What did I say before the call?")
  await expect(record).toContainText("Any time.")
  await page.screenshot({ path: "test-results/call-record.png" })

  // Each thing said is in it once, in the order it was said.
  const [agentId, chatId] = /\/a\/([^/]+)\/c\/([^/?]+)/.exec(page.url())!.slice(1)
  const chat = (await (
    await page.request.get(`/api/agents/${agentId}/chats/${chatId}`)
  ).json()) as {
    messages: { parts: { type: string; call?: { lines: { who: string; text: string }[] } }[] }[]
  }
  const kept = chat.messages.flatMap((message) => message.parts).find((part) => part.call)!.call!
  expect(kept.lines.map((line) => line.who)).toEqual(["you", "dood", "you", "dood"])
  expect(kept.lines[0]!.text).toBe("What did I say before the call?")
  expect(kept.lines[1]!.text).toMatch(/^You said: What did I say before the call\?/)
  expect(kept.lines[2]!.text).toBe("Thanks, that is all.")
  expect(kept.lines[3]!.text).toBe("Any time.")

  // It is still there for whoever opens the chat afresh.
  await page.reload()
  await expect(page.getByRole("region", { name: "A call" })).toContainText("Call with Juniper")
  await expect(page.getByRole("region", { name: "The call" })).toHaveCount(0)
})

test("a call goes on where its Dood's panel is not, as a card in the corner", async ({ page }) => {
  await talking(page)
  await panelOf(page).getByRole("button", { name: "Call" }).click()
  await expect(panelOf(page).getByText("On a call")).toBeVisible()
  // While the panel shows it there is no card: the panel is the call, on each of the Dood's pages.
  const card = page.getByRole("region", { name: "Call with Juniper" })
  await expect(card).toHaveCount(0)
  await tab(page, "Library").click()
  await expect(panelOf(page).getByText("On a call")).toBeVisible()
  await expect(card).toHaveCount(0)

  // With the panel shut the call is still on, and is a card in the corner of the window.
  await panelSwitch(page, "Hide")
  await expect(card).toBeVisible()
  await expect(card.getByRole("status")).toContainText(/Listening|Talking|Working/)
  // The menu on the Dood's name says so too.
  await nameMenu(page).click()
  await expect(page.getByRole("menuitem", { name: "On a call with Juniper" })).toBeVisible()
  await page.keyboard.press("Escape")
  await page.screenshot({ path: "test-results/call-card.png" })

  // It leads back to the chat the call is held in, where the Dood's row in the sidebar says it
  // is on a call.
  await card.getByRole("link", { name: "Back to Juniper" }).click()
  await expect(page.getByRole("region", { name: "The call" })).toBeVisible()
  await expect(page.locator("[data-latest]", { hasText: "On a call" })).toBeVisible()
  // Muted from the card, and ended from it: the record is in the chat all the same.
  await card.getByRole("button", { name: "Mute" }).click()
  await expect(card.getByRole("status")).toContainText("You’re muted")
  await card.getByRole("button", { name: "End the call" }).click()
  await expect(card).toHaveCount(0)
  await expect(page.getByRole("region", { name: "A call" })).toContainText("Call with Juniper")
  // The phone in the strip is how it is called with the panel shut.
  await expect(page.getByRole("button", { name: "Call Juniper" })).toBeEnabled()
})

test("a page that is left ends its call, and the chat still has the record", async ({ page }) => {
  await talking(page)
  await panelOf(page).getByRole("button", { name: "Call" }).click()
  const live = page.getByRole("region", { name: "The call" })
  await expect(live).toContainText("What did I say before the call?")
  // The page is loaded afresh in the middle of the call: the server is told on the way out.
  await page.reload()
  const record = page.getByRole("region", { name: "A call" })
  await expect(record).toContainText("Call with Juniper")
  await expect(page.getByRole("region", { name: "The call" })).toHaveCount(0)
  // The Dood can be called again.
  await expect(panelOf(page).getByRole("button", { name: "Call" })).toBeEnabled()
  await record.getByRole("button", { name: "Show what was said" }).click()
  await expect(record).toContainText("What did I say before the call?")
})

test("its voice is chosen in its settings", async ({ page }) => {
  await talking(page)
  const id = /\/a\/([^/]+)/.exec(page.url())![1]!
  const before = (await (await page.request.get(`/api/agents/${id}/calls`)).json()) as {
    available: boolean
    voice: string
    voices: string[]
  }
  expect(before).toMatchObject({ available: true, dialect: "scripted", voices: ["plain"] })
  await fromNameMenu(page, "Juniper's settings")
  const voices = page.getByRole("radiogroup", { name: "Voice" })
  await expect(voices.getByRole("radio", { name: "plain" })).toBeChecked()
})

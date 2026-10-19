import { expect, type Page } from "@playwright/test"
import { test } from "./fixtures.ts"
import { asOwner, composer, signIn } from "./helpers.ts"

asOwner()

// A call whose voice hands on work: the server plays a script in which what is handed on asks
// the Dood, as a `/tool` line the echo model calls, to hand it to a sub-agent, as a model would
// with anything that takes more than a quick look. Then the person says thanks, and goodbye.
test.use({ settings: { DC_CALLS: "on", DC_CALLS_SCRIPT: "work" } })

// The look the pictures are taken in, where a run asks for them (`DC_SHOTS`).
const scheme = process.env.DC_SHOTS_SCHEME === "dark" ? "dark" : "light"
test.use({ colorScheme: scheme })
async function shot(page: Page, name: string) {
  const folder = process.env.DC_SHOTS
  if (folder) await page.screenshot({ path: `${folder}/${name}-${scheme}.png` })
}

const panelOf = (page: Page) => page.getByRole("complementary", { name: "About Juniper" })

test("a call held in the main chat hands its work to a sub-agent, and leaves its notes there", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("dc-agent-panel", "open"))
  await page.setViewportSize({ width: 1500, height: 900 })
  await signIn(page)
  await composer(page).fill("The launch is on Friday.")
  await composer(page).press("Enter")
  await expect(page.getByText("You said: The launch is on Friday.")).toBeVisible()
  const [agentId, mainId] = /\/a\/([^/]+)\/c\/([^/?]+)/.exec(page.url())!.slice(1)

  await panelOf(page).getByRole("button", { name: "Call" }).click()
  const live = page.getByRole("region", { name: "The call" })
  // What the voice handed on is in the main chat, said out loud, and the Dood starts a sub-agent
  // on it and sends word that it has: that is what its voice says, and the call goes on.
  await expect(page.getByText("Said on a call")).toBeVisible()
  await expect(live).toContainText(/Started sub-agent \d+, "Launch checklist"/)
  await expect(live).toContainText("Any time.")
  // The sub-agent is at work, or done already, and is in the panel or the transcript.
  await shot(page, "call-subagent-live")

  await page
    .getByRole("button", { name: /^End( the call)?$/ })
    .first()
    .click()
  // The main chat has the call's one record, which is the people's and not folded away.
  const record = page.getByRole("region", { name: "A call" })
  await expect(record).toContainText("Call with Juniper")
  // No side chat was made for it: there is nothing to open but the sub-agent.
  await expect(record.getByRole("button", { name: "Open its side chat" })).toHaveCount(0)
  const state = (await (await page.request.get(`/api/agents/${agentId}`)).json()) as {
    chats: { id: string; kind: string; main?: boolean; title: string; parentId?: string }[]
  }
  expect(state.chats.filter((chat) => chat.kind === "chat").map((chat) => chat.id)).toEqual([
    mainId,
  ])
  const sub = state.chats.find((chat) => chat.kind === "subagent")!
  expect(sub).toMatchObject({ title: "Launch checklist", parentId: mainId })

  // The sub-agent's report reaches the main chat as an event, drawn in its place.
  const transcript = page.getByRole("log")
  await expect(transcript.getByText("Launch checklist reported back").last()).toBeVisible({
    timeout: 15_000,
  })
  // The call's notes are an event in the main chat: the agent is told it is over.
  const main = (await (
    await page.request.get(`/api/agents/${agentId}/chats/${mainId}`)
  ).json()) as {
    messages: { role: string; spoken?: unknown; parts: { call?: { chatId?: string } }[] }[]
  }
  expect(main.messages.some((message) => message.spoken !== undefined)).toBe(true)
  const kept = main.messages.flatMap((message) => message.parts).find((part) => part.call)!.call!
  expect(kept.chatId).toBeUndefined()
  await record.scrollIntoViewIfNeeded()
  await shot(page, "call-subagent-record")

  // The sub-agent's own chat is read, and says it was asked from the main chat.
  await page.goto(`/a/${agentId}/c/${sub.id}`)
  await expect(page.getByText("Write the checklist for Friday's launch.").first()).toBeVisible()
  await expect(page.getByText("Only Juniper talks to its sub-agents.")).toBeVisible()
})

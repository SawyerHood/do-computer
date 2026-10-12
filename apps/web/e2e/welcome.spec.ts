import { expect, test } from "./fixtures.ts"
import { card, composer, inOrder, owner } from "./helpers.ts"

inOrder()

// The scene is the same with less motion, without the fall and the waits: what is asked, and
// what comes of the answers, is what these are about.
test.use({ reducedMotion: "reduce" })

test("someone new meets their first agent: it is named as it hatches, and says hello in its chat", async ({
  page,
}) => {
  await page.goto("/welcome")
  await (
    await card(page, /Is somebody out there\?/)
  )
    .getByRole("button", { name: "Hello!" })
    .click()

  // Who they are is making an account.
  const you = await card(page, /who are you\?/)
  await you.getByLabel("Your name").fill(owner.name)
  await you.getByLabel("Email").fill(owner.email)
  await you.getByLabel("Password").fill(owner.password)
  await you.getByRole("button", { name: "That’s me" }).click()

  // It has no name until it is given one, and takes the color it is given too.
  const naming = await card(
    page,
    `Nice to meet you, ${owner.name}. I don’t have a name yet. What will you call me?`,
  )
  await expect(naming.getByRole("button", { name: "That’s your name" })).toBeDisabled()
  await naming.getByRole("button", { name: "Suggest a name" }).click()
  await expect(naming.getByLabel("A name for it")).toHaveValue("Pip")
  await naming.getByRole("radio", { name: "Rose" }).click()
  await naming.getByRole("button", { name: "That’s your name" }).click()

  // What it thinks with is what the deployment includes to begin with, which here is only an
  // echo: with one model there, there is nothing to change it to.
  const thinking = await card(page, "Pip. I like that. What should I think with?")
  const choices = thinking.getByRole("radiogroup", { name: "What it thinks with" })
  await expect(choices.getByRole("radio")).toHaveCount(1)
  const included = choices.getByRole("radio", { name: "Included" })
  await expect(included).toBeChecked()
  await expect(included).toHaveAccessibleDescription(/^Echo/)
  await expect(choices.getByRole("button", { name: /^Change the model/ })).toHaveCount(0)
  // An account of their own is a press away for the two most have, and the rest are behind one more.
  await choices.getByRole("button", { name: "Sign in with Claude", exact: true }).click()
  const claude = page.getByRole("dialog", { name: "Sign in with Claude Pro or Max" })
  await expect(claude.getByRole("link", { name: "Open the sign-in page" })).toBeVisible()
  await claude.getByRole("button", { name: "Cancel" }).click()
  await expect(
    choices.getByRole("button", { name: "Sign in with ChatGPT", exact: true }),
  ).toBeVisible()
  await thinking.getByRole("button", { name: "Other providers" }).click()
  const providers = thinking.getByRole("region", { name: "Model providers" })
  await providers.getByRole("button", { name: "Use a key for Anthropic" }).click()
  const key = page.getByRole("dialog", { name: "Anthropic API key" })
  await key.getByLabel("Key", { exact: true }).fill("sk-ant-api03-not-a-real-key")
  await key.getByRole("button", { name: "Save" }).click()
  await expect(key).toHaveCount(0)
  // Saving a key there is not this card being answered: the egg is still asking.
  await expect(thinking.getByRole("status")).toHaveText(/What should I think with\?/)
  // What they signed in to is a choice where Claude was, under its own name, and is the one
  // chosen, on its first model.
  await expect(providers).toHaveCount(0)
  await expect(choices.getByRole("radio")).toHaveCount(2)
  await expect(
    choices.getByRole("button", { name: "Sign in with Claude", exact: true }),
  ).toHaveCount(0)
  const theirs = choices.getByRole("radio", { name: "Your Anthropic key" })
  await expect(theirs).toBeChecked()
  await expect(theirs).toHaveAccessibleDescription("Claude Sonnet 5.5")
  await expect(thinking.getByRole("button", { name: "Use Claude Sonnet 5.5" })).toBeVisible()
  // Another of its models is behind the small "Change" beside the one it is on.
  await choices.getByRole("button", { name: "Change the model of Your Anthropic key" }).click()
  await page.getByRole("menuitemradio", { name: "Claude Haiku 5.5" }).click()
  await expect(theirs).toHaveAccessibleDescription("Claude Haiku 5.5")
  // Choosing what is included again, and then theirs, keeps the model theirs was changed to.
  await included.click()
  await expect(thinking.getByRole("button", { name: /^Use Echo/ })).toBeVisible()
  await theirs.click()
  await thinking.getByRole("button", { name: "Use Claude Haiku 5.5" }).click()

  // In a browser there is no computer to ask about: it hatches, and its chat is next.
  const out = await card(page, `There you are, ${owner.name}! Shall we get started?`)
  // The chat comes up under the scene before the creature leaves the island for its place
  // there. Until it has landed it is in the scene only: after each frame is drawn, the chat's
  // own large pictures of it are looked for, for as long as the scene is still there. One that
  // has only just come onto the page has not been drawn yet, so it counts the second time.
  await page.evaluate(() => {
    const seen = { twice: 0, frames: 0 }
    Object.assign(window, { seenInTwoPlaces: seen })
    let before = false
    const count = () => {
      const scene = document.querySelector("[data-welcome]")
      if (scene === null) return
      seen.frames++
      const shown = [
        ...document.querySelectorAll<HTMLElement>('[role="img"][aria-label="Agent avatar"]'),
      ].some(
        (face) =>
          !scene.contains(face) &&
          face.offsetWidth >= 120 &&
          getComputedStyle(face).visibility !== "hidden",
      )
      if (shown && before) seen.twice++
      before = shown
    }
    const frame = () => {
      setTimeout(count, 0)
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  await out.getByRole("button", { name: "Start chatting with Pip" }).click()
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  await expect(page.locator("[data-welcome]")).toHaveCount(0)
  const seen = await page.evaluate(
    () =>
      (window as unknown as { seenInTwoPlaces: { twice: number; frames: number } }).seenInTwoPlaces,
  )
  expect(seen.frames).toBeGreaterThan(10)
  expect(seen.twice).toBe(0)
  const hello = page.getByRole("heading", { name: `Hi ${owner.name}, I’m Pip.` })
  await expect(hello).toBeVisible()

  // On a phone the creature is over its hello, small enough that none of it is cut off above.
  await page.setViewportSize({ width: 375, height: 667 })
  await expect(hello.locator("..").getByRole("img", { name: "Agent avatar" })).toBeInViewport({
    ratio: 1,
  })
  await page.setViewportSize({ width: 1280, height: 860 })

  // What it is called and how it looks are its own from the start, and it is out of its egg.
  const { agents } = (await (await page.request.get("/api/agents")).json()) as {
    agents: {
      name: string
      avatar: { color: string; seed?: string }
      hatched: boolean
      model: string
    }[]
  }
  expect(agents).toHaveLength(1)
  expect(agents[0]).toMatchObject({
    name: "Pip",
    avatar: { color: "rose" },
    hatched: true,
    model: "anthropic/claude-haiku-5-5",
  })
  expect(agents[0]!.avatar.seed).toBeTruthy()

  // The key was not a real one, so it is put back on the echo before it is asked anything.
  const [{ id }] = (await (await page.request.get("/api/agents")).json()).agents as { id: string }[]
  const back = await page.request.patch(`/api/agents/${id}`, { data: { model: "echo/echo-1" } })
  expect(back.ok()).toBe(true)

  // What it offers to start with is said for them.
  await page.getByRole("button", { name: "Show me what you can do" }).click()
  await expect(page.getByRole("main").getByText("You said: Show me what you can do")).toBeVisible()
  await expect(composer(page)).toBeVisible()
})

test("someone who has an agent is sent on from the first run to where they left off", async ({
  page,
}) => {
  await page.goto("/login")
  await page.getByLabel("Email").fill(owner.email)
  await page.getByLabel("Password").fill(owner.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)

  await page.goto("/welcome")
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  await expect(page.locator("[data-welcome]")).toHaveCount(0)
})

test("the egg knows someone who signs in, and sends them on", async ({ page }) => {
  await page.goto("/welcome")
  await (
    await card(page, /Is somebody out there\?/)
  )
    .getByRole("button", { name: "Hello!" })
    .click()
  const you = await card(page, /who are you\?/)
  await you.getByRole("button", { name: "I already have an account" }).click()
  await expect(you.getByLabel("Your name")).toHaveCount(0)

  // What is wrong is said in the card, which can be tried again.
  await you.getByLabel("Email").fill(owner.email)
  await you.getByLabel("Password").fill("not the password")
  await you.getByRole("button", { name: "Sign in" }).click()
  await expect(you.getByRole("alert")).toBeVisible()

  await you.getByLabel("Password").fill(owner.password)
  await you.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  await expect(page.locator("[data-welcome]")).toHaveCount(0)
})

test("the sign-in page sends someone new to the first run", async ({ page }) => {
  await page.goto("/login")
  // Until the page's script has run the link is to `/signup`, which leads to the same place.
  const create = page.getByRole("link", { name: "Create an account" })
  await expect(create).toHaveAttribute("href", "/welcome")
  await create.click()
  await page.waitForURL(/\/welcome$/)
  await card(page, /Is somebody out there\?/)
})

test("a card comes back closed, and opens once its words are said", async ({ page }) => {
  // With the words written out as they are said, which is when a card has something to open.
  // The scene is not drawn here: a machine that draws it in software writes the words too
  // slowly to wait for, and the card is the same over the plain night.
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/welcome")
  const asked = page.locator("[data-card]")
  await expect(asked.getByRole("status")).toHaveText(/Is somebody out there\?$/)

  // What the card asks for only ever opens. It used to come back still open on the last answer,
  // as tall as the next form, and shut as the words began: that is counted here.
  await page.evaluate(() => {
    const seen = { shut: 0 }
    Object.assign(window, { seenShutting: seen })
    document.addEventListener("transitionrun", (event) => {
      const more = event.target as HTMLElement
      if (event.propertyName === "grid-template-rows" && more.matches("[data-more][inert]")) {
        seen.shut++
      }
    })
  })
  await asked.getByRole("button", { name: "Hello!" }).click()
  await expect(asked.getByLabel("Your name")).toBeVisible()
  const seen = await page.evaluate(
    () => (window as unknown as { seenShutting: { shut: number } }).seenShutting,
  )
  expect(seen.shut).toBe(0)
})

test("on a phone held sideways the card leaves the egg its room, and the rest of it is scrolled to", async ({
  page,
}) => {
  await page.setViewportSize({ width: 740, height: 360 })
  await page.goto("/welcome")
  await (
    await card(page, /Is somebody out there\?/)
  )
    .getByRole("button", { name: "Hello!" })
    .click()
  const you = await card(page, /who are you\?/)
  expect((await you.boundingBox())!.y).toBeGreaterThanOrEqual(80)

  // What does not fit in the card is inside it, a scroll away.
  const done = you.getByRole("button", { name: "That’s me" })
  await done.scrollIntoViewIfNeeded()
  await expect(done).toBeInViewport({ ratio: 0.95 })
})

import { expect, test } from "./fixtures.ts"
import {
  asOwner,
  closeSettings,
  composer,
  newChat,
  openSettings,
  openWorkspaceSettings,
  signIn,
  tool,
  panelSwitch,
} from "./helpers.ts"

asOwner()

test("a message sent while the agent works is in the chat at once, and is marked once it is delivered", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill('/tool bash {"command":"sleep 4; echo rested"}')
  await page.keyboard.press("Enter")
  await expect(page.getByRole("status")).toContainText("Running: sleep 4")

  await composer(page).fill("and then say hello")
  await page.keyboard.press("Enter")
  // It is a message like any other, after the one before it, and not a note over the box.
  const transcript = page.getByRole("log")
  await expect(transcript.getByText("and then say hello", { exact: true })).toBeVisible()
  // It has not reached the agent, which is in the middle of a step, and says so.
  await expect(transcript.getByRole("img", { name: "Sending" })).toHaveCount(1)
  if (process.env.DC_SHOTS) await page.screenshot({ path: `${process.env.DC_SHOTS}/1-sent.png` })

  // The step over, the agent has it: the mark says so, with a check.
  await expect(transcript.getByRole("img", { name: "Delivered" })).toHaveCount(1)
  await expect(transcript.getByRole("img", { name: "Sending" })).toHaveCount(0)
  await expect(transcript.getByText("and then say hello", { exact: true })).toHaveCount(1)
  await expect(page.getByRole("status")).toHaveCount(0)
  if (process.env.DC_SHOTS)
    await page.screenshot({ path: `${process.env.DC_SHOTS}/2-delivered.png` })
  // Having said so, the mark leaves.
  await expect(transcript.getByRole("img", { name: "Delivered" })).toHaveCount(0)
  if (process.env.DC_SHOTS) await page.screenshot({ path: `${process.env.DC_SHOTS}/3-gone.png` })
})

test("the agent uses its computer: one line says what it is doing, and only its answer stays", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill(
    '/tool bash {"command":"sleep 1; echo from the shell > note.txt && cat note.txt && ls"}',
  )
  await page.keyboard.press("Enter")
  // While it works, a single line says what it is doing, with the command it is running.
  await expect(page.getByRole("status")).toContainText("Running: sleep 1; echo from the shell")
  // With its panel away none of it moves: the ones in the sidebar and in the strip are pictures,
  // there is none beside the line, and none is over the chat.
  await expect(page.locator("[data-mood]")).toHaveCount(2)

  const transcript = page.getByRole("log")
  await expect(transcript.getByText("The tool returned:")).toBeVisible()
  await expect(transcript).toContainText("note.txt")

  // Once it has answered, the line is gone and the call itself was never put in the transcript.
  await expect(page.getByRole("status")).toHaveCount(0)
  await expect(transcript.getByRole("button", { name: /echo from the shell/ })).toHaveCount(0)
  await expect(transcript.getByText(/echo from the shell > note/)).toHaveCount(1)

  // The panel about the agent opens from the strip. It lists what the agent wrote up, which it
  // does only for big things: this was not one.
  const panel = page.getByRole("complementary", { name: "About Juniper" })
  await expect(panel).toHaveCount(0)
  await panelSwitch(page, "Show")
  await expect(panel.getByRole("img", { name: "Dood avatar" })).toHaveAttribute(
    "data-mood",
    /idle|done/,
  )
  await expect(panel.getByText("Nothing yet.")).toBeVisible()
  await expect(panel.getByRole("listitem")).toHaveCount(0)

  // The agent adds an entry itself, with a tool: a few words, so the list can be taken in at a
  // glance, with what came of it inside.
  await composer(page).fill(
    '/tool log {"title":"Write a note","outcome":"Left a note in the workspace."}',
  )
  await page.keyboard.press("Enter")
  const work = panel.getByRole("listitem").filter({ hasText: "Write a note" }).first()
  await expect(work).toBeVisible()
  await expect(panel.getByText("Nothing yet.")).toHaveCount(0)
  await expect(work.getByText("Left a note in the workspace.")).toBeHidden()
  await work.getByText("Write a note").click()
  await expect(work.getByText("Left a note in the workspace.")).toBeVisible()
  await expect(work.getByText("0 steps")).toBeVisible()
  await expect(page.getByRole("status")).toHaveCount(0)
  // Beside its name it says what it is doing in a word or two, not the whole command.
  await expect(panel.getByText("Ready", { exact: true })).toBeVisible()
  // Put away, from the end of the strip, it can be brought back from there.
  await panelSwitch(page, "Hide")
  await expect(panel).toHaveCount(0)
  await expect(transcript.getByText("Thought for a moment")).toHaveCount(0)
})

test("a picture pasted into the message box is attached, under a name of its own", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill("Look at this: ")
  const paste = (name: string, text?: string) =>
    page.evaluate(
      ([name, text]) => {
        const png = Uint8Array.from(
          atob(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          ),
          (character) => character.charCodeAt(0),
        )
        const data = new DataTransfer()
        data.items.add(new File([png], name!, { type: "image/png" }))
        if (text) data.setData("text/plain", text)
        document
          .querySelector('textarea[aria-label="Message"]')!
          .dispatchEvent(
            new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
          )
      },
      [name, text] as const,
    )
  // A screenshot on the clipboard is called image.png every time, so it is named for the moment.
  await paste("image.png")
  const attached = page.getByRole("list", { name: "Attached files" })
  // It is shown as the picture it is, small, and not as a name.
  const pasted = attached.getByRole("img", {
    name: /^pasted-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.png$/,
  })
  await expect(pasted).toBeVisible()
  await expect(pasted).toHaveJSProperty("naturalWidth", 1)
  // A copied file keeps its own name. What was typed is left as it was.
  await paste("receipt.png")
  await expect(attached.getByRole("img", { name: "receipt.png" })).toBeVisible()
  await expect(composer(page)).toHaveValue("Look at this: ")
  // The built-in echo model cannot look at pictures, and the box says what that means.
  await expect(attached.getByRole("note")).toContainText("cannot look at pictures")
  // It is also the only model there is, so the box has no button for choosing one.
  await expect(page.getByRole("button", { name: "Attach a file" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Model and thinking" })).toHaveCount(0)

  await composer(page).press("Enter")
  // The agent is told the files' names; the message shows them as files, and not that line.
  // The echo model sees no pictures, so none went with it to be shown as pictures.
  const sent = page.getByRole("log").getByRole("list", { name: "Sent files" }).first()
  await expect(sent.getByText(/^pasted-[\d_-]+\.png$/)).toBeVisible()
  await expect(sent.getByText("receipt.png")).toBeVisible()
  await expect(attached).toHaveCount(0)
})

test("attached pictures are shown small beside the names of other files, and open large", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  const picture = async (colour: string) =>
    Buffer.from(
      await page.evaluate((colour) => {
        const canvas = document.createElement("canvas")
        canvas.width = 300
        canvas.height = 200
        const context = canvas.getContext("2d")!
        context.fillStyle = colour
        context.fillRect(0, 0, 300, 200)
        return canvas.toDataURL("image/png").split(",")[1]!
      }, colour),
      "base64",
    )
  // Chosen together, as the picker allows: every one of them is attached, not only the first.
  await page.getByLabel("Choose files to attach").setInputFiles([
    { name: "harbour.png", mimeType: "image/png", buffer: await picture("#1b6ca8") },
    { name: "packing-list.txt", mimeType: "text/plain", buffer: Buffer.from("socks\n") },
    { name: "meadow.png", mimeType: "image/png", buffer: await picture("#4c9f38") },
  ])
  const attached = page.getByRole("list", { name: "Attached files" })
  await expect(attached.getByText("packing-list.txt")).toBeVisible()
  await expect(attached.locator("img")).toHaveCount(2)
  // The picture itself has been drawn, and its name is not written out beside it.
  const harbour = attached.getByRole("img", { name: "harbour.png" })
  await expect(harbour).toBeVisible()
  await expect(harbour).toHaveJSProperty("naturalWidth", 300)
  await expect(attached.getByText("harbour.png")).toHaveCount(0)
  await page.screenshot({ path: "test-results/chat-attached-pictures.png" })

  // Clicked, it opens large, and the arrow keys go from one picture to the next.
  const open = attached.getByRole("button", { name: "Open harbour.png large" })
  await open.click()
  const large = page.getByRole("dialog", { name: "harbour.png" })
  await expect(large.getByRole("img", { name: "harbour.png" })).toBeVisible()
  await expect(large.getByText("1 of 2")).toBeVisible()
  await page.keyboard.press("ArrowRight")
  await expect(
    page.getByRole("dialog", { name: "meadow.png" }).getByRole("img", { name: "meadow.png" }),
  ).toBeVisible()
  await page.keyboard.press("ArrowRight")
  await expect(large.getByText("1 of 2")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(open).toBeFocused()

  // Each can be taken off again, from the keyboard as well as with the mouse.
  await page.keyboard.press("Tab")
  await expect(attached.getByRole("button", { name: "Remove harbour.png" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(attached.locator("img")).toHaveCount(1)
  await expect(harbour).toHaveCount(0)
  await attached.getByRole("button", { name: "Remove meadow.png" }).click()
  await expect(attached.locator("img")).toHaveCount(0)
  await attached.getByRole("button", { name: "Remove packing-list.txt" }).click()
  await expect(attached).toHaveCount(0)
})

test("dictation without a model key says what is missing", async ({ browser, baseURL }) => {
  // A browser with a fake microphone, so recording works without hardware or a prompt.
  const context = await browser.newContext({
    baseURL,
    permissions: ["microphone"],
    colorScheme: "dark",
  })
  const page = await context.newPage()
  await signIn(page)
  await page.getByRole("button", { name: "Dictate" }).click()
  await expect(page.getByRole("button", { name: "Stop dictating" })).toBeVisible()
  await page.waitForTimeout(600)
  await page.getByRole("button", { name: "Stop dictating" }).click()
  await expect(page.getByRole("alert")).toContainText("Dictation needs a model key")
  await context.close()
})

test("what is dictated can be thrown away, or sent as it is", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    permissions: ["microphone"],
    colorScheme: "dark",
  })
  const page = await context.newPage()
  let heard = 0
  await page.route("**/api/transcribe", async (route) => {
    heard++
    await route.fulfill({ json: { text: "said out loud" } })
  })
  await signIn(page)
  await composer(page).fill("Typed first,")

  // While it listens, the box gives way to what the microphone hears.
  await page.getByRole("button", { name: "Dictate" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Listening" })).toBeAttached()
  await expect(composer(page)).toBeHidden()
  await page.waitForTimeout(600)
  await page.getByRole("button", { name: "Cancel dictating" }).click()
  await expect(composer(page)).toBeFocused()
  await expect(composer(page)).toHaveValue("Typed first,")
  expect(heard).toBe(0)

  await page.getByRole("button", { name: "Dictate" }).click()
  await page.waitForTimeout(600)
  await page.getByRole("button", { name: "Send what you said" }).click()
  await expect(page.getByText("Typed first, said out loud").first()).toBeVisible()
  await expect(composer(page)).toHaveValue("")
  expect(heard).toBe(1)
  await context.close()
})

test("starting fresh keeps the earlier messages within reach", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill("The first thing I said")
  await composer(page).press("Enter")
  const transcript = page.getByRole("log")
  await expect(transcript.getByText("You said: The first thing I said")).toBeVisible()

  // Rarely wanted, so it is in the Dood's settings, under its memory, and asks first.
  await expect(page.getByRole("button", { name: "Start fresh" })).toHaveCount(0)
  await openSettings(page, "Memory")
  const settings = page.getByRole("dialog")
  await settings.getByRole("button", { name: "Start fresh" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Start fresh" }).click()
  await expect(settings.getByText("Started fresh")).toBeVisible()
  await closeSettings(page)
  await expect(transcript.getByText("New context")).toBeVisible()
  await expect(transcript.getByText("The first thing I said")).toHaveCount(0)
  await composer(page).fill("The second thing")
  await composer(page).press("Enter")
  await expect(transcript.getByText("You said: The second thing")).toBeVisible()

  // What came before is not gone, here or after a reload.
  await page.reload()
  await page.getByRole("button", { name: "Show earlier messages" }).click()
  await expect(transcript.getByText("The first thing I said", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Show earlier messages" })).toHaveCount(0)
  // In order: the old exchange, the marker, the new one.
  const text = await transcript.innerText()
  expect(text.indexOf("The first thing I said")).toBeLessThan(text.indexOf("New context"))
  expect(text.indexOf("New context")).toBeLessThan(text.indexOf("The second thing"))
})

test("chatting works over plain http, where the browser withholds some features", async ({
  page,
}) => {
  // A page served over http from anything but localhost has no crypto.randomUUID and no
  // clipboard. That is how a self-hosted install on a home network or a tailnet is often reached.
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { value: undefined })
    Object.defineProperty(navigator, "clipboard", { value: undefined })
  })
  await signIn(page)
  await newChat(page)
  await composer(page).fill("sent without the secure-context extras")
  await composer(page).press("Enter")
  await expect(
    page.getByRole("log").getByText("You said: sent without the secure-context extras"),
  ).toBeVisible()

  // The command to pair a computer can still be copied, by selecting it.
  await openWorkspaceSettings(page, "Computers")
  await page.getByRole("button", { name: "Copy command" }).first().click()
  await expect(page.getByText(/Selected\. Press/)).toBeVisible()
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("install.sh")
})

test("a message that cannot be sent says so and stays in the box", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await page.route(/\/chats\/\d+\/messages$/, (route) => route.abort())
  await composer(page).fill("this one will not get through")
  await composer(page).press("Enter")
  await expect(page.getByRole("alert")).toContainText("That was not sent")
  await expect(composer(page)).toHaveValue("this one will not get through")

  // And goes once the way is clear.
  await page.unroute(/\/chats\/\d+\/messages$/)
  await composer(page).press("Enter")
  await expect(
    page.getByRole("log").getByText("You said: this one will not get through"),
  ).toBeVisible()
  await expect(page.getByRole("alert")).toHaveCount(0)
})

test("the transcript rests at the newest message, with no empty space under it", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  /** How far the last message ends above the bottom of the transcript, and whether the page scrolls. */
  const measure = () =>
    page.evaluate(() => {
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')!
      const items = document.querySelectorAll('[data-slot="message-scroller-item"]')
      const last = items[items.length - 1]!.getBoundingClientRect()
      const frame = viewport.getBoundingClientRect()
      return {
        gap: Math.round(frame.bottom - last.bottom),
        atEnd: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 2,
        pageScrolls: document.scrollingElement!.scrollHeight > window.innerHeight + 1,
      }
    })
  const say = async (text: string) => {
    await composer(page).fill(text)
    await composer(page).press("Enter")
    await expect(
      page.getByRole("log").getByText(new RegExp(`You said: ${text}[\\s\\S]*echo model`)),
    ).toBeVisible()
  }

  // One exchange: it sits at the bottom, next to the message box, not at the top of an empty page.
  await say("short one")
  await expect.poll(async () => (await measure()).gap).toBeLessThan(60)

  // A long conversation: still at the end, with nothing but the usual margin under the newest.
  for (const n of [2, 3, 4, 5, 6, 7]) await say(`message ${n}`)
  await expect.poll(async () => (await measure()).gap).toBeLessThan(60)
  expect(await measure()).toMatchObject({ atEnd: true, pageScrolls: false })

  // Someone reading further up is brought back when they send something.
  await page.locator('[data-slot="message-scroller-viewport"]').evaluate((element) => {
    element.scrollTop = 0
  })
  await say("back to the end")
  await expect.poll(async () => (await measure()).atEnd).toBe(true)
})

test("scrolling back up a chat, the messages above are already the height they will be", async ({
  page,
}) => {
  await page.setViewportSize({ width: 400, height: 800 })
  await signIn(page)
  await newChat(page)
  // Messages of different heights, and more of them than fit on a phone several times over.
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const text =
      n % 2 === 0 ? `short ${n}` : `long ${n}\n${"and another line\n".repeat(12)}end ${n}`
    await composer(page).fill(text)
    await composer(page).press("Enter")
    await expect(
      page.getByRole("log").getByText(new RegExp(`You said: (short|long) ${n}[\\s\\S]*echo model`)),
    ).toBeVisible()
  }

  // Opened anew, the chat is at its end and nothing above has been on screen yet.
  await page.reload()
  const viewport = page.locator('[data-slot="message-scroller-viewport"]')
  await expect(page.getByRole("log").getByText(/You said: short 8/)).toBeVisible()
  await expect
    .poll(() => viewport.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThan(2)

  // A message that took its height only as it came into view would move everything under it,
  // and where the browser does not hold the page still against that (Safari), the page jumps
  // under the finger. So the whole of it is as tall at the top as it was at the bottom.
  const heights = await viewport.evaluate(async (el) => {
    const seen = [el.scrollHeight]
    while (el.scrollTop > 0) {
      el.scrollTop -= 150
      await new Promise((resolve) => requestAnimationFrame(resolve))
      seen.push(el.scrollHeight)
    }
    return seen
  })
  expect(heights.length).toBeGreaterThan(10)
  expect(new Set(heights).size).toBe(1)
})

test("the settings page shows what the agent's thinking has cost", async ({ page }) => {
  await signIn(page)
  await openSettings(page, "Usage")
  const usage = page.getByRole("region", { name: "Usage" })
  await expect(usage.getByRole("table", { name: "Usage by model" })).toBeVisible()
  // The built-in echo model is free, and says so.
  await expect(usage.getByRole("row").nth(1)).toContainText("$0")
})

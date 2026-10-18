import { readFileSync } from "node:fs"
import { expect, test } from "./fixtures.ts"
import { asOwner, composer, newChat, signIn, tab, tool, openFile } from "./helpers.ts"

asOwner()

test("a document the agent writes opens from the chat, to be read and edited", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await tool(
    page,
    "write",
    {
      path: "library/notes/plan.md",
      content: "# The plan\n\nShip it. Then read [more](more.md).\n",
    },
    "Successfully wrote to library/notes/plan.md",
  )
  await tool(
    page,
    "write",
    { path: "library/notes/more.md", content: "# More\n" },
    "Successfully wrote to library/notes/more.md",
  )
  await composer(page).fill('/tool send {"text":"","files":["library/notes/plan.md"]}')
  await page.keyboard.press("Enter")

  const card = page
    // Within the transcript, where the file was sent.
    .getByRole("log")
    .getByRole("button", { name: /plan\.md/ })
    .first()
  await expect(card).toBeVisible()
  const download = page.waitForEvent("download")
  await page.getByRole("link", { name: "Download plan.md" }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe("plan.md")
  expect(readFileSync(await file.path(), "utf8")).toContain("Ship it.")

  // The card opens the document beside the chat, where a link to the one next to it opens that.
  await card.click()
  const beside = page.getByRole("complementary", { name: "Document" })
  await expect(beside.getByRole("heading", { name: "The plan", level: 1 })).toBeVisible()
  await expect(composer(page)).toBeVisible()
  await page.screenshot({ path: "test-results/library-beside-chat.png" })
  await beside.getByRole("link", { name: "more", exact: true }).click()
  await expect(beside.getByRole("heading", { name: "More", level: 1 })).toBeVisible()

  // From there it opens in the library, in its folder.
  await beside.getByRole("link", { name: "Open in the Library" }).click()
  await expect(page).toHaveURL(/\/library\?path=notes%2Fmore\.md/)
  const files = page.getByRole("navigation", { name: "Files" })
  await expect(files.getByRole("button", { name: "notes", exact: true })).toBeVisible()
  await openFile(page, "plan.md")
  await expect(files.getByRole("link", { name: "plan.md" })).toHaveAttribute("aria-current", "page")
  await expect(page.getByRole("heading", { name: "The plan", level: 1 })).toBeVisible()

  // A link to the document beside it opens that one.
  await page.getByRole("link", { name: "more", exact: true }).click()
  await expect(page.getByRole("heading", { name: "More", level: 1 })).toBeVisible()
  await openFile(page, "plan.md")

  // What the user types is saved, and is what the agent then reads.
  await page.getByRole("button", { name: "Split" }).click()
  const editor = page.getByRole("textbox", { name: "Edit plan.md" })
  await editor.fill("# The plan\n\nShip it on **Friday**.\n")
  await expect(page.getByText("Saved", { exact: true })).toBeVisible()
  await expect(page.locator(".prose-doc strong")).toHaveText("Friday")
  await page.screenshot({ path: "test-results/library-document.png" })

  await tab(page, "Chat").click()
  await tool(page, "bash", { command: "cat library/notes/plan.md" }, "Ship it on Friday.")

  // And what the agent then writes shows up, with the earlier content kept.
  await tool(
    page,
    "write",
    { path: "library/notes/plan.md", content: "# The plan\n\nShipped.\n" },
    "Successfully wrote to library/notes/plan.md",
  )
  await tab(page, "Library").click()
  await openFile(page, "plan.md")
  await expect(page.getByText("Shipped.")).toBeVisible()
  await page.getByRole("button", { name: "History" }).click()
  await expect(page.getByRole("menuitem", { name: /Put back this version/ })).toHaveCount(2)
  await page
    .getByRole("menuitem", { name: /Put back this version/ })
    .first()
    .click()
  await expect(page.locator(".prose-doc strong")).toHaveText("Friday")
})

test("a page the agent writes is shown as a page, apart from the app", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await tool(
    page,
    "bash",
    {
      command: [
        "mkdir -p library/site",
        `printf '%s' '<link rel="stylesheet" href="style.css"><h1>Energy</h1><p id="out">static</p><a href="../notes/plan.md">the plan</a><script src="app.js"></script>' > library/site/index.html`,
        `printf '%s' 'h1{color:rgb(0, 128, 128)}' > library/site/style.css`,
        `printf '%s' 'var c;try{c=document.cookie}catch(e){c="blocked"}document.getElementById("out").textContent="ran:"+c+":"+self.origin;fetch("/api/me",{credentials:"include",mode:"no-cors"})' > library/site/app.js`,
        "echo made",
      ].join(" && "),
    },
    "made",
  )
  await tab(page, "Library").click()
  // The page asks the app who is signed in, the way a hostile page would.
  const asked = page.waitForRequest(
    (request) => request.url().endsWith("/api/me") && request.frame() !== page.mainFrame(),
  )
  await openFile(page, "index.html")
  // The browser sends that without the session: to it, the page is another site.
  expect((await (await asked).allHeaders()).cookie).toBeUndefined()

  const frame = page.frameLocator('iframe[title="index.html"]')
  // The stylesheet and the script beside it loaded, by their relative addresses.
  await expect(frame.getByRole("heading", { name: "Energy" })).toHaveCSS(
    "color",
    "rgb(0, 128, 128)",
  )
  // The script ran, but as nobody: it may not read cookies, and its origin is not the app's.
  await expect(frame.locator("#out")).toHaveText("ran:blocked:null")
  await page.screenshot({ path: "test-results/library-page.png" })

  // A link from the page to a document opens the document here.
  await frame.getByRole("link", { name: "the plan" }).click()
  await expect(page).toHaveURL(/path=notes%2Fplan\.md/)
  await expect(page.getByRole("heading", { name: "The plan", level: 1 })).toBeVisible()

  // The address of a page works without the session, and only with its own key.
  await openFile(page, "index.html")
  const address = await page.locator('iframe[title="index.html"]').getAttribute("src")
  const anonymous = await page.request.fetch(address!, { headers: { cookie: "" } })
  expect(anonymous.status()).toBe(200)
  expect(anonymous.headers()["content-security-policy"]).toContain("sandbox")
  // Its key opens the whole library, so a page is shown the files beside it and may not read them.
  expect(anonymous.headers()["access-control-allow-origin"]).toBeUndefined()
  const forged = await page.request.fetch(address!.replace(/\/d\/([^/]+)\/[^/]+\//, "/d/$1/0-00/"))
  expect(forged.status()).toBe(404)
})

test("the user can add, rename and delete files, and bring one back", async ({ page }) => {
  await signIn(page)
  await tab(page, "Library").click()
  const files = page.getByRole("navigation", { name: "Files" })

  // An upload goes into the folder last clicked.
  await files.getByRole("button", { name: "notes", exact: true }).click()
  await page.getByLabel("Choose a file to upload").setInputFiles({
    name: "notes from me.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("remember the milk"),
  })
  await files.getByRole("button", { name: "notes", exact: true }).click()
  await openFile(page, "notes from me.txt")
  await expect(page).toHaveURL(
    /path=notes%2Fnotes\+from\+me\.txt|path=notes%2Fnotes%20from%20me\.txt/,
  )
  await expect(page.getByRole("textbox", { name: "Edit notes from me.txt" })).toHaveValue(
    "remember the milk",
  )

  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Rename or move" }).click()
  await page.getByLabel("Folder and name").fill("lists/shopping.txt")
  await page.getByRole("button", { name: "Save" }).click()
  await expect(files.getByRole("link", { name: "shopping.txt" })).toHaveAttribute(
    "aria-current",
    "page",
  )
  await expect(files.getByRole("button", { name: "lists", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Delete" }).click()
  await expect(files.getByRole("link", { name: "shopping.txt" })).toHaveCount(0)

  await page.getByRole("button", { name: /Recently deleted/ }).click()
  await page.getByRole("button", { name: "Restore shopping.txt" }).click()
  await expect(files.getByRole("link", { name: "shopping.txt" })).toHaveAttribute(
    "aria-current",
    "page",
  )

  // A new document starts beside the open file, ready to be written.
  await page.getByRole("button", { name: "New document" }).first().click()
  await expect(page.getByRole("textbox", { name: "Edit Untitled.md" })).toBeVisible()
  await expect(files.getByRole("link", { name: "Untitled.md" })).toBeVisible()
  await page.screenshot({ path: "test-results/library-new.png" })
})

test("a file attached to a message is one the agent can open", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await page.getByLabel("Choose files to attach").setInputFiles({
    name: "shopping.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("oat milk\nrye bread\n"),
  })
  const attached = page.getByRole("list", { name: "Attached files" })
  await expect(attached.getByText("shopping.txt")).toBeVisible()
  await composer(page).fill("Here is my list")
  await composer(page).press("Enter")
  const transcript = page.getByRole("log")
  // The message names the file, and the chip is gone once it is sent.
  await expect(
    transcript.getByRole("list", { name: "Sent files" }).getByText("shopping.txt").first(),
  ).toBeVisible()
  await expect(attached).toHaveCount(0)
  await expect(transcript.getByText(/echo model\.\)/)).toBeVisible()

  await composer(page).fill('/tool library {"action":"get","file":"shopping.txt"}')
  await composer(page).press("Enter")
  await expect(transcript.getByText(/Copied shopping\.txt \(19 bytes\) to/).first()).toBeVisible()
  await composer(page).fill('/tool bash {"command":"cat uploads/shopping.txt"}')
  await composer(page).press("Enter")
  await expect(transcript.getByText("rye bread").first()).toBeVisible()

  // It is also in the library, with the other things the user attached in chats.
  await tab(page, "Library").click()
  const files = page.getByRole("navigation", { name: "Files" })
  await expect(files.getByRole("button", { name: "uploads", exact: true })).toBeVisible()
  await expect(files.getByTitle("uploads/shopping.txt")).toBeVisible()
  // And in the agent's own folder, without it having to fetch the file first.
  await tab(page, "Chat").click()
  await composer(page).fill('/tool bash {"command":"wc -c < library/uploads/shopping.txt"}')
  await composer(page).press("Enter")
  await expect(transcript.getByText("19", { exact: true }).first()).toBeVisible()
})

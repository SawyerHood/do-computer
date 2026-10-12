import type { SiteSummary } from "@do-computer/protocol"
import { expect, type Page } from "@playwright/test"
import { test } from "./fixtures.ts"
import { asOwner, newChat, owner, signIn, tab, tool } from "./helpers.ts"

asOwner()

const agentOf = (page: Page) => /\/a\/([^/]+)/.exec(page.url())![1]!

async function sitesOf(page: Page): Promise<SiteSummary[]> {
  const response = await page.request.get(`/api/agents/${agentOf(page)}/sites`)
  return ((await response.json()) as { sites: SiteSummary[] }).sites
}

test("a site the agent shares opens for its workspace, apart from the app", async ({
  page,
  browser,
}) => {
  await signIn(page)
  await newChat(page)
  await tool(
    page,
    "bash",
    {
      command: [
        "mkdir -p library/sites/plan/more",
        `printf '%s' '<link rel="stylesheet" href="style.css"><h1>Launch plan</h1><p id="out">static</p><a href="more/">more</a><script src="app.js"></script>' > library/sites/plan/index.html`,
        `printf '%s' 'h1{color:rgb(0, 128, 128)}' > library/sites/plan/style.css`,
        `printf '%s' 'var c;try{c=document.cookie}catch(e){c="blocked"}document.getElementById("out").textContent="ran:"+c+":"+self.origin;fetch("/api/me",{credentials:"include",mode:"no-cors"})' > library/sites/plan/app.js`,
        `printf '%s' '<h2>More of it</h2>' > library/sites/plan/more/index.html`,
        `printf '%s' '<h1>Not shared</h1>' > library/secret.html`,
        "echo made",
      ].join(" && "),
    },
    /^made$/,
  )
  await tool(
    page,
    "share",
    { action: "publish", path: "sites/plan", title: "Launch plan" },
    /Shared sites\/plan as “Launch plan”/,
  )
  const [site] = await sitesOf(page)
  expect(site).toMatchObject({ path: "sites/plan", title: "Launch plan", public: false })
  const address = `/s/${site!.id}`

  // Whoever is in the workspace opens it at its address, and the page asks the app who is
  // signed in, the way a hostile page would.
  const asked = page.waitForRequest(
    (request) => request.url().endsWith("/api/me") && request.frame() !== page.mainFrame(),
  )
  await page.goto(address)
  await expect(page).toHaveTitle("Launch plan")
  // The browser sends that without the session: to it, the site is another site.
  expect((await (await asked).allHeaders()).cookie).toBeUndefined()
  const frame = page.frameLocator("iframe")
  // The stylesheet and the script beside the page loaded, by their relative addresses.
  await expect(frame.getByRole("heading", { name: "Launch plan" })).toHaveCSS(
    "color",
    "rgb(0, 128, 128)",
  )
  // The script ran, but as nobody: it may not read cookies, and its origin is not the app's.
  await expect(frame.locator("#out")).toHaveText("ran:blocked:null")
  // A page within the site is a link away, and has an address of its own.
  await frame.getByRole("link", { name: "more" }).click()
  await expect(frame.getByRole("heading", { name: "More of it" })).toBeVisible()
  await page.goto(`${address}/more/`)
  await expect(
    page.frameLocator("iframe").getByRole("heading", { name: "More of it" }),
  ).toBeVisible()

  // The files are served at addresses that carry a key, which opens this site and nothing else.
  await page.goto(address)
  const keyed = (await page.locator("iframe").getAttribute("src"))!
  expect(keyed).toMatch(new RegExp(`^${address}/~[^/]+/$`))
  const file = await page.request.fetch(keyed, { headers: { cookie: "" } })
  expect(file.status()).toBe(200)
  expect(file.headers()["content-security-policy"]).toMatch(/^sandbox /)
  expect(file.headers()["content-security-policy"]).not.toContain("allow-same-origin")
  // Nothing outside the folder is served, however it is asked for. An address with `..` in it
  // is another address by the time it is sent, and one with the slash written out is not.
  for (const outside of ["../secret.html", "..%2Fsecret.html", "..%2F..%2Fsecret.html"]) {
    const response = await page.request.fetch(`${keyed}${outside}`)
    expect(await response.text(), outside).not.toContain("Not shared")
  }
  expect((await page.request.fetch(`${keyed}..%2F..%2Fsecret.html`)).status()).toBe(404)
  const forged = await page.request.fetch(keyed.replace(/~[^/]+/, "~0-00"))
  expect(forged.status()).toBe(404)

  // Someone who is not signed in is told whose it is, and gets to it by signing in.
  const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin })
  const outside = await visitor.newPage()
  const refused = await outside.goto(address)
  expect(refused!.status()).toBe(401)
  await expect(
    outside.getByRole("heading", { name: "This page is shared with one workspace only." }),
  ).toBeVisible()
  await expect(outside.locator("iframe")).toHaveCount(0)
  await outside.getByRole("link", { name: "Sign in" }).click()
  await outside.getByLabel("Email").fill(owner.email)
  await outside.getByLabel("Password").fill(owner.password)
  await outside.getByRole("button", { name: "Sign in" }).click()
  await expect(
    outside.frameLocator("iframe").getByRole("heading", { name: "Launch plan" }),
  ).toBeVisible()
  await expect(outside).toHaveURL(new RegExp(`${address}$`))
  await visitor.close()
})

test("a site is opened by anyone once it is public, and by nobody once it is not shared", async ({
  page,
  browser,
}) => {
  await signIn(page)
  const agent = agentOf(page)
  const [site] = await sitesOf(page)
  const address = `/s/${site!.id}`
  const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin })
  const outside = await visitor.newPage()
  const heading = outside.frameLocator("iframe").getByRole("heading", { name: "Launch plan" })

  // The agent may not make it public by itself: a person is asked.
  await newChat(page)
  await tool(page, "share", { action: "public", site: "Launch plan" }, /needs the user's approval/)
  expect((await sitesOf(page))[0]!.public).toBe(false)
  expect((await outside.goto(address))!.status()).toBe(401)

  // Someone in the workspace makes it public, and it opens with no sign-in at all.
  const made = await page.request.patch(`/api/agents/${agent}/sites/${site!.id}`, {
    data: { public: true },
  })
  expect(((await made.json()) as { site: SiteSummary }).site.public).toBe(true)
  expect((await outside.goto(address))!.status()).toBe(200)
  await expect(heading).toBeVisible()
  const keyed = (await outside.locator("iframe").getAttribute("src"))!

  // Made the workspace's again, the address the visitor was given stops working at once.
  await page.request.patch(`/api/agents/${agent}/sites/${site!.id}`, { data: { public: false } })
  expect((await outside.request.get(keyed)).status()).toBe(404)
  expect((await outside.goto(address))!.status()).toBe(401)

  // A page shared by a person, by its own path, is that page alone.
  const shared = await page.request.post(`/api/agents/${agent}/sites`, {
    data: { path: "secret.html" },
  })
  expect(shared.status()).toBe(201)
  const alone = ((await shared.json()) as { site: SiteSummary }).site
  expect(alone).toMatchObject({ path: "secret.html", title: "Secret", public: false })
  await page.goto(`/s/${alone.id}`)
  await expect(
    page.frameLocator("iframe").getByRole("heading", { name: "Not shared" }),
  ).toBeVisible()
  const page2 = (await page.locator("iframe").getAttribute("src"))!
  expect((await page.request.get(`${page2}sites/plan/index.html`)).status()).toBe(404)
  // What is not in the library cannot be shared.
  const not = await page.request.post(`/api/agents/${agent}/sites`, {
    data: { path: "sites/plan/nothing.css" },
  })
  expect(not.status()).toBe(400)

  // No longer shared, its address leads nowhere, for anyone.
  expect((await page.request.delete(`/api/agents/${agent}/sites/${site!.id}`)).status()).toBe(200)
  const gone = await page.goto(address)
  expect(gone!.status()).toBe(404)
  await expect(page.getByRole("heading", { name: "There is no page here." })).toBeVisible()
  expect((await outside.goto(address))!.status()).toBe(404)
  // Nobody outside can list or change a workspace's sites.
  expect((await outside.request.get(`/api/agents/${agent}/sites`)).status()).toBe(401)
  expect(
    (
      await outside.request.patch(`/api/agents/${agent}/sites/${alone.id}`, {
        data: { public: true },
      })
    ).status(),
  ).toBe(401)
  await visitor.close()
})

test("anything in the library is shared, and shown as what it is", async ({ page }) => {
  await signIn(page)
  const agent = agentOf(page)
  await newChat(page)
  await tool(
    page,
    "bash",
    {
      command: [
        "mkdir -p library/notes library/exports",
        `printf '%s\\n' '# The plan' '' 'Ship on **Friday**.' '' '![chart](chart.svg)' '' '[the numbers](data.csv)' > library/notes/plan.md`,
        `printf '%s' '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="teal"/></svg>' > library/notes/chart.svg`,
        `printf '%s' 'week,signups' > library/notes/data.csv`,
        `printf '%s' '<p id="out">static</p><script>fetch("data.csv").then(r=>r.text()).then(t=>{document.getElementById("out").textContent="read:"+t})</script>' > library/notes/reader.html`,
        "printf 'PK\\003\\004' > library/exports/report.zip",
        "echo made",
      ].join(" && "),
    },
    /^made$/,
  )
  const share = async (path: string) => {
    const response = await page.request.post(`/api/agents/${agent}/sites`, { data: { path } })
    expect(response.status(), path).toBe(201)
    return ((await response.json()) as { site: SiteSummary }).site
  }

  // A folder with no front page is a list of what is in it.
  const folder = await share("notes")
  expect(folder).toMatchObject({ path: "notes", title: "Notes" })
  await page.goto(`/s/${folder.id}`)
  const frame = page.frameLocator("iframe")
  await expect(frame.getByRole("heading", { name: "Notes" })).toBeVisible()
  await expect(frame.getByRole("link")).toHaveText([
    /chart\.svg/,
    /data\.csv/,
    /plan\.md/,
    /reader\.html/,
  ])
  await page.screenshot({ path: "test-results/site-folder.png" })
  // A document in it is read as a document, with the picture beside it.
  await frame.getByRole("link", { name: /plan\.md/ }).click()
  await expect(frame.getByRole("heading", { name: "The plan", level: 1 })).toBeVisible()
  await expect(frame.locator("strong")).toHaveText("Friday")
  await expect
    .poll(() =>
      frame
        .getByRole("img", { name: "chart" })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(40)
  await page.screenshot({ path: "test-results/site-document.png" })
  // Text is shown as text, and a picture as the picture.
  await frame.getByRole("link", { name: "the numbers" }).click()
  await expect(frame.locator("pre")).toHaveText("week,signups")
  await page.goto(`/s/${folder.id}/chart.svg`)
  await expect
    .poll(() => frame.getByRole("img").evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(40)
  // A page in it that loads a file beside it is given the file, not a page about the file.
  await page.goto(`/s/${folder.id}/reader.html`)
  await expect(frame.locator("#out")).toHaveText("read:week,signups")

  // A document shared by itself is the document.
  const document = await share("notes/plan.md")
  expect(document).toMatchObject({ path: "notes/plan.md", title: "Plan" })
  await page.goto(`/s/${document.id}`)
  await expect(page).toHaveTitle("Plan")
  await expect(frame.getByRole("heading", { name: "The plan", level: 1 })).toBeVisible()
  // It brings the picture it refers to, and nothing else that is beside it.
  await expect
    .poll(() =>
      frame
        .getByRole("img", { name: "chart" })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(40)
  await page.screenshot({ path: "test-results/site-document-alone.png" })
  const keyed = (await page.locator("iframe").getAttribute("src"))!
  expect((await page.request.get(`${keyed}data.csv`)).status()).toBe(404)
  expect((await page.request.get(`${keyed}?picture=notes%2Fchart.svg`)).status()).toBe(200)
  expect((await page.request.get(`${keyed}?picture=notes%2Fdata.csv`)).status()).toBe(404)
  expect((await page.request.get(`${keyed}?picture=secret.html`)).status()).toBe(404)

  // What cannot be shown is offered as a download, under its own name.
  const file = await share("exports/report.zip")
  expect(file.title).toBe("report.zip")
  await page.goto(`/s/${file.id}`)
  await expect(frame.getByRole("heading", { name: "report.zip" })).toBeVisible()
  await page.screenshot({ path: "test-results/site-download.png" })
  const download = page.waitForEvent("download")
  await frame.getByRole("link", { name: "Download" }).click()
  expect((await download).suggestedFilename()).toBe("report.zip")
})

test("a file is shared from its card, from the library, and a folder from its row", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  // The card of a file the agent sent has the way to share it.
  await tool(page, "send_file", { path: "library/exports/report.zip" }, /report\.zip/)
  // It is shared already, by the test before this one, and the card says so.
  await page.getByRole("button", { name: "report.zip is shared with a link" }).last().click()
  const popover = page.getByRole("dialog")
  await expect(popover.getByText("Shared with a link")).toBeVisible()
  await expect(popover.getByRole("radio", { name: "Only you" })).toBeChecked()
  await page.screenshot({ path: "test-results/file-card-share.png" })
  await page.keyboard.press("Escape")

  // In the library, a document has a Share button like a page's, and a shared file a mark.
  await tab(page, "Library").click()
  const files = page.getByRole("navigation", { name: "Files" })
  await expect(files.getByRole("link", { name: "plan.md Shared with a link" })).toBeVisible()
  await files.getByRole("link", { name: /data\.csv/ }).click()
  await page.getByRole("button", { name: "Share", exact: true }).click()
  await popover.getByRole("button", { name: "Share", exact: true }).click()
  await expect(popover.getByText("Shared with a link")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Shared with a link", exact: true })).toBeVisible()

  // A folder is shared from its row among the files.
  await files.getByRole("button", { name: "Share the folder exports" }).click()
  await popover.getByRole("button", { name: "Share", exact: true }).click()
  await expect(popover.getByText("Shared with a link")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(
    files.getByRole("button", { name: "The folder exports is shared with a link" }),
  ).toBeVisible()
  await page.screenshot({ path: "test-results/library-tree-shared.png" })
  // Back to the library's front page, by the way a file says where it is.
  await page
    .getByRole("navigation", { name: "Where this file is" })
    .getByRole("link", { name: "Library" })
    .click()
  const shared = page.getByRole("region", { name: "Shared with a link" })
  await expect(shared.getByRole("link", { name: "Exports", exact: true })).toBeVisible()
  await expect(shared.getByRole("link", { name: "data.csv", exact: true })).toBeVisible()
})

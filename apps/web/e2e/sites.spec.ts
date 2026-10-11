import type { SiteSummary } from "@durable-computer/protocol"
import { expect, type Page } from "@playwright/test"
import { test } from "./fixtures.ts"
import { asOwner, newChat, owner, signIn, tool } from "./helpers.ts"

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
    "made",
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
  // What is not a page cannot be shared.
  const not = await page.request.post(`/api/agents/${agent}/sites`, {
    data: { path: "sites/plan/style.css" },
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

import { execSync, spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { createServer as createTcpServer, type AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { SignInWith } from "@do-computer/protocol"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { nodeBrowserIO } from "../src/browser/index.ts"
import { OWN_PORTS, findChrome } from "../src/browser/chrome.ts"

/**
 * Signing in with a saved login, for real: dev-browser, a Chromium without a window, a second
 * one standing in for the owner's own, and a small site on this machine that asks for a
 * password and writes down what it was sent. Run only when asked for, as the other live test is:
 *
 *   DC_BROWSER_LIVE=1 pnpm exec vitest run test/sign-in.live.test.ts
 */
const live = process.env.DC_BROWSER_LIVE === "1"
const agent = { id: "a1", name: "Ada", color: "#14b8a6" }
const dir = mkdtempSync(join(tmpdir(), "dc-sign-in-"))
const io = nodeBrowserIO({ dir, shown: false, log: (line) => console.log(line) })

const PASSWORD = "correct horse & battery=staple?"
const login: SignInWith = {
  name: "The test site",
  username: "ada@example.com",
  password: PASSWORD,
  sites: ["127.0.0.1"],
}

/** What the site was sent: each form, and each thing a listener left in a page sent away. */
const posts: { path: string; username: string | null; password: string | null }[] = []
const leaks: string[] = []

const field = (attributes: string) => `<input ${attributes} style="display:block;width:200px">`
const form = (action: string, inside: string) =>
  `<!doctype html><title>Sign in</title><form method="post" action="${action}">${inside}<button>Go</button></form>`
const both =
  field('name="username" autocomplete="username"') +
  field('name="password" type="password" autocomplete="current-password"')

const pages: Record<string, string> = {
  "/login": form("/session", both),
  "/home": "<!doctype html><title>Home</title><p>Welcome.</p>",
  "/search": form("/session", field('name="q" type="text"')),
  "/shown": form(
    "/session",
    `${field('name="username"')}${field(`name="password" type="password" onfocus="this.type='text'"`)}`,
  ),
  "/first": form("/first", field('name="username" autocomplete="username"')),
  "/code": form("/session-code", both),
  // A page that sends its form itself, and stays where it is when the answer is no.
  "/stays": `<!doctype html><title>Sign in</title><form id="f">${both}<button>Go</button></form>
<script>document.getElementById("f").addEventListener("submit", (event) => {
  event.preventDefault();
  fetch("/session", { method: "POST", body: new URLSearchParams(new FormData(event.target)) });
});</script>`,
}

let server: Server
let base = ""
let ownChrome: ChildProcess | undefined

const free = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createTcpServer()
    probe.once("error", () => resolve(false))
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)))
  })

const run = async (script: string) => {
  const ran = await io.run(agent, script, { timeoutMs: 60_000 })
  expect(ran.error).toBeUndefined()
  return ran
}
const open = (path: string, name = "login") =>
  run(
    `const page = await browser.getPage(${JSON.stringify(name)}); await page.goto(${JSON.stringify(base + path)}); page.url()`,
  )
/** What the boxes of the page hold now, read as an agent's script would read them. */
const held = async (name = "login") =>
  JSON.parse(
    (
      await run(
        `const page = await browser.getPage(${JSON.stringify(name)});
         console.log(JSON.stringify(await page.$$eval("input", (all) => all.map((el) => el.value))));`,
      )
    ).output,
  ) as string[]

/** What an agent that had been turned would leave behind before it asked to be signed in. */
const plant = (path: string) => `
const page = await browser.getPage("login");
await page.goto(${JSON.stringify(base + path)});
const spy = () => document.addEventListener("input", (e) => navigator.sendBeacon("/leak", e.target.value), true);
await page.evaluateOnNewDocument(spy);
// Not waited for: it goes on inside dev-browser after the script has ended.
(async () => {
  for (;;) {
    try {
      for (const each of await page.browser().pages()) {
        const session = await each.createCDPSession();
        await session.send("Page.enable");
        await session.send("Page.addScriptToEvaluateOnNewDocument", { source: "(" + spy + ")()" });
        await session.send("Runtime.evaluate", { expression: "(" + spy + ")()" });
        await session.detach().catch(() => {});
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
})();
console.log("planted");`

/** Plant, see that what was planted does read what is typed, and then sign in. */
async function signInOverALeak(own: boolean) {
  expect((await run(plant("/login"))).output).toContain("planted")
  // The page is loaded again and typed into by a script: what was planted hears it.
  await run(
    `const page = await browser.getPage("login"); await page.reload();
     await page.type("input[name=password]", "canary");`,
  )
  await delay(500)
  expect(leaks.join("\n")).toContain("canary")
  leaks.length = 0

  const went = await io.signIn(agent, login, { timeoutMs: 60_000, say: "Signing in" })
  console.log(went)
  await delay(1_000)
  expect(went).toMatchObject({
    outcome: "signed_in",
    site: "127.0.0.1",
    url: `${base}/home`,
    title: "Home",
    own,
  })
  expect(posts).toEqual([{ path: "/session", username: login.username, password: PASSWORD }])
  expect(leaks).toEqual([])
  expect(JSON.stringify(went)).not.toContain(PASSWORD)
  // dev-browser was stopped, and comes back by itself with the agent's page where it was left.
  const ran = await run(`const page = await browser.getPage("login"); page.url()`)
  expect(ran.output).toContain("/home")
  expect(ran.own).toBe(own)
}

describe.skipIf(!live)("signing in with a saved login, for real", () => {
  beforeAll(async () => {
    process.env.DC_BROWSER_OWN = "0"
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://x")
      let body = ""
      request.setEncoding("utf8")
      request.on("data", (chunk: string) => (body += chunk))
      request.on("end", () => {
        response.setHeader("content-type", "text/html")
        if (url.pathname === "/leak") {
          leaks.push(body)
          return response.end()
        }
        if (request.method !== "POST") return response.end(pages[url.pathname] ?? "")
        const sent = new URLSearchParams(body)
        posts.push({
          path: url.pathname,
          username: sent.get("username"),
          password: sent.get("password"),
        })
        if (url.pathname === "/first") {
          // The second page of two: the username is known, and the password is asked for.
          const known = `<input type="hidden" name="username" value="${sent.get("username") ?? ""}">`
          return response.end(form("/session", known + field('name="password" type="password"')))
        }
        if (url.pathname === "/session-code") {
          return response.end(
            form("/code-given", field('name="code" autocomplete="one-time-code"')),
          )
        }
        if (sent.get("password") === PASSWORD) {
          response.statusCode = 303
          response.setHeader("location", "/home")
          return response.end()
        }
        // As a careless site does: the form again, with what was typed still in it.
        const again = `${field(`name="username" value="${sent.get("username") ?? ""}"`)}${field(`name="password" type="password" value="${sent.get("password") ?? ""}"`)}`
        response.end(form("/session", again))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  beforeEach(() => {
    posts.length = 0
    leaks.length = 0
  })

  afterAll(async () => {
    await io.close()
    ownChrome?.kill("SIGKILL")
    server?.close()
    delete process.env.DC_BROWSER_OWN
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  })

  it("does not start a browser to sign in, or to say which page is in front", async () => {
    expect(await io.front()).toEqual({ own: false })
    const went = await io.signIn(agent, login, { timeoutMs: 10_000 })
    expect(went.outcome).toBe("failed")
    expect(went.message).toContain("browser tool first")
    expect(await io.front()).toEqual({ own: false })
  })

  it("hands a script to dev-browser where no other program can read it", async () => {
    const running = io.run(
      agent,
      `await new Promise((resolve) => setTimeout(resolve, 2000)); "a-mark-" + "in-the-script"`,
      { timeoutMs: 60_000 },
    )
    for (let tries = 0; tries < 15; tries++) {
      await delay(100)
      expect(execSync("ps -eo args", { encoding: "utf8" })).not.toContain("a-mark-")
    }
    expect((await running).output).toContain("a-mark-in-the-script")
  }, 180_000)

  it("signs in, and the site is sent the username and the password", async () => {
    await open("/login")
    expect(await io.front()).toMatchObject({ url: `${base}/login`, title: "Sign in", own: false })
    const went = await io.signIn(agent, login, { timeoutMs: 60_000, say: "Signing in" })
    console.log(went)
    expect(went).toMatchObject({ outcome: "signed_in", site: "127.0.0.1", url: `${base}/home` })
    expect(went.message).toContain(login.username)
    expect(posts).toEqual([{ path: "/session", username: login.username, password: PASSWORD }])
    expect((await io.view(0, 5_000)).say).toBe("Signing in")
  }, 120_000)

  it("types nothing on a page that is not one of the login's sites", async () => {
    await open("/login")
    const went = await io.signIn(
      agent,
      { ...login, sites: ["example.com", "localhost"] },
      {
        timeoutMs: 60_000,
      },
    )
    console.log(went)
    expect(went.outcome).toBe("wrong_site")
    expect(went.message).toContain("example.com, localhost")
    expect(went.message).toContain("127.0.0.1")
    expect(await held()).toEqual(["", ""])
    expect(posts).toEqual([])
  }, 120_000)

  it("is not read by what an earlier script left in the page and in dev-browser", async () => {
    await signInOverALeak(false)
  }, 180_000)

  it("types nothing of the password where there is no password box", async () => {
    await open("/search")
    const went = await io.signIn(agent, login, { timeoutMs: 60_000 })
    console.log(went)
    expect(went).toMatchObject({ outcome: "no_form", url: `${base}/search`, title: "Sign in" })
    expect(await held()).toEqual([""])
    expect(posts).toEqual([])
  }, 120_000)

  it("types nothing of the password into a box that stops being a password box when it is gone into", async () => {
    await open("/shown")
    const went = await io.signIn(agent, login, { timeoutMs: 60_000 })
    console.log(went)
    expect(went).toMatchObject({ outcome: "no_form", url: `${base}/shown` })
    expect(went.message).toContain("taken out again")
    expect(await held()).toEqual(["", ""])
    expect(posts).toEqual([])
  }, 120_000)

  it("says the page still asks where the password was wrong, and leaves nothing of it in the page", async () => {
    await open("/login")
    const wrong = { ...login, password: "not the password" }
    const went = await io.signIn(agent, wrong, { timeoutMs: 60_000 })
    console.log(went)
    expect(went.outcome).toBe("still_asking")
    expect(posts).toEqual([
      { path: "/session", username: login.username, password: "not the password" },
    ])
    expect((await held())[1]).toBe("")
    expect(JSON.stringify(went)).not.toContain("not the password")
  }, 120_000)

  it("empties the boxes of a page that stays where it is and still asks", async () => {
    await open("/stays")
    const wrong = { ...login, password: "not the password" }
    const went = await io.signIn(agent, wrong, { timeoutMs: 60_000 })
    console.log(went)
    expect(went.outcome).toBe("still_asking")
    expect(posts).toHaveLength(1)
    expect(await held()).toEqual(["", ""])
  }, 120_000)

  it("signs in where the username is asked for first, and the password on a page after it", async () => {
    await open("/first")
    const went = await io.signIn(agent, login, { timeoutMs: 60_000 })
    console.log(went)
    expect(went).toMatchObject({ outcome: "signed_in", url: `${base}/home` })
    expect(posts).toEqual([
      { path: "/first", username: login.username, password: null },
      { path: "/session", username: login.username, password: PASSWORD },
    ])
  }, 120_000)

  it("says so where the page goes on to ask for a code", async () => {
    await open("/code")
    const went = await io.signIn(agent, login, { timeoutMs: 60_000 })
    console.log(went)
    expect(went.outcome).toBe("still_asking")
    expect(went.message).toContain("asks for a code")
  }, 120_000)

  it("does not type where another window of the same site has hold of the page", async () => {
    await run(
      `const page = await browser.getPage("login"); await page.goto(${JSON.stringify(`${base}/login`)});
       await page.evaluate((leak) => {
         // The code is the other window's own, so that it goes on when this page is loaded again.
         window.open("about:blank").eval(\`setInterval(() => {
           try {
             if (opener.document.__heard) return;
             opener.document.__heard = true;
             opener.document.addEventListener("input", (e) => navigator.sendBeacon(\${JSON.stringify(leak)}, e.target.value), true);
           } catch {}
         }, 50)\`);
       }, ${JSON.stringify(`${base}/leak`)});`,
    )
    const went = await io.signIn(agent, login, { timeoutMs: 60_000 })
    console.log(went)
    await delay(500)
    expect(went.outcome).toBe("failed")
    expect(went.message).toContain("another window")
    expect(posts).toEqual([])
    expect(leaks).toEqual([])
    await run(
      `const page = await browser.getPage("login");
       for (const each of await page.browser().pages()) if (each !== page) await each.close();`,
    )
  }, 120_000)

  it("is not read in the owner's own browser either, over the one socket to it", async () => {
    let port = 0
    for (const candidate of OWN_PORTS) {
      if (await free(candidate)) {
        port = candidate
        break
      }
    }
    expect(port).not.toBe(0)
    ownChrome = spawn(
      findChrome(join(dir, "none")) as string,
      [
        "--headless=new",
        "--no-sandbox",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${join(dir, "own-profile")}`,
        "--no-first-run",
        "about:blank",
      ],
      { stdio: "ignore" },
    )
    for (let tries = 0; tries < 100; tries++) {
      const up = await fetch(`http://127.0.0.1:${port}/json/version`).then(
        (response) => response.ok,
        () => false,
      )
      if (up) break
      await delay(100)
    }
    delete process.env.DC_BROWSER_OWN
    await signInOverALeak(true)
    expect(await io.front()).toMatchObject({ url: `${base}/home`, own: true })
  }, 180_000)
})

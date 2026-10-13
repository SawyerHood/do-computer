import { afterEach, describe, expect, it } from "vitest"
import { browserConnect, browserSignIn } from "../src/browser-sign-in.ts"

type Opened = { port: number; state: string }

/** A sign-in that has got as far as opening the browser, and what the browser was sent with. */
function started(signingIn: ReturnType<typeof browserSignIn>) {
  let opened!: (to: Opened) => void
  const browser = new Promise<Opened>((resolve) => (opened = resolve))
  const answer = signingIn.signIn(opened)
  return { browser, answer }
}

const done = (to: Opened, query: Record<string, string>, path = "/done") =>
  fetch(`http://127.0.0.1:${to.port}${path}?${new URLSearchParams(query)}`)

/** Whether anything still listens where the browser was sent back to. */
const listens = (port: number) =>
  fetch(`http://127.0.0.1:${port}/`).then(
    () => true,
    () => false,
  )

describe("signing in through the browser", () => {
  let signingIn = browserSignIn()
  afterEach(() => signingIn.cancel())

  it("resolves with the token the browser came back with, and stops listening", async () => {
    signingIn = browserSignIn()
    const { browser, answer } = started(signingIn)
    const to = await browser
    expect(to.state).toMatch(/^[\w-]{32,}$/)

    const response = await done(to, { token: "tok_123", state: to.state })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    const page = await response.text()
    expect(page).toContain("You are signed in.")
    expect(page).toContain("You can close this tab and go back to Do Computer.")
    // The page is whole in itself: it asks nobody else for anything.
    expect(page).not.toMatch(/(src|href)=|url\(|@import/)

    expect(await answer).toEqual({ token: "tok_123" })
    expect(await listens(to.port)).toBe(false)
  })

  it("is not ended by a wrong state, and still takes the right one after", async () => {
    signingIn = browserSignIn()
    const { browser, answer } = started(signingIn)
    const to = await browser
    let settled = false
    void answer.then(() => (settled = true))

    expect((await done(to, { token: "stolen", state: "x".repeat(to.state.length) })).status).toBe(
      404,
    )
    expect((await done(to, { token: "stolen" })).status).toBe(404)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)

    expect((await done(to, { token: "tok_456", state: to.state })).status).toBe(200)
    expect(await answer).toEqual({ token: "tok_456" })
  })

  it("has nothing at any other path, or for a token that is none", async () => {
    signingIn = browserSignIn()
    const { browser, answer } = started(signingIn)
    const to = await browser
    let settled = false
    void answer.then(() => (settled = true))

    expect((await done(to, { token: "tok", state: to.state }, "/")).status).toBe(404)
    expect((await done(to, { token: "tok", state: to.state }, "/done/")).status).toBe(404)
    expect((await done(to, { token: "tok", state: to.state }, "/other")).status).toBe(404)
    expect((await done(to, { token: "", state: to.state })).status).toBe(404)
    expect((await done(to, { state: to.state })).status).toBe(404)
    expect((await done(to, { token: "t".repeat(513), state: to.state })).status).toBe(404)
    const posted = await fetch(`http://127.0.0.1:${to.port}/done?token=tok&state=${to.state}`, {
      method: "POST",
    })
    expect(posted.status).toBe(404)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)

    expect((await done(to, { token: "t".repeat(512), state: to.state })).status).toBe(200)
    expect(await answer).toEqual({ token: "t".repeat(512) })
  })

  it("resolves with an error when it is cancelled, and stops listening", async () => {
    signingIn = browserSignIn()
    const { browser, answer } = started(signingIn)
    const to = await browser
    signingIn.cancel()
    expect(await answer).toEqual({ error: "Signing in was cancelled." })
    expect(await listens(to.port)).toBe(false)
    // Cancelling with nothing waiting is nothing.
    signingIn.cancel()
  })

  it("gives up when nobody comes back in time", async () => {
    signingIn = browserSignIn({ timeoutMs: 30 })
    const { browser, answer } = started(signingIn)
    const to = await browser
    expect(await answer).toEqual({ error: "Nobody signed in in the browser. Try again." })
    expect(await listens(to.port)).toBe(false)
  })

  it("waits for one at a time: asking again ends the one before", async () => {
    signingIn = browserSignIn()
    const first = started(signingIn)
    const before = await first.browser
    const second = started(signingIn)
    expect(await first.answer).toEqual({ error: "Signing in was cancelled." })
    const to = await second.browser
    expect(to.state).not.toBe(before.state)
    expect(await listens(before.port)).toBe(false)

    expect((await done(to, { token: "tok_789", state: to.state })).status).toBe(200)
    expect(await second.answer).toEqual({ token: "tok_789" })
  })

  it("says so when the browser could not be opened", async () => {
    signingIn = browserSignIn()
    const answer = await signingIn.signIn(() => Promise.reject(new Error("no browser")))
    expect(answer).toEqual({ error: "Your browser could not be opened. Try again." })
  })
})

describe("a connector's sign-in in the browser", () => {
  let connecting = browserConnect()
  afterEach(() => connecting.cancel())

  /** One that has got as far as opening the browser, and the port the answer is to come to. */
  function started(state: string) {
    let opened!: (port: number) => void
    const port = new Promise<number>((resolve) => (opened = resolve))
    return { port, answer: connecting.connect(state, opened) }
  }
  const back = (port: number, query: string, path = "/connector") =>
    fetch(`http://127.0.0.1:${port}${path}${query}`)

  it("resolves with what the service said, as it said it, and stops listening", async () => {
    connecting = browserConnect()
    const { port, answer } = started("st_1")
    const at = await port
    const query = "?code=abc%2B1&state=st_1&iss=https%3A%2F%2Fservice.example"

    const response = await back(at, query)
    expect(response.status).toBe(200)
    const page = await response.text()
    expect(page).toContain("Back to Do Computer.")
    expect(page).not.toMatch(/(src|href)=|url\(|@import/)
    expect(await answer).toEqual({ query })
    expect(await listens(at)).toBe(false)
  })

  it("takes a refusal as an answer too", async () => {
    connecting = browserConnect()
    const { port, answer } = started("st_2")
    const query = "?state=st_2&error=access_denied&error_description=You+said+no."
    expect((await back(await port, query)).status).toBe(200)
    expect(await answer).toEqual({ query })
  })

  it("has nothing for another sign-in's state, or at another path", async () => {
    connecting = browserConnect()
    const { port, answer } = started("st_3")
    const at = await port
    let settled = false
    void answer.then(() => (settled = true))

    expect((await back(at, "?code=stolen&state=st_4")).status).toBe(404)
    expect((await back(at, "?code=stolen")).status).toBe(404)
    expect((await back(at, "?code=abc&state=st_3", "/done")).status).toBe(404)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)

    expect((await back(at, "?code=abc&state=st_3")).status).toBe(200)
    expect(await answer).toEqual({ query: "?code=abc&state=st_3" })
  })

  it("gives up at once when the deployment does not know the sign-in", async () => {
    connecting = browserConnect()
    const answer = await connecting.connect("st_5", () => Promise.reject(new Error("unknown")))
    expect(answer).toHaveProperty("error")
  })

  it("waits for one at a time, and gives up when nobody comes back in time", async () => {
    connecting = browserConnect({ timeoutMs: 60 })
    const first = started("st_6")
    const before = await first.port
    const second = started("st_7")
    expect(await first.answer).toHaveProperty("error")
    expect(await listens(before)).toBe(false)
    const at = await second.port
    expect(await second.answer).toHaveProperty("error")
    expect(await listens(at)).toBe(false)
  })
})

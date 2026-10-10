import { afterEach, describe, expect, it } from "vitest"
import { browserSignIn } from "../src/browser-sign-in.ts"

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

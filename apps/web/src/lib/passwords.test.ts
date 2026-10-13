import { MAX_LOGIN_SITES, type MessagePart, type SignInDetails } from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import {
  loginAnswer,
  loginToSend,
  signInOf,
  signInWords,
  usedWords,
  withSite,
} from "./passwords.ts"

describe("a site added to a login", () => {
  it("is kept as its host, however it was typed", () => {
    expect(withSite([], "https://GitHub.com/login")).toEqual({ sites: ["github.com"] })
    expect(withSite(["github.com"], " vercel.com ")).toEqual({
      sites: ["github.com", "vercel.com"],
    })
  })

  it("is not added twice", () => {
    expect(withSite(["github.com"], "https://github.com/settings")).toEqual({
      sites: ["github.com"],
    })
  })

  it("is refused when it is not a site, or one too many", () => {
    expect(withSite([], "not a site")).toEqual({ problem: expect.stringContaining("not a site") })
    expect(withSite([], "com")).toHaveProperty("problem")
    const full = Array.from({ length: MAX_LOGIN_SITES }, (_, index) => `s${index}.example.com`)
    expect(withSite(full, "github.com")).toEqual({ problem: expect.stringContaining("at most") })
  })
})

describe("the answer to a Dood's asking for a login", () => {
  const typed = { username: " sawyer@example.com ", password: " hunter2 ", sites: [], site: "" }

  it("sends the username, the password and the sites, the one that asked first", () => {
    expect(
      loginAnswer("github.com", { ...typed, sites: ["github.com", "gist.github.com"] }),
    ).toEqual({
      // A password is sent as it was typed: a space may be part of it.
      values: { username: "sawyer@example.com", password: " hunter2 " },
      sites: ["github.com", "gist.github.com"],
    })
    expect(loginAnswer("github.com", { ...typed, sites: ["vercel.com"] })).toMatchObject({
      sites: ["github.com", "vercel.com"],
    })
  })

  it("adds a site that was typed and not yet added", () => {
    expect(
      loginAnswer("github.com", { ...typed, sites: ["github.com"], site: "https://vercel.com/x" }),
    ).toMatchObject({ sites: ["github.com", "vercel.com"] })
  })

  it("is refused before it is sent when a site is not a site", () => {
    const answer = loginAnswer("github.com", { ...typed, sites: ["github.com"], site: "git hub" })
    expect(answer).toEqual({ problem: expect.stringContaining("not a site") })
    expect(answer).not.toHaveProperty("values")
  })

  it("is refused without a username or a password", () => {
    expect(loginAnswer("github.com", { ...typed, username: "  " })).toHaveProperty("problem")
    expect(loginAnswer("github.com", { ...typed, password: "" })).toHaveProperty("problem")
  })
})

describe("a login typed in settings", () => {
  it("is sent with its name and username trimmed", () => {
    expect(
      loginToSend({
        name: " GitHub ",
        username: " sawyer ",
        password: "hunter2",
        sites: ["github.com"],
        site: "",
      }),
    ).toEqual({
      login: { name: "GitHub", username: "sawyer", password: "hunter2", sites: ["github.com"] },
    })
  })

  it("needs a name, a single-line password and a site", () => {
    const login = { name: "GitHub", username: "sawyer", password: "hunter2", sites: ["github.com"] }
    expect(loginToSend({ ...login, name: " " })).toHaveProperty("problem")
    expect(loginToSend({ ...login, password: "one\ntwo" })).toHaveProperty("problem")
    expect(loginToSend({ ...login, sites: [] })).toHaveProperty("problem")
    expect(loginToSend({ ...login, sites: [], site: "github.com" })).toHaveProperty("login")
  })

  it("asks only for what a form has: a new password alone is enough", () => {
    expect(loginToSend({ password: "hunter3" })).toEqual({ login: { password: "hunter3" } })
    expect(loginToSend({ password: "" })).toHaveProperty("problem")
  })
})

describe("when a login was last used", () => {
  const now = Date.UTC(2026, 9, 13, 12)
  const hour = 3_600_000

  it("says how long ago and by which Dood", () => {
    expect(usedWords({ usedAt: now - 2 * hour, usedBy: "Juniper" }, now)).toBe(
      "Used 2 hours ago by Juniper",
    )
    expect(usedWords({ usedAt: now - 24 * hour, usedBy: "Juniper" }, now)).toBe(
      "Used yesterday by Juniper",
    )
    expect(usedWords({ usedAt: now - 8 * 24 * hour, usedBy: "Moss" }, now)).toBe(
      "Used last week by Moss",
    )
    expect(usedWords({ usedAt: now - 5_000, usedBy: null }, now)).toBe("Used just now")
  })

  it("says so when it never was", () => {
    expect(usedWords({ usedAt: null, usedBy: null }, now)).toBe("Not used yet")
  })
})

describe("the line a chat keeps of a sign-in", () => {
  const signIn = (
    outcome: SignInDetails["signIn"]["outcome"],
    site: string | null = "github.com",
  ): SignInDetails["signIn"] => ({
    computer: { id: "c1", name: "MacBook" },
    login: "GitHub",
    username: "sawyer@example.com",
    site,
    outcome,
  })
  const call = (details?: unknown, name = "sign_in"): MessagePart => ({
    type: "tool",
    toolCallId: "t1",
    name,
    args: { login: "GitHub" },
    status: "done",
    ...(details === undefined ? {} : { details: details as never }),
  })

  it("is read from a sign_in call that carries how it went, and from nothing else", () => {
    expect(signInOf(call({ signIn: signIn("signed_in") }))).toEqual(signIn("signed_in"))
    expect(signInOf(call())).toBeUndefined()
    expect(signInOf(call(null))).toBeUndefined()
    expect(signInOf(call({ signIn: { outcome: "signed_in" } }))).toBeUndefined()
    expect(signInOf(call({ signIn: { ...signIn("signed_in"), outcome: "other" } }))).toBeUndefined()
    expect(signInOf(call({ signIn: signIn("signed_in") }, "browser"))).toBeUndefined()
    expect(signInOf({ type: "text", text: "Signed in" })).toBeUndefined()
  })

  it("says where and as whom, and how it went", () => {
    const words = (outcome: SignInDetails["signIn"]["outcome"], running = false) =>
      signInWords(signIn(outcome), running).words
    expect(words("signing_in", true)).toBe("Signing in to github.com as sawyer@example.com…")
    expect(words("signed_in")).toBe("Signed in to github.com as sawyer@example.com")
    expect(words("no_form")).toBe("Did not sign in: no password box on github.com")
    expect(words("still_asking")).toBe("github.com still asks to sign in")
    expect(words("failed")).toBe("Could not sign in to github.com")
    // Its call ended before it said how it went.
    expect(words("signing_in")).toBe("Stopped while signing in to github.com")
    expect(signInWords(signIn("signing_in"), true).going).toBe(true)
    expect(signInWords(signIn("signed_in"), true).going).toBe(false)
  })

  it("tells a page the login is not for apart, and never names a site it does not know", () => {
    expect(signInWords(signIn("wrong_site", "github-settings.example.net"), false)).toEqual({
      words:
        "Did not sign in: this page is github-settings.example.net, not one the login GitHub is for",
      going: false,
      refused: true,
    })
    expect(signInWords(signIn("signed_in"), false).refused).toBe(false)
    expect(signInWords(signIn("signed_in", null), false).words).toBe(
      "Signed in as sawyer@example.com",
    )
    expect(signInWords(signIn("no_form", null), false).words).not.toContain("null")
  })
})

import {
  MAX_LOGIN_SITES,
  type MessagePart,
  type PayDetails,
  type SignInDetails,
} from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import {
  cardExpired,
  cardExpiry,
  cardNameFor,
  cardToSend,
  cardWords,
  groupedCardNumber,
  keptLine,
  loginAnswer,
  loginToSend,
  payOf,
  payWords,
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

describe("a card typed in settings", () => {
  const now = new Date(Date.UTC(2026, 9, 13))
  const typed = { number: "4242 4242 4242 4242", expires: "08 / 28", holder: "", postalCode: "" }

  it("has its number grouped in fours as it is typed", () => {
    expect(groupedCardNumber("4242424")).toBe("4242 424")
    expect(groupedCardNumber("4242 4242-4242 4242")).toBe("4242 4242 4242 4242")
    // The space after a group is not kept, so that it can be typed back over.
    expect(groupedCardNumber("4242 ")).toBe("4242")
    expect(groupedCardNumber("42a")).toBe("42")
    expect(groupedCardNumber("")).toBe("")
  })

  it("has the month and year it expires read however they were typed", () => {
    expect(cardExpiry("08/28")).toEqual({ expMonth: 8, expYear: 2028 })
    expect(cardExpiry(" 8 / 2028 ")).toEqual({ expMonth: 8, expYear: 2028 })
    expect(cardExpiry("12-30")).toEqual({ expMonth: 12, expYear: 2030 })
    expect(cardExpiry("0828")).toEqual({ expMonth: 8, expYear: 2028 })
    for (const not of ["", "08", "13/28", "00/28", "08/2", "08/202", "August 2028"]) {
      expect(cardExpiry(not)).toBeNull()
    }
  })

  it("is good to the end of the month it names", () => {
    expect(cardExpired({ expMonth: 10, expYear: 2026 }, now)).toBe(false)
    expect(cardExpired({ expMonth: 9, expYear: 2026 }, now)).toBe(true)
    expect(cardExpired({ expMonth: 1, expYear: 2027 }, now)).toBe(false)
  })

  it("is sent as its digits and when it expires, with only what else was filled in", () => {
    expect(cardToSend({ ...typed, name: "" }, now)).toEqual({
      card: { number: "4242424242424242", expMonth: 8, expYear: 2028 },
    })
    expect(
      cardToSend(
        { ...typed, holder: " Sawyer Hood ", postalCode: " 94110 ", name: " Travel " },
        now,
      ),
    ).toEqual({
      card: {
        number: "4242424242424242",
        expMonth: 8,
        expYear: 2028,
        holder: "Sawyer Hood",
        postalCode: "94110",
        name: "Travel",
      },
    })
  })

  it("is refused before it is sent without a number that adds up or a month still to come", () => {
    const card = { ...typed, name: "" }
    expect(cardToSend({ ...card, number: "" }, now)).toEqual({ problem: "Type the card number." })
    expect(cardToSend({ ...card, number: "4242 4242 4242 4241" }, now)).toEqual({
      problem: expect.stringContaining("not a card number"),
    })
    expect(cardToSend({ ...card, expires: "13/28" }, now)).toHaveProperty("problem")
    expect(cardToSend({ ...card, expires: "09/26" }, now)).toEqual({
      problem: "That card has expired.",
    })
    expect(cardToSend({ ...card, expires: "10/26" }, now)).toHaveProperty("card")
  })

  it("is called after its kind and its last four digits where it is given no name", () => {
    expect(cardNameFor("4242 4242 4242 4242")).toBe("Visa ending 4242")
    expect(cardNameFor("5555 5555 5555 4444")).toBe("Mastercard ending 4444")
    // A kind that is not known here.
    expect(cardNameFor("6200 0000 0000 0005")).toBe("Card ending 0005")
    // Until the number is all there, an example.
    expect(cardNameFor("5555 55")).toBe("Visa ending 4242")
  })

  it("is listed by its kind, the end of its number, when it expires and the name on it", () => {
    const card = { brand: "Visa", last4: "4242", expMonth: 8, expYear: 2028, holder: "" }
    expect(cardWords(card)).toBe("Visa ending 4242 · expires 08/28")
    // One called by its kind and the end of its number does not say them twice.
    expect(cardWords({ ...card, name: "Visa ending 4242" })).toBe("expires 08/28")
    expect(cardWords({ ...card, name: "Work card" })).toBe("Visa ending 4242 · expires 08/28")
    expect(cardWords({ ...card, brand: null, holder: "Sawyer Hood" })).toBe(
      "Card ending 4242 · expires 08/28 · Sawyer Hood",
    )
  })
})

describe("the line a chat keeps of a payment", () => {
  const pay = (
    outcome: PayDetails["pay"]["outcome"],
    site: string | null = "shop.example.com",
  ): PayDetails["pay"] => ({
    computer: { id: "c1", name: "MacBook" },
    card: "Visa ending 4242",
    last4: "4242",
    site,
    outcome,
  })
  const call = (
    details?: unknown,
    name = "pay",
    status: "running" | "done" = "done",
  ): MessagePart => ({
    type: "tool",
    toolCallId: "t1",
    name,
    args: { card: "Visa ending 4242" },
    status,
    ...(details === undefined ? {} : { details: details as never }),
  })

  it("is read from a pay call that carries how it went, and from nothing else", () => {
    expect(payOf(call({ pay: pay("sent") }))).toEqual(pay("sent"))
    expect(payOf(call())).toBeUndefined()
    expect(payOf(call(null))).toBeUndefined()
    expect(payOf(call({ pay: { outcome: "sent" } }))).toBeUndefined()
    expect(payOf(call({ pay: { ...pay("sent"), outcome: "other" } }))).toBeUndefined()
    expect(payOf(call({ pay: pay("sent") }, "browser"))).toBeUndefined()
  })

  it("says where and with which card, and how it went", () => {
    const words = (outcome: PayDetails["pay"]["outcome"], running = false) =>
      payWords(pay(outcome), running).words
    expect(words("paying", true)).toBe("Paying on shop.example.com with Visa ending 4242…")
    expect(words("sent")).toBe("Typed Visa ending 4242 on shop.example.com and pressed the button")
    expect(words("no_form")).toBe("Did not pay: no card boxes on shop.example.com")
    expect(words("still_asking")).toBe("shop.example.com did not take the payment")
    expect(words("failed")).toBe("Could not pay on shop.example.com")
    // Its call ended before it said how it went.
    expect(words("paying")).toBe("Stopped while paying on shop.example.com")
    expect(payWords(pay("paying"), true).going).toBe(true)
    expect(payWords(pay("sent"), true).going).toBe(false)
    for (const outcome of ["paying", "sent", "no_form", "still_asking", "failed"] as const) {
      expect(payWords(pay(outcome, null), true).words).not.toContain("null")
    }
  })

  it("is kept the way a sign-in's is, each told from the other", () => {
    expect(keptLine(call({ pay: pay("paying") }, "pay", "running"))).toEqual({
      of: "pay",
      outcome: "paying",
      words: "Paying on shop.example.com with Visa ending 4242…",
      going: true,
      refused: false,
    })
    const signIn = {
      computer: { id: "c1", name: "MacBook" },
      login: "GitHub",
      username: "sawyer",
      site: "github.com",
      outcome: "signed_in",
    }
    expect(keptLine(call({ signIn }, "sign_in"))).toMatchObject({
      of: "sign-in",
      words: "Signed in to github.com as sawyer",
    })
    expect(keptLine(call())).toBeUndefined()
    expect(keptLine(call({ pay: pay("sent") }, "browser"))).toBeUndefined()
    expect(keptLine({ type: "text", text: "Paid" })).toBeUndefined()
  })
})

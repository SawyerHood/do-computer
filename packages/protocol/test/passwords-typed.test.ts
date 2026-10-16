import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cardExpired,
  cardExpiry,
  cardNameFor,
  cardToSend,
  cardTrouble,
  cardWords,
  groupedCardNumber,
  groupedExpiry,
  keepsSecrets,
  loginAnswer,
  loginToSend,
  MAX_LOGIN_SITES,
  NO_CARD,
  usedWords,
  withSite,
} from "../src/index.ts"

describe("a workspace's Passwords section", () => {
  it("is there where the workspace keeps logins or cards for this person, and only there", () => {
    expect(keepsSecrets({})).toBe(false)
    expect(keepsSecrets({ savedLogins: true })).toBe(true)
    expect(keepsSecrets({ savedCards: true })).toBe(true)
    expect(keepsSecrets({ savedLogins: true, savedCards: true })).toBe(true)
  })
})

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
  const typed = { username: " test.user@example.com ", password: " hunter2 ", sites: [], site: "" }

  it("sends the username, the password and the sites, the one that asked first", () => {
    expect(
      loginAnswer("github.com", { ...typed, sites: ["github.com", "gist.github.com"] }),
    ).toEqual({
      // A password is sent as it was typed: a space may be part of it.
      values: { username: "test.user@example.com", password: " hunter2 " },
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
        username: " test.user ",
        password: "hunter2",
        sites: ["github.com"],
        site: "",
      }),
    ).toEqual({
      login: { name: "GitHub", username: "test.user", password: "hunter2", sites: ["github.com"] },
    })
  })

  it("needs a name, a single-line password and a site", () => {
    const login = {
      name: "GitHub",
      username: "test.user",
      password: "hunter2",
      sites: ["github.com"],
    }
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
        { ...typed, holder: " Test Person ", postalCode: " 12345 ", name: " Travel " },
        now,
      ),
    ).toEqual({
      card: {
        number: "4242424242424242",
        expMonth: 8,
        expYear: 2028,
        holder: "Test Person",
        postalCode: "12345",
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
    expect(cardWords({ ...card, brand: null, holder: "Test Person" })).toBe(
      "Card ending 4242 · expires 08/28 · Test Person",
    )
  })
})

describe("a card's expiry typed on a phone's keypad", () => {
  it("has the slash put in once the year is begun", () => {
    expect(groupedExpiry("0")).toBe("0")
    expect(groupedExpiry("08")).toBe("08")
    expect(groupedExpiry("082")).toBe("08/2")
    expect(groupedExpiry("0828")).toBe("08/28")
    // What iOS's AutoFill hands over, and what is pasted, come out the same way.
    expect(groupedExpiry("08/28")).toBe("08/28")
    expect(groupedExpiry("08 / 2028")).toBe("08/20")
  })

  it("loses the slash with the year's first digit, so a mistake is taken back in one go", () => {
    expect(groupedExpiry("08/")).toBe("08")
  })

  it("is read as the month and year the card expires", () => {
    expect(cardExpiry(groupedExpiry("0828"))).toEqual({ expMonth: 8, expYear: 2028 })
  })
})

describe("a card form", () => {
  it("starts with nothing typed, and has no box for a security code", () => {
    expect(NO_CARD).toEqual({ number: "", expires: "", holder: "", postalCode: "", name: "" })
  })
})

describe("what is wrong with a saved card", () => {
  const now = new Date(Date.UTC(2026, 9, 13))
  const card = { expMonth: 8, expYear: 2028 }

  it("is nothing for a card that can be read and is still good", () => {
    expect(cardTrouble(card, now)).toBeUndefined()
  })

  it("is that its number cannot be read, before that it has expired", () => {
    expect(cardTrouble({ ...card, unreadable: true }, now)).toMatch(/can no longer be read/)
    expect(cardTrouble({ expMonth: 1, expYear: 2020, unreadable: true }, now)).toMatch(
      /can no longer be read/,
    )
  })

  it("is that it has expired, at the end of the month it names", () => {
    expect(cardTrouble({ expMonth: 9, expYear: 2026 }, now)).toMatch(/expired/)
    expect(cardTrouble({ expMonth: 10, expYear: 2026 }, now)).toBeUndefined()
  })
})

describe("when a login was last used, where there is no Intl.RelativeTimeFormat", () => {
  // A phone's JavaScript engine may not have it.
  const now = Date.UTC(2026, 9, 13, 12)
  const hour = 3_600_000
  afterEach(() => vi.unstubAllGlobals())

  it("is said the way the browser says it", () => {
    vi.stubGlobal("Intl", { ...Intl, RelativeTimeFormat: undefined })
    expect(usedWords({ usedAt: now - 2 * hour, usedBy: "Juniper" }, now)).toBe(
      "Used 2 hours ago by Juniper",
    )
    expect(usedWords({ usedAt: now - hour, usedBy: null }, now)).toBe("Used 1 hour ago")
    expect(usedWords({ usedAt: now - 24 * hour, usedBy: null }, now)).toBe("Used yesterday")
    expect(usedWords({ usedAt: now - 8 * 24 * hour, usedBy: "Moss" }, now)).toBe(
      "Used last week by Moss",
    )
    expect(usedWords({ usedAt: now - 3 * 24 * hour, usedBy: null }, now)).toBe("Used 3 days ago")
  })
})

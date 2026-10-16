import type { MessagePart, PayDetails, SignInDetails } from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import { keptLine, payOf, payWords, signInOf, signInWords } from "./passwords.ts"

// What a person types for a login or a card is checked in the shared protocol, and tested
// there: packages/protocol/test/passwords-typed.test.ts.

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

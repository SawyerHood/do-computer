import type { PayWith } from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import {
  type BoxSeen,
  type PayTiming,
  chooseButton,
  chooseCardBoxes,
  chooseField,
  expiryOptions,
  expiryText,
  payOnPage,
  withoutNumber,
} from "../src/browser/pay.ts"
import type { PreviewSocket } from "../src/browser/preview.ts"

const box = (more: Partial<BoxSeen> = {}): BoxSeen => ({
  tag: "input",
  type: "text",
  autocomplete: "",
  called: [],
  maxLength: 0,
  shown: true,
  empty: true,
  ...more,
})
const says = (autocomplete: string, more: Partial<BoxSeen> = {}) => box({ autocomplete, ...more })
const called = (name: string, more: Partial<BoxSeen> = {}) => box({ called: [name], ...more })
const card: PayWith = {
  name: "Team card",
  holder: "Pip Example",
  number: "4242424242424242",
  expMonth: 8,
  expYear: 2028,
  code: "737",
  postalCode: "94107",
}

describe("the boxes of a page that a card goes into", () => {
  it("are the ones that say what they are for, in whichever frame they are", () => {
    // As Stripe's Payment Element has them: a page with an e-mail box, and one frame with the card.
    expect(
      chooseCardBoxes([
        [says("email", { type: "email" })],
        [],
        [
          says("cc-number"),
          says("cc-exp", { called: ["MM / YY"] }),
          says("cc-csc"),
          says("billing postal-code"),
        ],
      ]),
    ).toEqual({
      number: { frame: 2, at: 0 },
      expiry: { frame: 2, at: 1 },
      code: { frame: 2, at: 2 },
      postal: { frame: 2, at: 3 },
    })
  })

  it("may each be in a frame of their own", () => {
    expect(
      chooseCardBoxes([
        [says("postal-code"), says("cc-name")],
        [says("cc-csc")],
        [says("cc-exp")],
        [says("cc-number")],
      ]),
    ).toEqual({
      number: { frame: 3, at: 0 },
      expiry: { frame: 2, at: 0 },
      code: { frame: 1, at: 0 },
      holder: { frame: 0, at: 1 },
      postal: { frame: 0, at: 0 },
    })
  })

  it("are known by what they are called where they do not say, a month and a year apart too", () => {
    expect(
      chooseCardBoxes([
        [
          called("email"),
          called("cardNumber"),
          called("card_exp_month", { tag: "select", type: "select-one" }),
          called("card_exp_year", { tag: "select", type: "select-one" }),
          called("Security code", { type: "password" }),
          called("Name on card"),
          called("zip"),
        ],
      ]),
    ).toEqual({
      number: { frame: 0, at: 1 },
      month: { frame: 0, at: 2 },
      year: { frame: 0, at: 3 },
      code: { frame: 0, at: 4 },
      holder: { frame: 0, at: 5 },
      postal: { frame: 0, at: 6 },
    })
    expect(chooseCardBoxes([[called("cc-number"), called("expiry"), called("cvv")]])).toEqual({
      number: { frame: 0, at: 0 },
      expiry: { frame: 0, at: 1 },
      code: { frame: 0, at: 2 },
    })
  })

  it("take those of the frame the number is in before another's, and no box twice", () => {
    expect(
      chooseCardBoxes([[says("postal-code")], [says("cc-number"), says("postal-code")]]).postal,
    ).toEqual({ frame: 1, at: 1 })
    // A box for the number is not the one for when it runs out, whatever else it is called.
    expect(chooseCardBoxes([[box({ called: ["card-number", "expires with the card"] })]])).toEqual({
      number: { frame: 0, at: 0 },
    })
  })

  it("are none where no box for the number can be seen", () => {
    expect(chooseCardBoxes([[called("q"), says("cc-csc"), called("account number")]])).toEqual({})
    expect(chooseCardBoxes([[says("cc-number", { shown: false })]])).toEqual({})
    expect(chooseCardBoxes([[says("cc-number", { type: "checkbox" })]])).toEqual({})
  })
})

describe("when a card runs out, as it is typed", () => {
  it("is the month and the year as two digits each in one box, or with the year in full", () => {
    expect(expiryText(card, "both")).toBe("0828")
    expect(expiryText(card, "both", true)).toBe("082028")
    expect(expiryText({ expMonth: 12, expYear: 2030 }, "both")).toBe("1230")
  })

  it("is each alone in a box of its own, the year in full where the box takes four", () => {
    expect(expiryText(card, "month")).toBe("08")
    expect(expiryText(card, "year")).toBe("28")
    expect(expiryText(card, "year", true)).toBe("2028")
  })

  it("is an option of a list written either way", () => {
    expect(expiryOptions(card, "month")).toEqual(["8", "08"])
    expect(expiryOptions(card, "year")).toEqual(["2028", "28"])
  })
})

describe("the button to press", () => {
  const buttons = [["Apply"], ["Pay now", "pay"], ["Pay  $20.00"], ["Cancel"]]

  it("is the one that says the words, whatever the case and the spaces", () => {
    expect(chooseButton(buttons, "pay NOW")).toBe(1)
    expect(chooseButton(buttons, " Pay $20.00 ")).toBe(2)
    // One that says it outright comes before those that have it in what they say.
    expect(chooseButton(buttons, "pay")).toBe(1)
  })

  it("is one that has the words in what it says, where only one does", () => {
    expect(chooseButton(buttons, "$20")).toBe(2)
    expect(chooseButton(buttons, "canc")).toBe(3)
  })

  it("is not guessed where more than one fits, or none", () => {
    expect(chooseButton(buttons, "a")).toBe("many")
    expect(chooseButton([["Pay"], ["Pay"]], "Pay")).toBe("many")
    expect(chooseButton(buttons, "Buy")).toBe("none")
    expect(chooseButton(buttons, " ")).toBe("none")
  })
})

describe("a box to fill in beside the card", () => {
  const frames = [
    [called("q"), box({ called: ["email", "Email address *"] }), says("cc-number")],
    [says("given-name"), called("Country", { tag: "select", type: "select-one" })],
  ]

  it("is the one called that, by its name, its label or what it says it is for", () => {
    expect(chooseField(frames, "EMAIL")).toEqual({ frame: 0, at: 1 })
    expect(chooseField(frames, "email address")).toEqual({ frame: 0, at: 1 })
    expect(chooseField(frames, "given-name")).toEqual({ frame: 1, at: 0 })
    expect(chooseField(frames, "country")).toEqual({ frame: 1, at: 1 })
  })

  it("is none where no box is called that, and never one of the card's", () => {
    expect(chooseField(frames, "phone")).toBeUndefined()
    expect(chooseField(frames, "")).toBeUndefined()
    expect(chooseField(frames, "cc-number", [{ frame: 0, at: 2 }])).toBeUndefined()
  })
})

describe("the card's number, kept out of what is said afterwards", () => {
  it("is taken out as digits, in fours, and as an address carries it", () => {
    const number = "4242424242424242"
    for (const written of [
      "4242424242424242",
      "4242 4242 4242 4242",
      "4242-4242-4242-4242",
      "4242%204242%204242%204242",
      "4242+4242+4242+4242",
    ]) {
      const cleaned = withoutNumber(`https://shop.example/paid?card=${written}&ok=1`, number)
      expect(cleaned).toBe("https://shop.example/paid?card=[card number]&ok=1")
    }
    expect(withoutNumber("Order 4242 of 4242", number)).toBe("Order 4242 of 4242")
    expect(withoutNumber("Nothing here", "")).toBe("Nothing here")
  })
})

describe("paying on a page", () => {
  const QUICK: PayTiming = {
    callMs: 500,
    settleMs: 1,
    loadMs: 200,
    boxesMs: 60,
    restMs: 20,
    pressMs: 50,
    goneMs: 100,
    lookMs: 10,
  }
  /** A browser with one page at `url` that has the boxes and buttons given, and goes on when its button is pressed. */
  function fakeBrowser(url: string, boxes: BoxSeen[] = [], buttons: string[][] = []) {
    const sent: { method: string; params: Record<string, unknown> }[] = []
    const listeners: Record<string, ((event: { data: unknown }) => void)[]> = {}
    const holds: Record<string, string> = {}
    let caret = ""
    let pressed = false
    const info = { targetId: "t1", type: "page", url, title: "Checkout" }
    const answer = (method: string, params: Record<string, unknown>): unknown => {
      const declared = String(params.functionDeclaration ?? "")
      const held = String(params.objectId ?? "")
      switch (method) {
        case "Target.getTargets":
          return { targetInfos: [info] }
        case "Target.getTargetInfo":
          return { targetInfo: info }
        case "Target.attachToTarget":
          return { sessionId: "s1" }
        case "Page.getFrameTree":
          return { frameTree: { frame: { id: "f1", url } } }
        case "Page.createIsolatedWorld":
          return { executionContextId: 7 }
        case "Runtime.evaluate": {
          const expression = String(params.expression)
          if (expression.startsWith("globalThis.__dc")) return { result: { objectId: expression } }
          return { result: { value: { url, boxes, buttons } } }
        }
        case "Runtime.callFunctionOn":
          if (declared.includes("this.focus()")) caret = held
          if (declared.includes("this.focus()")) return { result: { value: true } }
          if (declared.includes("String(this.value)")) return { result: { value: holds[held] } }
          if (declared.includes("scrollIntoView")) return { result: { value: [10, 20] } }
          // Whether the box is still there: not once the button was pressed.
          return { result: { value: !pressed } }
        case "Input.insertText":
          holds[caret] = String(params.text)
          return {}
        case "Input.dispatchMouseEvent":
          pressed ||= params.type === "mouseReleased"
          return {}
        default:
          return {}
      }
    }
    const socket: PreviewSocket = {
      readyState: 1,
      send(data) {
        const call = JSON.parse(data)
        sent.push({ method: call.method, params: call.params })
        queueMicrotask(() => {
          for (const listener of listeners.message ?? []) {
            listener({
              data: JSON.stringify({ id: call.id, result: answer(call.method, call.params) }),
            })
          }
        })
      },
      close() {},
      addEventListener(type: string, listener: (event: { data: unknown }) => void) {
        ;(listeners[type] ??= []).push(listener)
        if (type === "open") queueMicrotask(() => listener({ data: undefined }))
      },
    }
    let stopped = 0
    return {
      sent,
      methods: () => sent.map((call) => call.method),
      stops: () => stopped,
      browser: {
        open: () => socket,
        stop: async () => {
          stopped += 1
        },
      },
    }
  }
  const asked = { timeoutMs: 5_000, fields: [], button: "Pay", timing: QUICK }

  it("types nothing, and leaves dev-browser be, on a page that is not reached by https", async () => {
    const fake = fakeBrowser("http://shop.example/checkout")
    const went = await payOnPage(fake.browser, card, asked)
    expect(went).toMatchObject({ outcome: "failed", typed: false, title: "Checkout" })
    expect(went.message).toContain("reached by https")
    expect(went.message).toContain("shop.example")
    expect(fake.stops()).toBe(0)
    expect(fake.methods()).toEqual(["Target.getTargets"])
  })

  it("stops dev-browser and loads the page again, and types nothing where there is no box for a number", async () => {
    const fake = fakeBrowser("https://shop.example/checkout")
    const went = await payOnPage(fake.browser, card, asked)
    expect(went).toMatchObject({ outcome: "no_form", typed: false, site: "shop.example" })
    expect(fake.stops()).toBe(1)
    expect(fake.methods()).toContain("Page.reload")
    expect(fake.methods()).not.toContain("Input.insertText")
    expect(fake.methods()).not.toContain("Input.dispatchMouseEvent")
    expect(JSON.stringify(went)).not.toContain(card.number)
  })

  it("fills in what is not secret, types the card, and presses the button, the card only ever as what is typed", async () => {
    const fake = fakeBrowser(
      "https://shop.example/checkout",
      [called("Email"), says("cc-number"), says("cc-exp"), says("cc-csc"), says("postal-code")],
      [["Apply"], ["Pay now"]],
    )
    const secret = { ...card, code: "9173" }
    const went = await payOnPage(fake.browser, secret, {
      ...asked,
      fields: [{ box: "email", text: "pip@example.com" }],
      button: "pay now",
    })
    expect(went).toMatchObject({ outcome: "sent", typed: true, site: "shop.example" })
    const typed = fake.sent.filter((call) => call.method === "Input.insertText")
    expect(typed.map((call) => call.params.text)).toEqual([
      "pip@example.com",
      card.number,
      "0828",
      "9173",
      "94107",
    ])
    // The button is pressed once everything is typed, and it is the one that was asked for.
    const methods = fake.methods()
    expect(methods.indexOf("Input.dispatchMouseEvent")).toBeGreaterThan(
      methods.lastIndexOf("Input.insertText"),
    )
    expect(JSON.stringify(fake.sent)).toContain("globalThis.__dcButtons[1]")
    // Nothing else that was said to the browser, and nothing of the answer, has the number or the code.
    const rest = JSON.stringify([
      fake.sent.filter((call) => call.method !== "Input.insertText"),
      went,
    ])
    expect(rest).not.toContain(card.number)
    expect(rest).not.toContain("9173")
  })
})

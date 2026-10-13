import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SignInWith } from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import { nodeBrowserIO } from "../src/browser/index.ts"
import type { PreviewSocket } from "../src/browser/preview.ts"
import {
  type InputSeen,
  type PageTarget,
  type SignInTiming,
  chooseFields,
  frontTarget,
  outcomeOf,
  overlooked,
  pageTargets,
  signInOnPage,
  withoutPassword,
} from "../src/browser/sign-in.ts"

const input = (more: Partial<InputSeen> = {}): InputSeen => ({
  type: "text",
  autocomplete: "",
  name: "",
  id: "",
  shown: true,
  form: 0,
  ...more,
})
const password = (more: Partial<InputSeen> = {}) => input({ type: "password", ...more })

describe("the boxes of a page that are signed in with", () => {
  it("are the password box that can be seen, and the box for text before it in its form", () => {
    expect(
      chooseFields([
        input({ name: "q", form: -1 }),
        input({ name: "login" }),
        password({ shown: false }),
        password(),
      ]),
    ).toEqual({ username: 1, password: 3, code: false })
  })

  it("are the one for the current password before one for a new, and a new one where it is all there is", () => {
    expect(
      chooseFields([
        password({ autocomplete: "new-password" }),
        password(),
        password({ autocomplete: "section-a current-password" }),
      ]).password,
    ).toBe(2)
    expect(chooseFields([password({ autocomplete: "new-password" }), password()]).password).toBe(1)
    expect(chooseFields([password({ autocomplete: "new-password" })]).password).toBe(0)
  })

  it("take the box that says it is for the username, then one for an e-mail address", () => {
    expect(
      chooseFields([
        input({ type: "email" }),
        input({ autocomplete: "username" }),
        input({ name: "captcha" }),
        password(),
      ]).username,
    ).toBe(1)
    expect(chooseFields([input({ type: "email" }), input(), password()]).username).toBe(0)
    // One in the password's own form before one in another.
    expect(
      chooseFields([
        input({ type: "email", form: 0 }),
        input({ type: "email", form: 1 }),
        password({ form: 1 }),
      ]).username,
    ).toBe(1)
  })

  it("have no password box where none is of that type, whatever a box for text is called", () => {
    expect(chooseFields([input({ name: "password" }), input({ id: "pass" })])).toEqual({
      code: false,
    })
    expect(chooseFields([input({ name: "q" }), password({ shown: false })])).toEqual({
      code: false,
    })
  })

  it("take a box for the username alone only where it says what it is for", () => {
    expect(chooseFields([input({ name: "q" }), input({ name: "user_login" })])).toEqual({
      username: 1,
      code: false,
    })
    expect(chooseFields([input({ autocomplete: "username" })]).username).toBe(0)
    expect(chooseFields([input({ type: "email" })]).username).toBe(0)
  })

  it("know a box for a code that is used once", () => {
    expect(chooseFields([input({ autocomplete: "one-time-code" })])).toEqual({ code: true })
    expect(chooseFields([input({ name: "otp" })]).code).toBe(true)
    expect(chooseFields([input({ id: "verification_code" })]).code).toBe(true)
    expect(chooseFields([input({ name: "hotpot" }), password()]).code).toBe(false)
  })
})

describe("how signing in went", () => {
  it("is signed in where the password box went and nothing more is asked", () => {
    expect(outcomeOf(true, { code: false })).toEqual({ outcome: "signed_in", code: false })
  })

  it("is still asking where the box is there, came back, or a code is wanted", () => {
    expect(outcomeOf(false, { password: 1, code: false }).outcome).toBe("still_asking")
    expect(outcomeOf(true, { password: 0, code: false }).outcome).toBe("still_asking")
    expect(outcomeOf(false, { code: false }).outcome).toBe("still_asking")
    expect(outcomeOf(true, { code: true })).toEqual({ outcome: "still_asking", code: true })
  })
})

describe("the password, kept out of what is said afterwards", () => {
  it("is taken out as it is, and as an address or a form carries it", () => {
    const secret = "p@ss word&1=2"
    expect(withoutPassword(`title ${secret}!`, secret)).toBe("title [password]!")
    expect(withoutPassword(`https://a.test/?p=${encodeURIComponent(secret)}&x=1`, secret)).toBe(
      "https://a.test/?p=[password]&x=1",
    )
    expect(withoutPassword(`https://a.test/?p=p%40ss+word%261%3D2`, secret)).toBe(
      "https://a.test/?p=[password]",
    )
    expect(withoutPassword(`https://a.test/${encodeURI(secret)}`, secret)).toBe(
      "https://a.test/[password]",
    )
    expect(withoutPassword("nothing of it here", secret)).toBe("nothing of it here")
    expect(withoutPassword("left as it is", "")).toBe("left as it is")
  })
})

const target = (targetId: string, url: string, openerId?: string): PageTarget => ({
  targetId,
  url,
  title: "",
  ...(openerId === undefined ? {} : { openerId }),
})

describe("the page in front", () => {
  it("is read from what the browser lists, pages only", () => {
    expect(
      pageTargets({
        targetInfos: [
          { targetId: "w", type: "service_worker", url: "https://a.test/sw.js" },
          { targetId: "p", type: "page", url: "https://a.test/", title: "A", openerId: "o" },
        ],
      }),
    ).toEqual([{ targetId: "p", url: "https://a.test/", title: "A", openerId: "o" }])
    expect(pageTargets(undefined)).toEqual([])
  })

  it("is the one the live view follows, and otherwise the latest that has gone somewhere", () => {
    const pages = [
      target("a", "https://a.test/"),
      target("b", "https://b.test/"),
      target("c", "about:blank"),
    ]
    expect(frontTarget(pages, "a")?.targetId).toBe("a")
    expect(frontTarget(pages)?.targetId).toBe("b")
    expect(frontTarget(pages, "gone")?.targetId).toBe("b")
    expect(frontTarget([target("c", "about:blank")])?.targetId).toBe("c")
    expect(frontTarget([])).toBeUndefined()
  })

  it("is overlooked by a window it opened or was opened by, of its own site or of none", () => {
    const page = target("a", "https://a.test/login")
    expect(overlooked(page, [page, target("b", "https://b.test/")])).toBe(false)
    expect(overlooked(page, [page, target("b", "about:blank", "a")])).toBe(true)
    expect(overlooked(page, [page, target("b", "https://a.test/other", "a")])).toBe(true)
    expect(overlooked(page, [page, target("b", "https://b.test/", "a")])).toBe(false)
    const opened = target("a", "https://a.test/login", "o")
    expect(overlooked(opened, [opened, target("o", "https://a.test/")])).toBe(true)
    expect(overlooked(opened, [opened, target("o", "https://shop.test/")])).toBe(false)
    // Two that one window opened are of one family.
    expect(
      overlooked(opened, [
        opened,
        target("o", "https://shop.test/"),
        target("s", "https://a.test/", "o"),
      ]),
    ).toBe(true)
  })
})

const QUICK: SignInTiming = {
  callMs: 500,
  settleMs: 1,
  loadMs: 200,
  formMs: 60,
  passwordMs: 100,
  goneMs: 200,
  lookMs: 10,
}
const login: SignInWith = {
  name: "Example",
  username: "pip@example.com",
  password: "hunter2-and-more",
  sites: ["example.com"],
}

/** A browser that answers what signing in asks of it, with a page that has the boxes given. */
function fakeBrowser(page: {
  url: string
  title?: string
  inputs: InputSeen[]
  /** Whether the password box says the caret is in it, and that it is one. */
  focused?: boolean
  /** Where the page has gone by itself by the time its boxes are looked for. */
  moved?: string
  /** A call that the browser refuses. */
  refuses?: string
}) {
  const sent: { method: string; params: Record<string, unknown>; sessionId?: string }[] = []
  const listeners: Record<string, ((event: { data: unknown }) => void)[]> = {}
  const say = (message: unknown) => {
    for (const listener of listeners.message ?? []) listener({ data: JSON.stringify(message) })
  }
  let entered = 0
  const answer = (method: string, params: Record<string, unknown>): unknown => {
    const declared = String(params.functionDeclaration ?? "")
    const expression = String(params.expression ?? "")
    switch (method) {
      case "Target.getTargets":
        return {
          targetInfos: [{ targetId: "t1", type: "page", url: page.url, title: page.title ?? "" }],
        }
      case "Target.getTargetInfo":
        return {
          targetInfo: { targetId: "t1", type: "page", url: page.url, title: page.title ?? "" },
        }
      case "Target.attachToTarget":
        return { sessionId: "s1" }
      case "Page.reload":
        queueMicrotask(() => say({ method: "Page.loadEventFired", params: {}, sessionId: "s1" }))
        return {}
      case "Page.getFrameTree":
        return { frameTree: { frame: { id: "f1", url: page.url } } }
      case "Page.createIsolatedWorld":
        return { executionContextId: 7 }
      case "Runtime.evaluate": {
        const held = /^globalThis\.__dcInputs\[(\d+)\]$/.exec(expression)
        if (held) return { result: { type: "object", objectId: `box-${held[1]}` } }
        // Once the form was sent the page is another, with no boxes.
        return {
          result: {
            value: {
              ready: true,
              url: page.moved ?? page.url,
              inputs: entered > 0 ? [] : page.inputs,
            },
          },
        }
      }
      case "Runtime.callFunctionOn":
        if (declared.includes("String(this.value)")) return { result: { value: "" } }
        if (declared.includes("this.focus()")) return { result: { value: true } }
        if (declared.includes("document.activeElement === this && this.isConnected")) {
          return { result: { value: page.focused ?? true } }
        }
        return { result: { value: false } }
      case "Input.dispatchKeyEvent":
        if (params.type === "keyUp") entered += 1
        return {}
      default:
        return {}
    }
  }
  const socket: PreviewSocket = {
    readyState: 1,
    send(data) {
      const call = JSON.parse(data)
      sent.push({ method: call.method, params: call.params, sessionId: call.sessionId })
      queueMicrotask(() => {
        if (call.method === page.refuses) {
          return say({
            id: call.id,
            error: { message: `Cannot do ${JSON.stringify(call.params)}` },
          })
        }
        say({ id: call.id, result: answer(call.method, call.params) })
      })
    },
    close() {},
    addEventListener(type: string, listener: (event: { data: unknown }) => void) {
      ;(listeners[type] ??= []).push(listener)
      if (type === "open") queueMicrotask(() => listener({ data: undefined }))
    },
  }
  let stopped = 0
  const typed = () =>
    sent.filter((call) => call.method === "Input.insertText").map((call) => call.params.text)
  return {
    sent,
    typed,
    stops: () => stopped,
    browser: {
      open: () => socket,
      stop: async () => {
        stopped += 1
      },
    },
  }
}

const form = [input({ autocomplete: "username" }), password()]

describe("signing in on a page", () => {
  it("stops dev-browser, loads the page again, and then types the username and the password", async () => {
    const chrome = fakeBrowser({ url: "https://www.example.com/login", inputs: form })
    const went = await signInOnPage(chrome.browser, login, { timeoutMs: 5_000, timing: QUICK })
    expect(went.outcome).toBe("signed_in")
    expect(went.site).toBe("www.example.com")
    expect(chrome.stops()).toBe(1)
    expect(chrome.typed()).toEqual([login.username, login.password])
    const methods = chrome.sent.map((call) => call.method)
    expect(methods.indexOf("Page.reload")).toBeGreaterThan(-1)
    expect(methods.indexOf("Page.reload")).toBeLessThan(methods.indexOf("Input.insertText"))
    expect(methods.at(-1)).toBe("Target.detachFromTarget")
    // The password is handed to the browser as what to type, and is in nothing else that is sent.
    const others = chrome.sent.filter((call) => call.params.text !== login.password)
    expect(JSON.stringify(others)).not.toContain(login.password)
    expect(JSON.stringify(went)).not.toContain(login.password)
  })

  it("types nothing, and leaves dev-browser be, on a page the login is not for", async () => {
    for (const url of ["https://example.com.evil.test/login", "http://example.com/login"]) {
      const chrome = fakeBrowser({ url, inputs: form })
      const went = await signInOnPage(chrome.browser, login, { timeoutMs: 5_000, timing: QUICK })
      expect(went.outcome).toBe("wrong_site")
      expect(went.message).toContain("example.com")
      expect(chrome.stops()).toBe(0)
      expect(chrome.typed()).toEqual([])
      expect(chrome.sent.map((call) => call.method)).not.toContain("Page.reload")
    }
  })

  it("types nothing where the page has gone on to another site by the time its boxes are found", async () => {
    const chrome = fakeBrowser({
      url: "https://example.com/login",
      moved: "https://accounts.elsewhere.test/login",
      inputs: form,
    })
    const went = await signInOnPage(chrome.browser, login, { timeoutMs: 5_000, timing: QUICK })
    expect(went.outcome).toBe("wrong_site")
    expect(went.message).toContain("accounts.elsewhere.test")
    expect(chrome.typed()).toEqual([])
  })

  it("does not type the password where the caret is not in a password box at that moment", async () => {
    const chrome = fakeBrowser({ url: "https://example.com/", inputs: form, focused: false })
    const went = await signInOnPage(chrome.browser, login, { timeoutMs: 5_000, timing: QUICK })
    expect(went.outcome).toBe("no_form")
    expect(chrome.typed()).toEqual([login.username])
  })

  it("types nothing at all where there is no box to sign in with", async () => {
    const chrome = fakeBrowser({ url: "https://example.com/", inputs: [input({ name: "q" })] })
    const went = await signInOnPage(chrome.browser, login, { timeoutMs: 5_000, timing: QUICK })
    // The page it was is asked of the browser before the socket to it is closed.
    expect(went).toMatchObject({
      outcome: "no_form",
      site: "example.com",
      url: "https://example.com/",
    })
    expect(chrome.typed()).toEqual([])
  })

  it("says it failed, and not why, where the browser refuses a call", async () => {
    for (const refuses of ["Page.reload", "Input.insertText", "Input.dispatchKeyEvent"]) {
      const chrome = fakeBrowser({ url: "https://example.com/", inputs: form, refuses })
      const went = await signInOnPage(chrome.browser, login, { timeoutMs: 5_000, timing: QUICK })
      expect(went.outcome).toBe("failed")
      expect(went.message).not.toContain("Cannot do")
      expect(JSON.stringify(went)).not.toContain(login.password)
    }
  })

  it("takes the password out of an address or a title that has it", async () => {
    const chrome = fakeBrowser({
      url: `https://example.com/?password=${encodeURIComponent(login.password)}`,
      title: `Welcome ${login.password}`,
      inputs: form,
    })
    const went = await signInOnPage(chrome.browser, login, { timeoutMs: 5_000, timing: QUICK })
    expect(went.outcome).toBe("signed_in")
    expect(went.url).toBe("https://example.com/?password=[password]")
    expect(went.title).toBe("Welcome [password]")
  })
})

describe("a computer where no browser is open for agents", () => {
  it("starts none to sign in, or to say which page is in front", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-sign-in-none-"))
    const io = nodeBrowserIO({ dir })
    expect(await io.front()).toEqual({ own: false })
    const went = await io.signIn({ id: "a", name: "Ada", color: "#000" }, login, {
      timeoutMs: 1_000,
    })
    expect(went).toMatchObject({ outcome: "failed", own: false })
    expect(went.message).toContain("with the browser tool first")
    // Nothing was downloaded or started for it: the folder is as it was made.
    expect(existsSync(join(dir, "dev-browser"))).toBe(false)
    expect(existsSync(join(dir, "browser-profile"))).toBe(false)
    await io.close()
  })
})

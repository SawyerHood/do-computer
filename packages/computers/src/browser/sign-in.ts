import { setTimeout as delay } from "node:timers/promises"
import { type BrowserSignedIn, type SignInWith, signInSite } from "@do-computer/protocol"
import type { PreviewSocket } from "./preview.ts"

/**
 * Signing in on a page with a saved login, done by the daemon itself over a DevTools socket of
 * its own. No script an agent wrote is part of it: dev-browser is stopped before the page is
 * loaded again, so that nothing an earlier script left behind is there to read what is typed,
 * and the password goes only into a box that is a password box at that moment.
 *
 * Nothing here puts the password into a script, an error or a log. It is handed to the browser
 * as the text of `Input.insertText`, and nowhere else.
 */

export type SignInTiming = {
  /** How long a call to the browser may take, and the socket to open. */
  callMs: number
  /** How long the browser is given to let go of what dev-browser had attached, once that has stopped. */
  settleMs: number
  /** How long the page is given to load again. */
  loadMs: number
  /** How long a page that has loaded is given to show its form, which some draw afterwards. */
  formMs: number
  /** How long a page that asked for the username alone is given to ask for the password. */
  passwordMs: number
  /** How long the form is given to go once it is sent. */
  goneMs: number
  /** How long between two looks at the page. */
  lookMs: number
}

export const SIGN_IN_TIMING: SignInTiming = {
  callMs: 10_000,
  settleMs: 400,
  loadMs: 15_000,
  formMs: 2_000,
  passwordMs: 8_000,
  goneMs: 12_000,
  lookMs: 200,
}

export type SignInBrowser = {
  /** Opens a DevTools socket of the daemon's own to the browser. */
  open(): PreviewSocket
  /** The page the live view follows, as the browser names it, where it is known. */
  front?: string
  /** Stops dev-browser, and with it whatever a script left running in it. */
  stop(): Promise<void>
}

export type PageTarget = { targetId: string; url: string; title: string; openerId?: string }

type Json = Record<string, unknown>
const obj = (value: unknown): Json =>
  typeof value === "object" && value !== null ? (value as Json) : {}
const text = (value: unknown) => (typeof value === "string" ? value : "")

const SOCKET_OPEN = 1
const BLANK = new Set(["", "about:blank"])

/** The pages among what `Target.getTargets` answered with. */
export function pageTargets(result: unknown): PageTarget[] {
  const infos = obj(result).targetInfos
  if (!Array.isArray(infos)) return []
  const pages: PageTarget[] = []
  for (const raw of infos) {
    const info = obj(raw)
    if (info.type !== "page" || typeof info.targetId !== "string") continue
    pages.push({
      targetId: info.targetId,
      url: text(info.url),
      title: text(info.title),
      ...(typeof info.openerId === "string" ? { openerId: info.openerId } : {}),
    })
  }
  return pages
}

/**
 * The page in front: the one the live view follows where that is known, and otherwise chosen
 * as the live view would choose, one that has gone somewhere before a blank one, and then the latest.
 */
export function frontTarget(pages: readonly PageTarget[], hint?: string): PageTarget | undefined {
  const hinted = pages.find((page) => page.targetId === hint)
  if (hinted) return hinted
  return pages.findLast((page) => !BLANK.has(page.url)) ?? pages.at(-1)
}

/**
 * Whether another window could read what is typed into `page`: one it opened or was opened by,
 * however many steps apart, that is of the same origin or of none of its own (a blank one has
 * its opener's). Such a window keeps hold of the page across a reload, and its script is the
 * page's own, which stopping dev-browser does not end.
 */
export function overlooked(page: PageTarget, pages: readonly PageTarget[]): boolean {
  const origin = originOf(page.url)
  const family = new Set([page.targetId])
  for (let grew = true; grew;) {
    grew = false
    for (const other of pages) {
      const joins =
        !family.has(other.targetId) &&
        ((other.openerId !== undefined && family.has(other.openerId)) ||
          pages.some((member) => family.has(member.targetId) && member.openerId === other.targetId))
      if (joins) {
        family.add(other.targetId)
        grew = true
      }
    }
  }
  return pages.some(
    (other) =>
      other.targetId !== page.targetId &&
      family.has(other.targetId) &&
      (originOf(other.url) ?? origin) === origin,
  )
}

/** The origin of an http or https address. Undefined for any other, which has none of its own. */
function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

/** One `input` of a page, as the page describes it: enough to choose by, and nothing it holds. */
export type InputSeen = {
  type: string
  autocomplete: string
  name: string
  id: string
  /** Whether it can be seen and typed into. */
  shown: boolean
  /** Which of the page's forms it is in. -1 for none. */
  form: number
}

/**
 * Run in the page, in a world of the daemon's own: lists the page's inputs in the order they
 * are in the page, and keeps them, so that the one chosen is taken by its place in the list.
 */
const SEE_INPUTS = `(() => {
  const forms = [...document.forms];
  const shown = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && !el.disabled && !el.readOnly;
  };
  globalThis.__dcInputs = [...document.querySelectorAll("input")];
  return {
    ready: document.readyState !== "loading",
    url: location.href,
    inputs: globalThis.__dcInputs.map((el) => ({
      type: String(el.type).toLowerCase(),
      autocomplete: String(el.getAttribute("autocomplete") || "").toLowerCase(),
      name: String(el.getAttribute("name") || ""),
      id: String(el.id || ""),
      shown: shown(el),
      form: forms.indexOf(el.form),
    })),
  };
})()`

/** Run on a box: whether it is in the page, to be seen, and still a password box. */
const IS_PASSWORD_BOX = `function () {
  const box = this.getBoundingClientRect();
  return this.isConnected && this.type === "password" && box.width > 0 && box.height > 0 &&
    getComputedStyle(this).visibility !== "hidden" && !this.disabled && !this.readOnly;
}`

/** Run on a box: put the caret in it, with what it holds selected, so that typing replaces that. */
const FOCUS = `function () { this.focus(); this.select(); return document.activeElement === this; }`

/** Run on a password box just before the password is typed: whether typing would go into it. */
const HAS_FOCUS_AS_PASSWORD = `function () {
  return document.activeElement === this && this.isConnected && this.type === "password";
}`

const VALUE = `function () { return String(this.value); }`

/** Run on a box: empty it, and tell the page so as typing would. */
const EMPTY = `function () {
  this.value = "";
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
}`

/** Run in the page: empty every password box there is. */
const EMPTY_PASSWORDS = `(() => {
  for (const el of document.querySelectorAll("input[type=password]")) {
    if (el.value === "") continue;
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
})()`

const TEXT_LIKE = new Set(["text", "email", "tel", ""])
const NAMED_USERNAME = /user|login|e-?mail|identifier|account/i
const NAMED_CODE = /(^|[-_.])(otp|totp|mfa|2fa)([-_.]|$)|one[-_]?time|verification[-_]?code/i

/** Which of a page's inputs to sign in with, as places in the list. */
export type FieldsChosen = {
  password?: number
  username?: number
  /** Whether the page asks for a code that is used once. */
  code: boolean
}

/**
 * The boxes a password manager would fill. The password box is one that can be seen and is of
 * type `password`: the one for a current password first, and one for a new password only where
 * there is no other. The username box is the one that says so, else one for an e-mail address,
 * else the nearest box for text before the password in its form. Where the page asks for the
 * username alone, a box for text counts where its name says what it is for.
 */
export function chooseFields(inputs: readonly InputSeen[]): FieldsChosen {
  const shown = inputs.map((input, at) => ({ ...input, at })).filter((input) => input.shown)
  const tokens = (input: InputSeen) => input.autocomplete.split(/\s+/)
  const code = shown.some(
    (input) =>
      input.type !== "password" &&
      (tokens(input).includes("one-time-code") ||
        NAMED_CODE.test(input.name) ||
        NAMED_CODE.test(input.id)),
  )
  const passwords = shown.filter((input) => input.type === "password")
  const password =
    passwords.find((input) => tokens(input).includes("current-password")) ??
    passwords.find((input) => !tokens(input).includes("new-password")) ??
    passwords[0]
  const texts = shown.filter(
    (input) => TEXT_LIKE.has(input.type) && !tokens(input).includes("one-time-code"),
  )
  // Of two that fit, the one in the password's form, and then the one nearest before it.
  const nearest = (fit: (input: InputSeen) => boolean) => {
    const fitting = texts.filter(fit)
    if (password === undefined) return fitting[0]
    const before = (list: typeof fitting) => list.findLast((input) => input.at < password.at)
    const together = fitting.filter((input) => input.form === password.form)
    return before(together) ?? together[0] ?? before(fitting) ?? fitting[0]
  }
  const username =
    nearest((input) => tokens(input).includes("username")) ??
    nearest((input) => input.type === "email") ??
    (password === undefined
      ? nearest((input) => NAMED_USERNAME.test(input.name) || NAMED_USERNAME.test(input.id))
      : texts.findLast((input) => input.form === password.form && input.at < password.at))
  return {
    ...(password === undefined ? {} : { password: password.at }),
    ...(username === undefined ? {} : { username: username.at }),
    code,
  }
}

/**
 * How it went, from what the page shows once the form was sent: `gone` is whether the password
 * box that was typed into is no longer there, and `fields` is what the page has now.
 */
export function outcomeOf(
  gone: boolean,
  fields: FieldsChosen,
): { outcome: "signed_in" | "still_asking"; code: boolean } {
  if (fields.code) return { outcome: "still_asking", code: true }
  return {
    outcome: gone && fields.password === undefined ? "signed_in" : "still_asking",
    code: false,
  }
}

/**
 * Take the password out of a text, as it is and as an address would carry it. It should never
 * be in one: this is for the page that puts what it was sent into its address or its title.
 */
export function withoutPassword(value: string, password: string): string {
  if (password === "") return value
  const forms = new Set([password, encodeURIComponent(password)])
  forms.add(encodeURIComponent(password).replace(/%20/g, "+"))
  forms.add(encodeURI(password))
  forms.add(new URLSearchParams({ p: password }).toString().slice(2))
  let cleaned = value
  // The longest first, so that one form inside another does not leave the rest of it behind.
  for (const form of [...forms].sort((a, b) => b.length - a.length)) {
    cleaned = cleaned.split(form).join("[password]")
  }
  return cleaned
}

type Cdp = {
  send(method: string, params: Json, sessionId?: string): Promise<Json>
  /** Resolves with true when the browser next says `method` of a session, or false after `waitMs`. */
  heard(method: string, sessionId: string, waitMs: number): Promise<boolean>
  close(): void
}

/**
 * A DevTools socket to speak over. A call that fails says only which call it was: what it was
 * given is never part of an error.
 */
function connect(open: () => PreviewSocket, callMs: number): Promise<Cdp> {
  return new Promise((resolve, reject) => {
    const socket = open()
    const calls = new Map<number, { resolve(value: Json): void; reject(error: Error): void }>()
    const listeners = new Set<(method: string, sessionId: string) => void>()
    let nextId = 0
    let closed = false
    const end = () => {
      closed = true
      clearTimeout(opening)
      for (const call of calls.values()) call.reject(new Error("The browser went away."))
      calls.clear()
      reject(new Error("The browser could not be reached."))
    }
    const opening = setTimeout(() => {
      end()
      socket.close()
    }, callMs)
    const cdp: Cdp = {
      send(method, params, sessionId) {
        if (closed || socket.readyState !== SOCKET_OPEN) {
          return Promise.reject(new Error("The browser went away."))
        }
        const id = ++nextId
        return new Promise<Json>((settle, fail) => {
          const timer = setTimeout(() => {
            calls.delete(id)
            fail(new Error(`${method} was not answered.`))
          }, callMs)
          calls.set(id, {
            resolve(value) {
              clearTimeout(timer)
              settle(value)
            },
            reject(error) {
              clearTimeout(timer)
              fail(error)
            },
          })
          socket.send(
            JSON.stringify({
              id,
              method,
              params,
              ...(sessionId === undefined ? {} : { sessionId }),
            }),
          )
        })
      },
      heard(method, sessionId, waitMs) {
        return new Promise((settle) => {
          const listener = (said: string, of: string) => {
            if (said !== method || of !== sessionId) return
            listeners.delete(listener)
            clearTimeout(timer)
            settle(true)
          }
          const timer = setTimeout(() => {
            listeners.delete(listener)
            settle(false)
          }, waitMs)
          listeners.add(listener)
        })
      },
      close() {
        if (closed) return
        end()
        socket.close()
      },
    }
    socket.addEventListener("open", () => {
      clearTimeout(opening)
      resolve(cdp)
    })
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return
      let message: Json
      try {
        message = obj(JSON.parse(event.data))
      } catch {
        return
      }
      if (typeof message.id === "number") {
        const call = calls.get(message.id)
        calls.delete(message.id)
        if (message.error) call?.reject(new Error("The browser refused a call."))
        else call?.resolve(obj(message.result))
        return
      }
      const method = text(message.method)
      const sessionId = text(message.sessionId)
      for (const listener of [...listeners]) listener(method, sessionId)
    })
    socket.addEventListener("close", end)
    socket.addEventListener("error", end)
  })
}

/** How long the browser is given to say which page is in front: whoever asks does not wait long. */
const FRONT_WAIT_MS = 3_000

/** The page in front, read over a socket of the daemon's own. Undefined where there is none. */
export async function readFront(
  browser: Pick<SignInBrowser, "open" | "front">,
): Promise<PageTarget | undefined> {
  let cdp: Cdp | undefined
  try {
    cdp = await connect(browser.open, FRONT_WAIT_MS)
    return frontTarget(pageTargets(await cdp.send("Target.getTargets", {})), browser.front)
  } catch {
    return undefined
  } finally {
    cdp?.close()
  }
}

type Outcome = Omit<BrowserSignedIn, "own" | "typed">

/**
 * Sign in on the page in front with `login`. Resolves with how it went, and never rejects.
 * Nothing in the answer is, or holds, the password.
 */
export async function signInOnPage(
  browser: SignInBrowser,
  login: SignInWith,
  options: { timeoutMs: number; timing?: SignInTiming },
): Promise<Omit<BrowserSignedIn, "own">> {
  const progress: Progress = { typed: "nothing" }
  const went = await attempt(
    browser,
    login,
    options.timeoutMs,
    options.timing ?? SIGN_IN_TIMING,
    progress,
  )
  const clean = (value: string) => withoutPassword(value, login.password)
  return {
    outcome: went.outcome,
    message: clean(went.message),
    typed: progress.typed === "password",
    ...(went.site === undefined ? {} : { site: clean(went.site) }),
    ...(went.url === undefined ? {} : { url: clean(went.url).slice(0, 2_000) }),
    ...(went.title === undefined ? {} : { title: clean(went.title).slice(0, 300) }),
  }
}

/** What of a login has been typed so far, kept where it outlives however the attempt ends. */
type Progress = { typed: "nothing" | "username" | "password" }

async function attempt(
  browser: SignInBrowser,
  login: SignInWith,
  timeoutMs: number,
  timing: SignInTiming,
  progress: Progress,
): Promise<Outcome> {
  const until = Date.now() + timeoutMs
  const left = (most: number) => Math.max(0, Math.min(most, until - Date.now()))
  const named = `the login "${login.name}"`
  const Named = `The login "${login.name}"`
  let cdp: Cdp | undefined
  let sessionId: string | undefined
  let site: string | undefined
  try {
    cdp = await connect(browser.open, timing.callMs)
    const speak = cdp
    const front = frontTarget(pageTargets(await speak.send("Target.getTargets", {})), browser.front)
    if (front === undefined) {
      return {
        outcome: "failed",
        message:
          "The browser has no page open. Open the page that asks to sign in with the browser tool first, and then sign in.",
      }
    }
    const refusal = (url: string): Outcome => ({
      outcome: "wrong_site",
      message: `${Named} is for ${login.sites.join(", ")}, and the page in front is ${hostOf(url)}${signInSite(url.replace(/^http:/, "https:"), login.sites) === null ? "" : ", which is not reached over https"}. Nothing of its password was typed. Open the sign-in page of a site it is for with the browser tool first.`,
      url,
    })
    if (signInSite(front.url, login.sites) === null) {
      return { ...refusal(front.url), title: front.title }
    }

    // From here until it is over nothing an agent wrote runs: not in dev-browser, and, once
    // the page has loaded again, not in the page.
    await browser.stop()
    // dev-browser has ended by now. The browser hears of it a moment later, and only then
    // drops what dev-browser had put in the page for every document to come.
    await delay(timing.settleMs)
    const session = text(
      (await speak.send("Target.attachToTarget", { targetId: front.targetId, flatten: true }))
        .sessionId,
    )
    sessionId = session
    const send = (method: string, params: Json = {}) => speak.send(method, params, session)
    await send("Page.enable")
    // A page that is not the one being looked at takes what is typed all the same.
    await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {})
    // The page is fetched afresh, past what the browser has kept of it and past any service
    // worker: either could have been put there for the site while a script still ran.
    await send("Network.enable")
    await send("Network.setCacheDisabled", { cacheDisabled: true })
    await send("Network.setBypassServiceWorker", { bypass: true })
    const loaded = speak.heard("Page.loadEventFired", session, left(timing.loadMs))
    await send("Page.reload", { ignoreCache: true })
    await loaded

    /** The page's address, as the browser has it now. */
    const address = async () =>
      text(obj(obj((await send("Page.getFrameTree")).frameTree).frame).url)
    /** Run fixed code in the page, in a world its own scripts cannot reach into. */
    const world = async () => {
      const frame = text(obj(obj((await send("Page.getFrameTree")).frameTree).frame).id)
      const made = await send("Page.createIsolatedWorld", {
        frameId: frame,
        worldName: "dc-sign-in",
      })
      return Number(made.executionContextId)
    }
    const on = async (objectId: string, declaration: string) =>
      obj(
        (
          await send("Runtime.callFunctionOn", {
            objectId,
            functionDeclaration: declaration,
            returnByValue: true,
          })
        ).result,
      ).value
    /** The page's inputs now, and a way to take hold of one. Undefined while it is between pages. */
    const look = async () => {
      try {
        const contextId = await world()
        const seen = obj(
          obj(
            (
              await send("Runtime.evaluate", {
                expression: SEE_INPUTS,
                contextId,
                returnByValue: true,
              })
            ).result,
          ).value,
        )
        if (!Array.isArray(seen.inputs)) return undefined
        return {
          ready: seen.ready === true,
          // The address of the document these boxes are in, which a box taken hold of stays part of.
          url: text(seen.url),
          fields: chooseFields(seen.inputs as InputSeen[]),
          async hold(at: number) {
            const held = obj(
              (
                await send("Runtime.evaluate", {
                  expression: `globalThis.__dcInputs[${Math.trunc(at)}]`,
                  contextId,
                })
              ).result,
            )
            return text(held.objectId)
          },
        }
      } catch {
        return undefined
      }
    }
    const after = async (): Promise<{ url?: string; title?: string }> => {
      try {
        const info = obj(
          (await speak.send("Target.getTargetInfo", { targetId: front.targetId })).targetInfo,
        )
        return { url: text(info.url), title: text(info.title) }
      } catch {
        return {}
      }
    }
    const enter = async () => {
      const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }
      await send("Input.dispatchKeyEvent", { type: "keyDown", ...key, text: "\r" })
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...key })
    }
    /** Empty the boxes that were filled, where they are still there, and every password box. */
    const empty = async (filled: string[]) => {
      for (const objectId of filled) await on(objectId, EMPTY).catch(() => {})
      const contextId = await world().catch(() => undefined)
      if (contextId !== undefined) {
        await send("Runtime.evaluate", { expression: EMPTY_PASSWORDS, contextId }).catch(() => {})
      }
    }

    // A reload can end somewhere else.
    const url = await address()
    site = signInSite(url, login.sites) ?? undefined
    if (site === undefined) return { ...refusal(url), ...(await after()) }
    const open = pageTargets(await speak.send("Target.getTargets", {}))
    if (overlooked(open.find((page) => page.targetId === front.targetId) ?? front, open)) {
      return {
        outcome: "failed",
        message:
          "The page in front was opened by another window of the same site, or has opened one, and that window could read what is typed here. Nothing was typed. Close the other window, or open the sign-in page in a page of its own, and then sign in.",
        site,
        ...(await after()),
      }
    }

    const noForm = async (filled: string[]): Promise<Outcome> => {
      await empty(filled)
      return {
        outcome: "no_form",
        message: `There is no box for a password on the page in front, so nothing of ${named} was typed${filled.length > 0 ? " but its username, which was taken out again" : ""}. Go to the page that asks for the password with the browser tool first.`,
        site,
        ...(await after()),
      }
    }

    const inTime = () => {
      if (Date.now() >= until) throw new Error("There was not time enough.")
    }
    let seen = await look()
    const nothing = () =>
      seen === undefined ||
      (seen.fields.password === undefined && seen.fields.username === undefined)
    for (const end = Date.now() + left(timing.formMs); nothing() && Date.now() < end;) {
      await delay(timing.lookMs)
      seen = await look()
    }
    if (seen === undefined) return await noForm([])
    inTime()
    // The page may have gone on by itself since it loaded: the boxes are typed into only where
    // the document they are in is one the login is for.
    site = signInSite(seen.url, login.sites) ?? undefined
    if (site === undefined) return { ...refusal(seen.url), ...(await after()) }
    const filled: string[] = []
    let usernameDone = false
    if (seen.fields.password === undefined) {
      // A page that asks for the username alone, and for the password once it has that.
      if (seen.fields.username === undefined) return await noForm([])
      const box = await seen.hold(seen.fields.username)
      if ((await on(box, VALUE)) !== login.username) {
        if ((await on(box, FOCUS)) !== true) return await noForm([])
        await send("Input.insertText", { text: login.username })
        progress.typed = "username"
        filled.push(box)
      } else {
        await on(box, FOCUS)
      }
      usernameDone = true
      await enter()
      seen = undefined
      for (const end = Date.now() + left(timing.passwordMs); Date.now() < end;) {
        await delay(timing.lookMs)
        const now = await look()
        if (now?.fields.password !== undefined) {
          seen = now
          break
        }
      }
      if (seen === undefined) return await noForm(filled)
      // The password may be asked for at another address, which is checked as the first was.
      site = signInSite(seen.url, login.sites) ?? undefined
      if (site === undefined) {
        await empty(filled)
        return { ...refusal(seen.url), ...(await after()) }
      }
    }
    if (seen.fields.password === undefined) return await noForm(filled)
    const passwordBox = await seen.hold(seen.fields.password)
    if (!usernameDone && seen.fields.username !== undefined) {
      const box = await seen.hold(seen.fields.username)
      if ((await on(box, VALUE)) !== login.username && (await on(box, FOCUS)) === true) {
        await send("Input.insertText", { text: login.username })
        progress.typed = "username"
        filled.push(box)
      }
    }
    inTime()
    // The password is typed only where the caret is in a box that is a password box now.
    await on(passwordBox, FOCUS)
    if ((await on(passwordBox, HAS_FOCUS_AS_PASSWORD)) !== true) return await noForm(filled)
    // Said before it is done: if the answer to this never comes, it may have been typed all the same.
    progress.typed = "password"
    await send("Input.insertText", { text: login.password })
    filled.push(passwordBox)
    await enter()

    let gone = false
    let fields: FieldsChosen = { password: 0, code: false }
    for (const end = Date.now() + left(timing.goneMs); Date.now() < end;) {
      await delay(timing.lookMs)
      const there = await on(passwordBox, IS_PASSWORD_BOX).catch(() => false)
      if (there === true) continue
      // The box is gone. What is there instead is believed once it has loaded, and has
      // been the same for two looks.
      const first = await look()
      if (!first?.ready) continue
      await delay(timing.lookMs)
      const second = await look()
      if (!second?.ready || JSON.stringify(second.fields) !== JSON.stringify(first.fields)) continue
      gone = true
      fields = second.fields
      break
    }
    if (!gone) fields = (await look())?.fields ?? fields
    const how = outcomeOf(gone, fields)
    if (how.outcome === "signed_in") {
      return {
        outcome: "signed_in",
        message: `Signed in to ${site} as ${login.username}, with ${named}.`,
        site,
        ...(await after()),
      }
    }
    await empty(filled)
    return {
      outcome: "still_asking",
      message: how.code
        ? `${Named} was typed and sent on ${site}, and the page now asks for a code. That is for the person whose account it is to give: ask them for it, or to type it into the browser themselves.`
        : `${Named} was typed and sent on ${site}, and the page still asks for a password: it may no longer be the right one, or the page wants something more first. What was typed was taken out of the page again. Look at the page with the browser tool to see what it says, and do not try again unless something has changed.`,
      site,
      ...(await after()),
    }
  } catch {
    // Why is left out on purpose: nothing that went wrong is worth the chance of saying what was typed.
    return {
      outcome: "failed",
      message:
        progress.typed === "password"
          ? `The browser stopped answering after ${named} was typed, so how it went is not known. Look at the page with the browser tool.`
          : Date.now() >= until
            ? `There was not time enough to sign in with ${named}. Nothing of its password was typed.`
            : `The browser could not be driven to sign in with ${named}: it stopped answering, or the page went away. Nothing of its password was typed.`,
      ...(site === undefined ? {} : { site }),
    }
  } finally {
    if (cdp !== undefined && sessionId !== undefined) {
      await cdp.send("Target.detachFromTarget", { sessionId }).catch(() => {})
    }
    cdp?.close()
  }
}

/** The host of an address, for saying which page it was. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname || "a page of the browser's own"
  } catch {
    return "a page of the browser's own"
  }
}

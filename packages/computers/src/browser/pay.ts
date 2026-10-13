import { setTimeout as delay } from "node:timers/promises"
import { type BrowserPaid, type PayField, type PayWith, paySite } from "@do-computer/protocol"
import {
  type Cdp,
  type SignInBrowser,
  type Speak,
  EMPTY,
  FOCUS,
  VALUE,
  connect,
  frontTarget,
  hostOf,
  obj,
  overlooked,
  pageTargets,
  speakTo,
  text,
} from "./sign-in.ts"

/**
 * Paying on a page with a saved card, done by the daemon itself as signing in is: dev-browser
 * is stopped, the page loaded again, and the card typed over a DevTools socket of the daemon's
 * own. A card's boxes are ordinary ones that any script could read afterwards, so it is all one
 * step: the boxes are filled, the button pressed, and what was typed taken out again where the
 * form is still there. No script an agent wrote runs in between.
 *
 * Nothing here puts the card's number or its code into a script, an error or a log. They are
 * handed to the browser as the text of `Input.insertText`, and nowhere else.
 */

export type PayTiming = {
  /** How long a call to the browser may take, and the socket to open. */
  callMs: number
  /** How long the browser is given to let go of what dev-browser had attached, once that has stopped. */
  settleMs: number
  /** How long the page is given to load again. */
  loadMs: number
  /** How long a page that has loaded is given to show a box for the card's number: such frames come late. */
  boxesMs: number
  /** How long the other boxes of a card are given once the one for its number is there. */
  restMs: number
  /** How long a button that cannot be pressed yet is given once the card is typed: many wait for a whole card. */
  pressMs: number
  /** How long the form is given to go once the button is pressed. */
  goneMs: number
  /** How long between two looks at the page. */
  lookMs: number
}

export const PAY_TIMING: PayTiming = {
  callMs: 10_000,
  settleMs: 400,
  loadMs: 15_000,
  boxesMs: 15_000,
  restMs: 2_000,
  pressMs: 5_000,
  goneMs: 20_000,
  lookMs: 200,
}

/** One box of a frame, as the frame describes it: enough to choose by, and nothing it holds. */
export type BoxSeen = {
  /** `input`, `select` or `textarea`. */
  tag: string
  type: string
  autocomplete: string
  /** What it is called: its name, id, label for a reader, placeholder, and the words of its labels. */
  called: string[]
  /** The most it takes. 0 where it does not say. */
  maxLength: number
  /** Whether it can be seen and typed into. */
  shown: boolean
  empty: boolean
}

/** A box, by which of the page's frames it is in and its place in that frame's list. */
export type Place = { frame: number; at: number }

/** Which boxes a card goes into. The time it runs out is one box, or a month and a year. */
export type CardBoxes = {
  number?: Place
  expiry?: Place
  month?: Place
  year?: Place
  code?: Place
  holder?: Place
  postal?: Place
}

/**
 * Run in a frame, in a world of the daemon's own: lists the frame's boxes and what can be
 * pressed in it, in the order they are in the frame, and keeps them, so that the one chosen is
 * taken by its place in the list.
 */
const SEE = `(() => {
  const shown = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && !el.disabled && !el.readOnly;
  };
  const words = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const pressed = "button, input[type=submit], input[type=button], [role=button], a";
  // A button is looked for whether or not it can be pressed yet: many cannot until the card is in.
  const seen = (el) => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };
  globalThis.__dcBoxes = [...document.querySelectorAll("input, select, textarea")];
  // The innermost of what can be pressed: a link around a button is the button.
  globalThis.__dcButtons = [...document.querySelectorAll(pressed)].filter(
    (el) => seen(el) && !el.querySelector(pressed),
  );
  return {
    url: location.href,
    boxes: globalThis.__dcBoxes.map((el) => ({
      tag: el.localName,
      type: String(el.type).toLowerCase(),
      autocomplete: String(el.getAttribute("autocomplete") || "").toLowerCase(),
      called: [
        el.getAttribute("name"),
        el.id,
        el.getAttribute("aria-label"),
        el.getAttribute("placeholder"),
        ...[...(el.labels || [])].map((label) => label.innerText),
      ].map(words).filter(Boolean),
      maxLength: el.maxLength > 0 ? el.maxLength : 0,
      shown: shown(el),
      empty: el.value === "",
    })),
    buttons: globalThis.__dcButtons.map((el) =>
      [el.innerText, el.value, el.getAttribute("aria-label")].map(words).filter(Boolean),
    ),
  };
})()`

/** Run on a box: whether it is still in its frame, and to be seen. */
const IS_THERE = `function () {
  const box = this.getBoundingClientRect();
  return this.isConnected && box.width > 0 && box.height > 0 && getComputedStyle(this).visibility !== "hidden";
}`

/** Run on a `select` with the options that would do: choose the first there is, and tell the page so as choosing would. */
const CHOOSE = `function (wanted) {
  const options = [...this.options];
  const same = (value) => wanted.includes(String(value).trim().toLowerCase());
  let at = options.findIndex((option) => same(option.value));
  if (at < 0) at = options.findIndex((option) => same(option.text));
  if (at < 0) return false;
  this.selectedIndex = at;
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}`

/** Run on a button: bring it into view, and answer with the middle of it. */
const MIDDLE = `function () {
  this.scrollIntoView({ block: "center" });
  const box = this.getBoundingClientRect();
  const pressable = this.isConnected && !this.disabled && this.getAttribute("aria-disabled") !== "true";
  return pressable ? [box.x + box.width / 2, box.y + box.height / 2] : null;
}`

const TYPED_INTO = new Set(["text", "tel", "number", "email", "password", "search", ""])
const NUMBER = /(card|cc)[-_ ]?(num(ber)?|no)(?![a-z])|^(number|pan)$/i
const CODE = /cvc|cvv|csc|cvn|security[-_ ]?code|card[-_ ]?code/i
const HOLDER = /card[-_ ]?holder|name[-_ ]?on[-_ ]?card|(card|cc)[-_ ]?name/i
const POSTAL = /postal|zip|post[-_ ]?code/i
const EXPIRY = /exp/i
const MONTH = /month|(^|[^a-z])mm([^a-z]|$)/i
const YEAR = /year|(^|[^a-z])yy(yy)?([^a-z]|$)/i
const OF_CARD = /exp|card|(^|[^a-z])cc/i

const words = (value: string) => value.replace(/\s+/g, " ").trim()

/**
 * The boxes a card goes into, among those of every frame of a page: each by what it says it is
 * for (`autocomplete`), and else by what it is called. The frame with the box for the number
 * comes first for the others, which may also each be in a frame of their own. Without a box
 * for the number there are none.
 */
export function chooseCardBoxes(frames: readonly (readonly BoxSeen[])[]): CardBoxes {
  const all = frames.flatMap((boxes, frame) =>
    boxes.map((box, at) => ({ ...box, frame, at })).filter((box) => box.shown),
  )
  type Box = (typeof all)[number]
  const says = (token: string) => (box: Box) => box.autocomplete.split(/\s+/).includes(token)
  const called =
    (...patterns: RegExp[]) =>
    (box: Box) =>
      patterns.every((pattern) => box.called.some((name) => pattern.test(name)))
  const typed = (fit: (box: Box) => boolean) => (box: Box) =>
    box.tag === "input" && TYPED_INTO.has(box.type) && fit(box)
  const chosen = (fit: (box: Box) => boolean) => (box: Box) =>
    (box.tag === "select" || typed(() => true)(box)) && fit(box)
  const taken = new Set<Box>()
  let near: number | undefined
  /** The first box that fits the first of `fits` that any does, and is not another's already. */
  const take = (...fits: ((box: Box) => boolean)[]): Place | undefined => {
    for (const fit of fits) {
      const fitting = all.filter((box) => !taken.has(box) && fit(box))
      const found = fitting.find((box) => box.frame === near) ?? fitting[0]
      if (found === undefined) continue
      taken.add(found)
      near ??= found.frame
      return { frame: found.frame, at: found.at }
    }
    return undefined
  }
  const number = take(typed(says("cc-number")), typed(called(NUMBER)))
  if (number === undefined) return {}
  const one = take(typed(says("cc-exp")))
  const month = one
    ? undefined
    : take(
        chosen(says("cc-exp-month")),
        chosen((box) => called(OF_CARD, MONTH)(box) && !called(YEAR)(box)),
      )
  const year = one
    ? undefined
    : take(
        chosen(says("cc-exp-year")),
        chosen((box) => called(OF_CARD, YEAR)(box) && !called(MONTH)(box)),
      )
  // One box for both says neither month nor year, or says both ("MM / YY").
  const expiry =
    one ??
    (month && year
      ? undefined
      : take(typed((box) => called(EXPIRY)(box) && called(MONTH)(box) === called(YEAR)(box))))
  const code = take(typed(says("cc-csc")), typed(called(CODE)))
  const holder = take(typed(says("cc-name")), typed(called(HOLDER)))
  const postal = take(typed(says("postal-code")), typed(called(POSTAL)))
  return {
    number,
    ...(expiry ? { expiry } : month && year ? { month, year } : {}),
    ...(code ? { code } : {}),
    ...(holder ? { holder } : {}),
    ...(postal ? { postal } : {}),
  }
}

const two = (value: number) => String(value % 100).padStart(2, "0")

/**
 * What is typed for when a card runs out: into one box for both the month and the year as two
 * digits each, and into a box for one of them that alone, the year in full where `fullYear`.
 */
export function expiryText(
  card: Pick<PayWith, "expMonth" | "expYear">,
  box: "both" | "month" | "year",
  fullYear = false,
): string {
  const year = fullYear ? String(card.expYear) : two(card.expYear)
  return box === "year" ? year : box === "month" ? two(card.expMonth) : two(card.expMonth) + year
}

/** How an option of a `select` for a card's month or year may be written, by value or by text. */
export function expiryOptions(
  card: Pick<PayWith, "expMonth" | "expYear">,
  box: "month" | "year",
): string[] {
  const value = box === "month" ? card.expMonth : card.expYear
  return [String(value), two(value)]
}

/**
 * The button to press, among what each thing that can be pressed says (its words, its value,
 * its label for a reader): the one that says `wanted`, whatever the case, and where none does
 * the one that has it in what it says. More than one is as good as none: which was meant is
 * not for this to guess.
 */
export function chooseButton(
  buttons: readonly (readonly string[])[],
  wanted: string,
): number | "none" | "many" {
  const want = words(wanted).toLowerCase()
  if (want === "") return "none"
  const where = (fit: (said: string) => boolean) =>
    buttons.flatMap((said, at) => (said.some((each) => fit(words(each).toLowerCase())) ? [at] : []))
  const equal = where((said) => said === want)
  const fitting = equal.length > 0 ? equal : where((said) => said.includes(want))
  return fitting.length === 1 ? (fitting[0] as number) : fitting.length === 0 ? "none" : "many"
}

/**
 * The box that is called `box`, whatever the case: by what it says it is for, its name, its
 * label or its placeholder. Never one of `not`, which are the card's.
 */
export function chooseField(
  frames: readonly (readonly BoxSeen[])[],
  box: string,
  not: readonly Place[] = [],
): Place | undefined {
  const want = words(box).toLowerCase()
  const same = (name: string) =>
    words(name)
      .replace(/[\s*:]+$/, "")
      .toLowerCase() === want
  for (const [frame, boxes] of frames.entries()) {
    const at = boxes.findIndex(
      (seen, place) =>
        seen.shown &&
        (seen.tag !== "input" || TYPED_INTO.has(seen.type) || seen.type === "url") &&
        !not.some((card) => card.frame === frame && card.at === place) &&
        (seen.autocomplete.split(/\s+/).includes(want) || seen.called.some(same)),
    )
    if (at >= 0 && want !== "") return { frame, at }
  }
  return undefined
}

/**
 * Take a card's number out of a text: its digits in their order, with or without something
 * between them as a page or an address would write them. It should never be in one: this is
 * for the page that puts what it was sent into its address or its title.
 */
export function withoutNumber(value: string, number: string): string {
  const digits = number.replace(/\D/g, "")
  if (digits === "") return value
  return value.replace(new RegExp(digits.split("").join("(?:[ -]|%20|\\+)?"), "g"), "[card number]")
}

type Outcome = Omit<BrowserPaid, "own" | "typed">

/** What of a card has been typed so far, kept where it outlives however the attempt ends. */
type Progress = { typed: boolean }

/**
 * Pay on the page in front with `card`: fill `fields` in, type the card, and press the button
 * that says `button`. Resolves with how it went, and never rejects. Nothing in the answer is,
 * or holds, the card's number or its code.
 */
export async function payOnPage(
  browser: SignInBrowser,
  card: PayWith,
  options: { timeoutMs: number; fields: PayField[]; button: string; timing?: PayTiming },
): Promise<Omit<BrowserPaid, "own">> {
  const progress: Progress = { typed: false }
  const went = await attempt(browser, card, options, options.timing ?? PAY_TIMING, progress)
  const clean = (value: string) => withoutNumber(value, card.number)
  return {
    outcome: went.outcome,
    message: clean(went.message),
    typed: progress.typed,
    ...(went.site === undefined ? {} : { site: clean(went.site) }),
    ...(went.url === undefined ? {} : { url: clean(went.url).slice(0, 2_000) }),
    ...(went.title === undefined ? {} : { title: clean(went.title).slice(0, 300) }),
  }
}

/** One frame of the page as it was last looked at, and how to speak to it. */
type Doc = {
  speak: Speak
  contextId: number
  /** Whether it is the page's own frame. */
  main: boolean
  url: string
  boxes: BoxSeen[]
  buttons: string[][]
}

/** The frames of a session, from what `Page.getFrameTree` answered with. */
function frameIds(tree: unknown): string[] {
  const node = obj(tree)
  const children = Array.isArray(node.childFrames) ? node.childFrames : []
  return [text(obj(node.frame).id), ...children.flatMap(frameIds)]
}

async function attempt(
  browser: SignInBrowser,
  card: PayWith,
  asked: { timeoutMs: number; fields: PayField[]; button: string },
  timing: PayTiming,
  progress: Progress,
): Promise<Outcome> {
  const until = Date.now() + asked.timeoutMs
  const left = (most: number) => Math.max(0, Math.min(most, until - Date.now()))
  const named = `the card "${card.name}"`
  const Named = `The card "${card.name}"`
  const digits = card.number.replace(/\D/g, "")
  let cdp: Cdp | undefined
  let sessionId: string | undefined
  let site: string | undefined
  /** The boxes something of the card went into, to be emptied where the form stays. */
  const filled: { speak: Speak; id: string }[] = []
  const empty = async () => {
    for (const { speak, id } of filled) {
      // As a person would, which a page that shapes what is typed understands; and then outright.
      try {
        if ((await speak.on(id, FOCUS)) === true) {
          const key = { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }
          await speak.send("Input.dispatchKeyEvent", { type: "keyDown", ...key })
          await speak.send("Input.dispatchKeyEvent", { type: "keyUp", ...key })
        }
      } catch {
        // The box may be gone, and then there is nothing in it.
      }
      if ((await speak.on(id, VALUE).catch(() => "")) !== "") {
        await speak.on(id, EMPTY).catch(() => {})
      }
    }
  }
  try {
    cdp = await connect(browser.open, timing.callMs)
    const speak = cdp
    const front = frontTarget(pageTargets(await speak.send("Target.getTargets", {})), browser.front)
    if (front === undefined) {
      return {
        outcome: "failed",
        message:
          "The browser has no page open. Open the checkout page with the browser tool first, and then pay.",
      }
    }
    const refusal = (url: string): Outcome => ({
      outcome: "failed",
      message: `The page in front, ${hostOf(url)}, is not a page a card can be typed on: it has to be reached by https. Nothing of ${named} was typed.`,
      url,
    })
    if (paySite(front.url) === null) return { ...refusal(front.url), title: front.title }

    // From here until it is over nothing an agent wrote runs: not in dev-browser, and, once
    // the page has loaded again, not in the page. See `signInOnPage`, which this follows.
    await browser.stop()
    await delay(timing.settleMs)
    const session = text(
      (await speak.send("Target.attachToTarget", { targetId: front.targetId, flatten: true }))
        .sessionId,
    )
    sessionId = session
    const page = speakTo(speak, session, "dc-pay")
    await page.send("Page.enable")
    await page.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {})
    await page.send("Network.enable")
    await page.send("Network.setCacheDisabled", { cacheDisabled: true })
    await page.send("Network.setBypassServiceWorker", { bypass: true })
    const loaded = speak.heard("Page.loadEventFired", session, left(timing.loadMs))
    await page.send("Page.reload", { ignoreCache: true })
    await loaded

    const address = async () =>
      text(obj(obj((await page.send("Page.getFrameTree")).frameTree).frame).url)
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

    // A reload can end somewhere else.
    const url = await address()
    site = paySite(url) ?? undefined
    if (site === undefined) return { ...refusal(url), ...(await after()) }
    const open = pageTargets(await speak.send("Target.getTargets", {}))
    if (overlooked(open.find((each) => each.targetId === front.targetId) ?? front, open)) {
      return {
        outcome: "failed",
        message:
          "The page in front was opened by another window of the same site, or has opened one, and that window could read what is typed here. Nothing was typed. Close the other window, or open the checkout page in a page of its own, and then pay.",
        site,
        ...(await after()),
      }
    }

    // A shop's card boxes are most often in frames of another site, which the browser keeps
    // apart from the page: it is asked to hand over each one of this page, and of those in turn.
    const apart = new Map<string, Speak>()
    const follow = (of: Speak) =>
      of
        .send("Target.setAutoAttach", {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
        })
        .catch(() => {})
    speak.on((method, parent, params) => {
      const child = text(params.sessionId)
      if (method === "Target.detachedFromTarget") apart.delete(child)
      if (method !== "Target.attachedToTarget" || obj(params.targetInfo).type !== "iframe") return
      if (parent !== session && !apart.has(parent)) return
      const frame = speakTo(speak, child, "dc-pay")
      apart.set(child, frame)
      void follow(frame)
    })
    await follow(page)

    const worlds = new Map<string, number>()
    /** Every frame of the page that can be read now, with its boxes. */
    const look = async (): Promise<Doc[]> => {
      const docs: Doc[] = []
      for (const of of [page, ...apart.values()]) {
        const ids = await of.send("Page.getFrameTree").then(
          (got) => frameIds(got.frameTree),
          () => [],
        )
        for (const [at, frameId] of ids.entries()) {
          const key = `${of.sessionId} ${frameId}`
          try {
            const contextId = worlds.get(key) ?? (await of.world(frameId))
            const ran = await of.send("Runtime.evaluate", {
              expression: SEE,
              contextId,
              returnByValue: true,
            })
            const seen = obj(obj(ran.result).value)
            if (!Array.isArray(seen.boxes) || !Array.isArray(seen.buttons)) continue
            worlds.set(key, contextId)
            docs.push({
              speak: of,
              contextId,
              main: of === page && at === 0,
              url: text(seen.url),
              boxes: seen.boxes as BoxSeen[],
              buttons: seen.buttons as string[][],
            })
          } catch {
            // The frame has gone on to another document, or is one the browser keeps apart.
            worlds.delete(key)
          }
        }
      }
      return docs
    }
    const hold = async (doc: Doc, list: "__dcBoxes" | "__dcButtons", at: number) =>
      text(
        obj(
          (
            await doc.speak.send("Runtime.evaluate", {
              expression: `globalThis.${list}[${Math.trunc(at)}]`,
              contextId: doc.contextId,
            })
          ).result,
        ).objectId,
      )
    const nothing = async (message: string): Promise<Outcome> => ({
      outcome: "no_form",
      message: `${message} Nothing of ${named} was typed.`,
      site,
      ...(await after()),
    })

    // Everything is found before anything is typed.
    let docs: Doc[] = []
    let boxes: CardBoxes = {}
    let numberSeen = 0
    for (const end = Date.now() + left(timing.boxesMs); ;) {
      docs = await look()
      boxes = chooseCardBoxes(docs.map((doc) => doc.boxes))
      if (boxes.number && (boxes.expiry || boxes.month) && boxes.code) break
      if (boxes.number) numberSeen ||= Date.now()
      if (Date.now() >= end || (numberSeen > 0 && Date.now() - numberSeen >= timing.restMs)) break
      await delay(timing.lookMs)
    }
    const main = docs.find((doc) => doc.main)
    if (boxes.number === undefined || main === undefined) {
      return await nothing(
        "There is no box for a card's number on the page in front. Go to the page that asks for the card with the browser tool first.",
      )
    }
    // The page may have gone on by itself since it loaded.
    site = paySite(main.url) ?? undefined
    if (site === undefined) return { ...refusal(main.url), ...(await after()) }
    const button = chooseButton(main.buttons, asked.button)
    if (typeof button !== "number") {
      return await nothing(
        button === "none"
          ? `There is no button that says "${asked.button}" on the page in front. Look at the page with the browser tool for what its button says.`
          : `More than one button on the page in front says "${asked.button}". Give the words of the one to press in full.`,
      )
    }
    const buttonId = await hold(main, "__dcButtons", button)
    if (Date.now() >= until) throw new Error("There was not time enough.")

    // What is not secret first, so that nothing is done between the card and the button.
    const missing: string[] = []
    for (const field of asked.fields) {
      const place = chooseField(
        docs.map((doc) => doc.boxes),
        field.box,
        Object.values(boxes),
      )
      const doc = place && docs[place.frame]
      let done = false
      if (place && doc) {
        const id = await hold(doc, "__dcBoxes", place.at)
        if (doc.boxes[place.at]?.tag === "select") {
          done = (await doc.speak.on(id, CHOOSE, [field.text.trim().toLowerCase()])) === true
        } else if ((await doc.speak.on(id, FOCUS)) === true) {
          await doc.speak.send("Input.insertText", { text: field.text })
          done = true
        }
      }
      if (!done) missing.push(field.box)
    }
    const unfilled =
      missing.length > 0 ? ` No box was found to fill in for: ${missing.join(", ")}.` : ""

    /**
     * Put something of the card into its box: typed where the caret is in that box at that
     * moment, into the frame the box is in, or chosen where the box is a list.
     */
    const fill = async (place: Place | undefined, typed: string, options: string[] = []) => {
      const doc = place && docs[place.frame]
      if (place === undefined || doc === undefined) return undefined
      const held = { speak: doc.speak, id: await hold(doc, "__dcBoxes", place.at) }
      if (doc.boxes[place.at]?.tag === "select") {
        filled.push(held)
        await held.speak.on(held.id, CHOOSE, options)
        return held
      }
      if ((await held.speak.on(held.id, FOCUS)) !== true) return undefined
      // Said before it is done: if the answer to this never comes, it may have been typed all the same.
      progress.typed = true
      filled.push(held)
      await held.speak.send("Input.insertText", { text: typed })
      return held
    }
    const fullYear = (place: Place | undefined, one: boolean) => {
      const box = place && docs[place.frame]?.boxes[place.at]
      return one ? box?.called.some((name) => /y{4}/i.test(name)) === true : box?.maxLength === 4
    }
    const empties = (place: Place | undefined) =>
      place !== undefined && docs[place.frame]?.boxes[place.at]?.empty === true

    const numberBox = await fill(boxes.number, digits)
    if (numberBox === undefined) {
      return await nothing(
        "The box for the card's number on the page in front cannot be typed into.",
      )
    }
    // A page that makes something else of what is typed is doing what this does not understand.
    if (String(await numberBox.speak.on(numberBox.id, VALUE)).replace(/\D/g, "") !== digits) {
      await empty()
      return {
        outcome: "failed",
        message: `The box for the card's number on ${site} did not take ${named} as it was typed, so it was taken out again and nothing was pressed. Do not try again unless something has changed.`,
        site,
        ...(await after()),
      }
    }
    if (boxes.expiry) {
      await fill(boxes.expiry, expiryText(card, "both", fullYear(boxes.expiry, true)))
    } else {
      await fill(boxes.month, expiryText(card, "month"), expiryOptions(card, "month"))
      await fill(
        boxes.year,
        expiryText(card, "year", fullYear(boxes.year, false)),
        expiryOptions(card, "year"),
      )
    }
    await fill(boxes.code, card.code)
    if (card.holder !== "" && empties(boxes.holder)) await fill(boxes.holder, card.holder)
    if (card.postalCode !== "" && empties(boxes.postal)) await fill(boxes.postal, card.postalCode)

    // Pressed as a person would press it, in the middle, where the button is now.
    const from = await address()
    let middle = await main.speak.on(buttonId, MIDDLE)
    for (
      const end = Date.now() + left(timing.pressMs);
      !Array.isArray(middle) && Date.now() < end;
    ) {
      await delay(timing.lookMs)
      middle = await main.speak.on(buttonId, MIDDLE)
    }
    if (!Array.isArray(middle)) {
      await empty()
      return {
        outcome: "failed",
        message: `The button that says "${asked.button}" went away, or could no longer be pressed, once ${named} was typed on ${site}. What was typed was taken out again, and nothing was pressed.`,
        site,
        ...(await after()),
      }
    }
    const [x, y] = middle as number[]
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
    for (const type of ["mousePressed", "mouseReleased"]) {
      await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 })
    }

    let gone = false
    for (const end = Date.now() + left(timing.goneMs); !gone && Date.now() < end;) {
      await delay(timing.lookMs)
      const there =
        (numberBox.speak === page || apart.has(numberBox.speak.sessionId)) &&
        (await numberBox.speak.on(numberBox.id, IS_THERE).catch(() => false)) === true
      gone = !there || (await address().catch(() => from)) !== from
    }
    if (gone) {
      return {
        outcome: "sent",
        message: `${Named} was typed on ${site} and "${asked.button}" was pressed, and the form is gone. Whether the payment was taken is for the page to say: look at it with the browser tool.${unfilled}`,
        site,
        ...(await after()),
      }
    }
    await empty()
    const more = (await look()).length > docs.length
    return {
      outcome: "still_asking",
      message: `${Named} was typed on ${site} and "${asked.button}" was pressed, and the page still shows the form: it refused something, or wants something more first${more ? ". More frames have opened in it since, so it may be asking for a code from the bank, which is for the person whose card it is to give in the browser's window" : ""}. What was typed was taken out of the page again. Look at the page with the browser tool to see what it says, and do not try again unless something has changed.${unfilled}`,
      site,
      ...(await after()),
    }
  } catch {
    // Why is left out on purpose: nothing that went wrong is worth the chance of saying what was typed.
    if (filled.length > 0) await Promise.race([empty(), delay(timing.callMs)]).catch(() => {})
    return {
      outcome: "failed",
      message: progress.typed
        ? `The browser stopped answering after ${named} was typed, so how it went is not known. Look at the page with the browser tool.`
        : Date.now() >= until
          ? `There was not time enough to pay with ${named}. Nothing of it was typed.`
          : `The browser could not be driven to pay with ${named}: it stopped answering, or the page went away. Nothing of it was typed.`,
      ...(site === undefined ? {} : { site }),
    }
  } finally {
    if (cdp !== undefined && sessionId !== undefined) {
      await cdp.send("Target.detachFromTarget", { sessionId }).catch(() => {})
    }
    cdp?.close()
  }
}

import type {
  MascotCore,
  MascotState,
  MascotVariant,
  Orb,
  SkyCore,
  Wardrobe,
} from "@do-computer/mascot"
import type { Outfit } from "@do-computer/protocol"
import { atom } from "jotai"

/** What an agent's creature is doing right now. */
export type MascotMood = { state: MascotState; variant?: MascotVariant }

export const IDLE: MascotMood = { state: "idle" }

const callMoods = new Map<string, ReturnType<typeof atom<MascotMood | undefined>>>()

/**
 * What an agent's creature is doing on a voice call, while it is on one: listening, talking,
 * working on what its voice handed it. It is shown in place of what the chat says of it.
 */
export function callMoodAtom(agentId: string) {
  let existing = callMoods.get(agentId)
  if (existing === undefined) {
    existing = atom<MascotMood | undefined>(undefined)
    callMoods.set(agentId, existing)
  }
  return existing
}

function moodAtom(agentId: string) {
  const fromChat = atom<MascotMood>(IDLE)
  return atom(
    (get) => get(callMoodAtom(agentId)) ?? get(fromChat),
    (_get, set, mood: MascotMood) => set(fromChat, mood),
  )
}

const moods = new Map<string, ReturnType<typeof moodAtom>>()

/**
 * The mood of one agent's creature, set by the chat on screen and read wherever it is drawn.
 * On a voice call it is what the call says, whatever the chat does.
 */
export function mascotMoodAtom(agentId: string) {
  let existing = moods.get(agentId)
  if (existing === undefined) {
    existing = moodAtom(agentId)
    moods.set(agentId, existing)
  }
  return existing
}

let loading: Promise<MascotCore | null> | undefined
/** The drawing code, once it has been fetched, whether or not there was anywhere to draw with it. */
let drawing: MascotCore | undefined
/** What a creature can wear, and the box a new thing comes in. Here once the drawing code is. */
let wardrobe: Wardrobe | undefined
/** The creatures a still picture is standing in for, each to be drawn once it can be. */
const waiting = new Set<(core: MascotCore) => void>()
/** How long after a try that came to nothing the next ones are made. After the last, no more. */
const RETRY_AFTER_MS = [1_000, 5_000, 30_000]
let retries = 0

async function tryMascot(): Promise<MascotCore | null> {
  try {
    const [three, { AgentOrbCore, AgentOrbWardrobe }] = await Promise.all([
      import("three"),
      import("@do-computer/mascot"),
    ])
    drawing ??= AgentOrbCore(three)
    // No WebGL here, or none to spare.
    if (drawing.Stage.get("px") === null) return null
    wardrobe = AgentOrbWardrobe(three, drawing)
    follow(drawing)
    return drawing
  } catch (error) {
    console.warn("The creatures could not be drawn.", error)
    return null
  }
}

/**
 * Try again in a while, and whenever the page is come back to. A page can be open for days,
 * in the desktop app above all, and what stopped the creatures being drawn as it opened may
 * be over in a moment.
 */
function retryLater(): void {
  const wait = RETRY_AFTER_MS[retries++]
  const retry = () => {
    clearTimeout(timer)
    document.removeEventListener("visibilitychange", back)
    window.removeEventListener("focus", back)
    loading = undefined
    void loadMascot()
  }
  const back = () => {
    if (document.visibilityState === "visible") retry()
  }
  const timer = wait === undefined ? undefined : setTimeout(retry, wait)
  document.addEventListener("visibilitychange", back)
  window.addEventListener("focus", back)
}

/**
 * The creature's drawing code with three.js, fetched once, when the first one is about to be
 * shown. Null where it cannot be drawn: a still picture stands in for it there, and
 * `whenMascotLoads` says if that changes.
 */
export function loadMascot(): Promise<MascotCore | null> {
  loading ??= tryMascot().then((core) => {
    if (core === null) retryLater()
    else for (const draw of [...waiting]) draw(core)
    return core
  })
  return loading
}

let sky: SkyCore | undefined

/**
 * The sky a first egg comes down out of, with three.js: fetched when the first run is about to
 * be shown. Null where it cannot be had, and the first run is then shown without it.
 */
export async function loadSky(): Promise<SkyCore | null> {
  try {
    const [three, { AgentOrbSky }] = await Promise.all([
      import("three"),
      import("@do-computer/mascot"),
    ])
    sky ??= AgentOrbSky(three)
    return sky
  } catch (error) {
    console.warn("The sky could not be drawn.", error)
    return null
  }
}

/**
 * Ask to be told when the creatures can be drawn after all, having been answered that they
 * cannot. Returns what takes the request back.
 */
export function whenMascotLoads(draw: (core: MascotCore) => void): () => void {
  waiting.add(draw)
  return () => waiting.delete(draw)
}

/** The wardrobe that goes with the drawing code, once `loadMascot` has answered with it. */
export const mascotWardrobe = (): Wardrobe | undefined => wardrobe

/** Put on a creature what its agent has on, in place of whatever it wore. */
export function dressMascot(orb: Orb, outfit: Outfit | null | undefined): void {
  wardrobe?.dress(orb, outfit)
}

/** Things every creature on the page reacts to: the pointer, the theme, and a wish for less motion. */
function follow(core: MascotCore): void {
  const each = (act: (orb: Orb) => void) => {
    for (const orb of core.Runner.orbs) act(orb)
  }
  window.addEventListener(
    "pointermove",
    (event) => each((orb) => orb.notice && orb.setPointer(event.clientX, event.clientY)),
    { passive: true },
  )
  document.addEventListener("pointerleave", () => each((orb) => orb.setPointer(null)))
  new MutationObserver(() => each((orb) => orb.setTheme(isDark()))).observe(
    document.documentElement,
    { attributes: true, attributeFilter: ["class"] },
  )
  const calm = matchMedia("(prefers-reduced-motion: reduce)")
  calm.addEventListener("change", () =>
    each((orb) => {
      orb.reduced = calm.matches
    }),
  )
}

export const isDark = () => document.documentElement.classList.contains("dark")
export const prefersCalm = () => matchMedia("(prefers-reduced-motion: reduce)").matches

/** The creatures on the page that show a given agent, so that what it does can reach them all. */
const shown = new Map<string, Set<Orb>>()

export function showing(agentId: string, orb: Orb): () => void {
  const orbs = shown.get(agentId) ?? new Set()
  shown.set(agentId, orbs)
  orbs.add(orb)
  return () => {
    orbs.delete(orb)
    if (orbs.size === 0) shown.delete(agentId)
  }
}

/**
 * A word of the agent's answer arrived, or its user pressed a key: its creature moves with it.
 * `amount` is how wide its mouth opens for a word, 0 to 1: on a call, how loud its voice is.
 */
export function feedMascot(agentId: string, kind: "token" | "key", amount?: number): void {
  for (const orb of shown.get(agentId) ?? []) {
    if (kind === "token") orb.feed("token", amount)
    else orb.feed("key")
  }
}

/** A hand on the agent's creature: every drawing of it that is moving leans into it. */
export function petMascot(agentId: string, x: number, amount?: number): void {
  for (const orb of shown.get(agentId) ?? []) {
    if (!orb.paused) orb.pet(x, amount)
  }
}

/** A treat is held out to the agent's creature, or taken away: it opens its mouth for it. */
export function offerMascot(agentId: string, on: boolean): void {
  for (const orb of shown.get(agentId) ?? []) orb.offer(on)
}

/** The agent's creature takes a bite of what it was offered. */
export function biteMascot(agentId: string): void {
  for (const orb of shown.get(agentId) ?? []) {
    if (!orb.paused) orb.bite()
  }
}

/** The agent's creature is pleased: a little hop, whatever it is doing. */
export function cheerMascot(agentId: string): void {
  for (const orb of shown.get(agentId) ?? []) {
    if (!orb.paused) orb.cheer()
  }
}

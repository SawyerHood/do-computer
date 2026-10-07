import type { MascotCore, MascotState, MascotVariant, Orb } from "@durable-computer/mascot"
import { atom } from "jotai"

/** What an agent's creature is doing right now. */
export type MascotMood = { state: MascotState; variant?: MascotVariant }

export const IDLE: MascotMood = { state: "idle" }

const moods = new Map<string, ReturnType<typeof atom<MascotMood>>>()

/** The mood of one agent's creature, set by the chat on screen and read wherever it is drawn. */
export function mascotMoodAtom(agentId: string) {
  let existing = moods.get(agentId)
  if (existing === undefined) {
    existing = atom<MascotMood>(IDLE)
    moods.set(agentId, existing)
  }
  return existing
}

let loading: Promise<MascotCore | null> | undefined

/**
 * The creature's drawing code with three.js, fetched once, when the first one is about to be
 * shown. Null where it cannot be drawn: a still picture stands in for it there.
 */
export function loadMascot(): Promise<MascotCore | null> {
  loading ??= (async () => {
    try {
      const [three, { AgentOrbCore }] = await Promise.all([
        import("three"),
        import("@durable-computer/mascot"),
      ])
      const core = AgentOrbCore(three)
      // No WebGL here, or none to spare.
      if (core.Stage.get("px") === null) return null
      follow(core)
      return core
    } catch {
      return null
    }
  })()
  return loading
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

/** A word of the agent's answer arrived, or its user pressed a key: its creature moves with it. */
export function feedMascot(agentId: string, kind: "token" | "key"): void {
  for (const orb of shown.get(agentId) ?? []) {
    if (kind === "token") orb.feed("token")
    else orb.feed("key")
  }
}

/** A hand on the agent's creature: every drawing of it that is moving leans into it. */
export function petMascot(agentId: string, x: number, amount?: number): void {
  for (const orb of shown.get(agentId) ?? []) {
    if (!orb.paused) orb.pet(x, amount)
  }
}

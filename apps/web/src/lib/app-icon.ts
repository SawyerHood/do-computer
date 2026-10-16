import type { Orb, Portrait } from "@do-computer/mascot"
import { type AgentSummary, avatarLook } from "@do-computer/protocol"
import { useEffect } from "react"
import { desktop } from "@/lib/desktop"
import { dressMascot, loadMascot } from "@/lib/mascot"

/**
 * In the desktop app, the pictures the app is shown by are of its owner's own agent, where
 * the app's usual ones have the app's own creature: the creature on its own color made deep
 * for the app itself, and the creature alone for the tray. They are drawn here, by the code
 * that draws the usual ones, and handed to the app, which can change its pictures for as long
 * as it runs. Before there is an agent it is an egg.
 */
type Shown = Pick<AgentSummary, "id" | "avatar" | "hatched" | "outfit">

/** What the app is handed: the picture of itself, and the tray's pair. */
type Pictures = { icon: string; tray: { on: string; off: string } | null }

/** What an egg nobody has met yet is grown from: the creature of the app's usual picture. */
const UNMET = { seed: "agt_ct5dka", color: "#3b9d9d" }

/**
 * How the picture is cut for a desktop, as `scripts/icons.mjs` cuts the usual ones. A Mac's
 * icons are a rounded square of 824 in a picture of 1024.
 */
const shapeFor = (platform: string) =>
  platform === "darwin"
    ? { grid: 103, scale: 8, round: 0.225, inset: 100 }
    : { grid: 128, scale: 4, round: 0.225 }

/** The tray's picture, as `scripts/icons.mjs` draws the usual one: at twice a tray's size. */
const TRAY = 36
/** While this computer is not shared the tray's creature is grey, and asleep. */
const OFF = "#737c80"

/** A moment when the page has nothing better to do: the pictures are not urgent. */
const idle = () =>
  new Promise<void>((resolve) => {
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(() => resolve(), { timeout: 2000 })
    else setTimeout(resolve, 200)
  })

let stage: Promise<Portrait | null> | undefined

/** What draws the pictures, loaded once for as long as the page is open. */
function portraitFor() {
  stage ??= (async () => {
    const [core, { AgentOrbPortrait }] = await Promise.all([
      loadMascot(),
      import("@do-computer/mascot"),
    ])
    if (core === null) return null
    await idle()
    return AgentOrbPortrait(core)
  })().catch(() => null)
  const drawn = stage
  // Where they cannot be drawn, the next change of agent tries again.
  void drawn.then((made) => {
    if (made === null && stage === drawn) stage = undefined
  })
  return drawn
}

/** The creature alone in the middle of a tray's square, awake in its color or grey and asleep. */
function trayPicture(
  portrait: Portrait,
  look: { seed: string; color: string },
  egg: boolean,
  dress: (orb: Orb) => void,
  on: boolean,
): string | null {
  const alone = portrait.sprite({
    seed: look.seed,
    color: on ? look.color : OFF,
    // This small its eyes are specks at rest, so it listens instead: the same with them wide.
    state: egg ? "egg" : on ? "listening" : "asleep",
    ...(egg ? {} : { dress }),
    wide: TRAY,
    tall: TRAY,
  })
  if (alone === null) return null
  const out = document.createElement("canvas")
  out.width = out.height = TRAY
  out
    .getContext("2d")
    ?.drawImage(alone, Math.round((TRAY - alone.width) / 2), Math.round((TRAY - alone.height) / 2))
  return out.toDataURL("image/png")
}

/** The app's pictures of an agent, or of the egg there is before one, as PNGs' addresses. */
async function pictures(agent: Shown | null, platform: string): Promise<Pictures | null> {
  const shape = shapeFor(platform)
  const portrait = await portraitFor()
  if (portrait === null) return null
  const look = agent === null ? UNMET : avatarLook(agent.avatar, agent.id)
  const egg = agent === null || !agent.hatched
  const dress = (orb: Orb) => dressMascot(orb, agent?.outfit)
  const tile = portrait.tile(portrait.backdrop({ grid: shape.grid, color: look.color }), {
    ...look,
    egg,
    dress,
  })
  const icon = portrait.framed(tile, shape).toDataURL("image/png")
  // The tray's is looked for at several sizes, so the page is let breathe first.
  await idle()
  const on = trayPicture(portrait, look, egg, dress, true)
  const off = trayPicture(portrait, look, egg, dress, false)
  return { icon, tray: on === null || off === null ? null : { on, off } }
}

/** What the app was last asked to be shown by, so that it is asked only when that changes. */
let asked: string | undefined

async function show(next: Pictures | null): Promise<void> {
  const key = JSON.stringify(next)
  if (key === asked) return
  asked = key
  const bridge = desktop()
  // An app older than this cannot change its pictures, or cannot change its tray's.
  await Promise.all([
    bridge?.setIcon?.(next?.icon ?? null).catch(() => {}),
    bridge?.setTray?.(next?.tray ?? null).catch(() => {}),
  ])
}

/**
 * While an agent's pages are open in the desktop app, the app's pictures are of that agent's
 * creature, in its egg until it hatches. Null is someone who has no agent yet: an egg. They
 * are kept as other pages are gone to, and until the app is quit.
 */
export function useAppIcon(agent: Shown | null | undefined): void {
  const known = agent !== undefined
  const id = agent?.id
  const hatched = agent?.hatched ?? false
  const color = agent?.avatar?.color
  const seed = agent?.avatar?.seed
  const wearing = JSON.stringify(agent?.outfit ?? {})
  useEffect(() => {
    const bridge = desktop()
    if (!known || bridge?.setIcon === undefined) return
    let gone = false
    const avatar = color === undefined ? null : { color, ...(seed === undefined ? {} : { seed }) }
    const of = id === undefined ? null : { id, avatar, hatched, outfit: JSON.parse(wearing) }
    void pictures(of, bridge.platform)
      .catch(() => null)
      .then((drawn) => {
        // Where they cannot be drawn, the app keeps the pictures it has.
        if (!gone && drawn !== null) void show(drawn)
      })
    return () => {
      gone = true
    }
  }, [known, id, color, seed, hatched, wearing])
}

/** Where nobody is signed in, the app is shown by its usual pictures again. */
export function useUsualAppIcon(): void {
  useEffect(() => {
    void show(null)
  }, [])
}

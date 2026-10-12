import type { Island, Portrait } from "@do-computer/mascot"
import { type AgentSummary, avatarLook } from "@do-computer/protocol"
import { useEffect } from "react"
import { desktop } from "@/lib/desktop"
import { dressMascot, loadMascot, loadSky } from "@/lib/mascot"

/**
 * In the desktop app, the picture the app is shown by is its owner's own agent: the creature
 * on the island it hatched on, where the app's usual picture has the app's own creature. It is
 * drawn here, by the code that draws both, and handed to the app, which can change its picture
 * for as long as it runs. Before there is an agent it is an egg.
 */
type Shown = Pick<AgentSummary, "id" | "avatar" | "hatched" | "outfit">

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

/** A moment when the page has nothing better to do: the island is drawn once, and is not urgent. */
const idle = () =>
  new Promise<void>((resolve) => {
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(() => resolve(), { timeout: 2000 })
    else setTimeout(resolve, 200)
  })

let stage: Promise<{ portrait: Portrait; island: Island } | null> | undefined

/** The island at sunrise, drawn once for as long as the page is open, and what draws on it. */
function islandFor(grid: number) {
  stage ??= (async () => {
    const [core, sky, { AgentOrbPortrait }] = await Promise.all([
      loadMascot(),
      loadSky(),
      import("@do-computer/mascot"),
    ])
    if (core === null || sky === null) return null
    await idle()
    const portrait = AgentOrbPortrait(core, sky)
    const island = portrait.island({ grid, hour: portrait.HOURS.sunrise })
    return island === null ? null : { portrait, island }
  })().catch(() => null)
  const drawn = stage
  // Where it could not be drawn, the next change of agent tries again.
  void drawn.then((made) => {
    if (made === null && stage === drawn) stage = undefined
  })
  return drawn
}

/** The app's picture of an agent, or of the egg there is before one, as a PNG's address. */
async function picture(agent: Shown | null, platform: string): Promise<string | null> {
  const shape = shapeFor(platform)
  const made = await islandFor(shape.grid)
  if (made === null) return null
  const look = agent === null ? UNMET : avatarLook(agent.avatar, agent.id)
  const tile = made.portrait.tile(made.island, {
    ...look,
    egg: agent === null || !agent.hatched,
    dress: (orb) => dressMascot(orb, agent?.outfit),
  })
  return made.portrait.framed(tile, shape).toDataURL("image/png")
}

/** What the app was last asked to be shown by, so that it is asked only when that changes. */
let asked: string | null | undefined

async function show(next: string | null): Promise<void> {
  if (next === asked) return
  asked = next
  // An app older than this cannot change its picture.
  await desktop()
    ?.setIcon?.(next)
    .catch(() => {})
}

/**
 * While an agent's pages are open in the desktop app, the app's picture is that agent's
 * creature, in its egg until it hatches. Null is someone who has no agent yet: an egg. It is
 * kept as other pages are gone to, and until the app is quit.
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
    void picture(of, bridge.platform)
      .catch(() => null)
      .then((drawn) => {
        // Where it cannot be drawn, the app keeps the picture it has.
        if (!gone && drawn !== null) void show(drawn)
      })
    return () => {
      gone = true
    }
  }, [known, id, color, seed, hatched, wearing])
}

/** Where nobody is signed in, the app is shown by its usual picture again. */
export function useUsualAppIcon(): void {
  useEffect(() => {
    void show(null)
  }, [])
}

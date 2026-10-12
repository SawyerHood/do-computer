import { type AgentSummary, avatarLook, avatarSvg } from "@do-computer/protocol"
import { useEffect } from "react"
import { dressMascot, isDark, loadMascot } from "@/lib/mascot"

/** The side of the picture, in pixels: a tab's icon at twice its size. */
const SIDE = 32
/** The largest it is drawn before the drawing code starts scaling its pixels up. */
const LARGEST = 80

/** The square around what is drawn on a canvas, or null where nothing is. */
function drawnSquare(canvas: HTMLCanvasElement): { x: number; y: number; side: number } | null {
  const { width, height } = canvas
  const pixels = canvas.getContext("2d")?.getImageData(0, 0, width, height).data
  if (pixels === undefined) return null
  let [left, top, right, bottom] = [width, height, -1, -1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Its shadow and glow are faint, and no part of what a tab should make room for.
      if (pixels[(y * width + x) * 4 + 3]! < 128) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < 0) return null
  const side = Math.max(right - left, bottom - top) + 1
  return {
    x: Math.round((left + right + 1 - side) / 2),
    y: Math.round((top + bottom + 1 - side) / 2),
    side,
  }
}

/**
 * A still of an agent's creature as it is drawn on the page, as an image address. Where it cannot
 * be drawn, the plain one in its color.
 */
async function portrait(
  agent: Pick<AgentSummary, "id" | "avatar" | "hatched" | "outfit">,
): Promise<string> {
  const core = await loadMascot()
  if (core !== null) {
    const drawn = document.createElement("canvas")
    const orb = new core.Orb(drawn, {
      ...avatarLook(agent.avatar, agent.id),
      size: SIDE,
      pixelRatio: 1,
      dark: isDark(),
      reduced: true,
      notice: false,
    })
    try {
      if (!agent.hatched) orb.setState("egg")
      else dressMascot(orb, agent.outfit)
      // It is let live for a moment, to take up its pose.
      for (let step = 0; step < 12; step++) orb.update(1 / 30)
      orb.render()
      // The creature keeps room around itself for hops and rings; a tab has none to give it. So
      // it is drawn again, as much larger as makes the creature alone fill the picture.
      const small = drawnSquare(drawn)
      if (small !== null) {
        orb.resize(Math.min(LARGEST, Math.round((SIDE * SIDE) / small.side)))
        orb.render()
      }
      const square = drawnSquare(drawn)
      if (square !== null) {
        const cut = document.createElement("canvas")
        cut.width = cut.height = SIDE
        const inset = Math.round((SIDE - square.side) / 2)
        cut.getContext("2d")?.drawImage(drawn, inset - square.x, inset - square.y)
        return cut.toDataURL("image/png")
      }
    } catch {
      // The plain one below.
    } finally {
      orb.dispose()
    }
  }
  return `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvg(agent.avatar, agent.id))}`
}

/** While an agent's pages are open, the tab's icon is its creature: in its egg until it hatches. */
export function useAgentFavicon(
  agent: Pick<AgentSummary, "id" | "avatar" | "hatched" | "outfit"> | undefined,
): void {
  const id = agent?.id
  const hatched = agent?.hatched ?? true
  const color = agent?.avatar?.color
  const seed = agent?.avatar?.seed
  const wearing = JSON.stringify(agent?.outfit ?? {})
  useEffect(() => {
    // Not known yet: the tab keeps its usual picture.
    if (id === undefined) return
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (link === null) return
    const usual = { href: link.getAttribute("href") ?? "", type: link.type }
    let gone = false
    const avatar = color === undefined ? null : { color, ...(seed === undefined ? {} : { seed }) }
    void portrait({ id, avatar, hatched, outfit: JSON.parse(wearing) }).then((href) => {
      if (gone) return
      link.type = href.startsWith("data:image/png") ? "image/png" : "image/svg+xml"
      link.href = href
    })
    return () => {
      gone = true
      link.type = usual.type
      link.href = usual.href
    }
  }, [id, color, seed, hatched, wearing])
}

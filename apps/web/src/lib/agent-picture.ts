import { type Avatar, avatarLook, avatarSvg } from "@durable-computer/protocol"
import { loadMascot } from "./mascot.ts"

/** Slack asks for an app's icon to be square and between 512 and 2000 pixels a side. */
const SIDE = 1024
/** How long the creature is let live before its picture is taken, so that it is in its pose. */
const SETTLE_SECONDS = 1.5
const STEP_SECONDS = 1 / 30

/** A color with white mixed into it: at a `share` of 0 it is white, at 1 the color itself. */
function tint(hex: string, share: number): string {
  const channel = (at: number) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16)
    return Math.round(255 + (value - 255) * share)
  }
  return `rgb(${channel(1)} ${channel(3)} ${channel(5)})`
}

/**
 * A picture of an agent's creature as a PNG file: the creature as it is drawn in the app, on a
 * ground of its own color, at a size an app's icon can be. For somewhere that wants an image of
 * the agent and cannot run the creature, such as a Slack app's icon.
 */
export async function agentPicture(
  avatar: Avatar | null | undefined,
  agentId: string,
): Promise<Blob> {
  const look = avatarLook(avatar, agentId)
  const canvas = document.createElement("canvas")
  canvas.width = SIDE
  canvas.height = SIDE
  const context = canvas.getContext("2d")
  if (context === null) throw new Error("This browser cannot draw the picture.")
  context.fillStyle = tint(look.color, 0.2)
  context.fillRect(0, 0, SIDE, SIDE)

  const core = await loadMascot()
  if (core === null) {
    // Where the creature cannot be drawn, the plain one that stands in for it is.
    const image = new Image()
    image.src = `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvg(avatar, agentId))}`
    await image.decode()
    context.drawImage(image, SIDE * 0.1, SIDE * 0.1, SIDE * 0.8, SIDE * 0.8)
  } else {
    // A creature of its own, on no page and in no loop: it is stepped here, drawn once, and gone.
    const sketch = document.createElement("canvas")
    const orb = new core.Orb(sketch, {
      seed: look.seed,
      color: look.color,
      size: SIDE,
      pixelRatio: 1,
      dark: false,
      notice: false,
    })
    try {
      orb.setState("idle")
      for (let lived = 0; lived < SETTLE_SECONDS; lived += STEP_SECONDS) orb.update(STEP_SECONDS)
      orb.render()
      // It is drawn small and in blocks, and stays in blocks when it is made large.
      context.imageSmoothingEnabled = false
      context.drawImage(sketch, 0, 0, sketch.width, sketch.height, 0, 0, SIDE, SIDE)
    } finally {
      orb.dispose()
    }
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob === null ? reject(new Error("The picture could not be made.")) : resolve(blob),
      "image/png",
    ),
  )
}

/** Hand a file to the person, as a download with a name. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  // Let go of it once the browser has had the chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

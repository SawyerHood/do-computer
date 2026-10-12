import {
  MAX_MESSAGE_IMAGE_CHARS,
  MAX_MESSAGE_IMAGES,
  type MessageImage,
} from "@do-computer/protocol"

/** What one picture may take of a message's allowance, so that a full set still fits. */
const BUDGET = Math.floor(MAX_MESSAGE_IMAGE_CHARS / MAX_MESSAGE_IMAGES) - 1_000

/** Longest side and JPEG quality to try, from as good as a model can use down to merely legible. */
const ATTEMPTS: readonly (readonly [number, number])[] = [
  [1568, 0.85],
  [1568, 0.7],
  [1280, 0.7],
  [1024, 0.7],
  [1024, 0.5],
  [768, 0.5],
  [512, 0.5],
]

/**
 * A copy of a picture small enough to send with a message for the agent to look at. The original
 * is not changed: that is what goes to the library. Undefined for a file that is not a picture
 * the browser can draw.
 */
export async function pictureFor(file: File): Promise<MessageImage | undefined> {
  if (!file.type.startsWith("image/")) return undefined
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return undefined
  }
  try {
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d")
    if (context === null) return undefined
    for (const [side, quality] of ATTEMPTS) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      // JPEG has no transparency, and what shows through would otherwise be black.
      context.fillStyle = "#fff"
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const url = canvas.toDataURL("image/jpeg", quality)
      const data = url.slice(url.indexOf(",") + 1)
      if (data.length <= BUDGET) return { mimeType: "image/jpeg", data }
    }
    return undefined
  } finally {
    bitmap.close()
  }
}

/** Where an `<img>` finds a picture that is held as base64. */
export function pictureSrc(image: MessageImage): string {
  return `data:${image.mimeType};base64,${image.data}`
}

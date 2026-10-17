/**
 * What `dev-browser --json` prints: one JSON object to a line, ending with `done`. Read here
 * into what an agent is told of its script.
 */

import {
  bytesToBase64,
  IMAGE_MAX_EDGE,
  IMAGE_MAX_PIXELS,
  IMAGE_RESULT_BYTES,
  type Shot,
} from "@do-computer/protocol"
import { prepareImage } from "../node-image.ts"

/** The most an agent is given of what its script printed. The end is kept: that is where it failed. */
export const OUTPUT_CAP = 60_000

export type RanFrames = {
  output: string
  error?: string
  /** The pictures the script took, as files dev-browser wrote. */
  images: { path: string; width: number; height: number }[]
  /** Absent where dev-browser never said it was done. */
  exitCode?: number
}

/** The end of `text`, where it is longer than `cap`, with a line saying that some was left out. */
export function keepEnd(text: string, cap = OUTPUT_CAP): string {
  if (text.length <= cap) return text
  return `[the first ${text.length - cap} characters were left out]\n${text.slice(text.length - cap)}`
}

const str = (value: unknown): string => (typeof value === "string" ? value : "")

/**
 * Read the lines dev-browser printed. A line that is not one of its frames is kept as output:
 * it is something that went wrong before dev-browser could say so properly.
 */
export function readFrames(ndjson: string): RanFrames {
  const text: string[] = []
  const images: RanFrames["images"] = []
  let error: string | undefined
  let exitCode: number | undefined
  for (const line of ndjson.split("\n")) {
    if (line.trim() === "") continue
    let frame: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(line)
      if (typeof parsed !== "object" || parsed === null) throw new Error("not a frame")
      frame = parsed as Record<string, unknown>
    } catch {
      text.push(line.endsWith("\n") ? line : `${line}\n`)
      continue
    }
    switch (frame.type) {
      case "stdout":
      case "stderr":
        text.push(str(frame.data))
        break
      case "result":
        text.push(str(frame.value))
        break
      case "error": {
        const name = str(frame.name)
        const message = str(frame.message)
        error = name && message ? `${name}: ${message}` : message || name || "The script failed."
        break
      }
      case "image":
        if (typeof frame.path === "string" && Number(frame.width) > 0 && Number(frame.height) > 0) {
          images.push({
            path: frame.path,
            width: Number(frame.width),
            height: Number(frame.height),
          })
        }
        break
      case "done":
        if (typeof frame.exitCode === "number") exitCode = frame.exitCode
        break
      default:
        // `hello`, and whatever a later dev-browser adds, says nothing an agent needs.
        break
    }
  }
  // Each piece is given a line of its own, as a terminal would show them.
  const output = text
    .map((piece) => (piece === "" || piece.endsWith("\n") ? piece : `${piece}\n`))
    .join("")
  return {
    output: output.trimEnd(),
    ...(error === undefined ? {} : { error }),
    images,
    ...(exitCode === undefined ? {} : { exitCode }),
  }
}

/**
 * A picture a script took, as it is handed back: no larger than a model is shown, since the agent
 * keeps every one for as long as its chat lasts. A page drawn at twice its size on a sharp
 * screen is scaled down here, on the computer; one that fits goes as it is. Undefined for one
 * that is not a JPEG, cannot be read, or is too large still.
 */
export function shotOf(
  bytes: Uint8Array,
  said: { width: number; height: number },
): Shot | undefined {
  if (!isJpeg(bytes)) return undefined
  const made = prepareImage(bytes, {
    maxEdge: IMAGE_MAX_EDGE,
    maxPixels: IMAGE_MAX_PIXELS,
    maxBytes: IMAGE_RESULT_BYTES,
  })
  if (made === undefined) return undefined
  // What dev-browser said of its size stands where nothing was changed.
  const scaled = made.width !== made.from.width || made.height !== made.from.height
  return {
    mimeType: made.mimeType,
    data: bytesToBase64(made.bytes),
    width: scaled ? made.width : said.width,
    height: scaled ? made.height : said.height,
  }
}

/** Whether these bytes are a JPEG, which is all `page.shot()` writes. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

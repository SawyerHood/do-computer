import type { ImageLimits } from "@do-computer/protocol"
import jpeg from "jpeg-js"
import { PNG } from "pngjs"

/**
 * Making a picture a model is to look at as small as it can be without the model seeing less.
 * This runs in the daemon, on the machine the file is on, where memory is cheap: the server's
 * side of a thread keeps every picture it was shown for as long as the thread lasts, and copies
 * them into every request to the model.
 *
 * Pure JavaScript, so that the daemon stays one file that runs on any Node: jpeg-js and pngjs.
 * Only PNG and JPEG are decoded; WebP and GIF are left as they are (WebP is compact already, and
 * there is no encoder for it short of WebAssembly).
 */

/** A picture prepared for a model, and what it was before. */
export type ShrunkImage = {
  bytes: Uint8Array
  mimeType: string
  width: number
  height: number
  from: { mimeType: string; width: number; height: number; bytes: number }
}

/**
 * JPEG quality, tried in turn until the picture fits `maxBytes`. jpeg-js keeps colour at full
 * resolution (4:4:4), so text in a screenshot stays sharp at 80; that is where the ladder starts.
 */
const JPEG_QUALITIES = [80, 70, 60, 50] as const
/** Pictures with more pixels than this are not decoded: their RGBA alone would be 100 MB. */
const MAX_DECODE_PIXELS = 25_000_000

type Header = {
  mimeType: "image/png" | "image/jpeg"
  width: number
  height: number
  orientation: number
}

/**
 * What a picture is, from its first bytes: its format, its size as stored, and for a JPEG the
 * way its camera says to turn it (EXIF orientation, 1 to 8). Undefined for anything else.
 */
export function imageHeader(bytes: Uint8Array): Header | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    bytes.length >= 24 &&
    view.getUint32(0) === 0x89504e47 &&
    view.getUint32(4) === 0x0d0a1a0a &&
    view.getUint32(12) === 0x49484452 // IHDR
  ) {
    return {
      mimeType: "image/png",
      width: view.getUint32(16),
      height: view.getUint32(20),
      orientation: 1,
    }
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
    return undefined
  let orientation = 1
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined
    const marker = bytes[offset + 1]!
    if (marker === 0xff) {
      offset++ // fill byte
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return undefined // no frame header before the data
    const length = view.getUint16(offset + 2)
    const start = offset + 4
    if (marker === 0xe1)
      orientation = exifOrientation(view, start, start + length - 2) ?? orientation
    // Every start of frame but DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (start + 5 > bytes.length) return undefined
      return {
        mimeType: "image/jpeg",
        height: view.getUint16(start + 1),
        width: view.getUint16(start + 3),
        orientation,
      }
    }
    offset = start + length - 2
  }
  return undefined
}

/** The orientation tag of an APP1 segment holding EXIF, if it has one that makes sense. */
function exifOrientation(view: DataView, start: number, end: number): number | undefined {
  end = Math.min(end, view.byteLength)
  // "Exif\0\0", then a TIFF header.
  if (end - start < 14 || view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0) {
    return undefined
  }
  const tiff = start + 6
  const little = view.getUint16(tiff) === 0x4949
  if (!little && view.getUint16(tiff) !== 0x4d4d) return undefined
  const ifd = tiff + view.getUint32(tiff + 4, little)
  if (ifd + 2 > end) return undefined
  const entries = view.getUint16(ifd, little)
  for (let index = 0; index < entries; index++) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > end) return undefined
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little)
      return value >= 1 && value <= 8 ? value : undefined
    }
  }
  return undefined
}

/** The size a picture of `width` by `height` is scaled to, to keep within `limits`. */
export function fittedSize(
  width: number,
  height: number,
  limits: Pick<ImageLimits, "maxEdge" | "maxPixels">,
) {
  const scale = Math.min(
    1,
    limits.maxEdge / Math.max(width, height),
    Math.sqrt(limits.maxPixels / (width * height)),
  )
  if (scale >= 1) return { width, height }
  return {
    width: Math.max(1, Math.min(limits.maxEdge, Math.floor(width * scale))),
    height: Math.max(1, Math.min(limits.maxEdge, Math.floor(height * scale))),
  }
}

/**
 * The picture in `bytes`, made as small as it can be for a model: scaled down to `limits`,
 * turned upright, and as a JPEG, unless it has transparency (then a PNG) or its own bytes are
 * smaller and need no change. Undefined where it is not a PNG or JPEG, cannot be decoded, has
 * too many pixels to decode, or is still over `limits.maxBytes` at the lowest quality.
 */
export function prepareImage(bytes: Uint8Array, limits: ImageLimits): ShrunkImage | undefined {
  const header = imageHeader(bytes)
  if (header === undefined || header.width === 0 || header.height === 0) return undefined
  if (header.width * header.height > MAX_DECODE_PIXELS) return undefined
  const turned = header.orientation >= 5
  const shown = turned
    ? { width: header.height, height: header.width }
    : { width: header.width, height: header.height }
  const from = { mimeType: header.mimeType, ...shown, bytes: bytes.length }
  const target = fittedSize(shown.width, shown.height, limits)
  const asItIs =
    target.width === shown.width &&
    target.height === shown.height &&
    header.orientation === 1 &&
    bytes.length <= limits.maxBytes
      ? { bytes, mimeType: header.mimeType, ...shown, from }
      : undefined
  // A JPEG re-encoded is a copy of a copy, and seldom smaller.
  if (asItIs !== undefined && header.mimeType === "image/jpeg") return asItIs

  let decoded: { width: number; height: number; data: Uint8Array }
  try {
    decoded =
      header.mimeType === "image/png"
        ? PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
        : jpeg.decode(bytes, {
            useTArray: true,
            formatAsRGBA: true,
            maxResolutionInMP: MAX_DECODE_PIXELS / 1_000_000,
          })
  } catch {
    return undefined
  }
  if (decoded.width !== header.width || decoded.height !== header.height) return undefined
  const alpha = hasTransparency(decoded.data)
  // The picture with transparency that needs no change: a PNG again would be no smaller.
  if (alpha && asItIs !== undefined) return asItIs

  // Scaled first, in the orientation it is stored in, so that turning it handles fewer pixels.
  const stored = turned ? { width: target.height, height: target.width } : target
  let pixels =
    stored.width === decoded.width && stored.height === decoded.height
      ? decoded.data
      : downscale(decoded.data, decoded.width, decoded.height, stored.width, stored.height, alpha)
  if (header.orientation !== 1)
    pixels = orient(pixels, stored.width, stored.height, header.orientation)

  let made: ShrunkImage | undefined
  if (alpha) {
    const png = new PNG({ width: target.width, height: target.height })
    png.data = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)
    const encoded = PNG.sync.write(png, { colorType: 6 })
    if (encoded.length <= limits.maxBytes) {
      made = { bytes: encoded, mimeType: "image/png", ...target, from }
    }
  } else {
    for (const quality of JPEG_QUALITIES) {
      const encoded = jpeg.encode(
        { width: target.width, height: target.height, data: pixels },
        quality,
      ).data
      if (encoded.length <= limits.maxBytes) {
        made = { bytes: encoded, mimeType: "image/jpeg", ...target, from }
        break
      }
      // A JPEG over the limit at the first quality is not made smaller by anything that keeps
      // the picture as it is: the original, where it fits, may still be.
      if (asItIs !== undefined) break
    }
  }
  if (asItIs !== undefined && (made === undefined || asItIs.bytes.length <= made.bytes.length)) {
    return asItIs
  }
  return made
}

/** Whether any pixel of RGBA `data` is less than opaque. */
function hasTransparency(data: Uint8Array): boolean {
  for (let index = 3; index < data.length; index += 4) if (data[index] !== 255) return true
  return false
}

/**
 * For each pixel of a row (or column) `to` long, the pixels of one `from` long it covers and by
 * how much: averaging what each covers keeps fine lines and text that skipping pixels would lose.
 */
function coverage(from: number, to: number): { start: number; weights: Float32Array }[] {
  const ratio = from / to
  const spans: { start: number; weights: Float32Array }[] = []
  for (let index = 0; index < to; index++) {
    const left = index * ratio
    const right = Math.min(from, left + ratio)
    const start = Math.floor(left)
    const end = Math.min(from, Math.ceil(right))
    const weights = new Float32Array(end - start)
    for (let source = start; source < end; source++) {
      weights[source - start] = (Math.min(right, source + 1) - Math.max(left, source)) / ratio
    }
    spans.push({ start, weights })
  }
  return spans
}

/**
 * RGBA `data` of `width` by `height`, scaled down to `toWidth` by `toHeight` by averaging the
 * pixels each new one covers: across, then down. With `alpha`, colour is weighted by it, so that
 * transparent pixels do not darken their neighbours' edges.
 */
export function downscale(
  data: Uint8Array,
  width: number,
  height: number,
  toWidth: number,
  toHeight: number,
  alpha: boolean,
): Uint8Array {
  const across = coverage(width, toWidth)
  const down = coverage(height, toHeight)
  const rows = new Float32Array(toWidth * height * 4)
  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    for (let x = 0; x < toWidth; x++) {
      const { start, weights } = across[x]!
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = 0; k < weights.length; k++) {
        const at = row + (start + k) * 4
        const weight = weights[k]!
        const opacity = alpha ? data[at + 3]! / 255 : 1
        r += data[at]! * weight * opacity
        g += data[at + 1]! * weight * opacity
        b += data[at + 2]! * weight * opacity
        a += data[at + 3]! * weight
      }
      const out = (y * toWidth + x) * 4
      rows[out] = r
      rows[out + 1] = g
      rows[out + 2] = b
      rows[out + 3] = a
    }
  }
  const result = new Uint8Array(toWidth * toHeight * 4)
  for (let y = 0; y < toHeight; y++) {
    const { start, weights } = down[y]!
    for (let x = 0; x < toWidth; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = 0; k < weights.length; k++) {
        const at = ((start + k) * toWidth + x) * 4
        const weight = weights[k]!
        r += rows[at]! * weight
        g += rows[at + 1]! * weight
        b += rows[at + 2]! * weight
        a += rows[at + 3]! * weight
      }
      // Undo the weighting by opacity: the colour of what shows, at its new opacity.
      const unweight = alpha ? (a > 0 ? 255 / a : 0) : 1
      const out = (y * toWidth + x) * 4
      result[out] = Math.min(255, Math.round(r * unweight))
      result[out + 1] = Math.min(255, Math.round(g * unweight))
      result[out + 2] = Math.min(255, Math.round(b * unweight))
      result[out + 3] = Math.round(a)
    }
  }
  return result
}

/**
 * RGBA `data` of `width` by `height` as stored, turned the way EXIF `orientation` (2 to 8) says
 * it is to be shown. For 5 to 8 the result is `height` wide.
 */
export function orient(
  data: Uint8Array,
  width: number,
  height: number,
  orientation: number,
): Uint8Array {
  const turned = orientation >= 5
  const outWidth = turned ? height : width
  const outHeight = turned ? width : height
  const result = new Uint8Array(data.length)
  // A Buffer from Node's pool may start anywhere; whole pixels are read at a multiple of four.
  const aligned = data.byteOffset % 4 === 0 ? data : data.slice()
  const words = new Uint32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4)
  const out = new Uint32Array(result.buffer)
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      let sx: number
      let sy: number
      switch (orientation) {
        case 2:
          sx = width - 1 - x
          sy = y
          break
        case 3:
          sx = width - 1 - x
          sy = height - 1 - y
          break
        case 4:
          sx = x
          sy = height - 1 - y
          break
        case 5:
          sx = y
          sy = x
          break
        case 6:
          sx = y
          sy = height - 1 - x
          break
        case 7:
          sx = width - 1 - y
          sy = height - 1 - x
          break
        case 8:
          sx = width - 1 - y
          sy = x
          break
        default:
          sx = x
          sy = y
      }
      out[y * outWidth + x] = words[sy * width + sx]!
    }
  }
  return result
}

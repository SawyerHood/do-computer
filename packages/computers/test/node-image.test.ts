import jpeg from "jpeg-js"
import { PNG } from "pngjs"
import { describe, expect, it } from "vitest"
import { downscale, fittedSize, imageHeader, orient, prepareImage } from "../src/node-image.ts"

const LIMITS = { maxEdge: 1568, maxPixels: 1_150_000, maxBytes: 640 * 1024 }

/** RGBA pixels drawn by `paint`, which answers each pixel's colour. */
function pixels(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number, number],
): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4)
  }
  return data
}

function png(width: number, height: number, data: Uint8Array, colorType: 2 | 6 = 6): Uint8Array {
  const image = new PNG({ width, height })
  image.data = Buffer.from(data)
  return PNG.sync.write(image, { colorType })
}

/** Something like a screenshot of a page: noise that PNG cannot squeeze, under bands of "text". */
function screenshot(width: number, height: number): Uint8Array {
  let seed = 7
  const noise = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) >>> 16) % 64
  return png(
    width,
    height,
    pixels(width, height, (x, y) =>
      y % 20 < 3 && x % 9 < 6
        ? [20, 20, 30, 255]
        : [180 + noise(), 160 + noise(), 140 + noise(), 255],
    ),
    2,
  )
}

/** A JPEG with an APP1 EXIF segment saying `orientation`, placed right after its start. */
function withOrientation(bytes: Uint8Array, orientation: number): Uint8Array {
  // "Exif\0\0", then a big-endian TIFF header and one IFD holding one entry: 0x0112.
  const tiff = [
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    0x00,
    0x01,
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]
  const length = payload.length + 2
  const segment = [0xff, 0xe1, length >> 8, length & 0xff, ...payload]
  return Uint8Array.from([...bytes.subarray(0, 2), ...segment, ...bytes.subarray(2)])
}

describe("preparing a picture for a model", () => {
  it("reads what a picture is from its first bytes", () => {
    const shot = screenshot(40, 30)
    expect(imageHeader(shot)).toEqual({
      mimeType: "image/png",
      width: 40,
      height: 30,
      orientation: 1,
    })
    const photo = jpeg.encode(
      { width: 50, height: 20, data: pixels(50, 20, () => [1, 2, 3, 255]) },
      90,
    ).data
    expect(imageHeader(photo)).toEqual({
      mimeType: "image/jpeg",
      width: 50,
      height: 20,
      orientation: 1,
    })
    expect(imageHeader(withOrientation(photo, 6))).toMatchObject({ orientation: 6 })
    expect(imageHeader(new TextEncoder().encode("hello, this is not a picture"))).toBeUndefined()
  })

  it("keeps what a provider would keep: a long edge of 1568 and about 1.15 megapixels", () => {
    expect(fittedSize(1280, 760, LIMITS)).toEqual({ width: 1280, height: 760 })
    expect(fittedSize(4000, 1000, LIMITS)).toEqual({ width: 1568, height: 392 })
    expect(fittedSize(1170, 1992, LIMITS)).toEqual({ width: 821, height: 1399 })
    const { width, height } = fittedSize(1400, 1100, LIMITS)
    expect(width * height).toBeLessThanOrEqual(LIMITS.maxPixels)
    expect(width / height).toBeCloseTo(1400 / 1100, 2)
  })

  it("makes a screenshot a JPEG of the same size, several times smaller", () => {
    const shot = screenshot(1280, 760)
    const made = prepareImage(shot, LIMITS)!
    expect(made).toMatchObject({
      mimeType: "image/jpeg",
      width: 1280,
      height: 760,
      from: { mimeType: "image/png", width: 1280, height: 760, bytes: shot.length },
    })
    expect(made.bytes.length * 2).toBeLessThan(shot.length)
    const back = jpeg.decode(made.bytes, { useTArray: true })
    expect([back.width, back.height]).toEqual([1280, 760])
  })

  it("scales a large picture down to what the model is shown", () => {
    const shot = screenshot(2400, 1800)
    const made = prepareImage(shot, LIMITS)!
    expect(made.mimeType).toBe("image/jpeg")
    expect(made).toMatchObject(fittedSize(2400, 1800, LIMITS))
    expect(made.width * made.height).toBeLessThanOrEqual(LIMITS.maxPixels)
    expect(made.from).toMatchObject({ width: 2400, height: 1800 })
  })

  it("leaves a picture as it is where its own bytes are smaller", () => {
    // A flat drawing compresses better as a PNG than any JPEG.
    const flat = png(
      300,
      200,
      pixels(300, 200, (x) => (x < 150 ? [255, 255, 255, 255] : [0, 90, 200, 255])),
      2,
    )
    const made = prepareImage(flat, LIMITS)!
    expect(made.mimeType).toBe("image/png")
    expect(made.bytes).toBe(flat)
    // A JPEG that needs no scaling is not encoded again: a copy of a copy is seldom smaller.
    const photo = jpeg.encode(
      { width: 640, height: 480, data: pixels(640, 480, (x, y) => [x % 256, y % 256, 99, 255]) },
      95,
    ).data
    expect(prepareImage(photo, LIMITS)!.bytes).toBe(photo)
  })

  it("keeps transparency, as a PNG", () => {
    const icon = png(
      64,
      64,
      pixels(64, 64, (x, y) => (x + y < 64 ? [255, 0, 0, 255] : [0, 0, 0, 0])),
    )
    // Small enough already: as it is.
    expect(prepareImage(icon, LIMITS)!.bytes).toBe(icon)
    const large = png(
      3136,
      400,
      pixels(3136, 400, (x) => (x % 2 === 0 ? [0, 0, 255, 255] : [0, 0, 0, 0])),
    )
    const made = prepareImage(large, LIMITS)!
    expect(made).toMatchObject({ mimeType: "image/png", width: 1568, height: 200 })
    const back = PNG.sync.read(Buffer.from(made.bytes))
    // Half the pixels were clear: what is left is half as opaque, and still blue, not darkened.
    expect([...back.data.subarray(0, 4)]).toEqual([0, 0, 255, 128])
  })

  it("turns a photo the way its camera said", () => {
    // Stored 40 wide and 20 high, red on its left half; orientation 6 is a quarter turn clockwise.
    const stored = pixels(40, 20, (x) => (x < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255]))
    const photo = withOrientation(jpeg.encode({ width: 40, height: 20, data: stored }, 95).data, 6)
    const made = prepareImage(photo, LIMITS)!
    expect(made).toMatchObject({ mimeType: "image/jpeg", width: 20, height: 40 })
    expect(made.from).toMatchObject({ width: 20, height: 40 })
    const back = jpeg.decode(made.bytes, { useTArray: true })
    // The left half is now the top: red above, blue below.
    expect(back.data[0]).toBeGreaterThan(200)
    expect(back.data[39 * 20 * 4 + 2]).toBeGreaterThan(200)
  })

  it("prepares nothing it cannot, for the file to be read as it is", () => {
    expect(prepareImage(new TextEncoder().encode("plain text"), LIMITS)).toBeUndefined()
    const shot = screenshot(200, 100)
    expect(prepareImage(shot.subarray(0, 100), LIMITS)).toBeUndefined()
    // Still over the limit at the lowest quality.
    expect(prepareImage(screenshot(1280, 760), { ...LIMITS, maxBytes: 1000 })).toBeUndefined()
    // Too many pixels to decode at all: refused from its header alone.
    const huge = Uint8Array.from(shot)
    new DataView(huge.buffer).setUint32(16, 10_000)
    new DataView(huge.buffer).setUint32(20, 10_000)
    expect(prepareImage(huge, LIMITS)).toBeUndefined()
  })
})

describe("scaling and turning pixels", () => {
  it("averages the pixels each new one covers", () => {
    const data = Uint8Array.from([
      0, 0, 0, 255, 255, 255, 255, 255, 100, 100, 100, 255, 200, 200, 200, 255,
    ])
    expect([...downscale(data, 2, 2, 1, 1, false)]).toEqual([139, 139, 139, 255])
    expect([...downscale(data, 4, 1, 2, 1, false)]).toEqual([
      128, 128, 128, 255, 150, 150, 150, 255,
    ])
    // Three to two: the middle pixel is shared half and half.
    const three = Uint8Array.from([0, 0, 0, 255, 90, 90, 90, 255, 180, 180, 180, 255])
    expect([...downscale(three, 3, 1, 2, 1, false)]).toEqual([30, 30, 30, 255, 150, 150, 150, 255])
  })

  it("turns pixels for each of the eight orientations", () => {
    // 2 wide, 1 high: A then B.
    const A = [1, 1, 1, 1]
    const B = [2, 2, 2, 2]
    const data = Uint8Array.from([...A, ...B])
    expect([...orient(data, 2, 1, 2)]).toEqual([...B, ...A])
    expect([...orient(data, 2, 1, 3)]).toEqual([...B, ...A])
    expect([...orient(data, 2, 1, 4)]).toEqual([...A, ...B])
    expect([...orient(data, 2, 1, 5)]).toEqual([...A, ...B]) // 1 wide, 2 high: A over B
    expect([...orient(data, 2, 1, 6)]).toEqual([...A, ...B])
    expect([...orient(data, 2, 1, 7)]).toEqual([...B, ...A])
    expect([...orient(data, 2, 1, 8)]).toEqual([...B, ...A])
  })
})

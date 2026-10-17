import { describe, expect, it } from "vitest"
import { IMAGE_MAX_PIXELS, pictureSize } from "../src/index.ts"

describe("the size a picture is drawn at for a model", () => {
  it("is its own where it is within what a model is shown", () => {
    expect(pictureSize(1280, 760)).toEqual({ width: 1280, height: 760 })
    expect(pictureSize(1, 1)).toEqual({ width: 1, height: 1 })
  })

  it("keeps to a long edge of 1568, or less where less is asked", () => {
    expect(pictureSize(4000, 1000)).toEqual({ width: 1568, height: 392 })
    expect(pictureSize(4000, 1000, 1024)).toEqual({ width: 1024, height: 256 })
  })

  it("keeps to about 1.15 megapixels, keeping its shape", () => {
    // A retina screenshot, and a phone's photo held upright.
    expect(pictureSize(2880, 1800)).toEqual({ width: 1356, height: 847 })
    const photo = pictureSize(3024, 4032)
    expect(photo.width * photo.height).toBeLessThanOrEqual(IMAGE_MAX_PIXELS)
    expect(photo.width / photo.height).toBeCloseTo(3024 / 4032, 2)
  })
})

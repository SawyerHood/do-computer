import { describe, expect, it } from "vitest"
import {
  agentAddress,
  areasOf,
  boundsOf,
  BOX,
  inAny,
  isId,
  isPetPage,
  keepOn,
  petAddress,
  placeOf,
  SIZE,
  startAt,
} from "../src/companion-place.ts"

/** A screen with a menu bar across its top. */
const screen = { x: 0, y: 25, width: 1440, height: 875 }

describe("where the companion is", () => {
  it("starts in the bottom right of the screen, with what it says above it", () => {
    const at = startAt(screen)
    expect(at).toEqual({ x: 1440 - BOX - 24, y: 900 - BOX - 24 })
    expect(placeOf(at, screen)).toEqual({ x: "right", y: "bottom" })
    // The window reaches up and to the left of the creature, and ends where its square does.
    const bounds = boundsOf(at, placeOf(at, screen))
    expect(bounds).toEqual({ x: at.x + BOX - SIZE.width, y: at.y + BOX - SIZE.height, ...SIZE })
  })

  it("says what it says toward the middle of the screen, and below itself under the top edge", () => {
    expect(placeOf({ x: 20, y: 600 }, screen)).toEqual({ x: "left", y: "bottom" })
    expect(placeOf({ x: 20, y: 30 }, screen)).toEqual({ x: "left", y: "top" })
    expect(placeOf({ x: 1200, y: 30 }, screen)).toEqual({ x: "right", y: "top" })
    // In a corner where it speaks below and to the right, the window starts where the square does.
    expect(boundsOf({ x: 20, y: 30 }, { x: "left", y: "top" })).toEqual({ x: 20, y: 30, ...SIZE })
  })

  it("is kept wholly on the screen it was put on, and moved no further than that takes", () => {
    expect(keepOn({ x: 300, y: 400 }, screen)).toEqual({ x: 300, y: 400 })
    expect(keepOn({ x: -90, y: -90 }, screen)).toEqual({ x: 0, y: 25 })
    expect(keepOn({ x: 5000, y: 5000 }, screen)).toEqual({ x: 1440 - BOX, y: 900 - BOX })
    // A second screen to the left of the first has places below nought.
    const left = { x: -1920, y: 0, width: 1920, height: 1080 }
    expect(keepOn({ x: -2000, y: 500 }, left)).toEqual({ x: -1920, y: 500 })
    expect(placeOf({ x: -1900, y: 500 }, left)).toEqual({ x: "left", y: "bottom" })
  })
})

describe("which clicks are the companion's", () => {
  const creature = { x: 140, y: 130, width: 200, height: 200 }

  it("are those on a part of the window the page says is something", () => {
    expect(inAny({ x: 200, y: 200 }, [creature])).toBe(true)
    expect(inAny({ x: 10, y: 10 }, [creature])).toBe(false)
    expect(inAny({ x: 340, y: 200 }, [creature])).toBe(false)
    expect(inAny({ x: 200, y: 200 }, [])).toBe(false)
  })

  it("believes a page only about rectangles inside the window", () => {
    expect(areasOf([creature])).toEqual([creature])
    expect(areasOf([{ x: -40, y: 280.4, width: 9000, height: 9000 }])).toEqual([
      { x: 0, y: 280, width: SIZE.width, height: SIZE.height - 280 },
    ])
    expect(areasOf([{ x: 1, y: 1, width: 0, height: 5 }])).toEqual([])
    expect(areasOf([{ x: "1", y: 1, width: 5, height: 5 }, null, 7])).toEqual([])
    expect(areasOf("everything")).toEqual([])
    expect(areasOf(Array.from({ length: 50 }, () => creature))).toHaveLength(8)
  })
})

describe("the companion's page", () => {
  const server = "https://do.example"

  it("is one page of the deployment the app is set to", () => {
    expect(petAddress(server)).toBe("https://do.example/desktop/pet")
    expect(isPetPage("https://do.example/desktop/pet", server)).toBe(true)
    expect(isPetPage("https://do.example/desktop/pet?agent=a#b", server)).toBe(true)
    expect(isPetPage("https://do.example/a/1", server)).toBe(false)
    expect(isPetPage("https://do.example/desktop/pet/more", server)).toBe(false)
    expect(isPetPage("https://do.example.evil.test/desktop/pet", server)).toBe(false)
    expect(isPetPage("https://do.example/desktop/pet", undefined)).toBe(false)
    expect(isPetPage("about:blank", server)).toBe(false)
  })

  it("opens the app on an agent it names, and on nothing else", () => {
    expect(agentAddress(server, "ag_1")).toBe("https://do.example/a/ag_1")
    expect(agentAddress(server, "ag_1", "12")).toBe("https://do.example/a/ag_1/c/12")
    expect(isId("ag_1-x")).toBe(true)
    expect(isId("../../login")).toBe(false)
    expect(isId("a/b")).toBe(false)
    expect(isId("")).toBe(false)
    expect(isId(7)).toBe(false)
  })
})

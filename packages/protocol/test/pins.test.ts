import { describe, expect, it } from "vitest"
import { MAX_PINS, type Pin, pinnedEntries, pinsFull, pinStanding } from "../src/index.ts"

const pin = (fileId: string, path: string, title?: string): Pin => ({
  fileId,
  path,
  ...(title === undefined ? {} : { title }),
  by: "agent",
  at: 1,
})
const file = (id: string, path: string) => ({
  id,
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
})

describe("pinnedEntries", () => {
  it("keeps the order of the pins and names each by its title or its file", () => {
    const entries = pinnedEntries(
      [pin("b", "boards/launch.html", "Launch board"), pin("a", "plan.md")],
      [file("a", "plan.md"), file("b", "boards/launch.html")],
    )
    expect(entries.map((entry) => [entry.title, entry.file?.id])).toEqual([
      ["Launch board", "b"],
      ["plan.md", "a"],
    ])
  })

  it("follows a file that was moved, by its id", () => {
    const [entry] = pinnedEntries([pin("a", "plan.md")], [file("a", "notes/renamed.md")])
    expect(entry?.file?.path).toBe("notes/renamed.md")
    expect(entry?.title).toBe("renamed.md")
  })

  it("keeps a pin whose file is gone, named after where the file was", () => {
    const [entry] = pinnedEntries([pin("gone", "notes/gone.md")], [file("a", "plan.md")])
    expect(entry?.file).toBeUndefined()
    expect(entry?.title).toBe("gone.md")
  })
})

describe("pinsFull", () => {
  it("is true only once as many are pinned as a Dood may have", () => {
    expect(pinsFull(undefined)).toBe(false)
    expect(pinsFull(Array.from({ length: MAX_PINS - 1 }))).toBe(false)
    expect(pinsFull(Array.from({ length: MAX_PINS }))).toBe(true)
  })
})

describe("pinStanding", () => {
  const then = { pin: pin("a", "plan.md", "Plan"), file: file("a", "plan.md") }

  it("is the pin as it was made until what is pinned is known", () => {
    expect(pinStanding(then, undefined)).toBe(then.pin)
  })

  it("is the pin as it is now while it stands, and nothing once it was taken off", () => {
    const now = pin("a", "plan.md", "Renamed")
    expect(pinStanding(then, [now])).toBe(now)
    expect(pinStanding(then, [])).toBeUndefined()
  })
})

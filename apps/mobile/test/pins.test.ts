import { type LibraryFile, type Pin, pinnedEntries } from "@do-computer/protocol"
import { describe, expect, it, vi } from "vitest"
import { pinChoice, pinnedMenuItems } from "../src/pins/model.ts"

const file = (id: string, path: string): LibraryFile => ({
  id,
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  size: 10,
  contentType: "text/plain",
  source: "agent",
  chatId: null,
  createdAt: 0,
  updatedAt: 1,
  updatedBy: "agent",
  rev: 1,
})
const pin = (fileId: string, path: string, title?: string): Pin => ({
  fileId,
  path,
  ...(title === undefined ? {} : { title }),
  by: "user",
  at: 1,
})

describe("pinChoice", () => {
  it("offers to pin a file that is not pinned, to the Dood by its name", () => {
    expect(pinChoice([], file("a", "plan.md"), "Pip")).toMatchObject({
      pinned: false,
      fileId: "a",
      title: "Pin to Pip",
      short: "Pin",
      icon: "pin",
    })
  })

  it("offers to take the pin off a file that is pinned, by the file the pin is kept under", () => {
    // A file deleted and made again at the same place is what its pin is of.
    expect(pinChoice([pin("old", "plan.md")], file("new", "plan.md"), "Pip")).toMatchObject({
      pinned: true,
      fileId: "old",
      title: "Unpin from Pip",
      short: "Unpin",
      icon: "pinSlash",
    })
  })

  it("offers nothing for a file from before files had a place", () => {
    expect(pinChoice([], { id: "a" }, "Pip")).toBeUndefined()
  })
})

describe("pinnedMenuItems", () => {
  const files = [file("a", "boards/launch.html"), file("b", "plan.md")]
  const entries = pinnedEntries(
    [
      pin("a", "boards/launch.html", "Launch board"),
      pin("gone", "notes/gone.md"),
      pin("b", "plan.md"),
    ],
    files,
  )

  it("names each pin, in order, and opens its file", () => {
    const open = vi.fn()
    const items = pinnedMenuItems(entries, true, open)
    expect(items.map((item) => item.title)).toEqual([
      "Launch board",
      "gone.md (no longer in the library)",
      "plan.md",
    ])
    expect(items.map((item) => item.icon)).toEqual(["globe", "doc", "doc"])
    items[0]?.onPress?.()
    expect(open).toHaveBeenCalledWith(files[0])
  })

  it("lists a pin whose file is gone as something that cannot be pressed", () => {
    const gone = pinnedMenuItems(entries, true, vi.fn())[1]
    expect(gone?.disabled).toBe(true)
    expect(gone?.onPress).toBeUndefined()
  })

  it("says what a pin does where the menu is not a menu of its own", () => {
    expect(pinnedMenuItems(entries, false, vi.fn())[0]?.title).toBe("Open Launch board")
  })
})

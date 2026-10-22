import { describe, expect, it, vi } from "vitest"
import { contextMenu } from "../src/context-menu.ts"

const flags = {
  canUndo: true,
  canRedo: false,
  canCut: true,
  canCopy: true,
  canPaste: true,
  canSelectAll: true,
  canDelete: true,
  canEditRichly: false,
}
const click = (item: { click?: unknown }) => (item.click as () => void)()
const noImage = { mediaType: "none", srcURL: "" } as const
const newActions = () => ({
  replace: vi.fn(),
  learn: vi.fn(),
  copyImage: vi.fn(),
  copyText: vi.fn(),
  save: vi.fn(),
})

describe("the right-click menu", () => {
  it("offers corrections for a misspelled word, and puts the one chosen in its place", () => {
    const actions = newActions()
    const items = contextMenu(
      {
        ...noImage,
        isEditable: true,
        selectionText: "",
        misspelledWord: "Anythig",
        dictionarySuggestions: ["Anything", "Anythin"],
        editFlags: flags,
      },
      actions,
    )
    expect(items.slice(0, 3).map((item) => item.label)).toEqual([
      "Anything",
      "Anythin",
      "Add to Dictionary",
    ])
    click(items[0]!)
    expect(actions.replace).toHaveBeenCalledWith("Anything")
    click(items[2]!)
    expect(actions.learn).toHaveBeenCalledWith("Anythig")
    expect(items.map((item) => item.role).filter(Boolean)).toEqual([
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
      "selectAll",
    ])
  })

  it("says so when it has no guess", () => {
    const items = contextMenu(
      {
        ...noImage,
        isEditable: true,
        selectionText: "",
        misspelledWord: "qzxv",
        dictionarySuggestions: [],
        editFlags: flags,
      },
      newActions(),
    )
    expect(items[0]).toMatchObject({ label: "No Guesses Found", enabled: false })
  })

  it("offers copy for selected text, and nothing on the page itself", () => {
    const params = {
      ...noImage,
      isEditable: false,
      misspelledWord: "",
      dictionarySuggestions: [],
      editFlags: flags,
    }
    const actions = newActions()
    expect(contextMenu({ ...params, selectionText: "hello" }, actions)).toEqual([
      { role: "copy", enabled: true },
    ])
    expect(contextMenu({ ...params, selectionText: "" }, actions)).toEqual([])
  })

  it("offers to copy and save an image, and copies its address where it has one", () => {
    const actions = newActions()
    const params = {
      isEditable: false,
      selectionText: "",
      misspelledWord: "",
      dictionarySuggestions: [],
      editFlags: flags,
      mediaType: "image" as const,
    }
    const items = contextMenu({ ...params, srcURL: "https://example.com/cat.png" }, actions)
    expect(items.map((item) => item.label)).toEqual([
      "Copy Image",
      "Copy Image Address",
      "Save Image As…",
    ])
    click(items[0]!)
    expect(actions.copyImage).toHaveBeenCalled()
    click(items[1]!)
    expect(actions.copyText).toHaveBeenCalledWith("https://example.com/cat.png")
    click(items[2]!)
    expect(actions.save).toHaveBeenCalledWith("https://example.com/cat.png")

    const blob = contextMenu({ ...params, srcURL: "blob:https://example.com/1" }, actions)
    expect(blob.map((item) => item.label)).toEqual(["Copy Image", "Save Image As…"])

    const selected = contextMenu(
      { ...params, srcURL: "https://example.com/cat.png", selectionText: "hi" },
      actions,
    )
    expect(selected.map((item) => item.role ?? item.type ?? item.label)).toEqual([
      "Copy Image",
      "Copy Image Address",
      "Save Image As…",
      "separator",
      "copy",
    ])
  })
})

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

describe("the right-click menu", () => {
  it("offers corrections for a misspelled word, and puts the one chosen in its place", () => {
    const actions = { replace: vi.fn(), learn: vi.fn() }
    const items = contextMenu(
      {
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
        isEditable: true,
        selectionText: "",
        misspelledWord: "qzxv",
        dictionarySuggestions: [],
        editFlags: flags,
      },
      { replace: vi.fn(), learn: vi.fn() },
    )
    expect(items[0]).toMatchObject({ label: "No Guesses Found", enabled: false })
  })

  it("offers copy for selected text, and nothing on the page itself", () => {
    const params = {
      isEditable: false,
      misspelledWord: "",
      dictionarySuggestions: [],
      editFlags: flags,
    }
    const actions = { replace: vi.fn(), learn: vi.fn() }
    expect(contextMenu({ ...params, selectionText: "hello" }, actions)).toEqual([
      { role: "copy", enabled: true },
    ])
    expect(contextMenu({ ...params, selectionText: "" }, actions)).toEqual([])
  })
})

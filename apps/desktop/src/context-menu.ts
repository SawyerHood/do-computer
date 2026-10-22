/**
 * The menu a right click opens. Electron shows none of its own, so without this a word the
 * spellchecker underlined could not be corrected, and text could not be cut, copied or pasted
 * with the mouse, and an image could not be copied or saved. It is offered where there is
 * something to do: in a field, on a selection, or on an image.
 */
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from "electron"

/** What the menu's own items do, beyond what the edit roles do by themselves. */
export interface MenuActions {
  /** Put this word in place of the misspelled one. */
  replace(word: string): void
  /** Stop underlining this word from now on. */
  learn(word: string): void
  /** Put the image under the pointer on the clipboard. */
  copyImage(): void
  /** Put this text on the clipboard. */
  copyText(text: string): void
  /** Save the file at this address, asking where. */
  save(url: string): void
}

/** The items for a right click, or none where there is nothing to offer. */
export function contextMenu(
  params: Pick<
    ContextMenuParams,
    | "isEditable"
    | "selectionText"
    | "misspelledWord"
    | "dictionarySuggestions"
    | "editFlags"
    | "mediaType"
    | "srcURL"
  >,
  actions: MenuActions,
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  if (params.mediaType === "image" && params.srcURL !== "") {
    const src = params.srcURL
    items.push({ label: "Copy Image", click: () => actions.copyImage() })
    // A blob or data address means nothing anywhere else.
    if (/^https?:/i.test(src)) {
      items.push({ label: "Copy Image Address", click: () => actions.copyText(src) })
    }
    items.push({ label: "Save Image As…", click: () => actions.save(src) }, { type: "separator" })
  }
  const word = params.misspelledWord
  if (params.isEditable && word !== "") {
    const suggestions = params.dictionarySuggestions.slice(0, 5)
    for (const suggestion of suggestions) {
      items.push({ label: suggestion, click: () => actions.replace(suggestion) })
    }
    if (suggestions.length === 0) items.push({ label: "No Guesses Found", enabled: false })
    items.push(
      { label: "Add to Dictionary", click: () => actions.learn(word) },
      { type: "separator" },
    )
  }
  const flags = params.editFlags
  if (params.isEditable) {
    items.push(
      { role: "undo", enabled: flags.canUndo },
      { role: "redo", enabled: flags.canRedo },
      { type: "separator" },
      { role: "cut", enabled: flags.canCut },
      { role: "copy", enabled: flags.canCopy },
      { role: "paste", enabled: flags.canPaste },
      { type: "separator" },
      { role: "selectAll", enabled: flags.canSelectAll },
    )
  } else if (params.selectionText.trim() !== "") {
    items.push({ role: "copy", enabled: flags.canCopy })
  }
  // Nothing follows the image's items: no separator to end on.
  if (items.at(-1)?.type === "separator") items.pop()
  return items
}

/** Give a page's right click the menu above. */
export function withContextMenu(
  contents: WebContents,
  popup: (items: MenuItemConstructorOptions[]) => void,
  writeText: (text: string) => void,
): void {
  contents.on("context-menu", (_event, params) => {
    const items = contextMenu(params, {
      replace: (word) => contents.replaceMisspelling(word),
      learn: (word) => contents.session.addWordToSpellCheckerDictionary(word),
      copyImage: () => contents.copyImageAt(params.x, params.y),
      copyText: writeText,
      // With no save path set, Electron asks where to save it.
      save: (url) => contents.downloadURL(url),
    })
    if (items.length > 0) popup(items)
  })
}

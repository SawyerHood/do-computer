const MAX_PREVIEW_CHARS = 140

/** Text with its markdown marks taken off and its whitespace run together. */
function plain(text: string): string {
  return (
    text
      // A link or a picture leaves its words.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      // The marks that open a heading, a quotation or an item of a list.
      .replace(/^\s{0,3}(#{1,6}|>|[-*+])\s+/gm, "")
      // An underscore inside a word is part of a name, and is kept.
      .replace(/[*`~]|(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])/g, "")
      .replace(/\s+/g, " ")
      .trim()
  )
}

/**
 * One line of plain text from something that was said, for a list: code blocks and markdown
 * marks dropped, cut short. Something that was nothing but code is shown as the code.
 */
export function preview(text: string): string {
  const flat =
    plain(text.replace(/```[\s\S]*?(```|$)/g, " ")) || plain(text.replace(/```\S*/g, " "))
  return flat.length > MAX_PREVIEW_CHARS
    ? `${flat.slice(0, MAX_PREVIEW_CHARS - 1).trimEnd()}…`
    : flat
}

/** The folder a path is in, or "" at the top. */
export const dirOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""

/**
 * Where a relative link from a document in `dir` leads within the library, or undefined when it
 * leads somewhere else: another site, a place on the same page, or above the top folder.
 */
export function resolveLink(dir: string, href: string): string | undefined {
  if (href === "" || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return undefined
  const [plain] = href.split(/[?#]/)
  let decoded: string
  try {
    decoded = decodeURIComponent(plain ?? "")
  } catch {
    return undefined
  }
  const parts = decoded.startsWith("/") || dir === "" ? [] : dir.split("/")
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      if (parts.length === 0) return undefined
      parts.pop()
    } else parts.push(part)
  }
  return parts.length === 0 ? undefined : parts.join("/")
}

/**
 * The addresses a Markdown document names as its pictures and its links, as they are written:
 * what follows `](` in the text, and what a reference such as `[chart]: chart.svg` stands for.
 * More than its pictures alone, and never less: it is for deciding what a document shared by
 * itself may bring with it, which is then only ever a picture.
 */
export function markdownTargets(text: string): string[] {
  const found: string[] = []
  // An address is written bare, or between angle brackets where it has a space in it.
  for (const match of text.matchAll(/\]\(\s*(?:<([^>\n]*)>|([^)\s]+))/g)) {
    found.push(match[1] ?? match[2]!)
  }
  for (const match of text.matchAll(/^ {0,3}\[[^\]]+\]:\s*(?:<([^>\n]*)>|(\S+))/gm)) {
    found.push(match[1] ?? match[2]!)
  }
  return found
}

/**
 * The files of the library a Markdown document at `path` refers to, by their places in it.
 * What it names somewhere else, or above the library, is left out.
 */
export function markdownFiles(path: string, text: string): Set<string> {
  const dir = dirOf(path)
  const files = new Set<string>()
  for (const target of markdownTargets(text)) {
    const file = resolveLink(dir, target)
    if (file !== undefined) files.add(file)
  }
  return files
}

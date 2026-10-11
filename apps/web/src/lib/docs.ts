/**
 * The guides: the Markdown files in `docs/` at the top of the repository. Each is served twice,
 * as a page for people (`/docs/<name>`) and as the file itself for agents (`/docs/<name>.md`),
 * so what someone reads and what their agent follows are the same text.
 */
const FILES = import.meta.glob<string>("../../../../docs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
})

/** The guides that come first, in this order. Any other follows, by name. */
const ORDER = ["self-hosting"]

export type GuideSection = { id: string; title: string }

export type Guide = {
  /** Its name in an address: the file's name without `.md`. */
  slug: string
  /** Its first line, without the `#`. */
  title: string
  /** The paragraph under the title: what the guide is for. */
  summary: string
  /** The whole file, as an agent is given it. */
  text: string
  /** The file without its title and that paragraph, which a page shows above the rest. */
  body: string
  /** Its `##` headings, in order. */
  sections: GuideSection[]
}

/** A heading as the last part of an address. */
export function headingId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Read a guide out of its file. A file with no `# ` line first is not a guide. */
export function readGuide(slug: string, text: string): Guide | undefined {
  const opening = /^# (.+)\n+((?:(?!\n\n)[\s\S])+)\n*/.exec(text)
  if (opening === null) return undefined
  const [all, title = "", summary = ""] = opening
  const body = text.slice(all.length)
  const sections: GuideSection[] = []
  let fenced = false
  for (const line of body.split("\n")) {
    // A `##` inside a block of commands is a comment in a shell, not a heading.
    if (/^\s*```/.test(line)) fenced = !fenced
    else if (!fenced && line.startsWith("## ")) {
      const heading = line.slice(3).trim()
      sections.push({ id: headingId(heading), title: heading })
    }
  }
  return {
    slug,
    title: title.trim(),
    summary: summary.replace(/\s+/g, " ").trim(),
    text,
    body,
    sections,
  }
}

const place = (slug: string) => {
  const at = ORDER.indexOf(slug)
  return at === -1 ? ORDER.length : at
}

export const GUIDES: readonly Guide[] = Object.entries(FILES)
  .map(([path, text]) => readGuide(path.slice(path.lastIndexOf("/") + 1, -".md".length), text))
  .filter((guide): guide is Guide => guide !== undefined)
  .sort((a, b) => place(a.slug) - place(b.slug) || a.slug.localeCompare(b.slug))

export function guideOf(slug: string): Guide | undefined {
  return GUIDES.find((guide) => guide.slug === slug)
}

/** What someone pastes to an agent of theirs to have it follow a guide. */
export function agentPrompt(origin: string, guide: Guide): string {
  return guide.slug === "self-hosting"
    ? `Follow ${origin}/docs/${guide.slug}.md and set up Do Computer for me.`
    : `Follow ${origin}/docs/${guide.slug}.md for me.`
}

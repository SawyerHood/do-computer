/**
 * How tall each page drawn into a chat was when it was last shown, so that it is given that
 * room at once the next time, and what is under it does not move when the page says how tall
 * it is. A page is as tall as it is at a width, so it is kept by width too. Kept in this
 * browser, the newest few hundred.
 */

const KEY = "dc-visual-heights"
const MOST = 300
/** Widths this near each other lay a page out the same. */
const STEP = 40

let kept: Map<string, number> | undefined

function all(): Map<string, number> {
  if (kept !== undefined) return kept
  try {
    kept = new Map(JSON.parse(localStorage.getItem(KEY) ?? "[]") as [string, number][])
  } catch {
    kept = new Map()
  }
  return kept
}

const name = (page: string, width: number) => `${page}@${Math.round(width / STEP) * STEP}`

/** How tall `page` was at about this width, if it has been shown here before. */
export function heightBefore(page: string, width: number): number | undefined {
  return all().get(name(page, width))
}

/** Keep how tall `page` is at this width. */
export function keepHeight(page: string, width: number, height: number) {
  const heights = all()
  const key = name(page, width)
  if (heights.get(key) === height) return
  // Put last, so that what is dropped when there are too many is what was shown longest ago.
  heights.delete(key)
  heights.set(key, height)
  while (heights.size > MOST) heights.delete(heights.keys().next().value!)
  try {
    localStorage.setItem(KEY, JSON.stringify([...heights]))
  } catch {
    // A browser that keeps nothing measures each time.
  }
}

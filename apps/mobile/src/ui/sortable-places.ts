// Where the rows of a list being put in order are, worked out on the UI thread as a finger moves.
// Plain functions, so that they can be tried without a phone.

/** How far from the top of the list a row starts, with those over it as tall as they were measured. */
export function topOf(
  order: readonly string[],
  heights: Readonly<Record<string, number>>,
  id: string,
): number {
  "worklet"
  let top = 0
  for (const each of order) {
    if (each === id) return top
    top += heights[each] ?? 0
  }
  return top
}

/** How tall the whole list is. */
export function heightOf(
  order: readonly string[],
  heights: Readonly<Record<string, number>>,
): number {
  "worklet"
  let total = 0
  for (const each of order) total += heights[each] ?? 0
  return total
}

/**
 * The order with the row that is held where its top now is (`top`, from the top of the list):
 * in the place whose top is nearest to it. So it takes the next row's place once it has gone
 * half that row's height, either way, and does not flicker between two places at one point.
 */
export function placeHeld(
  order: readonly string[],
  heights: Readonly<Record<string, number>>,
  id: string,
  top: number,
): string[] {
  "worklet"
  const others = order.filter((each) => each !== id)
  let at = 0
  let nearest = Math.abs(top)
  let y = 0
  for (let index = 0; index < others.length; index++) {
    y += heights[others[index]!] ?? 0
    const off = Math.abs(top - y)
    if (off < nearest) {
      nearest = off
      at = index + 1
    }
  }
  return [...others.slice(0, at), id, ...others.slice(at)]
}

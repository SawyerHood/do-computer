/**
 * One at a time for whatever starts drawing with the graphics card: a creature's view, or the
 * picture of one made off the screen.
 *
 * Two that start at the same moment do not always both come up: one of them draws into its own
 * picture as it should and nothing of it reaches the screen, and it never mends. Started one
 * after another, with a moment between, they all do. So each waits its turn, and gives it up
 * once its first frame is out.
 */
let last: Promise<void> = Promise.resolve()

/** How long after one has started the next may. */
const BETWEEN_MS = 120
/** The longest one is waited for, so that one which never finishes does not hold up the rest. */
const LONGEST_MS = 2_500

/** Resolves when it is the caller's turn, with what to call when it has started. */
export function takeTurn(): Promise<() => void> {
  const before = last
  let done!: () => void
  last = new Promise<void>((resolve) => {
    done = resolve
  })
  return before.then(() => {
    let given = false
    const give = () => {
      if (given) return
      given = true
      setTimeout(done, BETWEEN_MS)
    }
    setTimeout(give, LONGEST_MS)
    return give
  })
}

/**
 * Whether the reader has just pressed something in the page a frame shows: the frame has the
 * reader's attention, and the browser says someone has just acted. A page does some things only
 * then, so that it cannot do them by itself.
 *
 * A page kept apart from the app is drawn by another process, and word that the reader pressed
 * in it can reach the app a moment after what the page said because of the press. So where it
 * is not yet so, it is looked for again for a short while. A page nobody pressed in is never
 * given either, however long it is waited for.
 */
export async function pressedIn(frame: HTMLIFrameElement | null, waitMs = 600): Promise<boolean> {
  const now = () =>
    frame !== null &&
    document.activeElement === frame &&
    navigator.userActivation?.isActive !== false
  if (now()) return true
  const until = performance.now() + waitMs
  while (performance.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (now()) return true
  }
  return false
}

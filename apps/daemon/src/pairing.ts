/** How often a daemon waiting to be paired asks whether it has been, to begin with. */
export const POLL_EAGER_MS = 3_000
/** How long it asks that often. Whoever started it confirms the code within minutes, or is away. */
export const POLL_EAGER_FOR_MS = 5 * 60_000
/** How often it asks after that, for as long as nobody confirms. */
export const POLL_PATIENT_MS = 30_000

/**
 * How long a daemon that has waited `waitedMs` to be paired waits before it asks again.
 *
 * Each time it asks is a request and a read of the app's database, and a computer nobody pairs
 * asks for as long as it is on: an app installed and never signed in to. Asked every three
 * seconds that was most of what the database was read for. So it asks often while someone is
 * likely to be confirming the code, and seldom after, where a confirmation is then collected
 * within half a minute.
 */
export function pollDelay(waitedMs: number, eagerMs = POLL_EAGER_MS): number {
  return waitedMs < POLL_EAGER_FOR_MS ? eagerMs : Math.max(eagerMs, POLL_PATIENT_MS)
}

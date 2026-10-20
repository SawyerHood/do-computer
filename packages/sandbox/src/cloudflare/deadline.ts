/** Deadlines belong to the caller, not to the eventual completion of platform IO. */
export function within<T>(work: Promise<T>, ms: number, expired?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        expired?.()
      } catch {
        /* Cleanup failure cannot disable the deadline. */
      }
      reject(new Error(`Computer operation timed out after ${ms}ms`))
    }, ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

export const START_TIMEOUT_MS = 180_000
export const SETUP_TIMEOUT_MS = 30_000
export const EXEC_GRACE_MS = 10_000

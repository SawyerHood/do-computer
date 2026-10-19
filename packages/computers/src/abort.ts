/** Release a caller's wait on abort, even when the underlying transport cannot be interrupted. */
export function abortable<T>(
  work: () => Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void,
): Promise<T> {
  if (signal === undefined) return work()
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort)
    const abort = () => {
      cleanup()
      reject(signal.reason)
      onAbort?.()
    }
    signal.addEventListener("abort", abort, { once: true })
    try {
      work().then(
        (value) => {
          cleanup()
          resolve(value)
        },
        (error) => {
          cleanup()
          reject(error)
        },
      )
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

const ignore = () => {}

/**
 * Runs operations in call order. An operation starts at once when nothing is running or waiting;
 * otherwise it waits for everything before it. An asynchronous operation started with `runAsync`
 * holds the queue until it settles, which is what a transaction needs.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private pending = 0

  run<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.pending > 0) return this.enqueue(operation)
    try {
      return Promise.resolve(operation())
    } catch (error) {
      return Promise.reject(error)
    }
  }

  runAsync<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pending > 0) return this.enqueue(operation)
    this.pending++
    // Publish the barrier before the operation starts, so calls it makes synchronously wait behind it.
    const { promise: barrier, resolve: release } = Promise.withResolvers<void>()
    this.tail = barrier
    let started: Promise<T>
    try {
      started = operation()
    } catch (error) {
      started = Promise.reject(error)
    }
    return started.finally(() => {
      this.pending--
      release()
    })
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    this.pending++
    const settled = this.tail.then(operation).finally(() => {
      this.pending--
    })
    this.tail = settled.then(ignore, ignore)
    return settled
  }
}

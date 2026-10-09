import { USE_HELD_WAIT_MS, USE_LINGER_MS, type UsingAgent } from "@durable-computer/protocol"

/**
 * Thrown by a screen or a browser that will not do what was asked: its owner has it switched
 * off, or stopped the agent. The message is for the agent to read.
 */
export class UseRefused extends Error {}

/** How long an agent that was stopped is kept off, so that trying again at once gets nowhere. */
const STOPPED_MS = 60_000

export type UseStateOptions = {
  /** What is being used, as the agent is told of it: "the screen", "the browser". */
  readonly what: string
  readonly now?: () => number
  readonly heldWaitMs?: number
}

/**
 * Who is using a screen or a browser, and whether they may: the same for both. It is in use
 * from the first thing an agent does until a while after the last. Its owner can pause the
 * agent, which then waits where it is, and can stop it, which fails what it is doing and keeps
 * it off for a minute.
 */
export class UseState {
  agent: UsingAgent | undefined
  /** What the agent is doing, in a few words. */
  say: string | undefined
  held = false
  /** Counts clicks, so that whoever watches can see a new one happen. */
  clicks = 0
  /**
   * True while the agent itself is pressing keys. Whatever listens for the owner's keys, to
   * pause the agent, must not take the agent's own for theirs.
   */
  pressing = false
  #lastAt = Number.NEGATIVE_INFINITY
  #stoppedAt = Number.NEGATIVE_INFINITY
  readonly #what: string
  readonly #now: () => number
  readonly #heldWaitMs: number
  readonly #listeners = new Set<() => void>()
  #waiting: (() => void)[] = []

  constructor(options: UseStateOptions) {
    this.#what = options.what
    this.#now = options.now ?? Date.now
    this.#heldWaitMs = options.heldWaitMs ?? USE_HELD_WAIT_MS
  }

  /** Whether an agent is using it: paused, or did something a short while ago. */
  get active(): boolean {
    return this.agent !== undefined && (this.held || this.#now() - this.#lastAt < USE_LINGER_MS)
  }

  /** Called whenever any of this changes. Resolves with how to stop being called. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #changed(): void {
    for (const listener of this.#listeners) listener()
  }

  /**
   * An agent is about to do something. Waits while it is paused, and rejects with `UseRefused`
   * where it was stopped or is paused for too long.
   */
  async enter(agent: UsingAgent, say: string | undefined): Promise<void> {
    this.#refuseIfStopped()
    this.agent = agent
    this.say = say
    this.#lastAt = this.#now()
    this.#changed()
    if (!this.held) return
    const until = this.#now() + this.#heldWaitMs
    while (this.held) {
      const left = until - this.#now()
      if (left <= 0) {
        throw new UseRefused(
          `The person at the computer paused you before you could use ${this.#what}, and has not let you carry on. Tell them you are waiting, and try again when they say.`,
        )
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(left, 1_000))
        this.#waiting.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
      this.#refuseIfStopped()
    }
    this.#lastAt = this.#now()
  }

  /** The agent finished doing something: it is in use for a while yet. */
  touch(say?: string): void {
    this.#lastAt = this.#now()
    if (say !== undefined) this.say = say
    this.#changed()
  }

  /** The agent is about to press keys itself, or has finished pressing them. */
  press(pressing: boolean): void {
    if (this.pressing === pressing) return
    this.pressing = pressing
    this.#changed()
  }

  /** Pause the agent, or let it carry on. */
  hold(held: boolean): void {
    if (this.held === held) return
    this.held = held
    // Let on again, it is in use from now: whoever is told of the change should find it so.
    if (!held && this.agent !== undefined && !this.stopped) this.#lastAt = this.#now()
    this.#wake()
    this.#changed()
  }

  /** The owner stopped the agent: what it is doing fails, and so does what it tries next. */
  stop(): void {
    this.#stoppedAt = this.#now()
    this.held = false
    this.#lastAt = Number.NEGATIVE_INFINITY
    this.#wake()
    this.#changed()
  }

  /** Whether the owner stopped the agent a moment ago. Something under way should give up. */
  get stopped(): boolean {
    return this.#now() - this.#stoppedAt < STOPPED_MS
  }

  #refuseIfStopped(): void {
    if (!this.stopped) return
    throw new UseRefused(
      `The person at the computer stopped you using ${this.#what}. Do not try again: tell them how far you got, and wait to be asked.`,
    )
  }

  #wake(): void {
    const waiting = this.#waiting
    this.#waiting = []
    for (const wake of waiting) wake()
  }
}

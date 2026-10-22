import type { HarnessInspection, TaskInspection } from "@earendil-works/pi-durable"

export type LiveWork = {
  /** Whether anything can still get further in this process: a wake-up is worth setting for it. */
  readonly live: boolean
  /** Tasks nothing registered can run. They wait for a deployment that can. */
  readonly blocked: readonly TaskInspection[]
}

/**
 * What of an agent's unfinished work can still get further.
 *
 * A task is blocked when no registered definition can take it: one written by a newer version
 * than the one running, say, after a deployment was rolled back. Waking the agent does nothing
 * for it, nor for a task that waits on nothing else, nor for a message that is behind it in its
 * chat. Only another deployment does, and opening the agent after one finds it runnable again.
 * So none of these count as live work. An agent that counted them would wake itself for as long
 * as they stayed, which is for good.
 */
export function liveWork(
  inspection: HarnessInspection,
  /**
   * Whether a task asleep (a retry's backoff, say) counts as work going: it does for whether
   * the agent is at work, and does not for keeping it loaded, since the alarm wakes it when the
   * sleep is over. A task held up only by sleeping ones, and a message behind them, are then
   * not live either.
   */
  { asleep = true }: { asleep?: boolean } = {},
): LiveWork {
  const blocked = inspection.tasks.filter((task) => task.state.kind === "blocked")
  const resting = asleep
    ? blocked
    : inspection.tasks.filter((task) => task.state.kind === "blocked" || task.state.kind === "sleeping")
  if (resting.length === 0) {
    return { live: inspection.tasks.length > 0 || inspection.submissions.length > 0, blocked }
  }
  const stuck = new Set(resting.map((task) => String(task.record.id)))
  // A task held up only by stuck tasks is stuck too, and so on up the chain.
  for (let grew = true; grew;) {
    grew = false
    for (const task of inspection.tasks) {
      const id = String(task.record.id)
      if (stuck.has(id) || !heldBy(task, inspection.tasks).every((on) => stuck.has(on))) continue
      stuck.add(id)
      grew = true
    }
  }
  const tasks = inspection.tasks.filter((task) => !stuck.has(String(task.record.id)))
  if (tasks.length > 0) return { live: true, blocked }
  // With every task stuck, a message in a chat that has one of them is behind it. One in a
  // chat that has none is about to be taken up.
  const held = new Set(inspection.tasks.map((task) => String(task.record.conversationId)))
  return {
    live: inspection.submissions.some((entry) => !held.has(String(entry.conversationId))),
    blocked,
  }
}

/**
 * The tasks one task cannot get past: those it waits on, or, where its outcome is held until
 * the work it owns is over, that work. A task that is held up by nothing gives a task that is
 * not stuck, so that `every` of nothing does not make it look stuck.
 */
function heldBy(task: TaskInspection, tasks: readonly TaskInspection[]): string[] {
  const held =
    task.state.kind === "waiting"
      ? task.state.on.map(String)
      : task.state.kind === "completing"
        ? tasks
            .filter((other) => String(other.record.owner) === String(task.record.id))
            .map((other) => String(other.record.id))
        : []
  return held.length === 0 ? [NOTHING] : held
}

/** No task has this id. */
const NOTHING = ""

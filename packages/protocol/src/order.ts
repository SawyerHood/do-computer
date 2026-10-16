import type { AgentSummary } from "./agent.ts"

/**
 * The order a person put the Doods of their workspaces in by hand: for each workspace, its Doods'
 * ids from the top down. A workspace that is not here was never put in order. It is each
 * person's own, kept on the server, so that every browser, the desktop app and the phone agree.
 */
export type DoodOrder = Readonly<Record<string, readonly string[]>>

/** The most ids one workspace's order keeps. A workspace with more has the rest latest-first. */
export const MAX_ORDERED = 500

/** Agents with the one that was last spoken to or heard from first. One that never was counts from when it was made. */
export function latestFirst<T extends Pick<AgentSummary, "latest" | "createdAt">>(
  agents: readonly T[],
): T[] {
  const at = (agent: T) => agent.latest?.at ?? agent.createdAt
  return [...agents].sort((a, b) => at(b) - at(a))
}

/**
 * Agents in the order someone put them in by hand: `order` is their ids, the top one first.
 * One that is not in it came after they were last put in order, and is above the rest, the one
 * last heard from first. An id in it that is no longer one of them is passed over. With no
 * order they are all the one last heard from first.
 */
export function inOrder<T extends Pick<AgentSummary, "id" | "latest" | "createdAt">>(
  agents: readonly T[],
  order: readonly string[] | undefined,
): T[] {
  if (order === undefined) return latestFirst(agents)
  const place = new Map(order.map((id, index) => [id, index]))
  const placed = agents
    .filter((agent) => place.has(agent.id))
    .sort((a, b) => place.get(a.id)! - place.get(b.id)!)
  return [...latestFirst(agents.filter((agent) => !place.has(agent.id))), ...placed]
}

/** `ids` with the one at `from` taken out and put back at `to`. */
export function moved<T>(ids: readonly T[], from: number, to: number): T[] {
  const next = [...ids]
  const [taken] = next.splice(from, 1)
  if (taken === undefined) return next
  next.splice(Math.max(0, Math.min(to, next.length)), 0, taken)
  return next
}

/**
 * What came in as a workspace's order, as it can be kept: strings only, each once, and no more
 * than `MAX_ORDERED`. Anything else is not an order at all.
 */
export function readOrderIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every((id) => typeof id === "string" && id.length > 0 && id.length <= 200)) {
    return undefined
  }
  return [...new Set(value as string[])].slice(0, MAX_ORDERED)
}

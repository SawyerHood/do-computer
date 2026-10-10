import type { AgentEvent } from "./agent.ts"
import type { ChatEvent } from "./chat.ts"

/**
 * What an agent is followed over: one WebSocket for everything a client follows of it, in place
 * of an event stream for the agent and one for each chat.
 *
 * A stream keeps the agent in memory on the server for as long as it is open, which is paid for
 * by the second. A socket does not: where the server can put an idle agent away with its sockets
 * still connected, it does, and the agent is brought back by whatever happens to it next. It
 * then has no memory of what it had told each socket, so it says where things stand
 * (`resumed`) and each client checks that against what it has.
 */

/** What a client says on an agent's socket. */
export type AgentSocketRequest =
  /** Send this chat's state, and then every change to it. Asked again, the state is sent again. */
  { type: "follow"; chat: string } | { type: "unfollow"; chat: string }

/** What says where one of an agent's documents stands, by the name it goes by in `changed`. */
export type DocDigests = Record<string, string>

/** What an agent says on its socket. */
export type AgentSocketMessage =
  /**
   * What an agent's event stream says. `ready` comes with where every document stands, and
   * `changed` with where the one that changed now does.
   */
  | { type: "agent"; event: AgentEvent; docs?: DocDigests; at?: string }
  /** One change to a chat the socket follows. The first is always its `snapshot`. */
  | { type: "chat"; chat: string; event: ChatEvent }
  /** There is no such chat, or no longer. It is not followed. */
  | { type: "gone"; chat: string }
  /**
   * The agent was put away and has come back, to this socket among others. `docs` is where its
   * documents stand and `chats` where each chat this socket follows does, as `digest` has it. A
   * client that has something else follows the chat again, or reads the document again.
   */
  | { type: "resumed"; docs: DocDigests; chats: Record<string, string> }

/** What a workspace's library says on its socket: where it stands, each time that may be news. */
export type LibrarySocketMessage = { type: "at"; rev: number }

/** How many chats one socket can follow. A client shows one or two; this is to bound the rest. */
export const MAX_FOLLOWED_CHATS = 16

/**
 * A short fingerprint of a JSON value: the same for two values that are equal as JSON, in
 * whatever order their keys are, and different, as good as always, for two that are not. A key
 * whose value is undefined counts as absent, as it is once the value has been sent anywhere.
 *
 * For checking that two sides hold the same thing without sending it. Not for anything an
 * adversary gains by forging.
 */
export function digest(value: unknown): string {
  let a = 0x811c9dc5
  let b = 0x9747b28c
  const add = (text: string) => {
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index)
      a = Math.imul(a ^ code, 0x01000193)
      b = Math.imul(b + code, 0x5bd1e995)
      b ^= b >>> 15
    }
  }
  const walk = (value: unknown): void => {
    if (value === null || value === undefined) return add("n")
    if (typeof value === "string") return add(`"${value.length}:${value}`)
    if (typeof value === "number") return add(`#${Number.isFinite(value) ? value : "n"};`)
    if (typeof value === "boolean") return add(value ? "t" : "f")
    if (Array.isArray(value)) {
      add("[")
      for (const item of value) walk(item)
      return add("]")
    }
    if (typeof value === "object") {
      add("{")
      const record = value as Record<string, unknown>
      for (const key of Object.keys(record).sort()) {
        if (record[key] === undefined) continue
        add(`${key.length}:${key}`)
        walk(record[key])
      }
      return add("}")
    }
    add("?")
  }
  walk(value)
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0")
}

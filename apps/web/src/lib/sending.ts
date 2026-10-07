import type { ChatMessage, ChatState, MessageImage, QueuedInput } from "@durable-computer/protocol"

/**
 * A message the user has sent that the chat does not have yet. It is shown from the moment it
 * is sent, where it will be once the chat has it, and it gives way to the chat's own copy.
 */
export type Sending = {
  /** The id the request to send it carries. */
  id: string
  text: string
  images: MessageImage[]
  at: number
  /**
   * The agent was at work when it was sent, so it is shown among what is waiting for the agent.
   * Otherwise it is shown in the transcript, as what the agent is about to answer.
   */
  waiting: boolean
  /** The messages and waiting inputs the chat already had. None of those is this one. */
  known: ReadonlySet<string>
  /** What the server calls it, and when it took it. Unset while the request is on its way. */
  submissionId?: string
  acceptedAt?: number
  /** It has been seen waiting for the agent in the chat's own list. */
  queued?: boolean
}

/**
 * How long after the server took a message it is still shown here if the chat never shows it.
 * That should not happen, and a message that stayed on screen twice would be worse than one
 * that left a moment early.
 */
export const GIVE_UP_MS = 20_000

const textOf = (message: ChatMessage): string =>
  message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")

const asMessage = (send: Sending): ChatMessage => ({
  id: `sending:${send.id}`,
  role: "user",
  parts: [
    { type: "text", text: send.text },
    ...send.images.map((image) => ({ type: "image" as const, ...image })),
  ],
  status: "done",
  createdAt: send.at,
})

/**
 * Set what is being sent against the chat as the server has it. The chat's copy of a message
 * has an id of the chat's own, so a message is known to have arrived by its words: it is the
 * first message of the user's with those words that was not there when it was sent.
 *
 * Returns the sends that are still on their way (the same list if none has arrived), those of
 * them to show as messages after the chat's own, what to show as waiting for the agent, and the
 * chat's own messages that have just taken a send's place.
 */
export function settleSends(
  sending: readonly Sending[],
  state: ChatState,
  /** The time, and whether the chat is being heard from: a send is only given up on if it is. */
  now: number,
  following: boolean,
): {
  sending: readonly Sending[]
  messages: ChatMessage[]
  queued: QueuedInput[]
  arrived: string[]
} {
  if (sending.length === 0) return { sending, messages: [], queued: state.queued, arrived: [] }
  const taken = new Set<string>()
  const stoodFor = new Set<string>()
  const next: Sending[] = []
  const messages: ChatMessage[] = []
  const waiting: QueuedInput[] = []
  const arrivals: string[] = []
  let changed = false
  for (const send of sending) {
    const arrived = state.messages.find(
      (message) =>
        message.role === "user" &&
        message.agent === undefined &&
        !send.known.has(message.id) &&
        !taken.has(message.id) &&
        textOf(message) === send.text,
    )
    if (arrived !== undefined) {
      taken.add(arrived.id)
      arrivals.push(arrived.id)
      changed = true
      continue
    }
    const queued = state.queued.find(
      (input) =>
        !taken.has(input.id) &&
        (send.submissionId === undefined
          ? !send.known.has(input.id) && input.text === send.text
          : input.id === send.submissionId),
    )
    if (queued !== undefined) {
      taken.add(queued.id)
      if (send.queued !== true) changed = true
      next.push(send.queued === true ? send : { ...send, queued: true })
      // Shown once: as the message it was sent as, or as the chat's own waiting input.
      if (!send.waiting) {
        stoodFor.add(queued.id)
        messages.push(asMessage(send))
      }
      continue
    }
    // It was waiting for the agent and no longer is. Taken up, it is a message of the chat's
    // a moment from now; let go of, it is nothing.
    if (send.waiting && send.queued === true) {
      changed = true
      continue
    }
    if (following && send.acceptedAt !== undefined && now - send.acceptedAt > GIVE_UP_MS) {
      changed = true
      continue
    }
    next.push(send)
    if (send.waiting) waiting.push({ id: `sending:${send.id}`, mode: "steer", text: send.text })
    else messages.push(asMessage(send))
  }
  return {
    sending: changed ? next : sending,
    messages,
    arrived: arrivals,
    queued:
      stoodFor.size === 0 && waiting.length === 0
        ? state.queued
        : [...state.queued.filter((input) => !stoodFor.has(input.id)), ...waiting],
  }
}

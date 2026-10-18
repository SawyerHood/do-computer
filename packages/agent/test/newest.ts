/**
 * The newest message of a request that is not the prompt. A change to the prompt (what the
 * agent is told about its computers, say) is sent as a system message after what came before
 * it, so the very last message may be that and not the input that set the request going.
 */
export const newest = <T>(messages: readonly T[]): T | undefined =>
  messages.findLast((message) => (message as { role?: string }).role !== "system")

import type { Message } from "@earendil-works/pi-ai"
import { estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate"
import type { ContextEdit, ContextView, EntryRecord, ModelRef } from "@earendil-works/pi-durable"

/**
 * How much of the chat it branched off a side chat carries: all of it, all of it but its older
 * tool output and pictures, or only its most recent part.
 */
export type Carried = "whole" | "trimmed" | "recent"

/**
 * The most of another chat a branch carries when the provider's cache will not be read, in tokens
 * as estimated. Every carried token is then paid for in full, so fewer is cheaper.
 */
export const MAX_COLD_TOKENS = 60_000
/** How much at the end of what is carried is left as it is, however much is cut before it. */
export const UNTRIMMED_TOKENS = 20_000
/**
 * How long after a chat's last answer its prompt is taken to be in the provider's cache still.
 * It is Claude's lifetime for the long cache the agent asks for, and the shortest of them.
 */
export const WARM_MS = 60 * 60_000
/** How many of a chat's latest answers are looked at for a sign of the cache. */
const WARM_ANSWERS = 3
/** What is not worth replacing with a line saying it was left behind. */
const MIN_TRIMMED_TOKENS = 200

const tokens = (messages: readonly Message[]) =>
  messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)

/**
 * Whether a branch of a chat would have what it carries read from the provider's cache: the chat
 * was answered within the cache's lifetime by the model the branch will run on, and one of its
 * latest answers read or wrote the cache. Not every provider says when it writes, so the answer
 * that filled a cold cache can show nothing, and the ones before it are asked too.
 */
export function isWarm(entries: readonly EntryRecord[], model: ModelRef, now: number): boolean {
  const answers = []
  for (let index = entries.length - 1; index >= 0 && answers.length < WARM_ANSWERS; index--) {
    const entry = entries[index]!
    const message = entry.model?.[0]
    if (entry.kind !== "pi.assistant" || message?.role !== "assistant") continue
    // Another model's cache is not this one's.
    if (message.provider !== model.provider || message.model !== model.modelId) break
    answers.push(message)
  }
  const last = answers[0]
  if (last === undefined || now - last.timestamp >= WARM_MS) return false
  return answers.some((answer) => answer.usage.cacheRead > 0 || answer.usage.cacheWrite > 0)
}

const count = (n: number, one: string) => `${n.toLocaleString("en-US")} ${one}${n === 1 ? "" : "s"}`

/**
 * What an entry contributes once its bulk is left behind: a tool's output or a picture becomes a
 * line saying what was there. Undefined for an entry that has neither.
 */
function withoutBulk(entry: EntryRecord, messages: readonly Message[]): Message[] | undefined {
  let changed = false
  const lighter = messages.map((message): Message => {
    if (message.role === "toolResult" && entry.kind === "pi.tool-result") {
      const chars = message.content.reduce(
        (sum, block) => sum + (block.type === "text" ? block.text.length : 0),
        0,
      )
      const pictures = message.content.filter((block) => block.type === "image").length
      const what = [
        ...(chars > 0 ? [`${count(chars, "character")} of output`] : []),
        ...(pictures > 0 ? [count(pictures, "picture")] : []),
      ].join(" and ")
      if (what === "") return message
      changed = true
      return {
        ...message,
        content: [
          {
            type: "text",
            text: `[${what} left behind in the main chat. Use the tool again if you need it.]`,
          },
        ],
      }
    }
    if (message.role === "user" && typeof message.content !== "string") {
      if (!message.content.some((block) => block.type === "image")) return message
      changed = true
      return {
        ...message,
        content: message.content.map((block) =>
          block.type === "image"
            ? { type: "text", text: "[A picture, left behind in the main chat.]" }
            : block,
        ),
      }
    }
    return message
  })
  return changed ? lighter : undefined
}

/**
 * What to change in a branch so that it carries no more than `budget` tokens of the chat it
 * branched off, as edits to write into the branch: they change what the branch's model is shown
 * and nothing in the chat it came from. Nothing is cut that fits.
 *
 * First the tool output and pictures older than the last `untrimmed` tokens are replaced by a
 * line each, since they are most of a transcript and the least missed. What was said is kept
 * whole. If that is not enough, the oldest turns are left out as well, up to a message of the
 * user's so that no tool call is parted from its result. The summary a chat begins with and the
 * entries that hold its prompt are never touched.
 */
export function cutDown(
  view: ContextView,
  budget = MAX_COLD_TOKENS,
  untrimmed = UNTRIMMED_TOKENS,
): { carried: Carried; edits: ContextEdit[] } {
  const sizes = view.contributions.map(tokens)
  let total = sizes.reduce((sum, size) => sum + size, 0)
  if (total <= budget) return { carried: "whole", edits: [] }

  const edits = new Map<number, ContextEdit>()
  let recent = 0
  for (let index = view.entries.length - 1; index >= 0; index--) {
    if (recent < untrimmed) {
      recent += sizes[index]!
      continue
    }
    const entry = view.entries[index]!
    const lighter = withoutBulk(entry, view.contributions[index]!)
    if (lighter === undefined) continue
    const size = tokens(lighter)
    if (sizes[index]! - size < MIN_TRIMMED_TOKENS) continue
    edits.set(index, { target: entry.id, action: "replace", messages: lighter })
    total -= sizes[index]! - size
    sizes[index] = size
  }
  const ordered = () => [...edits.entries()].sort(([a], [b]) => a - b).map(([, edit]) => edit)
  if (total <= budget) return { carried: "trimmed", edits: ordered() }

  // The head marker, where there is one, is first and holds the summary of what came before.
  const first = view.head !== undefined && view.entries[0]?.id === view.head.id ? 1 : 0
  // An entry the model is shown nothing of has nothing to leave out.
  const droppable = (index: number) =>
    view.entries[index]!.kind !== "pi.system" && sizes[index]! > 0
  const starts = view.entries.flatMap((entry, index) =>
    index > first && entry.kind === "pi.user" ? [index] : [],
  )
  let cut: number | undefined
  let dropped = 0
  let from = first
  for (const start of starts) {
    for (let index = from; index < start; index++) if (droppable(index)) dropped += sizes[index]!
    from = start
    cut = start
    if (total - dropped <= budget) break
  }
  if (cut === undefined) return { carried: "trimmed", edits: ordered() }
  for (let index = first; index < cut; index++) {
    if (droppable(index)) edits.set(index, { target: view.entries[index]!.id, action: "omit" })
  }
  return { carried: "recent", edits: ordered() }
}

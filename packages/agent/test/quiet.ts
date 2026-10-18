import type { Context as ModelContext } from "@earendil-works/pi-ai"
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxProviderHandle,
  type FauxResponseStep,
} from "@earendil-works/pi-ai/providers/faux"
import { UNSENT } from "../src/bus.ts"

/**
 * Whether a request needs nothing from the script: the one reminder a run gets when it sent a
 * person nothing, or the result of a `send`, after which a model has nothing more to say.
 */
function reminded(context: ModelContext): boolean {
  // What changed of the prompt since is not something said.
  const last = context.messages.findLast((message) => message.role !== "system")
  if (last?.role === "toolResult") {
    // The round that sent something, once all of its results are in.
    const round = context.messages.findLast((message) => message.role === "assistant")
    return (
      round?.role === "assistant" &&
      round.content.some((block) => block.type === "toolCall" && block.name === "send") &&
      !context.messages.some(
        (message) =>
          message.role === "toolResult" && message.toolName === "send" && message.isError,
      )
    )
  }
  if (last?.role !== "user") return false
  const blocks = typeof last.content === "string" ? [] : last.content
  return blocks.some((block) => block.type === "text" && block.text === UNSENT)
}

/** The words of the newest thing a request was told, past what changed of its prompt. */
function told(context: ModelContext): string | undefined {
  const last = context.messages.findLast((message) => message.role !== "system")
  if (last?.role !== "user") return undefined
  return typeof last.content === "string"
    ? last.content
    : last.content.map((block) => (block.type === "text" ? block.text : "")).join("")
}

/**
 * A scripted model for a test of something other than the bus, in a main chat, where every run
 * that sends a person nothing is reminded once (`bus.ts`). Told that, or that what it sent was
 * sent, it ends quietly, as a model with nothing more to say would, without taking the next of
 * the answers the test scripted: those stay for the requests the test is about. Otherwise it is
 * the scripted model as it was, but that an event it has no answer scripted for is passed over
 * quietly too.
 */
export function quietOnReminder<T extends FauxProviderHandle>(
  faux: T,
): T & { requests: ModelContext[]; passThrough: boolean } {
  const steps: FauxResponseStep[] = []
  /** Every request the model was sent, oldest first, those it answered quietly among them. */
  const requests: ModelContext[] = []
  const setResponses = faux.setResponses
  const appendResponses = faux.appendResponses
  const next: FauxResponseStep = (context, options, state, model) => {
    // One stays queued for every request, whatever the test scripted.
    appendResponses([next])
    requests.push(structuredClone(context))
    if (!wrapped.passThrough && reminded(context)) {
      return fauxAssistantMessage("")
    }
    const step = steps.shift()
    // An event that nothing was scripted for, as a main chat is told of a run or a report, is
    // passed over without a word: quiet is the usual answer to one.
    if (!wrapped.passThrough && step === undefined && told(context)?.startsWith("<event ")) {
      return fauxAssistantMessage("")
    }
    if (step === undefined) {
      return fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "No more faux responses queued",
      })
    }
    return typeof step === "function" ? step(context, options, state, model) : step
  }
  setResponses([next])
  const wrapped = {
    ...faux,
    requests,
    /** Every request goes to the script, as for a test of the bus itself. */
    passThrough: false,
    setResponses: (responses: FauxResponseStep[]) => {
      steps.splice(0, steps.length, ...responses)
    },
    appendResponses: (responses: FauxResponseStep[]) => {
      steps.push(...responses)
    },
    getPendingResponseCount: () => steps.length,
  }
  return wrapped
}

/** An answer that says `text` to the people in a main chat, as a model there does: with `send`. */
export const sent = (text: string) =>
  fauxAssistantMessage([fauxToolCall("send", { text })], { stopReason: "toolUse" })

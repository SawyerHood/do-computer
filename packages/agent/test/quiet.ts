import {
  type AssistantMessage,
  type Context as ModelContext,
  getCurrentTools,
} from "@earendil-works/pi-ai"
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxProviderHandle,
  type FauxResponseStep,
} from "@earendil-works/pi-ai/providers/faux"
import { UNSENT } from "../src/bus.ts"
import { LOAD_TOOLS } from "../src/deferred.ts"
import { newest } from "./newest.ts"

/**
 * Whether a request needs nothing from the script: the one reminder a run gets when it sent a
 * person nothing, or the result of a `send`, after which a model has nothing more to say.
 */
function reminded(context: ModelContext): boolean {
  const last = newest(context.messages)
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
  const last = newest(context.messages)
  if (last?.role !== "user") return undefined
  return typeof last.content === "string"
    ? last.content
    : last.content.map((block) => (block.type === "text" ? block.text : "")).join("")
}

/**
 * A scripted model that loads a tool of the agent's own that is loaded on demand before it calls
 * one (`deferred.ts`), as a model told of it does. `first` gives the answer to a request, or
 * where that calls such a tool, `load_tools` for it, holding the answer back; `held` is that
 * answer, for the request that carries what `load_tools` said, once. Kept by that call, so that
 * the chats of one model each get their own.
 */
export function loadsFirst() {
  const kept = new Map<string, AssistantMessage>()
  return {
    held(context: ModelContext): AssistantMessage | undefined {
      const last = newest(context.messages)
      if (last?.role !== "toolResult" || !kept.has(last.toolCallId)) return undefined
      const answer = kept.get(last.toolCallId)
      kept.delete(last.toolCallId)
      return answer
    },
    first(context: ModelContext, answer: AssistantMessage): AssistantMessage {
      const offered = new Set(getCurrentTools(context.messages).map((tool) => tool.name))
      if (!offered.has(LOAD_TOOLS)) return answer
      // A connector's tools are looked for with `tool_search`, which a test scripts itself.
      const names = answer.content.flatMap((block) =>
        block.type === "toolCall" && !offered.has(block.name) && !block.name.includes("__")
          ? [block.name]
          : [],
      )
      if (names.length === 0) return answer
      const load = fauxToolCall(LOAD_TOOLS, { names: [...new Set(names)] })
      kept.set(load.id, answer)
      return fauxAssistantMessage([load], { stopReason: "toolUse" })
    },
  }
}

/**
 * A scripted model for a test of something other than the bus, in a main chat, where every run
 * that sends a person nothing is reminded once (`bus.ts`). Told that, or that what it sent was
 * sent, it ends quietly, as a model with nothing more to say would, without taking the next of
 * the answers the test scripted: those stay for the requests the test is about. Otherwise it is
 * the scripted model as it was, but that an event it has no answer scripted for is passed over
 * quietly too, and that it loads a tool of the agent's own that is loaded on demand before it
 * calls one (`deferred.ts`), as a model told of it does: that request is answered with
 * `load_tools`, and the next one with the answer that was scripted.
 */
export function quietOnReminder<T extends FauxProviderHandle>(
  faux: T,
): T & { requests: ModelContext[]; passThrough: boolean } {
  const steps: FauxResponseStep[] = []
  /** Every request the model was sent, oldest first, those it answered quietly among them. */
  const requests: ModelContext[] = []
  const setResponses = faux.setResponses
  const appendResponses = faux.appendResponses
  const loading = loadsFirst()
  const next: FauxResponseStep = async (context, options, state, model) => {
    // One stays queued for every request, whatever the test scripted.
    appendResponses([next])
    requests.push(structuredClone(context))
    const held = loading.held(context)
    if (held !== undefined) return held
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
    return loading.first(
      context,
      typeof step === "function" ? await step(context, options, state, model) : step,
    )
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

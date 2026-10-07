import { LOG_TOOL } from "@durable-computer/protocol"
import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool } from "@earendil-works/pi-durable"

/**
 * How an agent adds to the list of what it did in a chat, which its user sees beside the chat.
 * Nothing is stored for it: the call is in the transcript, and clients read the list from there
 * (`chatRuns` in the protocol package). The agent decides what is worth an entry.
 */
const log = defineTool({
  name: LOG_TOOL,
  description: `Add an entry to the short list of what you have done in this chat, which the person sees beside it. Call it once, when you have finished a substantial piece of work: something was made, changed, set up, fixed or sent, or it took real effort over many steps, such as a long investigation. Do not call it for a quick lookup or check, reading a file or two, a single search, saving a note or answering a question: most replies get no entry. Call it in the same reply as your last step, or just before your final answer. One entry covers everything done since the person last wrote; calling it again replaces that entry.`,
  parameters: Type.Object({
    title: Type.String({
      description:
        'Two to six words naming the task, the way a to-do item would: "Set up SSH key access", "Find flights to Lisbon". No period at the end.',
    }),
    outcome: Type.String({
      description:
        'One plain sentence of at most ten words on what came of it, in the past tense: what was made, changed or found, or why it did not work. Do not begin with "I".',
    }),
  }),
  execute: async (args) => {
    if (args.title.trim() === "" || args.outcome.trim() === "") {
      return {
        isError: true,
        content: [{ type: "text" as const, text: "An entry needs a title and an outcome." }],
      }
    }
    return { content: [{ type: "text" as const, text: "Added to the list." }] }
  },
})

/** Gives the agent the tool it writes up substantial work with. */
export const Log = defineExtension({ name: "dc.log", tools: [log] })

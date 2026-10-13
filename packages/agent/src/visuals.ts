import {
  DOCUMENT_GUIDE,
  MAX_VISUAL_BYTES,
  MAX_VISUAL_TITLE,
  PAGE_STYLE_GUIDE,
  prepareVisual,
  REPLY_GUIDE,
  VISUAL_GUIDE,
  VISUAL_TOOL,
  VISUALS_FOLDER,
  visualFileName,
  visualProblems,
} from "@do-computer/protocol"
import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, section } from "@earendil-works/pi-durable"
import { type LibraryBackend, LibraryError } from "./library-store.ts"

export type VisualsOptions = {
  /** Where the library is kept right now: with the agent, or with its workspace. */
  readonly backend: () => Promise<LibraryBackend>
  /** The agent, which the visuals it draws are put down to where the library is shared. */
  readonly agentId?: string
}

/**
 * Lets the agent answer with a page where a page says more than prose: a chart, a mock-up, a
 * diagram. The agent writes the page; it is kept in the library, where it can be opened, edited
 * and shared like any other, and the chat shows it as the page itself. It needs no computer.
 */
export function visuals(options: VisualsOptions): Extension {
  const fail = (text: string) => ({ isError: true, output: [{ type: "text" as const, text }] })
  const tool = defineTool({
    name: VISUAL_TOOL,
    description: `Show the person a page you wrote, drawn in the chat itself above your reply: a chart, a dashboard, a mock-up, something to press and try, anything that says more laid out than in prose. A plain table or a simple diagram goes in your reply as Markdown instead. Give one complete, self-contained HTML document with its styles and scripts inline. Call it before you write your reply. The person already sees the page, so your reply should not announce it, say where it is or repeat it: add only what the page does not say. ${VISUAL_GUIDE} The page is also kept in their library, in ${VISUALS_FOLDER}/, where it can be opened full size and shared.`,
    parameters: Type.Object({
      title: Type.String({
        description: "A short name for the page, which it is kept under: “Signups by week, Q3”",
      }),
      html: Type.String({ description: "The complete HTML document" }),
    }),
    execute: async (args, api) => {
      const title = args.title.replace(/\s+/g, " ").trim().slice(0, MAX_VISUAL_TITLE)
      if (title === "") return fail("A visual needs a title.")
      if (args.html.trim() === "") return fail("A visual needs a page: `html` was empty.")
      // What would break the page where it is shown is said before it is shown, so that the
      // person never sees the broken one.
      const problems = visualProblems(args.html)
      if (problems.stops.length > 0) {
        return fail(
          `The page was not shown, because it would not work in the chat:\n${problems.stops
            .map((stop) => `- ${stop}`)
            .join("\n")}\nFix that and draw it again.`,
        )
      }
      const bytes = new TextEncoder().encode(prepareVisual(args.html))
      if (bytes.length > MAX_VISUAL_BYTES) {
        return fail(
          `That page is ${Math.round(bytes.length / 1024)} KB; a visual can be up to ${MAX_VISUAL_BYTES / 1024} KB. Draw less data.`,
        )
      }
      try {
        const file = await (
          await options.backend()
        ).add({
          // Each visual is a page of its own: one with the same title is kept beside the last.
          path: `${VISUALS_FOLDER}/${visualFileName(title)}`,
          bytes,
          source: "agent",
          chatId: String(api.conversationId),
          ...(options.agentId === undefined ? {} : { agentId: options.agentId }),
          contentType: "text/html",
        })
        return {
          output: [
            {
              type: "text",
              text:
                `Shown to the person in the chat, above your reply, and kept in the library as ${file.path}. Do not describe the page or say where it is; reply with only what it does not already say.` +
                (problems.notes.length === 0
                  ? ""
                  : `\n\nThings in this page to keep in mind for the next one you draw (do not draw this one again for them, and do not mention them):\n${problems.notes
                      .map((note) => `- ${note}`)
                      .join("\n")}`),
            },
          ],
          details: file,
        }
      } catch (error) {
        if (error instanceof LibraryError) return fail(error.message)
        throw error
      }
    },
  })
  return defineExtension({
    name: "dc.visuals",
    tools: [tool],
    sections: [
      section("visuals", () =>
        [
          `When a chart, a timeline, a mock-up or something to press and try would say more than prose, draw it with the \`${VISUAL_TOOL}\` tool: you write a small HTML page and the person sees it in the chat itself, above your reply. Use it for answers that have a shape, and not for a few sentences or a short list.`,
          "The person sees the page as part of your answer, so do not announce it or restate what is in it.",
          REPLY_GUIDE,
        ].join(" "),
      ),
      // How a page should look is said once, for a visual and for a page kept in the library.
      section("pages", () =>
        [
          `How a page you write should look, whether it is drawn with \`${VISUAL_TOOL}\` or is an HTML file in the library: a document, a dashboard, a chart. ${PAGE_STYLE_GUIDE}`,
          DOCUMENT_GUIDE,
        ].join("\n"),
      ),
    ],
  })
}

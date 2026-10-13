import {
  DOCUMENT_GUIDE,
  MAX_VISUAL_BYTES,
  VISUAL_COMPUTER_WIDTH,
  VISUAL_MAX_HEIGHT,
  VISUAL_MEASURED_WIDTHS,
  VISUAL_PHONE_WIDTH,
  type VisualHeights,
  visualPreviewDocument,
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
import { type PagePreviewer, PreviewError } from "@do-computer/runtime"
import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, section } from "@earendil-works/pi-durable"
import { type LibraryBackend, LibraryError } from "./library-store.ts"

export type VisualsOptions = {
  /** Where the library is kept right now: with the agent, or with its workspace. */
  readonly backend: () => Promise<LibraryBackend>
  /** The agent, which the visuals it draws are put down to where the library is shared. */
  readonly agentId?: string
  /**
   * A browser that draws a page for the agent to look at before the person does. Without one
   * the agent draws without looking.
   */
  readonly previewer?: PagePreviewer
  /** Whether the agent's model takes pictures. One that does not is told of the page in words. */
  readonly sees?: () => Promise<boolean>
  /** The app's address, which a page being looked at loads the app's typefaces from. */
  readonly appUrl?: () => string | undefined
}

/** The tool an agent looks at a page with before it draws it. */
export const VISUAL_PREVIEW_TOOL = "visual_preview"
/** How long a look at a page may take before the agent is told to go on without it. */
const PREVIEW_MS = 20_000
/** How many pages an agent may look at in an hour: each is some seconds of a browser. */
const PREVIEWS_AN_HOUR = 60
/** How many pages' measured heights are kept, for the ones that are then drawn. */
const MEASURED_KEPT = 8

/**
 * Lets the agent answer with a page where a page says more than prose: a chart, a mock-up, a
 * diagram. The agent writes the page; it is kept in the library, where it can be opened, edited
 * and shared like any other, and the chat shows it as the page itself. It needs no computer.
 */
export function visuals(options: VisualsOptions): Extension {
  const fail = (text: string) => ({ isError: true, output: [{ type: "text" as const, text }] })
  const stopped = (stops: readonly string[]) =>
    `The page was not shown, because it would not work in the chat:\n${stops
      .map((stop) => `- ${stop}`)
      .join("\n")}\nFix that and draw it again.`
  // How tall each page that was looked at is, by what it says: one drawn as it was looked at
  // is then given its room in the chat before it has loaded.
  const measured = new Map<string, VisualHeights>()
  // When each look of the last hour was taken.
  let looks: number[] = []
  const previewer = options.previewer
  const preview =
    previewer === undefined
      ? undefined
      : defineTool({
          name: VISUAL_PREVIEW_TOOL,
          description: `Look at a page before you show it: it is drawn in a browser as the chat will draw it, and you get a picture of it, how tall it is on a computer and on a phone, and what it wrote to its console, with anything that failed in it. Nothing is shown to the person and nothing is kept. Use it to check a page you are about to draw with \`${VISUAL_TOOL}\`, fix what is wrong, and look again; console.log is a fine way to check something of your own. Pictures and data the page loads from elsewhere may not arrive here.`,
          parameters: Type.Object({
            html: Type.String({ description: "The complete HTML document" }),
            width: Type.Optional(
              Type.Number({
                description: `How wide to picture it, in pixels, from 240 to 1600. ${VISUAL_COMPUTER_WIDTH}, a reply on a computer, unless you say; ${VISUAL_PHONE_WIDTH} is a phone.`,
              }),
            ),
            appearance: Type.Optional(
              Type.Union([Type.Literal("dark"), Type.Literal("light")], {
                description: "Dark unless you say.",
              }),
            ),
          }),
          execute: async (args) => {
            if (args.html.trim() === "")
              return fail("There is no page to look at: `html` was empty.")
            if (new TextEncoder().encode(args.html).length > MAX_VISUAL_BYTES) {
              return fail(`A visual can be up to ${MAX_VISUAL_BYTES / 1024} KB. Draw less data.`)
            }
            const problems = visualProblems(args.html)
            if (problems.stops.length > 0) return fail(stopped(problems.stops))
            const now = Date.now()
            looks = looks.filter((at) => now - at < 60 * 60 * 1000)
            if (looks.length >= PREVIEWS_AN_HOUR) {
              return fail(
                "That is a great many pages looked at in an hour. Draw this one as it is.",
              )
            }
            looks.push(now)
            const width = Math.round(
              Math.min(1600, Math.max(240, args.width ?? VISUAL_COMPUTER_WIDTH)),
            )
            let timer: ReturnType<typeof setTimeout> | undefined
            try {
              const seen = await Promise.race([
                previewer.preview({
                  html: visualPreviewDocument(args.html, {
                    appearance: args.appearance ?? "dark",
                    ...(options.appUrl?.() === undefined ? {} : { base: options.appUrl()! }),
                  }),
                  width,
                  widths: VISUAL_MEASURED_WIDTHS,
                }),
                new Promise<never>((_, late) => {
                  timer = setTimeout(
                    () => late(new PreviewError("The browser took too long to draw it.")),
                    PREVIEW_MS,
                  )
                }),
              ])
              measured.delete(args.html)
              measured.set(args.html, seen.heights)
              while (measured.size > MEASURED_KEPT) measured.delete(measured.keys().next().value!)
              const tall = (at: number) => seen.heights.find(([wide]) => wide === at)?.[1]
              const words = [
                `At ${width}px wide the page is ${tall(width) ?? seen.pictured}px tall` +
                  (seen.pictured < (tall(width) ?? 0)
                    ? `, of which the first ${seen.pictured}px are in the picture.`
                    : "."),
                `Where it will be read it is ${tall(VISUAL_COMPUTER_WIDTH)}px tall on a computer (${VISUAL_COMPUTER_WIDTH}px wide) and ${tall(VISUAL_PHONE_WIDTH)}px on a phone (${VISUAL_PHONE_WIDTH}px wide). Past ${VISUAL_MAX_HEIGHT}px it scrolls inside its frame.`,
                seen.console.length === 0
                  ? "It wrote nothing to its console, and nothing in it failed."
                  : `Its console:\n${seen.console.map((line) => `[${line.level}] ${line.text}`).join("\n")}`,
                ...(problems.notes.length === 0
                  ? []
                  : [
                      `To fix before you draw it:\n${problems.notes.map((note) => `- ${note}`).join("\n")}`,
                    ]),
              ]
              const sees = (await options.sees?.()) ?? true
              return {
                output: [
                  {
                    type: "text" as const,
                    text: sees
                      ? words.join("\n")
                      : `${words.join("\n")}\nYour model does not take pictures, so the picture of it is left out.`,
                  },
                  ...(sees
                    ? [{ type: "image" as const, data: seen.png, mimeType: "image/png" }]
                    : []),
                ],
              }
            } catch (error) {
              if (error instanceof PreviewError) {
                return fail(
                  `The page could not be looked at: ${error.message} Draw it without looking.`,
                )
              }
              throw error
            } finally {
              clearTimeout(timer)
            }
          },
        })
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
      if (problems.stops.length > 0) return fail(stopped(problems.stops))
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
          // With how tall it was when it was looked at, where it was: the chat then gives it
          // that room before the page has said anything.
          details:
            measured.get(args.html) === undefined
              ? file
              : { ...file, heights: measured.get(args.html)!.map(([wide, tall]) => [wide, tall]) },
        }
      } catch (error) {
        if (error instanceof LibraryError) return fail(error.message)
        throw error
      }
    },
  })
  return defineExtension({
    name: "dc.visuals",
    tools: preview === undefined ? [tool] : [preview, tool],
    sections: [
      section("visuals", () =>
        [
          ...(preview === undefined
            ? []
            : [
                `Look at a page with \`${VISUAL_PREVIEW_TOOL}\` before you draw it, and fix what the picture and its console show: the person should not be the first to see it.`,
              ]),
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

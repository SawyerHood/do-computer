import {
  DOCUMENT_GUIDE,
  embedKind,
  type LibraryFile,
  MAX_VISUAL_BYTES,
  VISUAL_COMPUTER_WIDTH,
  VISUAL_MAX_HEIGHT,
  VISUAL_MEASURED_WIDTHS,
  VISUAL_PHONE_WIDTH,
  type VisualHeights,
  visualPreviewDocument,
  LIBRARY_PAGE_PARAM,
  MAX_VISUAL_TITLE,
  PAGE_STYLE_GUIDE,
  prepareVisual,
  REPLY_GUIDE,
  THEME_TOKENS,
  VISUAL_GUIDE,
  VISUAL_TOOL,
  VISUALS_FOLDER,
  visualFileName,
  visualProblems,
  visualThemeFragment,
} from "@do-computer/protocol"
import {
  type PagePreview,
  type PagePreviewer,
  PREVIEW_WINDOW_HEIGHT,
  PreviewError,
  type PreviewRequest,
} from "@do-computer/runtime"
import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, section } from "@earendil-works/pi-durable"
import { LIBRARY_FOLDER, type LibraryBackend, LibraryError } from "./library-store.ts"

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
  /**
   * Where the app serves the library's files as what they are, each with the files beside it:
   * the address a person's own browser is given, ending in a slash, which a file's path in
   * the library follows. Whoever has it can read the library for some hours, so it is never
   * said to the agent. Undefined where the app's own address is not known. With it and a
   * browser, the agent can look at what is in the library.
   */
  readonly viewRoot?: () => Promise<string | undefined>
  /** The agent's own color, which a page in the app's look takes its accent from. */
  readonly color?: () => Promise<string | undefined>
}

/** The tool an agent looks at a page with before it draws it. */
export const VISUAL_PREVIEW_TOOL = "visual_preview"
/** The tool an agent looks at a file of the library with. */
export const LOOK_TOOL = "look"
/** How long a look at a page may take before the agent is told to go on without it. */
const PREVIEW_MS = 20_000
/** How many pages an agent may look at in an hour: each is some seconds of a browser. */
const PREVIEWS_AN_HOUR = 60
/** How many pages' measured heights are kept, for the ones that are then drawn. */
const MEASURED_KEPT = 8
/** How wide a file of the library is looked at unless the agent says: a window on a computer. */
const LOOK_WIDTH = 1120
/**
 * About how many pixels one picture of a file holds. A model is given a larger picture made
 * smaller, and the words in it are then too small to read, so a wide page is pictured less far
 * down than a narrow one, and the agent looks further down for the rest.
 */
const LOOK_PIXELS = 1_500_000
/** The largest text the app lays out as a page to read. A larger one is only handed over. */
const MAX_LAID_OUT_BYTES = 1024 * 1024
/** How each kind of file that is not a picture is drawn, as the agent is told it. */
const LOOKED_AT_AS = {
  page: "as the app shows the page",
  markdown: "laid out as a document to read",
  table: "as its table",
  text: "as its text",
} as const
/** What the page a picture is drawn in says of it on its console: how large it is, or that it is none. */
const PICTURE_SAYS = "dc-picture:"

/** The file meant by what the agent wrote: its id, its place in the library, or its name. */
function fileMeant(files: readonly LibraryFile[], wanted: string): LibraryFile | undefined {
  const lower = wanted.toLowerCase()
  // A place as it is in the library, and as it is on a machine, where the library is a folder.
  const places = [
    wanted.replace(new RegExp(`^(?:~/|\\./|/)?${LIBRARY_FOLDER}/`), "").replace(/^\.?\//, ""),
    ...(wanted.includes(`/${LIBRARY_FOLDER}/`)
      ? [wanted.slice(wanted.indexOf(`/${LIBRARY_FOLDER}/`) + LIBRARY_FOLDER.length + 2)]
      : []),
  ].map((place) => place.replace(/\/+$/, "").toLowerCase())
  for (const place of places) {
    const at =
      files.find((file) => file.path.toLowerCase() === place) ??
      // A folder is its front page, as it is wherever the library is served.
      files.find((file) => file.path.toLowerCase() === `${place}/index.html`)
    if (at !== undefined) return at
  }
  // `list` is newest first, so a name used twice means the latest one.
  return (
    files.find((file) => file.id === wanted) ??
    files.find((file) => file.name.toLowerCase() === lower)
  )
}

/**
 * The document a browser is given to draw a picture of the library in: the picture alone, on
 * the app's background, no wider than the window and never made larger than it is. It says on
 * its console how large the picture is, or that there was none to draw.
 */
function pictureDocument(address: string, appearance: "light" | "dark"): string {
  const canvas = THEME_TOKENS.find((token) => token.name === "--canvas")!
  const background = appearance === "dark" ? (canvas.dark ?? canvas.light) : canvas.light
  const src = address.replace(
    /[&<>"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!,
  )
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `html,body{margin:0;background:${background}}img{display:block;margin:0 auto;max-width:100%}` +
    `</style></head><body><img id="picture" alt="" src="${src}">` +
    `<script>(function(){var i=document.getElementById("picture");` +
    `window.dcReady=new Promise(function(done){function end(){` +
    `console.info(${JSON.stringify(PICTURE_SAYS)}+(i.naturalWidth>0?i.naturalWidth+"x"+i.naturalHeight:"none"));done()}` +
    `if(i.complete)end();else{i.addEventListener("load",end);i.addEventListener("error",end)}})})()</script></body></html>`
  )
}

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
  /** Count a look, or answer false where the hour has had as many as it may. */
  const mayLook = () => {
    const now = Date.now()
    looks = looks.filter((at) => now - at < 60 * 60 * 1000)
    if (looks.length >= PREVIEWS_AN_HOUR) return false
    looks.push(now)
    return true
  }
  const previewer = options.previewer
  /** Have the browser draw something, and give up on it when it takes too long. */
  const drawn = async (browser: PagePreviewer, request: PreviewRequest): Promise<PagePreview> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        browser.preview(request),
        new Promise<never>((_, late) => {
          timer = setTimeout(
            () => late(new PreviewError("The browser took too long to draw it.")),
            PREVIEW_MS,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const consoleOf = (lines: PagePreview["console"]) =>
    lines.map((line) => `[${line.level}] ${line.text}`).join("\n")
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
            if (!mayLook()) {
              return fail(
                "That is a great many pages looked at in an hour. Draw this one as it is.",
              )
            }
            const width = Math.round(
              Math.min(1600, Math.max(240, args.width ?? VISUAL_COMPUTER_WIDTH)),
            )
            try {
              const seen = await drawn(previewer, {
                html: visualPreviewDocument(args.html, {
                  appearance: args.appearance ?? "dark",
                  ...(options.appUrl?.() === undefined ? {} : { base: options.appUrl()! }),
                }),
                width,
                widths: VISUAL_MEASURED_WIDTHS,
              })
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
                  : `Its console:\n${consoleOf(seen.console)}`,
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
            }
          },
        })
  const viewRoot = options.viewRoot
  const look =
    previewer === undefined || viewRoot === undefined
      ? undefined
      : defineTool({
          name: LOOK_TOOL,
          description: `See a file of the library as the person sees it: you get a picture of it. An HTML page is drawn in a browser as the app shows it, in the app's look and with the styles, scripts and pictures beside it, and you are told how tall it is and what it wrote to its console, with anything that failed in it. A Markdown document is laid out as the page its link shares, where a \`mermaid\` block stays code and code has no colors; a CSV is its table, and a picture is shown as it is. Use it to check a page or a document you made or changed before you send it, and to see a picture the person gave you. Nothing is shown to the person, and the file is not changed. A PDF, a film and a sound cannot be looked at this way.`,
          parameters: Type.Object({
            file: Type.String({
              description:
                "The file's path in the library, its name or its id, as the `library` tool lists it. A folder is its index.html.",
            }),
            width: Type.Optional(
              Type.Number({
                description: `How wide the window is, in pixels, from 240 to 1600. ${LOOK_WIDTH}, a window on a computer, unless you say; ${VISUAL_PHONE_WIDTH} is a phone.`,
              }),
            ),
            top: Type.Optional(
              Type.Number({
                description:
                  "How far down the picture starts, in pixels, for what is too tall for one picture. Its top unless you say.",
              }),
            ),
            appearance: Type.Optional(
              Type.Union([Type.Literal("dark"), Type.Literal("light")], {
                description: "Dark unless you say.",
              }),
            ),
          }),
          execute: async (args) => {
            const wanted = args.file.trim()
            if (wanted === "") return fail("Say which file: its path in the library.")
            const file = fileMeant(await (await options.backend()).list(), wanted)
            if (file === undefined) {
              return fail(
                `There is no "${wanted}" in the library. The \`library\` tool's list action shows what is there; a file on a machine is in the library once it is under ~/${LIBRARY_FOLDER}.`,
              )
            }
            const kind = embedKind(file.name, file.contentType)
            if (kind === "pdf" || kind === "video" || kind === "audio" || kind === "other") {
              const what =
                kind === "pdf"
                  ? "a PDF"
                  : kind === "video"
                    ? "a film"
                    : kind === "audio"
                      ? "a sound file"
                      : "not something that is drawn"
              return fail(
                `${file.path} is ${what}, which cannot be looked at this way: only a page, a document, a table, text and a picture can.`,
              )
            }
            if (kind !== "page" && kind !== "image" && file.size > MAX_LAID_OUT_BYTES) {
              return fail(
                `${file.path} is ${Math.round(file.size / 1024)} KB of text, and the app lays out up to ${MAX_LAID_OUT_BYTES / 1024} KB as a page: the person is handed it as a file. Read it with your own tools.`,
              )
            }
            const root = await viewRoot()
            if (root === undefined) {
              return fail(
                "The address people reach the app at is not known here, so the browser cannot be sent to the library.",
              )
            }
            const address = `${root}${file.path.split("/").map(encodeURIComponent).join("/")}`
            // Where the library is served is the permission to read it: it is left out of
            // whatever the page or the browser says, which the agent may go on to repeat.
            const unsaid = (text: string) => text.replaceAll(root, "")
            if (!mayLook()) {
              return fail("That is a great many pages looked at in an hour. Go on without looking.")
            }
            const width = Math.round(Math.min(1600, Math.max(240, args.width ?? LOOK_WIDTH)))
            const appearance = args.appearance ?? "dark"
            const color = await options.color?.()
            // A picture is drawn by itself. A page is told its colors on its address, as the
            // app tells one it shows, and what is neither is asked for as the page the app
            // makes of it.
            const what =
              kind === "image"
                ? { html: pictureDocument(address, appearance) }
                : {
                    url:
                      kind === "page"
                        ? `${address}${visualThemeFragment({ appearance, ...(color === undefined ? {} : { color }) })}`
                        : `${address}?${LIBRARY_PAGE_PARAM}`,
                  }
            try {
              const seen = await drawn(previewer, {
                ...what,
                width,
                widths: [],
                appearance,
                most: Math.max(PREVIEW_WINDOW_HEIGHT, Math.round(LOOK_PIXELS / width)),
                ...(args.top === undefined ? {} : { top: args.top }),
              })
              const picture = seen.console.find((line) => line.text.startsWith(PICTURE_SAYS))
              const lines = seen.console
                .filter((line) => line !== picture)
                .map((line) => ({ ...line, text: unsaid(line.text) }))
              if (kind === "image" && picture?.text === `${PICTURE_SAYS}none`) {
                return fail(
                  `${file.path} could not be drawn as a picture: the browser could not load it, or it is not one it knows.`,
                )
              }
              const tall = seen.heights.find(([wide]) => wide === width)?.[1] ?? seen.pictured
              const top = seen.top ?? 0
              const until = top + seen.pictured
              const rest =
                until < tall ? ` Look again with \`top\` at ${until} for what is below.` : ""
              const shown =
                top === 0 && until >= tall
                  ? "all of it is in the picture."
                  : `the picture is of ${top}px to ${until}px down.${rest}`
              const words =
                kind === "image"
                  ? [
                      `${file.path} is a picture${picture === undefined ? "" : ` of ${picture.text.slice(PICTURE_SAYS.length).replace("x", " by ")} pixels`}. In a window ${width}px wide it is ${tall}px tall, and ${shown}`,
                    ]
                  : [
                      `${file.path}, ${LOOKED_AT_AS[kind]}, in a window ${width}px wide and ${PREVIEW_WINDOW_HEIGHT}px tall: it is ${tall}px tall, and ${shown}`,
                      ...(kind !== "page"
                        ? []
                        : [
                            lines.length === 0
                              ? "It wrote nothing to its console, and nothing in it failed."
                              : `Its console:\n${consoleOf(lines)}`,
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
                return fail(`${file.path} could not be looked at: ${unsaid(error.message)}`)
              }
              throw error
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
    tools: [
      ...(preview === undefined ? [] : [preview]),
      tool,
      ...(look === undefined ? [] : [look]),
    ],
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
          ...(look === undefined
            ? []
            : [
                `You can see what is in the library with \`${LOOK_TOOL}\`: it gives you a picture of a file as the person sees it. Look at a page or a document you wrote or changed there before you send it, and fix what the picture and its console show; look at it as a phone shows it too where it may be read on one. It is also how you see a picture the person gave you.`,
              ]),
        ].join("\n"),
      ),
    ],
  })
}

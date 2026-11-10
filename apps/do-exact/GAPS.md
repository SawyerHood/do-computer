# What Exact cannot do yet, and what this app does instead

One paragraph each: what, where in the React app, what was done instead.

## The shell

**The sidebar is beside the page from 900 px, not 768.** Exact's web host splits a stack's
first route from its detail at 900 px (`navigationSplit`); the React app puts the sidebar
beside the page from `48rem` (`SIDEBAR_BESIDE` in `components/shell/app-shell.tsx`). Between
the two this app is a phone's stack.

**On a phone the list is a screen, not a drawer.** The React app's phone keeps the chat on
screen and pulls the sidebar over it from the left edge (`usePulledSidebar`). Here the list is
the stack's first screen and a Dood's chat is pushed over it, with the way back at the top
left where the React app's sidebar button is.

**The sidebar does not fold to a rail of faces or resize.** The React app's wide sidebar is a
column of faces until its edge is dragged out, and is dragged to any width from 208 to 448 px
(`ResizeHandle`, `sidebarColumn`). Exact's split column has one width, given by
`navigationSplit="288"` (the React app's starting width); there is no way to drag it.

**Some of a Dood's pages are pages here, not sections of a settings window.** The React app
opens skills, connectors, computers, permissions, profile and settings, and a team's people and
settings, as sections of one settings dialog over the page, and redirects their old addresses
to it (`routes/_app.a.$agentId.skills.tsx` and the like). Here each is a route at that address,
in the content beside the sidebar, which Exact gives Back, reload and links for nothing. A
modal route (`navigationPresentation="modal"`) would be the dialog, if that is wanted later.

**A pages menu opens from the pill's start, not its middle.** The React app centres the Dood's
menu under its name (`align="center"`); an Exact popover is placed by the platform under the
button that opens it.

## Transport

**A stream opens before its answer awaits anything, so socket tickets are kept ready.** On the
web, Exact starts a stream only as its answer is asked, before the answer's first `await`
(`host/web-js/ts-fetch.js`), so a source cannot ask for a ticket and then open the socket with
it. The React app's browser has its cookie and needs none. Here a few tickets are kept ready
(`stockTickets` in data/api.ts): asked for at sign-in and whenever a page opens sockets or one is
lost, by `socketTickets` in views/transport.contract. A socket asked for when none is ready is
`lost`, and its view follows it again a moment later.

**A data source has no clock and cannot see the page's address.** `Date.now()` is refused and
`location` is hidden from the data module. A ticket's age is counted in rounds of a one-minute
task (`socketRound`), and a socket that answers no ping for two rounds of the 30 s ping task is
closed, where the React client times both (`packages/client/src/follow.ts`). Whether the app is
served by the deployment itself is found out by asking `/api/me` with no token, which only the
browser's own cookie can answer (`byCookie`).

**An ended socket is followed again on a timer, with no backoff.** Exact does not ask a stream's
resource again when it ends. The chat (`task mend`, every second) and the Dood and the feed
(`healPulse`, every 5 s) ask again while theirs is `lost`; the React client backs off
(`reconnectDelay`) and shares one socket per Dood between its chat and its events, where here the
chat and the Dood's changes are a socket each.

**Exact knows no path prefix, so the app served at `/x/` runs at the React app's addresses.**
Exact's router matches a route against the whole `location.pathname` (`host/web-js/router.js`),
and its deploy anchors locations at `/`. A build served under `/x/` loads its files there
(`<base href="/x/">`), but its pages have to be at `/a/…`, the React app's addresses. So `/x/`
sets a cookie that picks the Exact app and sends the browser to the page's own address, which the
server then answers with the Exact app (apps/web/src/server/exact-app.ts) until `/x/off`.

## Type and colour

**Fonts are TTF, from Geist's own release.** Exact's `font` takes TTF or OTF and refuses WOFF2
(`lower-font-format`), and the React app's fonts come from `@fontsource-variable/geist`, which
ships WOFF2 only. `assets/fonts/` has the variable TTFs from vercel/geist-font v1.9.2 (OFL), the
same design. Inter, the React app's fallback, is not bundled.

**Tokens are not CSS variables at run time.** A token in a literal attribute, even inside a
shorthand (`border-right="1px solid var(--hairline)"`), is resolved at build; one in a string
made at run time is not, so a colour cannot be mixed from a Dood's own colour and a token in the
view (`color-mix(in oklch, ${color}, var(--shade) 32%)` draws nothing, and with a literal
colour in place of the token the build warns that it stays the same in dark mode). The React app deepens a Dood's colour into
`--primary`; here the composer's Send and other filled buttons keep the default `primary`, and
the placeholder face draws no words on the Dood's colour.

**Markdown's paragraph spacing is Exact's.** The React app's prose has its own margins
(`styles.css`, the assistant prose rules); a `text markup="markdown"` takes `font-size` and
`line-height` but not the spacing between its blocks, which is a line here against about two
thirds of one in the React app.

## Navigation

**Back after a reload adds to the history.** A deep link (or a reload) opens with the page's
parents put under it, which were never in the browser's history, so the app's Back from such a
page pushes the parent instead of going back. The React app's Back is the browser's alone.
Within a session Back and Forward follow the browser's history.

**Browser history cannot be stepped in a test.** `tap "app" history 1` works in a drive and
is a syntax error in a `.test.contract`, so Forward is checked by drive only (PORTING.md).

## A Dood as a creature

**The flight from the island is the sky's own.** welcome/stage.ts moves the creature's canvas
from the island to the chat's picture of it with a CSS transition. The first run's creature is
inside `do-sky`'s shadow DOM, not a Contract node, so Exact's `sharedElement` flight cannot carry
it: `do-sky`'s `fly` finds the target by its test id, waits for it to stop moving and moves its
own picture there on Exact's clock (modules/web/README.md). The page's picture is hidden by
`welcome.contract` until the sky says `flown`.

**A sleeping creature is woken only by what the app sees.** use-mascot-mood.ts lets it doze
after four quiet minutes and wakes it on any pointer move, key, wheel or press on the window.
Exact hands a view no window-wide pointer, so here the quiet is broken by what the app itself
sees change: the draft, the chat's messages and work, the end of a run, another Dood opened.

**What a chat's last `send` was is not in the view's chat.** `chatMood`'s rule that a Dood that
has said its last word and only finishes up is idle reads the `send` tool, which data/chat.ts
leaves out of the blocks it hands the view; here such a Dood shows the work it is finishing.

**A pat reaches the creature petted, not every drawing of it.** The React app's `petMascot`
leans every moving picture of the agent (panel, pill, sidebar) into a hand on any one of them.
Each `do-creature` here is its own view; the others are told nothing.

**The box's Wear it is the app's colour, not the Dood's.** box-window.tsx's buttons take the
Dood's deepened colour as `--primary`; as under "Type and colour", a token cannot be mixed from a
colour known only at run time.

## Exact bugs worked around

**`exactTime()` fails the build of an app that draws Markdown.** The build renders the app once
under Bun to compile its Markdown, in a bundle that does not answer the reserved `exactTime`
source, so the call reaches `app.ts`, whose table has no `exactTime`: "sources[source] is not a
function". `app.ts` answers a source it does not have with a zero time, which only that render
asks for (PORTING.md, "Known problems").

## Web native views

The creature, wardrobe gift/tiles, island portrait and first-run sky now use the existing
three.js mascot through web native views, not a rewritten model. There is no Apple/Linux
implementation. The agent sees each labelled native tag and its props/events, but not its
shadow DOM or meshes, so canvas correctness needs screenshots. Page modules are served
unchanged: `modules/web/build.mjs` generates the committed local dependency bundle rather
than relying on npm or outside-folder imports in the browser. Exact's hatch clock drives
animation; the mascot package's deferred GPU-resource disposal and WebGL retry bookkeeping
still use its wall clock (no visible animation depends on it). Sky particles use its unseeded
randomness, so clock stepping controls their timing but does not promise pixel-identical
confetti on every launch. React's `AgentAvatar` overscans its span by 12%; `do-creature`
does too with `overscan="true"`, which DoodFace and Hatchling set. The first-run view includes the sky, fall and
hatch from `components/welcome/stage.ts`, and the flight from island to chat (`fly`, below
under "A Dood as a creature"). Petting emits `message="pet"`;
the Contract caller must apply server care limits and mutations, as React's creature care
does. If WebGL is unavailable, `do-creature` uses the protocol's plain SVG; it has no clothes,
seed-specific silhouette or egg, like React's stand-in. Rich message content is now implemented
separately below; PORTING.md's Native views section gives the integration recipe.

## Data-free gallery verification

Exact's `scripts/verify.mjs:1371` launches several web drives together for an app without a
server. With the required port 8766 pin they collide (`port 8766 (--port or EXACT_PORT) is in
use: another drive or program holds it`), even though no other process holds the port before
or after the command. The gallery is checked sequentially with `./x test web --size …` and
`./x agent web … "check both"` instead; the machine-wide lock and port policy are unchanged.
The root app's own verify is not affected: it has a server, and runs clean. No Exact patch was
made.


## Rich message content

`views/markdown.contract` and the web-only `do-markdown`, `do-code` and `do-mermaid` tags
render the React app's sanitized GFM, highlighted code, scrolling/copyable tables, GitHub
alerts, folding HTML and diagrams. Exact's `text markup="markdown"` reader leaves tables as
text and does not supply these controls; it is retained for simple prose. Rich messages stay
in one shadow DOM tree so selection crosses prose and code. The native content has natural
web layout height; no Apple/Linux implementation or native intrinsic sizing was added. The
Exact agent sees tags/props, not their text or buttons; the separate gallery's Playwright
probe tests those. A simple reply can change renderer once richer syntax arrives, which may
lose a selection over that change. The real chat has not been wired while another branch
rewrites it; the exact `MessageText` call is in `modules/web/README.md`.

React's `components/chat/markdown.tsx` resolves library links and images using the chat's
library query, previews local CSV/TSV, opens files beside the chat, refreshes expired view
URLs, and uses the full multi-picture viewer with download. This presentation-only piece
accepts a caller-resolved `files` prop and emits `file:<id-or-path>`, renders known image
URLs and browser video/audio controls, and otherwise shows alt text. It does not fetch the
library, preview CSV/TSV, refresh authorization, open a side panel, or provide the picture
viewer. A figure opens in a new tab and emits `image:<url>`. The chat/library owner must
supply browser-loadable URLs and consume file events; no bearer secret belongs in props.
Attachments that are separate message blocks remain that screen's responsibility.

Remote pictures/media wait for Show, as in React, but there is no persistent Always from
this host permission yet. Responsive raw-HTML `<source srcset>` is skipped because it could
make a request around that gate. Failed pictures show their words. Raw HTML uses the exact
React sanitizer, not unrestricted innerHTML; only strict Mermaid's own sanitized SVG is
inserted as markup. Alerts have their kind/title/color but not the React icon set, and fonts
inherit the host rather than shipping React's Geist fonts. Code over 80,000 characters and
unknown languages remain plain, as in React. There is no math renderer or custom mention
widget in the React reference either: math delimiters and @names remain text.
## Composer and other chats

**Files use Exact's pick, paste and drop support, with a 16 MiB read ceiling.** React's
`chat/composer.tsx` sends browser `File`s directly; here `input type="file"` produces picked
paths, and clipboard/drop handlers produce `doc:` paths. `data/composer.ts` reads their bytes
and uploads to the same library endpoint. Exact's `readFile` result is limited to 16 MiB;
a larger file reports an attachment error and leaves the draft alone. Images use Exact's
JPEG compressor at the same 1568-pixel limit and per-message budget instead of React's
canvas quality ladder. Interactive file drives need `--storage`; authored tests already have
it. No native file hatch or Exact patch was needed.

**The picture preview is a simple dialog.** Attached pictures open large and close with the
button or Escape. React's shared `PictureViewer` also has gallery navigation, zoom and swipe;
those gestures are not ported in this composer dialog.

**The microphone is a web native view.** `do-dictation` in `modules/web/dictation.js` reaches
`getUserMedia`, `MediaRecorder` and an analyser. Contract owns the recording controls and
sends the audio through `data/composer.ts` to the unchanged `/api/transcribe`. The waveform
uses Exact's hatch clock. Cancelling or leaving the chat releases the microphone and ignores
a late answer. The test deployment has no transcription model key, so recording, cancellation
and the server's transcription refusal are tested; successful recognition needs a configured
deployment. There is no implementation for native hosts, nor a live voice-call button here
(the React composer gets that button from `components/call/call.tsx`).

**Other chats open from a small menu above the composer.** React places old side chats in the
Dood's pill menu, and agent/Slack threads in its panel; here `views/threads.contract` groups
old side chats, other Doods, Slack and sub-agents under “Other chats”. All use the same
`/a/:agentId/c/:chatId` route and are read-only, with Main chat/parent links, status, Stop and
the Slack address. This React version has no new-side-chat, rename or delete controls, and no
slash-command or mention menu: `chat/commands.tsx` is background shell commands, not slash
commands. Their running count, last output and Stop live above this composer's box; transcript
chips and their notices remain the transcript area's responsibility. Team typing indicators,
the programmatically given initial cursor, gallery gestures and the live call button have not
been ported by this area. Model choices use a searchable menu with arrow keys, Enter and Escape
instead of React's combobox; model/thinking settings are the Dood's saved settings. The
computer-kind picker is not part of React's composer and remains with computer/settings pages.

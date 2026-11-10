# Where this app differs from the React app, and why

What Exact cannot do yet, what this app does instead, and the few differences that were decided
rather than forced. One paragraph each, by area: what, where in the React app, what was done
instead. PORTING.md says how the app is built; README.md what it covers.

## Decisions

**Filled buttons are the app's teal, whichever Dood is open.** The React app deepens the open
Dood's colour into `--primary` (`styles.css`, `--agent-color`), so a Dood's Send, Save and Wear it
are in its colour. Here every filled button, switch and focus ring is `app.tamber`'s `primary`,
the default agent teal, on every page: a decision of the owner's, not a limit. A Dood's colour is
on its creature, its face everywhere it is drawn, and its profile's colour choice.

**A Dood is renamed, moved and deleted from its profile.** The React app's sidebar menu has the
Dood's pages (Library, Automations, Settings) and so does this one's; renaming, moving to
another workspace and deleting (with or without the computers only it used) are in the
profile, as there. The menu here also has Move up and Move down (see "The shell").

## The shell

**The sidebar is beside the page from 900 px, not 768.** Exact's web host splits a stack's
first route from its detail at 900 px (`navigationSplit`); the React app puts the sidebar
beside the page from `48rem` (`SIDEBAR_BESIDE` in `components/shell/app-shell.tsx`). Between
the two this app is a phone's stack.

**On a phone the list is a screen, not a drawer.** The React app's phone keeps the chat on
screen and pulls the sidebar over it from the left edge (`usePulledSidebar`). Here the list is
the stack's first screen and a Dood's chat is pushed over it, with the way back at the top
left where the React app's sidebar button is.

**The sidebar does not fold to a rail of faces or resize.** The React app's wide sidebar can be
a column of faces, and is dragged to any width from 208 to 448 px (`ResizeHandle`,
`sidebarColumn`). Exact's split column has one width, `navigationSplit="288"` (the React app's
starting width), and no way to drag it.

**A pages menu opens from the pill's start, not its middle.** The React app centres the Dood's
menu under its name (`align="center"`); an Exact popover is placed by the platform under the
button that opens it.

**Hover reveals nothing.** Exact's `:hover` paints a box and cannot show a child. So what the
React app shows under a pointer is always shown: a sidebar row's menu (at the row's end, in its
shade, with its drag grip in a wide window), a file card's download, a visual's corner button.

**A phone reorders with Move up and Move down.** A mouse drags a row's grip in a wide window
(Exact's `reorderFor`), and the order is kept by the deployment as the React app's is. A finger
dragging at 390x844 did not change the order in the test driver, so a phone's row menu has Move
up and Move down instead, on the same API; the grip is only shown in a wide window. A real touch
screen was not tried.

**Who is where is known for the team on screen.** As in the React app (`useHere`), one team's
presence socket is followed: the open Dood's, or the workspace page's. The sidebar's other
teams show nobody.

## Transport

**A stream opens before its answer awaits anything, so socket tickets are kept ready.** On the
web, Exact starts a stream only as its answer is asked, before the answer's first `await`
(`host/web-js/ts-fetch.js`), so a source cannot ask for a ticket and then open the socket with
it. The React app's browser has its cookie and needs none. Here a few tickets are kept ready
(`stockTickets` in data/api.ts): asked for at sign-in and whenever a page opens sockets or one is
lost, by `socketTickets` in views/transport.contract. A socket asked for when none is ready is
`lost`, and its view follows it again a moment later. Served by the deployment itself the
session is the browser's cookie and no ticket is needed (`byCookie`); no request then carries a
bearer, which the server would answer by dropping the cookie.

**A data source has no clock and cannot see the page's address.** `Date.now()` is refused and
`location` is hidden from the data module. A ticket's age is counted in rounds of a one-minute
task (`socketRound`), and a socket that answers no ping for two rounds of the 30 s ping task is
closed, where the React client times both (`packages/client/src/follow.ts`). Whether the app is
served by the deployment itself is found out by asking `/api/me` with no token (`byCookie`). A
library card says "Nov 10, 4:59 AM" where the React app says "4:59 AM" for today.

**An ended socket is followed again on a timer, with no backoff.** Exact does not ask a stream's
resource again when it ends. The chat (`task mend`, every second), the Dood, the feed, the
library and the team's presence (every 5 s) ask again while theirs is `lost`; the React client
backs off (`reconnectDelay`) and shares one socket per Dood between its chat and its events,
where here the chat and the Dood's changes are a socket each. What changes on the Dood is
counted on the shell's socket (`followDood`, `data/chat-asks.ts`) and the chat's, the tools'
and the library's resources are asked again `with` their count, where the React app refetches
what an event names (`refreshAgent`).

**Exact knows no path prefix, so the app served at `/x/` runs at the React app's addresses.**
Exact's router matches a route against the whole `location.pathname`, and its deploy anchors
locations at `/`. A build served under `/x/` loads its files there (`<base href="/x/">`), but its
pages have to be at `/a/…`. So `/x/` sets a cookie that picks the Exact app and sends the
browser to the page's own address, which the server then answers with the Exact app
(apps/web/src/server/exact-app.ts) until `/x/off`.

## Navigation

**Back after a reload adds to the history.** A deep link (or a reload) opens with the page's
parents put under it, which were never in the browser's history, so the app's Back from such a
page pushes the parent instead of going back. Within a session Back and Forward follow the
browser's history.

**Browser history cannot be stepped in a test.** `tap "app" history 1` works in a drive and
is refused in a `.test.contract`, so Forward is checked by drive only.

## Chat transcript

**Visuals run in Exact's `iframe`, which speaks only in strings.** The React app's frame
(`components/chat/visual.tsx`) and this one have the same sandbox and load the same session-free
library view, with its colours in the fragment. Exact's frame posts a string, and a visual's
page reads objects, so nothing can be told to the page after it loads: not a change between
light and dark (it follows the device's own), not being shown large, and no answer to what it
asks (opening a link, putting words in the composer, saving a file). What the page says arrives
as its JSON's text and is read for its height, which the frame follows, and a script's failure,
which offers "Tell …". The React app also checks that a request came from a press in the frame
(`lib/pressed.ts`), keeps a page's height per width (`lib/visual-heights.ts`), loads a frame far
up the chat only when near (`loading="lazy"`) and offers sharing the page; none of these are
here. "Open beside the chat" is the library page's link.

**MCP apps are not shown.** A connector's page for one of its tools (`mcp-app.tsx`) is served
under `/api`, which needs the session, and is driven by a JSON-RPC host over object messages.
Exact's frame can send neither a bearer header nor an object, so the chat says whose page it is
and that the web app shows it. A web native view that builds its own frame would do it.

**Pictures that need the session are not shown.** An `image` cannot send the bearer token. A file
the Dood sends is shown and downloaded from the session-free view address, but the pictures kept
of each step on a screen or in a browser (`shots/<id>`) and the live view of a screen in use
(`uses.tsx`) are behind the session. A use is a line ("Juniper used MacBook's screen · 4 steps")
that unfolds to its steps in words. Pausing and stopping a use from its window are not here.

**The transcript keeps to its end itself.** A `list`'s `scrollFollowEnd` follows rows as they
arrive, but rich message text takes its height a moment after its row is laid out, which the
list does not see. So while the reader follows, the chat scrolls to the last row after each
change, as the React app's MessageScroller watches the content's size.

**A picture in a message opens on its own.** A picture in a message, a file's preview and a
figure in Markdown open in `LibraryPictureViewer` with that picture alone; the React app's
transcript does not open them large at all.

**The working line breathes instead of shining.** The React app sweeps a light band across
"Thinking…" (`animate-shine`, a gradient clipped to the text), which Exact cannot draw; here
the words fade and return on the same two-second beat, and stand still for reduced motion.

**The panel has fewer sections.** The React panel lists what runs in the background, sub-agents
at work, chats from other Doods and from Slack, and files shared in the chat
(`components/chat/agent-panel.tsx`). Here running commands are over the composer and the other
chats are in its "Other chats" menu (views/composer-jobs.contract, views/threads.contract); the
files of a chat are its cards in the transcript, with no list of their own. The panel has the
creature, what is pinned, the Dood's computers and, in a team, who is here now.

## Rich message content

**Markdown, code and diagrams are web native views.** `do-markdown`, `do-code` and
`do-mermaid` (`modules/web/`) draw the React app's sanitized GFM, highlighted code, tables,
alerts with their icons, folding HTML and diagrams, in Geist and Geist Mono, for messages and the
library's documents. They exist on the web only. The test driver sees their tags and props, not
the text and buttons inside them (`tests/markdown-gallery` checks those with Playwright). A plain
reply is Exact's own `text markup="markdown"` until richer syntax arrives, when it changes
renderer, which can lose a selection made across that change.

**What the React renderer fetches itself is given to this one.** React's
`components/chat/markdown.tsx` asks the library for what a message links to, previews a linked
CSV or TSV in place, and refreshes an expired view address. Here the caller hands the view its
files (`chatLibraryLinks`, `libraryLinks`), a press on one is said back to the view
(`file:`/`image:`), and a linked table is a link. Raw HTML's `<source srcset>` is skipped, since
it could load a picture around the remote-picture question.

## Composer and other chats

**Files are read with Exact's pick, paste and drop, up to 16 MiB.** React's `chat/composer.tsx`
sends the browser's `File`s; here a picked, pasted or dropped file's bytes are read
(`data/composer.ts`) and uploaded to the same library endpoint. Exact's `readFile` stops at
16 MiB, so a larger file is refused in words and the draft kept. Pictures are made smaller with
Exact's JPEG compressor at the same 1568-pixel limit instead of React's quality ladder.

**An attached picture opens large without zoom or swipe.** The dialog steps through the attached
pictures with its buttons and the arrow keys; React's `PictureViewer` also zooms and swipes.

**The microphone is a web native view.** `do-dictation` (`modules/web/dictation.js`) records with
`getUserMedia` and `MediaRecorder`; Contract has the controls and `data/composer.ts` sends the
audio to `/api/transcribe`. No native host has it. The test server has no transcription model,
so a successful transcription is untested.

**Other chats open from a menu over the composer.** React puts old side chats in the pill's menu
and other Doods', Slack's and sub-agents' chats in the panel; here "Other chats" over the
composer has them all, on the same `/a/:agentId/c/:chatId` addresses. Words put in the box
from elsewhere get the cursor, but Contract's `focus` cannot put it at their end, as React's
`setSelectionRange` does.

## A Dood as a creature

**The flight from the island is the sky's own.** The first run's creature is inside `do-sky`'s
shadow DOM, not a Contract node, so Exact's `sharedElement` flight cannot carry it: `do-sky`'s
`fly` finds the chat's picture by its test id, waits for it to settle and moves its own picture
there on Exact's clock (modules/web/README.md). The page's picture shows when the sky says
`flown`.

**A sleeping creature is woken only by what the app sees.** use-mascot-mood.ts wakes it on any
pointer move, key, wheel or press on the window. Exact hands a view no window-wide pointer, so
here what wakes it is the draft, the chat's messages and work, the end of a run, another Dood
opened.

**A pat reaches the creature petted, not every drawing of it.** The React app's `petMascot`
leans every moving picture of the Dood (panel, pill, sidebar) into a hand on any one of them.
Each `do-creature` here is its own view; the others are told nothing.

**The placeholder face draws no initial on the Dood's colour.** A token in a string made at run
time is not resolved (`color-mix(in oklch, ${color}, var(--shade) 32%)` draws nothing), so a
colour cannot be mixed from a Dood's own colour and a token in the view. Where WebGL is missing,
`do-creature` draws the protocol's flat SVG, as React's stand-in does.

## Settings

**Settings are routes drawn as the settings window's card, not a dialog over the page.** The
React app opens every setting as a section of one dialog, 56rem across, over whatever page is
showing (`components/settings/settings-dialog.tsx`). Exact's modal route is at most 35rem across
(`host/web/neutral.css`), too narrow for the sections beside a section, and a `fullscreen` route
hides the page under it. So each section is a route of its own (`/a/:id/profile`, `/settings`,
`/w/:id/models`, …) drawn in the content area as the dialog's card, with a cross back to the
page it was opened from; on a phone the list, then a section, as the React dialog does there.

**Settings have addresses, not a `?settings=` query.** The React app says which section is open
in the query of the page under it (`lib/settings.ts`). Here a Dood's sections are under it, the
person's own under `/settings`, a workspace's under `/w/:id`. Back and reload work on each.

**Choices are menus, not selects.** A browser's `select` takes none of the app's colours (the
build says so of `app.tamber`'s accent), and the React app's Select is a menu of its own, so
every choice of one is `views/select.contract`'s `Select`: a button that drops a menu.

**A sentence with a link in it is a row of runs, or Markdown.** A `text` paragraph holds only
text runs and images (`lower-leaf-children`), so "…under Models in the workspace's settings"
is a wrapping row of a text, a link and a text, or, on Global models, Markdown.

**Web push works through a service worker the page module registers under `/modules/`.** A data
module cannot reach `navigator.serviceWorker`, and a web build serves only what it builds plus
`modules/web/`. `do-push` (`modules/web/push.js`) registers `push-worker.js` with the scope
`/modules/`, asks the browser, subscribes with the server's key and hands the subscription to
the view, which sends it with the session. A click on a notification loads the page's address
(the worker does not control the page); a replaced subscription is sent again when
Notifications is opened, not by the worker, which has no session; a subscribed browser
registers again when Notifications is opened rather than at every launch. Headless Chrome
cannot deliver a push, so the tests check the page's state.

**A model sign-in is asked after every second, not held open.** The React app waits on a request
the server holds until the sign-in changes (`modelLogin(id, { rev, waitMs })`); a resource that
is always waiting keeps a test's `clock data` from settling.

**The password and card checks are said again in `data/settings-passwords.ts`.** Exact refuses a
data module that imports a file mentioning `Date.now()` or `new Date()` (`analyze-ambient-api`),
and `packages/protocol/src/passwords-typed.ts` does. Its `loginToSend`, `withSite`,
`cardToSend`, `cardWords` and `cardTrouble` are repeated there with the month passed in; keep
the two the same.

**Secrets typed into settings are states that are never kept.** A key, a password or a card's
number lives in a state without `persist`, reaches the data module only as a mutation's
arguments, and is emptied once sent. A card's number is a plain field, as in the React app, so
a drive's tree shows it while it is typed.

**What is checked by drive, not by test.** The account menu has Settings and Sign out, without
the name and email over them (text in that menu makes the build warn of the sidebar's list on
iOS, `lower-list-beside-fixed`). A Dood's Voice shows only where calls can be made, which the
test server cannot. Global models and the waiting list are for whoever looks after the
deployment, which an account made on an open server never is: they were checked with
`DC_SIGNUP=waitlist DC_ADMIN_EMAILS=… ./x agent web …`.

## Teams

**The waiting list's own first run is not here.** A waiting account gets an explanation, Check
again and Sign out; React also lets it hatch and pet its first Dood
(`components/settings/waitlist.tsx`). The shell's sources still ask for a waiting session's
workspaces and Doods, which the server refuses with 403. The test server forces
`DC_SIGNUP=open`, so invitation-only sign-up and admission are checked by drive only, as are
an email inbox invitation (it needs a verified email) and GitHub sign-in.

**Share links are the deployment's.** An invitation's link to pass on is the absolute address
the deployment returns, for the React app; View invitation in this app is its own `/invite/:id`.

**The test driver can keep two sidebar targets of one name.** After crossing routes or accounts,
a workspace's or a Dood's menu can be in the tree twice. The tests that cross accounts reload
before using the sidebar.

## Skills, connectors, computers and automations

**A connector's sign-in is a step in the same window.** React opens a popup
(`components/settings/connectors.tsx`); here "Continue sign-in" goes there in this window, and
the service returns to the app, which finishes under its session and takes the code out of the
address. Exact's native OAuth session is not wired. `tools/tools-check.mjs` checks this against a
local MCP OAuth service in both hostings, not against real Composio or Slack accounts.

**Slack's bot picture is made by a web native view.** `modules/web/connectors-picture.js` draws
the 1024 px PNG with the bundled mascot. Other hosts say so instead of offering Download.

**"This computer" is the desktop app's.** As in a plain browser running the React app, nothing
here starts or configures the Electron app's own daemon; the install commands, pairing, update,
removal and diagnostics work through the API. Installing a real daemon was not tried.

**A computer's install command wraps.** React's scrolls sideways on one line beside its copy
button; here it wraps, since a phone or the largest text has no room for it and the checks
count a line that runs under its button.

## Library, pins and sharing

**Documents are edited in a textarea.** Reading, editing, split view, autosave, conflicts and
reverting use Contract state and the real library API; `library-format.js` applies the toolbar to
the textarea's selection. There is no scroll syncing or syntax colouring while editing. A phone's
split shows the editor, and Read shows the document.

**A document over the chat is a fixed panel.** React's opens beside the chat and is dragged to a
width (`docPanelColumn`); here it is 26rem over the chat's end in a wide window and the whole
screen on a phone.

**A pinned page's preview keeps its own colours.** The full page viewer tells a page the app's
light or dark (`library-frame.js`); the small preview on the shelf is a plain frame and is not
told.

**Downloads, uploads and shares lean on the browser.** Contract's `download` cannot name a file
made from fetched bytes, so `library-download.js` makes a Blob address in a web native button.
Uploads use Exact's file picker. Shared addresses are the deployment's `/s/:siteId` pages,
including its own sign-in for restricted links. All three are web only.

## Native views and verification

**Every native view is web only.** The creature, wardrobe, island, sky, Markdown, code,
diagrams, dictation, push, library frame and downloads are `modules/web/` views with no Apple or
Linux implementation. The mascot uses the existing three.js package through a bundle that
`modules/web/build.mjs` makes, on Exact's hatch clock; its GPU clean-up and WebGL retries still
use the package's own clock, and its sky's sparkles are not seeded, so a screenshot can differ
in them from one run to the next.

**`exactTime()` fails the build of an app that draws Markdown.** The build renders the app once
under Bun to compile its Markdown, in a bundle that does not answer the reserved `exactTime`
source, so the call reaches `app.ts`: "sources[source] is not a function". `app.ts` answers a
source it does not have with a zero time, which only that render asks for.

**A gallery without a server races its own ports in verify.** Exact's `scripts/verify.mjs`
starts several web drives at once for an app with no server; pinned to one port they collide.
`tests/creature-gallery` and `tests/markdown-gallery` are checked one size at a time with
`./x test web --size …` and `./x agent web … "check both"`. The root app's `./x verify` gives its
drives ports of a range of their own, trusted by the test server.

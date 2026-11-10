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

## Chat transcript

**Visuals run in Exact's `iframe`, which speaks only in strings.** The React app's frame
(`components/chat/visual.tsx`) and this one have the same sandbox, `allow-scripts allow-popups
allow-forms allow-modals` without `allow-same-origin`, and load the same address, the library's
session-free view (`/d/<agent>/<view>/<path>`), with its colours in the fragment. What Exact's
frame cannot do: `postMessage(text, id)` posts a string, and a visual's page (and an MCP app's)
reads objects, so nothing can be told to the page after it loads: not a change between light and
dark (it follows the device's own, which the app follows too), not being shown large
(fullscreen), and no answer to what it asks (opening a link, putting words in the composer,
saving a file), so those requests are left unanswered. What the page says arrives as its JSON's
text (`message=`), read in `chat-frames.contract` by searching the text: its height, which the
frame follows, and a script's failure, which offers "Tell …" as the React app does. The React app
also checks that a request came from the person's own press in the frame (`lib/pressed.ts`), keeps
the height a page took per width so it opens at it next time (`lib/visual-heights.ts`), loads a
frame far up the chat only when it is scrolled near (`loading="lazy"`), and offers sharing the page
from its corner; none of these are here. "Open beside the chat" is the library page's link.

**MCP apps are not shown.** A connector's page for one of its tools (`mcp-app.tsx`) is served
under `/api`, which needs the session, and is driven by a JSON-RPC host
(`lib/mcp-app-host.ts`: initialize, tool calls with the person's consent, resource reads) over
object messages. Exact's frame can send neither a bearer header nor an object, so the chat says
whose page it is and that the web app shows it. A web native view that builds its own frame
would do it.

**Pictures that need the session are not shown.** An `image` here cannot send the bearer token (served by the deployment itself, the app has the cookie, but the tests and `./x` run it from its own origin).
A file the Dood sends is shown, and downloaded, from the session-free view address; but the
pictures kept of each step on a screen or in a browser (`shots/<id>`), and the live view of a
screen while the Dood uses it (`uses.tsx`, `lib/use-live-view.ts`), are behind the session. A
use is a line, "Juniper used MacBook's screen · 4 steps", that unfolds to its steps in words; while
it goes, it is the step under way. Pausing and stopping a use from its window are not here.

**What changed on the Dood is counted for the chat on the shell's socket.** The React app
refetches what an agent event names (`refreshAgent` in `lib/collections.ts`). Here the shell's
`followDood` counts each kind (`data/chat-asks.ts`), and the chat's resources, the approvals of
permissions.contract, the composer's jobs, the threads and the library's listing, pins and sites
on a chat page are asked again `with` their count. A socket of the chat's own for these would be a
third to the same Dood. (The library page still follows its own, `followLibrary`.)

**The transcript keeps to its end itself.** A `list`'s `scrollFollowEnd` follows rows as they
arrive, but rich message text (markdown.contract's `do-markdown`) takes its height a moment after
its row is laid out, which the list does not see. So the chat keeps to the end too: after each
change it scrolls to the last row, while it is `following`, which only the reader's wheel, drag or
keys turn off (a list that moves by itself as rows are measured is not the reader). The React app's
MessageScroller watches the content's size for the same reason.

**A picture opens in the library's viewer, one at a time.** A picture in a message, a file's
preview and a figure in Markdown (`image:`) open in `LibraryPictureViewer`, mounted once at the
root (its dialog has a fixed id), with that picture alone; the React app's transcript does not
open pictures large at all, and its composer's viewer steps through every attached one.

**Hover reveals nothing.** Exact's `:hover` paints a box itself and cannot show a child, so a
file card's download and a visual's corner button are always shown, as the React app shows them
under a finger.

**The working line does not shine.** The React app sweeps a highlight across "Thinking…"
(`animate-shine`); here it is still, beside the Dood's working face. "Delivered" leaves after
three seconds without fading.

**Who else is here, and typing.** A team's presence and "Ada is typing…" come over the person's
own socket in the React app (`useHere`, `noteTyping`). This app has live personal-feed and
Dood sockets, but has not wired team presence or outgoing typing notifications into them.
Calls are now in views/call.contract. The first-run starters are in views/welcome.contract.

**Earlier messages** ("Show earlier messages") are loaded a page at a time from
`/chats/:id/history`, after the chat was started fresh from the Dood's Memory settings
(`chat-transcript.test.contract` does so). `tools/chat-earlier.sh` drives the same against a
server it fills over the API.

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
The root app has a server. Its wrapper gives verify's concurrent initial page drives separate
ports in a slot-specific range, with those origins trusted by the empty local test server;
a fixed `EXACT_PORT` otherwise makes one initial viewport fail to start. No Exact patch was
made.


## Teams and sidebar

**Live people are not wired yet.** The people list shows membership and roles, and the sidebar
keeps its existing unread, working and asking marks. React also draws who is with a Dood and
who is here (`components/shell/agent-list.tsx`, `components/people.tsx`). This client
uses the merged personal WebSocket feed for live Dood rows, but does not open a second
team-presence connection. Initials or account images stand for members; the public invitation
preview lists their names, not React's row of faces.

**The waiting-list flow is partial.** Deployment admins use the merged Settings → Waiting
list to read/admit people; the duplicate workspace waitlist and its data source were removed.
A waiting account gets an explanation, Check again and Sign out. React also lets it
hatch and pet its first Dood (the welcome stage and `components/settings/waitlist.tsx`). The
normal first run now has that egg and care; the waiting-account version is not added here.
Existing shell sources still request the admitted-user workspaces/Doods APIs for a waiting
session; those APIs return 403. Their waiting-state gating remains deployment-mode integration
work. The local test server forces `DC_SIGNUP=open`, so invitation-only sign-up, waiting-account
admission and admin-only waitlist controls still need deployment-mode integration tests. Normal signed-out preview, sign-up, acceptance and Not now are covered
against the real server. An email inbox invitation belongs only to an email-verified account;
verified inbox dismissal and GitHub sign-in need accounts the local password-only harness
does not supply. Not now treats only the server's expected 404 as leaving a public link alone;
other failures remain visible.

**Moving is a dialog, deleting keeps computers.** Reorder is native within one workspace;
Move to a workspace confirms the sharing implications separately. The sidebar's typed-name
Delete removes the Dood but always keeps computers. React's full deletion dialog can also offer
to remove eligible computers. There is no such destructive option in this sidebar port.

**Teams use the merged settings window.** The kit from `exact-client` replaces the copied
snapshot. Workspaces → a team opens People beside its section list on a wide window, or the
list alone on a phone. People, Computers, Models and (where enabled) Passwords are separate
sections; New team is available from Workspaces and the sidebar. Workspace computers remains
an explicit placeholder, matching the unported computer-management area. Public share links
remain the canonical absolute URLs returned by the deployment; View invitation uses the
relative Exact route. See Settings below for the address-versus-query difference.

**The driver can retain duplicate sidebar targets after crossing routes or accounts.** A
workspace menu or Dood menu can have two nodes with its same label and ID, even after settling.
The cross-route and multi-user tests reload before acting on the affected sidebar. Shared
sign-out/navigation is left unchanged as requested; this should be investigated when
integrating the areas. Dood action menus are explicitly hidden before opening a dialog
or changing row order, so a virtualized row is not held by an open popover after it moves.

**Phone reorder uses Move up / Move down.** Native mouse drag is tested and persists after
reload, including clearing the override with Sort by latest. Finger-driven reorder at 390×844
did not change the stored order, even with a held press and the list scrolled up. Its cause is
not established. The grip is therefore offered only in the wide layout; phones keep the
explicit Move up / Move down actions, which use the same persisted order API. The regression
test covers that phone alternative rather than claiming touch drag works. Wide touch screens
still need a real-device check.

## Rich message content

`views/markdown.contract` and the web-only `do-markdown`, `do-code` and `do-mermaid` tags
render the React app's sanitized GFM, highlighted code, scrolling/copyable tables, GitHub
alerts, folding HTML and diagrams. Exact's `text markup="markdown"` reader leaves tables as
text and does not supply these controls; it is retained for simple prose. Rich messages stay
in one shadow DOM tree so selection crosses prose and code. The native content has natural
web layout height; no Apple/Linux implementation or native intrinsic sizing was added. The
Exact agent sees tags/props, not their text or buttons; the separate gallery's Playwright
probe tests those. A simple reply can change renderer once richer syntax arrives, which may
lose a selection over that change. The real transcript now calls `MessageText` in
`views/chat-rows.contract`; `chatLibraryLinks` resolves its files and `markdownSaid` handles
file and image presses, opening the library panel or the root picture viewer.

React's `components/chat/markdown.tsx` resolves library links and images using the chat's
library query, previews local CSV/TSV, opens files beside the chat, refreshes expired view
URLs, and uses the full multi-picture viewer with download. This presentation-only piece
accepts a caller-resolved `files` prop and emits `file:<id-or-path>`, renders known image
URLs and browser video/audio controls, and otherwise shows alt text. It does not fetch the
library, preview CSV/TSV, refresh authorization, open a side panel, or provide the picture
viewer itself. It emits `image:<url>` for a figure. The integrated chat supplies browser-loadable
URLs and consumes file/image events; no bearer secret belongs in props.
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
deployment. There is no implementation for native hosts. The live call button now comes from views/call.contract.

**Other chats open from a small menu above the composer.** React places old side chats in the
Dood's pill menu, and agent/Slack threads in its panel; here `views/threads.contract` groups
old side chats, other Doods, Slack and sub-agents under “Other chats”. All use the same
`/a/:agentId/c/:chatId` route and are read-only, with Main chat/parent links, status, Stop and
the Slack address. This React version has no new-side-chat, rename or delete controls, and no
slash-command or mention menu: `chat/commands.tsx` is background shell commands, not slash
commands. Their running count, last output and Stop live above this composer's box; transcript
chips and their notices remain the transcript area's responsibility. Team typing indicators,
the programmatically given initial cursor and gallery gestures have not
been ported by this area. Model choices use a searchable menu with arrow keys, Enter and Escape
instead of React's combobox; model/thinking settings are the Dood's saved settings. The
computer-kind picker is not part of React's composer and remains with computer/settings pages.
## Settings

**Settings are routes drawn as the settings window's card, beside the sidebar, not a dialog over
the page.** The React app opens every setting as a section of one dialog over whatever page is
showing (`components/settings/settings-dialog.tsx`): 56rem across, its sections listed down its
side, the page dimmed under it. Exact's web host does draw a modal route
(`navigationPresentation="modal"`) as a dialog over the page under it, but at most 35rem across
(`host/web/neutral.css`, `width: min(35rem, …) !important`, which an authored width does not
beat), too narrow for the list of sections beside a section; a `fullscreen` route hides the page
under it. So each section is a route at an address of its own (`/a/:id/profile`, `/settings`,
`/w/:id/models`, …) drawn in the content area as the dialog's card: the list of sections
beside the open one, the open one washed, a cross that goes back to the page (a Dood's chat, or
the page the person's own settings were opened from). A Dood's keep its pill over them. On a
phone the React dialog fills the screen and shows the list, then a section with the way back to
the list; so does this, the list and the section being routes. `views/settings-kit.contract`
is the frame and its pieces, which every settings page uses.

**Settings have addresses, not a `?settings=` query.** The React app says which section is open
in the query of whatever page is under it (`lib/settings.ts`), and redirects the old
`/a/:id/profile`, `/permissions` and `/settings` to it. Here a section is a route: a Dood's are
under it (`settings` is the list of its sections, which the React app's
`/a/:id/settings` sends to the person's General instead), the person's own are under
`/settings`, a workspace's under `/w/:id`. Back and reload work on each.

The shared `Workspace.secrets` now comes from `savedLogins` / `savedCards` on the server's
workspace summary, so the section list offers Passwords only where this person may use it.

**Web push works through a service worker the page module registers under `/modules/`.** A data
module cannot reach `navigator.serviceWorker` or `Notification`, and an Exact web build serves
only what it builds plus `modules/web/` (at `/modules/`). The `do-push` web native view
(`modules/web/push.js`) registers `modules/web/push-worker.js` with the scope `/modules/`
(checked on Exact's web host: it registers, and has a `pushManager`), asks the browser's leave,
subscribes with the server's key, and hands the subscription to the view, which sends it to the
server with the session. Push needs no wider scope, since the worker answers no requests. Two
things differ from the React app's `public/sw.js`: a click on a notification posts the page to
go to and the page loads that address (the worker does not control the page, so cannot steer it
in place), and a subscription the push service replaces (`pushsubscriptionchange`) is not sent
to the server, which is on another origin and takes a bearer the worker does not have; opening
Notifications sends it again. The React app also re-registers a subscribed browser at every
launch (`syncNotifications`); here that happens when Notifications is opened. Headless Chrome
cannot deliver a push, so the tests check the page's state, not a notification.

**A model sign-in is asked after every second, not held open.** The React app follows a sign-in
by a request the server holds until it changes (`modelLogin(id, { rev, waitMs })`). A resource
that is always waiting keeps a test's `clock data` from ever settling, so the sign-in window
asks again each second while it waits.

**The password and card checks are said again in `data/settings-passwords.ts`.** Exact refuses a
data module that imports a file mentioning `Date.now()` or `new Date()`, even as a default
parameter (`analyze-ambient-api`), and `packages/protocol/src/passwords-typed.ts` does. Its
`loginToSend`, `withSite`, `cardToSend`, `cardWords` and `cardTrouble` are repeated there with
the month passed in, using the protocol's `siteHost`, `cardDigits` and limits; keep the two the
same.

**Secrets typed into settings are states that are never kept.** A model provider's key, a
login's password and a card's number live in states without `persist`, reach the data module
only as a mutation's arguments, are never a resource's argument (whose answers Exact may keep),
and are emptied once sent or when the window closes. A password or a key is an
`input type="password"`, which Exact never shows in an agent's output. A card's number is a plain
field, as in the React app, so a drive's tree shows it while it is typed.

**A sentence with a link in it is a row of runs, or Markdown.** A `text` paragraph holds only
text runs and images (`lower-leaf-children`), so "…under Models in the workspace's settings"
is a wrapping row of a text, a link and a text (it breaks before the link on a phone), or, on
Global models, Markdown, whose link is the browser's blue.

**The Move to menu is a menu, not a select.** A `select` anywhere in the app makes the build
warn that the browser's select takes no `accent-color` (`tamber-unreachable`); the React app's
Select is a drop-down of its own anyway, so this is a button with a popover menu.

**What is not here.** The person's account (name, email, password, deleting it) has no page in
the React app either: its menu shows the name and email and signs out. The account menu here
has Settings and Sign out; the name and email over them are left out, since text in that menu
makes the build warn of the sidebar's list on iOS (`lower-list-beside-fixed`). Starting a team
("New team" under Workspaces) and answering an invitation (its View goes to `/invite/:id`,
which this app has no page for) are the teams area's. A Dood's Voice shows only where calls can
be made; DC_CALLS_SCRIPT opens it without a provider key for call tests. Global models and the
waiting list are only for those who look after the deployment, which an account made with an
email on an open server never is; they were checked by a drive (`DC_SIGNUP=waitlist
DC_ADMIN_EMAILS=… ./x agent web …`, the first account on such a server counts as vouched for),
not by a test.
## Library, pins and sharing

**Library Markdown has one swap point.** `views/library-markdown.contract` wraps Exact's
`text markup="markdown"`. It is not the React `Markdown` component: code highlighting,
Mermaid/math, DOM embeds, and the React document typography await the separate Markdown
port. Inline Markdown images are currently alt text rather than pictures (standalone image
viewing works). The front page therefore shows shorter previews, and a document's paragraph spacing
is Exact's. Relative library links/images are resolved in `data/library.ts`; individual
Markdown nodes do not yet call the chat document-panel action.

**Editors use a textarea, not the React editor DOM.** Read/edit/split, autosave, errors,
conflict resolution and revision revert use Contract state and the real library API. A
small `library-format.js` native view applies the toolbar to a textarea's actual selection
and gives Contract the resulting string. There is no editor scroll synchronisation or
rich syntax colouring. On phones split keeps the editor; Read switches to the preview rather than
squeezing two columns together. Folder operations are full-path rename/move; like React,
folders are implicit and there is no standalone empty-folder operation. Drafts are not a
persisted offline queue: keep a failed save open and retry it before closing the app.

**Chat has an integration seam, not a second attachment renderer.** `LibraryFileCard` and
`LibraryPictureViewer` in `views/library-card.contract` are exports for the separate chat
port. They are not mounted by this branch's basic transcript, so real chat tool-result
file cards and multiple-picture keyboard navigation are not end-to-end tested here.
`openLibraryPanel(fileId)` and `LibraryDocumentPanel` are mounted, and a real pinned file
opens the panel over the chat (tested). `LibraryPinsDock` temporarily occupies the bottom
of the existing wide Dood panel; the chat port should mount `PinsShelf` in its own scroll
column and remove that dock. The document panel is a bounded overlay, not a draggable
split, and has a whole-screen presentation on a phone.

**Pins have dates, not transient change flashes.** The first pin has an image, Markdown or
sandboxed page preview; subsequent pins are title rows, and deleted pins stay with an
unpin action. SSE refreshes them after writes and reconnects. The React shelf's live
"Just changed" label and timed highlight are not reproduced; the file's date is shown.
A pinned page preview does not receive the host theme message (the full page viewer does).

**Downloads need a browser hatch; shares stay on the server.** Contract's `download` link
cannot turn a fetched binary response into a named file, so `library-download.js` creates a
Blob URL in its own web-native button, revokes it and reports success/failure. Uploads use
Exact's file picker and a read-only grant for `app:/tmp/picked`. Native test drives must
name a scratch store (`--storage`) or picker reads are unavailable. Sandboxed HTML/PDF
iframes, new tabs and downloaded files remain browser-owned. `library-frame.js` sends
host theme messages and only accepts open-document messages from its own iframe. Shared
URLs are the existing `/s/:siteId` pages on the API origin, including that origin's sign-in
for restricted links; Exact does not duplicate the public website or promise an Exact
bearer session is also a cookie there. All three hatches are web-only.

## Calls

**The media is a web native view, not a Contract audio primitive.** `do-call` in
modules/web/call.js holds the shared `packages/client` caller, its actual WebRTC adapter,
remote audio player, microphone and audio analysers. Contract owns the buttons, transcript,
record and failure card. Authenticated writes cross data/call.ts; the native view gets only
a one-use socket ticket, never the sign-in. Its waveform uses Exact's hatch clock; the shared
caller's deadlines and script use its own browser timers, as in React. Calls are web-only.
The no-key server's real scripted mode tests handoffs, replies and records. A real local
WebRTC loopback tests capture, playback attachment, the data channel, mute and cleanup, not
OpenAI. A real provider call, voice quality, provider voice selection, interruption and billing
limits have not been exercised end to end without a provider sign-in.

**Leaving the page always stops its media; cross-origin write-up may wait.** The React
lib/call.ts sends a cookie-authenticated keepalive end request on pagehide. This view does
the same on a same-origin deployment, and emits the authenticated Exact end request too.
Across origins the native view has no bearer, and unloading may beat Exact's callback; the
server then writes up the call at its deadline rather than immediately. Signing out stops
media too; if the session has already been removed, server completion can likewise need the
deadline. Normal End is acknowledged through the data module and is tested. No server
behaviour was changed for it.

**The call keeps a compact window card on phones and outside its chat panel.** Like React's
web CallCard, not the mobile app's separate full-screen call route. It keeps its controls,
words and a link back while navigating. The card uses the app's dark primary mix rather than
the Dood's own exact hue, has no animated rings, and does not move left for a document beside
chat. Like a floating React CallCard it can cover the upper transcript, which an active-call
`check both` probe reports as covered/overlapping; opening the wide panel removes that card.
Its active labels use ink so they remain readable in dark mode. The panel's creature reacts
to listening, thinking, speaking and work; sidebar/pill
creatures do too. The panel keeps its existing care/wardrobe controls during a call instead of
hiding them. The live card bounds activity to the last five handoffs rather than every
pending handoff; the shared caller and main chat still process them all. Call records keep
a plain speaker-labelled transcript rather than React's two-column rows. The old side-chat link is drawn when the server's record names one.

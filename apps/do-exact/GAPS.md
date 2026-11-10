# What Exact cannot do yet, and what this app does instead

One paragraph each: what, where in the React app, what was done instead.

## The shell

**The sidebar hears of other Doods by asking.** The React app's sidebar follows the person's
feed, a WebSocket at `/api/presence/personal:<user>` that says when any Dood starts or stops
work, what it last said, and when one was looked at elsewhere (`apps/web/src/lib/latest.ts`
`useFeed`). The server takes the session on that socket from a cookie, and an Exact app's
socket on the web is the browser's, which sends no cookie across origins and no
`Authorization` header. So `loadDoods` is asked again every 10 s (`task poll` in
`views/shell.contract`); the open Dood's own event stream (`/api/agents/:id/events`, SSE, which
takes the bearer) asks again at once when it changes, and its chat asks again when it starts or
stops working. Once a socket can carry the session (the chat's move to the WebSocket needs the
same), the feed replaces the poll.

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
confetti on every launch. The native view's box contains the whole picture;
React's `AgentAvatar` overscans its span by 12%. The first-run view includes the sky, fall and
hatch from `components/welcome/stage.ts`, but not the UI's flight from island to chat: the
screen that owns both boxes must implement that transition. Petting emits `message="pet"`;
the Contract caller must apply server care limits and mutations, as React's creature care
does. If WebGL is unavailable, `do-creature` uses the protocol's plain SVG; it has no clothes,
seed-specific silhouette or egg, like React's stand-in. Syntax highlighting, Mermaid and other
foreign views are not implemented by this piece; PORTING.md's Native views section gives the
worked integration recipe.

## Data-free gallery verification

Exact's `scripts/verify.mjs:1371` launches several web drives together for an app without a
server. With the required port 8766 pin they collide (`port 8766 (--port or EXACT_PORT) is in
use: another drive or program holds it`), even though no other process holds the port before
or after the command. The gallery is checked sequentially with `./x test web --size …` and
`./x agent web … "check both"` instead; the machine-wide lock and port policy are unchanged.
The root app's own verify is not affected: it has a server, and runs clean. No Exact patch was
made.

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

**A workspace's Passwords is listed whether or not it keeps any.** The React app lists the
section only where the workspace keeps logins or cards this person may see (`workspaceSections`).
The kit's frame reads the shell's `Workspace`, which does not say; the Passwords page says when
there is nothing it keeps, and lists logins and cards only where it does.

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
be made, which the test server cannot, so it is drawn but untested. Global models and the
waiting list are only for those who look after the deployment, which an account made with an
email on an open server never is; they were checked by a drive (`DC_SIGNUP=waitlist
DC_ADMIN_EMAILS=… ./x agent web …`, the first account on such a server counts as vouched for),
not by a test.

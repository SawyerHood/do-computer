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

**Some of a Dood's pages are pages here, not sections of a settings window.** The React app
opens skills, connectors, computers, permissions, profile and settings, and a team's people and
settings, as sections of one settings dialog over the page, and redirects their old addresses
to it (`routes/_app.a.$agentId.skills.tsx` and the like). Here each is a route at that address,
in the content beside the sidebar, which Exact gives Back, reload and links for nothing. A
modal route (`navigationPresentation="modal"`) would be the dialog, if that is wanted later.

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

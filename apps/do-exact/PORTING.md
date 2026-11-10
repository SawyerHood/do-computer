# Porting Do Computer's web app to Exact

The goal: `apps/do-exact` does everything `apps/web`'s signed-in app does, on Exact's **web**
host, talking to the same server. Read this before working on any part of it. `README.md` says
what the app is and how it runs.

## The two sides

- **The reference** is the React app in `apps/web/src` (routes in `routes/`, UI in
  `components/`, data in `lib/`). It is what a screen should do and how it should look.
  `packages/client/src/index.ts` lists every API call with its types;
  `packages/protocol/src` has the types. `docs/reference/*.md` describes each feature in prose.
- **Exact** is the checkout at `~/.do-code/exact/exact` (public `main` of
  https://github.com/expo/exact; never push to it, and change nothing in it but what
  `setup.mjs` does). Its `docs/start-here.md` is required reading. Then look things up:
  `./x contract vocab <name>…` (tags, functions, recipes), `./x docs <heading words>`,
  `docs/card.md`, `docs/contract-for-agents.md`, `docs/contract-grammar.md`,
  `docs/reference.md`, `docs/agent-pitfalls.md`, and whole apps in its `apps/` (`agents`,
  `messages`, `realworld`, `shelf`, `ui-gallery`, `native-fixture`).
  https://github.com/expo/exact-templates has three more (`/tmp/exact-research/exact-templates`
  on bee), written for a fork: read them for ideas, and expect some of what they use to be
  missing here.

## Setting up a checkout

```sh
PATH=~/.local/share/pnpm/bin:~/.nvm/versions/node/v24.18.0/bin:$PATH pnpm install --frozen-lockfile
PATH=~/.local/share/pnpm/bin:~/.nvm/versions/node/v24.18.0/bin:$PATH pnpm --filter @do-computer/web build:node
cd apps/do-exact
PATH=~/.bun-1.4.2/bin:$PATH bun setup.mjs ~/.do-code/exact/exact && ./x update
./x test web
```

`setup.mjs` runs `bun` itself, so Bun 1.4.2 has to be on `PATH`, not only named. Rebuild the
server (`build:node`) after changing anything under `apps/web` or `packages`. The first web
build compiles Rust for a minute or two; later ones take seconds.

## The loop

- `./x contract build app.contract` compiles every file and type-checks `app.ts`: seconds. Fix
  every error and warning it prints; there are none now.
- `./x test web [file…]` runs the `*.test.contract` files beside `app.contract` against the
  real server, with the echo model (it answers "You said: …"). `server.ts` starts it empty
  **once for the whole run**: every test starts signed out with empty storage, but the accounts
  earlier tests made are still there, so each test signs up with an address of its own
  (`<file>-<n>@example.com`). `DC_ECHO_REPLIES` (see `readConfig` in
  `apps/web/src/server/platform.ts`) scripts other replies, tool calls among them.
- `./x agent web --size 1280x800 "tap …" "clock data" "screenshot .exact/shots/a.png" check`
  drives the app and takes pictures. **Look at every screenshot you take.** A test passes on a
  layout that is broken. `tools/shots.sh` takes this app's standard set (sign-in, chat, panel,
  pages menu, library, the phone's list) at 1280x800 and 390x844, light and dark, into
  `.exact/shots/exact/`; `node tools/react-shots.mjs` takes the React app's same screens into
  `.exact/shots/react/`, on a server of its own on port 3990. Hold them side by side.
- `./x verify` at the end of a piece of work: tests, layout checks light and dark, a relaunch.
- **Ports.** Other agents work in other checkouts on this machine. A checkout's `.slot` file
  holds a number that moves both its ports (the server's 3911 + slot, the page's 8766 + slot),
  and `./x` takes a lock per slot around the verbs that use them. Use the slot you were given
  (`echo 3 > .slot`); without one you share slot 0 and wait your turn. Never start `server.ts`,
  the React dev server or anything else on those ports yourself and leave it running; never
  `pkill` by a broad pattern. The React app for comparison is at the server's port.

## Structure

### What Contract allows

- **Only the root component declares `resource`, `mutation` and `task`.** Any component holds
  `state`, `derive` and `action`, and takes `props` (values, and `action` props it calls).
- **But the root's members may live in other files.** `members "./views/chat.contract"` in the
  root's body stands for the `members App` block in that file, as if written there. A members
  file holds one such block (resources, mutations, tasks, state, derives, actions) and may also
  declare shapes, `fn`s and components beside it. Every file of the root sees every member, and
  a name declared in two of them is refused naming both: give an area's names its own words
  (`libraryFiles`, not `files`).
- **`use A, B as C from "./x.contract"`** imports shapes, `fn`s, styles and components. The path
  is relative to the file that says it, starts with `./` and has no `..`.
- **`provide` and `inject`.** The root's `provide` section lists what any component under it
  can `inject` by name and type, values and actions alike. Any component may have a `provide`
  section, and the nearest provider wins; there is no `provide` around a block of a view.
- **A slot.** A component with `slot` places its use's indented nodes where its view says
  `children`. One slot, no named ones.
- **A screen is a component.** A route is the node with a `navigationKey` under the root's
  `for e in stack(nav)`; it may be the top node of a component used there, so each screen is a
  component in its area's file and the root only picks it by `e.name`.
- **The root file alone** has `routes` and `font`. `path()` takes a literal route name, and
  `scrollIntoView` and `focus` a literal id.
- **Tests.** `test` and `verify` run `app.test.contract` and every `*.test.contract` beside
  `app.contract`. A test in `tests/` runs only when named, and `verify` never reads it, so the
  tests stay beside the root, a file per area.

### What is where

```
app.contract              the root: use lines, fonts, routes, a members line per area, provide,
                          the navigation (follow, back), and which screen draws each route
app.tamber                Do Computer's colours, the platform roles mapped to them, its icons
app.ts                    grants, and the sources of every data/<area>.ts in one table
views/shapes.contract     shapes more than one area reads (Session, Reply, Dood, Workspace, Page…)
views/styles.contract     shared styles (`style Name`, used as `class=Name`)
views/shell.contract      members: viewport, time, workspaces, Doods, the open Dood's events,
                          hatching, marking seen. Sidebar, DoodRow, AccountButton, DoodHeader
                          (the pill and its pages menu), DoodScreen, WorkspaceScreen, NoDood
views/sign-in.contract    members: the session, signing in and out. SignIn
views/chat.contract       members: the open chat, sending. ChatScreen, MessageRow, DoodPanel
views/creature.contract   DoodFace: a Dood's creature, the `do-creature` native view (seed, colour,
                          state, name, size), live from `liveFaces`; Hatchling, the large one
views/panel*.contract     members: the creature's live state (panel-mood), its hatch, the panel's
                          folds. DoodPanel beside the chat, PanelSection for the panel's sections
views/care*.contract      members: the creature, treats, the box. CreatureCare, BoxWindow
views/wardrobe.contract   members: dressing. WardrobeWindow, CreatureWindows (drawn at the root)
views/welcome.contract    members: the first run. WelcomeScene over everything, FirstHello in a chat
views/settings-kit.contract  the settings' frame (DoodSettings, AccountSettings,
                          WorkspaceSettingsFrame: the settings window's card, its list of sections
                          beside the open one) and pieces (SettingsSection, SettingsCard,
                          SettingsRow, SettingsList, SettingsItem, SettingsEmpty, Confirm, styles)
views/<area>.contract     each other page: a placeholder screen in DoodScreen or WorkspaceScreen
views/transport.contract  members: tickets kept ready for the sockets, and their pings (no screen)
data/api.ts               the session, ask/get/post/put/patch/del, reply, ownerOf/current, follow
data/<area>.ts            an area's sources, exported as `<area>Sources`
<area>.test.contract      an area's tests
tools/                    shots.sh, react-shots.mjs, phosphor-icons.mjs; stream-check.mjs (a long
                          reply arrives whole); same-origin.sh (the app served by the server)
tests/same-origin.test.contract  the app at the server's own origin, run by tools/same-origin.sh
```

The root's view has a marked arm per route (`// --- library ---`) and its body a `members`
line per area. Add yours in its own place, in the order of the routes, so that work done in
parallel merges.

### Conventions

- **Routes** mirror the React app's addresses: `/a/:agentId` (the Dood's main chat),
  `/a/:agentId/c/:chatId`, `/a/:agentId/library`, `…/automations`, `…/skills`,
  `…/connectors`, `…/computers`, `…/permissions`, `…/profile`, `…/settings`,
  `/w/:workspaceId`, `/w/:workspaceId/people`, `/w/:workspaceId/settings`. A link is
  `link href=path("library", agentId)`; `follow` in `app.contract` makes the stack the list,
  then the Dood's chat (or the workspace's page), then the page, so a phone's Back goes up one
  and a wide window shows the page beside the list. One of a Dood's pages in place of another
  replaces it.
- **Which page is open:** `onRoute` (the top route's name), `openAgentId` (the deepest Dood in
  the stack), `chatEntryId`. A resource only a page needs is asked for while that page is
  open: give it `onRoute == "library" ? openAgentId : ""` and answer nothing for `""`.
- **Test ids** of a screen end in its route's name, since covered routes stay mounted:
  `pages-library`, `go-skills-library`, `title-library`, `heading-library`, `back-dood`.
- **Data.** Every source uses `data/api.ts`:
  - a read is `get(store, path)`, which throws on failure, so Exact keeps the last answer and
    `failed(x)` says so;
  - a write is `reply(() => post(store, path, body))` (or `put`, `patch`, `del`), which answers
    `{ ok, error }`: the server's words for a refusal, ours for a lost connection;
  - an answer that is someone's carries `owner` (the session's `owner`, which `ownerOf` makes
    from the user and a tag of the session), the source is asked with `session.owner` and
    answers `NOBODY`'s nothing when `current(owner, store)` is false, and the view shows it only
    while `x.owner == session.owner` (`doodList`, `workspaceList` in shell.contract);
  - something that keeps coming is one of the server's WebSockets:
    `follow(store, path, { open, each, lost, now })` (`/api/agents/:id/socket`, a feed). Exact
    gives its mapper every frame in order; `open` may `say` what the socket should send (a
    chat's `follow`). Where the session is a bearer token the socket opens with a ticket kept
    ready (data/api.ts, views/transport.contract); with none ready, or when the socket ends, it
    is `lost`, and the view follows it again (`heal` in chat.contract, `healPulse` in
    shell.contract). Served by the deployment itself the session is the browser's cookie and no
    ticket is needed (`byCookie`);
  - types and pure functions come from `../protocol/` (`reduceChat`, `inOrder`, `avatarLook`).
- **Looks.** Colours are `app.tamber`'s tokens (`canvas`, `ink`, `ink.muted`, `frame`,
  `hairline`, `wash`, `bubble`, `primary`…), never a literal; sizes in `rem` where text grows
  with them; the type is Geist; icons are `symbol:icon.<name>` from `app.tamber` (add one to
  `tools/phosphor-icons.mjs`, run it, list it in `icons`). Shared looks are styles in
  `views/styles.contract`. A page that is not the chat is drawn in `DoodScreen` or
  `WorkspaceScreen`, which give it the header, its title and a lead line. A page that is a
  section of the React app's settings window is drawn in `DoodSettings` (a Dood's),
  `AccountSettings` (the person's own) or `WorkspaceSettingsFrame` (a workspace's), from
  `views/settings-kit.contract`, whose list of sections names its route (`doodEntries` and the
  others there).

### Adding an area: the library, say

1. `views/library.contract`: its shapes, its members and its screen.

   ```contract
   use Page from "./shapes.contract"
   use DoodScreen from "./shell.contract"

   shape LibraryFile
     id: string
     name: string

   shape Library
     owner: string
     agentId: string
     files: LibraryFile[]

   members App
     // --- library ---
     resource library = loadLibrary(session.owner, onRoute == "library" ? openAgentId : "") as shape Library else empty()
     derive libraryFiles = library.owner == session.owner and library.agentId == openAgentId ? library.files : []

   component LibraryScreen
     props
       page: Page
       files: LibraryFile[]
     view
       DoodScreen(page=page, route="library", lead="Documents and files made by the Doods of this workspace…")
         for f in files key=f.id
           text f.name testId=`file-${f.id}`
   ```

2. `app.contract`: `members "./views/library.contract"` with the others, and in the route's
   arm pass what the screen reads: `LibraryScreen(page=…, files=libraryFiles)`.
3. `data/library.ts`:

   ```ts
   import type { Result, Sources } from '../app.contract.d.ts';
   import type { LibraryListing } from '../protocol/agent.ts';
   import { current, get, NOBODY, seg } from './api.ts';

   export const librarySources: Pick<Sources, 'loadLibrary'> = {
     loadLibrary: async ([owner, agentId], store): Promise<Result<'loadLibrary'>> => {
       if (agentId === '' || !current(owner, store)) return { owner: NOBODY, agentId: '', files: [] };
       const { files } = await get<LibraryListing>(store, `/api/agents/${seg(agentId)}/library`);
       return { owner, agentId, files: files.map((f) => ({ id: f.id, name: f.name })) };
     },
   };
   ```

4. `app.ts`: `...librarySources` in `sources`.
   (This example compiled and type-checked as written, 2026-11-10.)
5. `library.test.contract`: the sign-up preamble from `chat.test.contract` with an address of
   its own, then `tap "pages-dood"`, `tap "go-library-dood"`, and what the page should show.

## Native views

These work on Exact's public main on the web. `modules/web/index.js` is the page module. It
exports ABI 1, a `roster` and `create`, `setProps`, `destroy`, and dispatches each tag to its own
file. The module is loaded after first paint. Do not put DOM work at import time.

To add another (Shiki and Mermaid follow this recipe):

1. Add a hyphenated tag to `app.json` `modules`, and its file to the `views` table in
   `modules/web/index.js`. Give it `{ snapshot: false }` in the roster (the table does this).
2. Export `create(element, props, event)` from that file. Return a handle with
   `setProps(props)` and `destroy()`. Use the element's shadow root, so library styles cannot
   repaint the app. Keep the element's size, attributes and accessibility under Contract.
3. Props are a whole replacement object of **strings**, parsed once by the dispatcher.
   Unknown attribute names reach the module. Known ones belong to the box: `color` never
   reaches it, `size` is refused with `lower-unknown-attr`. Use distinct names (`colour`,
   `side`, `code`, `language`, `diagram`), not `value`, `src`, or event names. Parse and validate
   before changing a view. A thrown refusal keeps the last accepted aggregate.
4. Events use `event(kind, payload)`: press 0, change 1 (string), hover 2 (bool), focus 3,
   blur 4, key 5 (string), submit 6, load 7, message 8 (string). Contract binds the usual names:

   ```contract
   action creatureSaid(word: string)
     lastCreatureWord = word
   // In the view:
   do-creature seed=dood.seed colour=dood.colour state=dood.state side="48" width=48 height=48 message=creatureSaid aria-label="Dood" testId="avatar"
   ```

   A DOM click already runs the authored `press=`. Do not also emit 0 for the same click.
   Use `message=` for domain events (`"pet"`, `"hatched"`), not new event attributes. The host
   queues callbacks after the current commit and drops callbacks after destruction.
5. Give it an explicit `width` and `height`, or an otherwise sized box. `side` controls mascot
   drawing resolution, not layout. The web observes the element's size, but has no JS
   `intrinsicSize` callback. A `ResizeObserver` handles the view's own canvas. Its shadow DOM
   is opaque to the agent's tree: the tag, props, label and testId are visible, not its meshes
   or text. Put a readable fallback or status in Contract when people need one.
6. Exact **does not bundle the page module**. It copies `modules/web/` to `/modules/`
   (`host/web-js/build.mjs`; the WASM build does the same). Relative imports inside that tree
   work; a bare npm import and an import walking outside it are not served. For a foreign
   dependency, use `Bun.build` with `target: 'browser'` and `format: 'esm'`, output inside that
   tree, and import the output. `modules/web/build.mjs` is the worked example: it reads the
   real three.js 0.128 installed for `apps/web`, `packages/mascot/src` and the pure protocol
   helpers, and generates `engine.js`. Nothing in those packages is copied by hand or changed.
   The generated bundle is committed so a fresh checkout works; after changing its inputs,
   run `bun modules/web/build.mjs` from this app. No CDN or network fetch is needed at runtime.
7. Use Exact's clock for animation. The page module exports `app()` so Exact loads its
   hatch clock even without any element hatches. `exact.hatches.frames(frame => …)` gives
   milliseconds in `frame.now`, and returns a stop function; `exact.hatches.after(ms, fn)`
   does the same for a wait. Stop tickets and observers in `destroy`. The mascot uses
   `new core.Orb`, `Runner.add`, and one shared `Runner.tick(frame.now)`, never `createOrb`
   (which starts its own browser loop). Its GPU-resource retirement and WebGL retry bookkeeping still use the package's
   wall clock; movement, hearts, gift opening and sky/hatching use the test clock.
8. Test it outside the app. `tests/creature-gallery` is a second small app with its own `./x`
   taking the same machine lock and ports. Its prepare script mirrors the production page
   module, not a second implementation. From that folder:

   ```sh
   ./x test web creature.test.contract
   ./x agent web --size 1280x1300 "clock data" "clock +1200" "screenshot .exact/creatures.png" check
   ./x verify
   ```

   `clock data` first waits for the page module to attach. `clock +N` alone need not wait for
   it. Screenshots include WebGL (the shared stage copies it to 2D canvases); look at them,
   since tree assertions alone cannot tell whether the canvas is blank. Native tags are
   web-only here; do not try to fix that by changing the Exact checkout.

The mascot tags and their full prop/event list are in `modules/web/README.md`. Leave
`app.contract`, `app.ts` and screen components alone when adding another native tag.

The data-free gallery exposes one limitation of this Exact checkout: `verify.mjs:1371` starts
its tests, large-text tour and first-screen drives in parallel when an app has no server.
With `./x` pinning port 8766, they race and report `port 8766 (--port or EXACT_PORT) is in use`.
Do not change Exact, remove the machine lock or start extra servers. Run the gallery's tests
at `--size 390x844` and `--size 1280x1300`, and its `agent … "check both"` sequentially. The
large-text part of verify still runs; its last run found nothing spilling in this gallery.
Native animation is culled offscreen by the mascot Runner, as in React: the gallery's Hatch
and Open actions scroll their view into sight before starting it. `state` includes the last
frame's mascot counts under `hatches.scopes.module.published.mascot` (64 orbs, 46 held in the
full gallery); `at` is Exact time. These diagnostics do nothing in production.

Content views can take **natural height** on the web: a `:host{display:block}` with an ordinary
shadow DOM child participates in browser layout. `do-markdown`, `do-code` and `do-mermaid`
leave height unset and use `align-self="stretch" min-width=0 max-width="100%"`. No intrinsic-size
callback, estimated line count or message/resize feedback loop is needed. The gallery's
browser check compares host and child heights, checks an 80-line block, and confirms that
highlighting does not change a code block's height. This is a web result, not a native-host
promise. Diagram completion and picture loading can still change their content's real height.

Keep lazy dependencies lazy at the **dispatch** boundary too. `content-views.js` loads the
rich implementation only when its tag is created, so a creature-only page does not load a
Markdown parser (or require its chunk directory). A gallery using rich views must copy the
whole module tree, not just top-level JS. Await a labelled `load=` state with
`clock until state ready == true within 3000` before asserting its rendering; `clock data`
waits for the page module, not every library's later dynamic import. Shadow DOM's internal
controls and text need a browser probe while an official `./x agent` drive owns the host;
`tests/markdown-gallery/run-browser.mjs` is the example. It never starts another server.

## Known problems in Exact, and what this app does about them

- **`exactTime()` and Markdown.** An app that draws `markup="markdown"` is run once at build, in
  Exact's server render bundle, to compile its Markdown. That bundle does not answer the
  reserved `exactTime` source (`host/web-js/build.mjs` installs `data.reserved.exactTime` for
  the page, not for `main-server.js`), so the call falls to `app.ts`'s `answer`, where
  `sources.exactTime` is undefined: "sources[source] is not a function". The `one-screen`
  pattern draws no Markdown, so it never meets it. `app.ts` answers a source it does not have
  with a zero time, which only that build-time render ever asks for; in the browser the runtime
  answers `exactTime` itself.
- **A stream opens before its answer awaits anything** on the web, and a data source sees
  neither the page's address nor a clock. So the tickets a socket opens with are kept ready
  (`stockTickets`) and aged in rounds of a task, and served by the deployment the app finds its
  cookie session by asking (`byCookie`). GAPS.md, "Transport".
- **History after a reload.** A deep link opens with its parents put under it
  (`/a/x/library` is the list, the chat, the library). Those were never in the browser's
  history, so the app's Back from such a page adds an entry instead of going back. Within a
  session Back and Forward follow the browser's history.
- **No browser history in tests.** `tap "app" history 1` works in a drive and is refused in a
  `.test.contract`; Forward is checked by drive only.
- **Native hosts** do not keep the open route across a relaunch; the web keeps the URL.
- `deploy.store` in `app.json` must stay as it is.

## Rules of the house

- **Web only for now.** Do not build iOS, macOS or Linux hosts. Do not break what would keep
  them from working later where it costs nothing, but web behaviour decides.
- **Structure** as above: your area's members, shapes and screens in `views/<area>.contract`,
  its sources in `data/<area>.ts`, its tests in `<area>.test.contract`, and in the root only
  its `members` line and its route's arm.
- **The server is the truth.** No state here that the server has. Reuse types and pure
  functions from `packages/protocol/src` through the `./protocol/` mount; do not copy them.
- **Server changes** are allowed where the client cannot do without one. Keep them small, in
  the repository's style (read neighbouring code and its comments), with a test, and say so in
  your report. Nothing may change what the React, mobile or desktop apps see.
- **Foreign JavaScript** (three.js, Shiki, Mermaid) goes in `modules/web/` as a native view: a
  hyphenated tag (`native-views` recipe; `apps/native-fixture/modules/web/index.js` in Exact).
  A Dood's face is `DoodFace` in `views/creature.contract`, which draws `do-creature`: add
  what the creature does (petting, outfits, hatching) there.
- **Tests.** Every feature gets tests in `<area>.test.contract` that drive it against the real
  server. Someone signed in with no Dood gets the first run's scene over everything, 400 ms after
  the list says so: a test that taps `new-dood` (or `first-dood`) at once, as the six lines do
  followed by that tap, has its Dood before the scene comes, and never sees it. Each starts
  signed out with empty storage, on a server the whole run shares, so it signs up first with
  the same six lines and an address no other test uses.
- **Looks.** The React app's look wins where it and Exact's platform look differ on the web:
  its colours, type and shapes, from `app.tamber` and `views/styles.contract`. Wide windows
  get the sidebar beside the content; narrow ones a stack. Compare against the React app's
  screenshots at 1280x800 and 390x844, light and dark.
- **When Exact cannot do something**, find the nearest thing it can do, write down the gap in
  `GAPS.md` (one short paragraph: what, where in the React app, what was done instead), and
  move on. Do not patch Exact. Do not leave a feature out silently.
- **Writing.** Comments and docs in this repository are plain, short and say why. Match them.
- **Git.** Work only in your own worktree and branch. Commit as you go with messages in the
  repository's style (a sentence saying what is now true). Never push, never open a pull
  request, never touch `main`.
- **Feedback to Expo is off**: `./x` sets `EXACT_FEEDBACK=0`. Leave it off, and run Exact only through `./x`.

## Reporting back

When done: what works (with the test names), what is in `GAPS.md`, any server change, anything
the next person must know, and the paths of the screenshots that show it. Say plainly what you
did not finish.

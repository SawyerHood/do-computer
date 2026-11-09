# Porting Do Computer's web app to Exact

The goal: `apps/do-exact` does everything `apps/web`'s signed-in app does, on Exact's **web**
host, talking to the same server. Read this before working on any part of it. `README.md` says
what the app is and how it runs.

## The two sides

- **The reference** is the React app in `apps/web/src` (routes in `routes/`, UI in
  `components/`, data in `lib/`). It is what a screen should do and roughly how it should look.
  `packages/client/src/index.ts` lists every API call with its types;
  `packages/protocol/src` has the types. `docs/reference/*.md` describes each feature in prose.
- **Exact** is the checkout at `~/.do-code/exact/exact` (public `main` of
  https://github.com/expo/exact; never push to it, and change nothing in it but what
  `setup.mjs` does). Its `docs/start-here.md` is required reading. Then look things up:
  `./x contract vocab <name>…` (tags, functions, recipes), `./x docs <heading words>`,
  `docs/card.md`, `docs/contract-for-agents.md`, `docs/reference.md`, `docs/agent-pitfalls.md`,
  and whole apps in its `apps/` (`agents`, `messages`, `realworld`, `shelf`, `ui-gallery`,
  `native-fixture`). https://github.com/expo/exact-templates has three more
  (`/tmp/exact-research/exact-templates` on bee), written for a fork: read them for ideas, and
  expect some of what they use to be missing here.

## Setting up a checkout

```sh
PATH=~/.local/share/pnpm/bin:~/.nvm/versions/node/v24.18.0/bin:$PATH pnpm install --frozen-lockfile
PATH=~/.local/share/pnpm/bin:~/.nvm/versions/node/v24.18.0/bin:$PATH pnpm --filter @do-computer/web build:node
cd apps/do-exact
~/.bun-1.4.2/bin/bun setup.mjs ~/.do-code/exact/exact && ./x update
./x test web
```

Rebuild the server (`build:node`) after changing anything under `apps/web` or `packages`.

## The loop

- `./x contract build app.contract` compiles and type-checks `app.ts`: seconds. Fix every
  error and warning it prints.
- `./x test web [file…]` runs the `*.test.contract` files against the real server, which
  `server.ts` starts empty each run, with the echo model (it answers "You said: …").
  `DC_ECHO_REPLIES` (see `readConfig` in `apps/web/src/server/platform.ts`) scripts other
  replies, tool calls among them.
- `./x agent web --size 1280x800 "tap …" "clock data" "screenshot .exact/shots/a.png" check`
  drives the app and takes pictures. **Look at every screenshot you take.** A test passes on a
  layout that is broken. Take the same screen of the React app for comparison: while a drive or
  test runs, the server is at http://127.0.0.1:3911 and serves the React app there (the
  `browsing-the-web` skill, or dev-browser, opens it; sign up the same way).
- `./x verify` at the end of a piece of work: tests, layout checks light and dark, a relaunch.
- `./x` takes a machine-wide lock around the verbs that use ports 3911 and 8766, because other
  agents work in other checkouts on this machine. Never start `server.ts`, the React dev
  server or anything else on those ports yourself and leave it running; never `pkill` by a
  broad pattern.

## Rules of the house

- **Web only for now.** Do not build iOS, macOS or Linux hosts. Do not break what would keep
  them from working later where it costs nothing, but web behaviour decides.
- **Structure.** `app.contract` is the root: routes, shapes it needs, every `resource` and
  `mutation`, the actions. Screens are components in `views/<area>.contract`, taking props and
  action props. Shared shapes and styles are in `views/shapes.contract` and
  `views/styles.contract`. The data module is `app.ts`, which only gathers `sources` from
  `data/<area>.ts`; shared plumbing (the session, `ask`, `post`, `reply`) is `data/api.ts`.
  Add to the root in your area's own marked block (`// --- library ---`) so that work done in
  parallel merges.
- **The server is the truth.** No state here that the server has. Reuse types and pure
  functions from `packages/protocol/src` through the `./protocol/` mount; do not copy them.
- **Server changes** are allowed where the client cannot do without one. Keep them small, in
  the repository's style (read neighbouring code and its comments), with a test, and say so in
  your report. Nothing may change what the React, mobile or desktop apps see.
- **Foreign JavaScript** (three.js, Shiki, Mermaid) goes in `modules/web/` as a native view: a
  hyphenated tag (`native-views` recipe; `apps/native-fixture/modules/web/index.js` in Exact).
- **Tests.** Every feature gets a `tests/<area>.test.contract` that drives it against the real
  server. Each test starts from empty storage and an empty server, so it signs up first: keep
  that preamble short and the same everywhere.
- **Looks.** Platform controls unpainted, colours by role, as `start-here.md` says, with Do
  Computer's own type, colours and shapes coming from `app.tamber` and `views/styles.contract`
  once they exist. Wide windows get the sidebar beside the content; narrow ones a stack.
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
   (which starts its own browser loop). Its GPU-resource retirement alone uses the package's
   wall-clock timers; movement, hearts, gift opening and sky/hatching use the test clock.
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

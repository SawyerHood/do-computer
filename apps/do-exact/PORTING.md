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

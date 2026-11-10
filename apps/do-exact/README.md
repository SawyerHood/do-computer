# Do Computer in Exact

A client for Do Computer written with [Exact](https://github.com/expo/exact): the view is
`app.contract` and the files in `views/`, the data module is `app.ts` and the files in `data/`,
and one source could run on the web, iOS, macOS and Linux; for now it is built for the web. It
talks to a deployment (`apps/web`) over the HTTP API the web and phone apps use.

It is the shell of the app and its chat, not a replacement for the React app yet.
[What is here](#what-is-here) and [what is not](#what-is-not) say where it stands;
[PORTING.md](PORTING.md) says how it is laid out and how to add to it, and [GAPS.md](GAPS.md)
what Exact cannot do yet.

## What is here

- Do Computer's look: its colours light and dark (`app.tamber`, from the React app's theme
  tokens), Geist, its icons, its sidebar, pill and bubbles.
- Signing in with a password, or making an account, on the React app's card; signing out from
  the account menu at the foot of the sidebar. The session is kept in the platform's secret
  store and survives a reload.
- The sidebar: your Doods under each workspace (one list when you are in no team), in the order
  you put them in, each with its creature (the React app's mascot, as a web native view), the
  last thing said and when, whether it is working or waiting on you, and a mark for something
  new. A workspace's menu leads to its settings and people. Hatching a Dood opens it.
- A wide window has the sidebar beside the page; a phone has the list, then a Dood's chat over
  it. Every page has its address (`/a/:agentId`, `/a/:agentId/c/:chatId`,
  `/a/:agentId/library`, `/w/:workspaceId/people`, …): deep links, reload, Back and Forward work.
- A Dood's main chat: the transcript, opened at its newest message and following it, with the
  reply arriving as it is written over the chat's event stream. Text is drawn as Markdown;
  thinking, tool calls and notices each have a plain row. Sending a message. Its panel beside
  the chat, from its face in the pill.
- Skills: install from a URL, read all the files, enable/disable and delete, in the shared
  settings frame. Automations: schedule/check/run metadata, pause/resume, run now, delete and
  links to the last run; creating and editing happens in chat, as in React.
- Connectors: MCP URL/token/client credentials, tool lists, reconnect, switches and removal;
  the apps gateway and its OAuth sign-in; Slack setup, connection/removal and a 1024 px bot
  picture download. Credentials are password fields, not persisted form state or returned data.
- Computers: the workspace's machines and paired computers, adapter diagnostics, access,
  ownership transfer, Dood grants, requests, daemon update/removal, add-machine kinds and the
  install/read-only commands. `/pair?code=…` verifies the daemon's code, owner and Dood selection.
- The other pages remain placeholders here: library, permissions, profile and settings,
  and a workspace's people/settings. Other Exact area branches fill those in.
- Tests (`chat`, `shell`, `sign-in`, `skills`, `connectors`, `computers` and `automations`
  `.test.contract` files) that drive all
  of that against Do Computer's own server on the web host. `./x verify` also checks sizes,
  themes, largest text, reload and relaunch.

## Run it

Exact has no releases. An app uses a checkout of it by path, and the files that hold the path are
made for each machine and kept out of Git.

```sh
# Once: Rust (rustup), Bun 1.4.2, Chrome or Chromium (CHROME=<path> for another), and Exact
git clone https://github.com/expo/exact ~/exact && (cd ~/exact && bun scripts/exact.mjs setup)
bun setup.mjs ~/exact

# The deployment the tests and the dev loop run: this repository's server, built
pnpm --filter @do-computer/web build:node

EXACT_PORT=8766 bun exact.mjs test web     # the tests, in headless Chrome
EXACT_PORT=8766 bun exact.mjs web          # the dev loop at http://127.0.0.1:8766/ (run `bun server.ts` beside it)
bun exact.mjs linux                        # the Linux host; then `bun exact.mjs test linux`
bun exact.mjs ios --run                    # on a Mac with Xcode: an iOS simulator
bun exact.mjs mac --run                    # on a Mac: the macOS app
```

`server.ts` starts `apps/web` on port 3911 with an empty data folder and no model key, so a Dood
answers with the echo model. The address is the `API_BASE_URL` setting, read in `app.ts`; `./x` sets it.

The web build is served from its own origin, so the server has to be told about it:
`DC_CLIENT_ORIGINS=http://127.0.0.1:8766`, which `server.ts` sets and which is why the commands
above pin `EXACT_PORT`.

## What the server gained for it

- **Sessions without cookies.** Better Auth's `bearer` plugin: a sign-in's reply carries the
  session in `set-auth-token`, and a request sends it back as `Authorization: Bearer`. An Exact
  app's `fetch` has no cookie jar on a native host, and a browser sends none across origins.
- **`DC_CLIENT_ORIGINS`.** Origins of client apps served from somewhere else. They get CORS
  headers (without credentials) and may sign in. See `apps/web/src/server/client-origins.ts`.
- **A connector OAuth return for bearer clients.** A validated `client_return` registers the
  Exact origin's `/a/:id/connectors` as the place to return. The gateway sends the browser back there, and Exact finishes once with its bearer session (`dc_client=1`).
  Only success/error comes back, never connector credentials. Both an allowed development
  origin and the server's own origin are accepted; unrelated origins and non-connector paths
  are refused. The existing React-cookie and desktop callback paths are unchanged.

## What is not

In the order it would be built:

1. **The other pages' bodies.** Library, permissions, profile and account/team settings are
   placeholders on this branch; skills, connectors, computers and automations have real bodies.
   PORTING.md says how areas are joined. The creature is not petted, dressed or hatched here.
2. **The rest of a chat.** Approvals, queued messages and Stop, earlier history, attachments and
   pictures, side chats and sub-agents, code blocks with highlighting, tables.
3. **The rest of the shell.** Naming and hatching with the egg, starting a team and answering
   invitations, putting Doods in order by dragging, folding a workspace, calls, and the
   React app's wide sidebar that folds to a column of faces.
4. **Any deployment.** The address is a constant. A person should type it at sign-in, as on the
   phone, which needs the grant `net.fetch https:` and the address kept in the store.
5. **Apple hosts.** Nothing here was built for iOS or macOS yet: that needs a Mac with Xcode.
   The native Linux build was the evidence, for the first slice, that the data module, the
   secret store and the stream work off the web; it has not been run since the app was split
   into areas. Sign-in with Google or GitHub would go through Exact's OAuth session. A
   native launch opens at the list of Doods: the open chat is not kept across launches.
6. **A lossless stream.** Exact drops server-sent events that arrive faster than it commits them
   (`coalesced`), and a chat's events are deltas. The app notices and follows the chat again from
   a fresh snapshot (`heal`). The real fix is following over the WebSocket the server already
   has, which Exact delivers frame by frame, once a socket can carry a bearer session.
7. **What Exact has no answer for yet.** Mermaid and Shiki (npm packages with DOM or wasm needs,
   which would be web native views as the creature is), MCP app and visual embeds beyond a plain
   `iframe`, remote push, and the desktop app's work: running the daemon and driving the screen
   and browser. Windows is unfinished in Exact.

## Things learned about Exact, 2026-11-09

- Public `main` built and tested this app on Linux with nothing but `setup`. The pinned fork the
  [chat template](https://github.com/expo/exact-templates) needs does not build outside Expo: it
  depends on a private repository (`expo/snapback`).
- `typescript.sources` crashes the web build on public `main` (a missing `snapback4/ts`).
  `setup.mjs` makes the empty folder that gets past it.
- A reserved `exactTime()` resource failed this app's build ("sources[source] is not a
  function") though the same line works in the `one-screen` pattern: the build runs an app that
  draws Markdown once to compile it, in a bundle that does not answer `exactTime`. `app.ts`
  answers it there (PORTING.md).
- An import of a file outside the app's folder is refused unless it is mounted, and a mount
  works well: `./protocol/chat.ts` is `packages/protocol/src/chat.ts`, so the app applies chat
  events with the same `reduceChat` as every other client.

## Tools-area checks (2026-11-10)

`skills.test.contract`, `connectors.test.contract`, `computers.test.contract` and
`automations.test.contract` use the real echo server. They cover tool-created skills and
schedules, read/toggle/delete, pause/resume/run/history, validation, browser preference,
invalid pairing and recovery from failed HTTP loads. The OAuth bridge has seven server tests
in `apps/web/src/server/connectors-client.test.ts`. A supplemental real-browser run also
checked multi-Dood pairing with a lowercase code, grants, request denial/approval, ownership
transfer, daemon-update command receipt (a protocol fixture, not installation on a real
computer), MCP token/tools/toggle/OAuth, Slack PNG export and paired-computer revocation.
Typechecking `apps/web` passed. The shared settings kit was copied unchanged from
`exact-settings` at `941da6f`.

For the tools worker on bee, slot 6's API port 3917 was occupied by an unrelated Do Code
server. Checks used `API_BASE_URL=http://127.0.0.1:3927 ./x …` and the assigned Exact port 8772;
no process on 3917 was changed. This is a local test override, not a new deployment address.
The supplemental browser check and reference photographs are kept under `.exact/` in that
worktree (not committed): `.exact/integration.mjs` and `.exact/shots/tools/`. It starts local
MCP/OAuth and daemon-protocol fixtures, but drives the real Do Computer API and Exact page.
External Slack/apps credentials and real cloud-machine provisioning are not used.

The final verifier passed all 11 tests and ordinary phone/wide, light/dark and reload checks;
three findings remain only at its largest text size, in the shared heading/pill (GAPS.md).
Forty comparison screenshots (five sections × two sizes × two schemes × two apps) were read:
the settings layout, typography, cards and dark colours are recognisable against React.
Exact keeps a route rather than the dimmed-chat overlay, a fixed sidebar rather than React's
rail, a default rather than per-Dood accent, and slightly roomier computer rows. On a phone
Slack's picture explanation/download wraps rather than squeezing its text into a narrow column.

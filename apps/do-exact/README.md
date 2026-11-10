# Do Computer in Exact

A client for Do Computer written with [Exact](https://github.com/expo/exact): the view is
`app.contract` and the files in `views/`, the data module is `app.ts` and the files in `data/`,
and one source could run on the web, iOS, macOS and Linux; for now it is built for the web. It
talks to a deployment (`apps/web`) over the HTTP API the web and phone apps use.

It has the shell, basic chat and library, not a replacement for the React app yet.
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
  new, kept current by the person's feed socket, as the React app's is. A workspace's menu
  leads to its settings and people. Hatching a Dood opens it.
- A wide window has the sidebar beside the page; a phone has the list, then a Dood's chat over
  it. Every page has its address (`/a/:agentId`, `/a/:agentId/c/:chatId`,
  `/a/:agentId/library`, `/w/:workspaceId/people`, …): deep links, reload, Back and Forward work.
- A Dood from its first moment (views/welcome, panel, panel-mood, care, wardrobe): someone with
  no Dood watches an egg come down out of the night onto its island, says hello, names it, picks
  its colour and what it thinks with, sees it hatch as the sun comes up, and follows it as it flies
  into its chat, where it offers what to do first. A Dood hatched from the sidebar's + is met as
  an egg that hatches while its owner watches. Its panel beside the chat has its creature, petted
  with a click or by rubbing, treats beside it, its box filling with the hours until the next,
  opened over the page, and its wardrobe, where anything the workspace found is worn by any of its
  Doods. Every picture of a Dood is in its egg until it has hatched, wears what it has on, and
  acts out what its chat says: listening, thinking, at which kind of work, answering, done,
  troubled, waiting for an OK, asleep.
- A Dood's main chat: the transcript, opened at its newest message and following it, with the
  reply arriving as it is written, every piece of it, over the Dood's WebSocket. Text is drawn as Markdown;
  thinking, tool calls, approvals, secrets, connector/computer asks, files, pins and sites use
  the rich transcript. Earlier messages, retry, delivery, activity and read-only chat bars are
  included. Sending a message. Its panel beside
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
- Tests (`chat`, `shell`, `sign-in`, `skills`, `connectors`, `computers` and `automations`
  `.test.contract` files) that drive all
  of that against Do Computer's own server on the web host. `./x verify` also checks sizes,
  themes, largest text, reload and relaunch.
- Settings, in the React app's settings window's card (`views/settings-kit.contract`): a Dood's
  profile (name, tagline, colour, a new look, voice, personality, moving it, deleting it),
  memory (with starting the main chat fresh), model and thinking with its computers, usage and
  permissions; the person's own General (theme, which sets the app's scheme, default model and
  computer), Notifications (this browser's web push, through the `do-push` view and a service
  worker of its own), and the lists of Doods and workspaces; a workspace's Models (signing in
  to a provider with a key, a subscription or a code) and Passwords (logins and cards); and for
  whoever looks after the deployment, Global models and the waiting list. The account menu
  leads to them.
- The library: recent previews and folder tree, filtering, document creation, multi-upload,
  image/page/PDF/media/table/text viewers, Markdown editing and split preview, autosave and
  conflicts, rename/move/download/delete, revision revert and deleted-file restore. Pins open
  a document over chat. Files/folders can be shared with the workspace or anyone with a link.
  [LIBRARY-PORT.md](LIBRARY-PORT.md) records the scope and integration seams.
- The composer and other chats from `exact-client`, including attachments, model/computer
  pickers, running commands and thread navigation, plus its shared rich Markdown renderer.
- Workspace home and people remain placeholders in this integration (teams is joining
  separately). Workspace settings' old address is its section list, linked to Computers.
- The whole app's `*.test.contract` files run against the real echo server; `./x verify`
  additionally checks sizes, themes, reload/relaunch and largest text. Passwords are enabled
  in `server.ts` so their tests can run.

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
above pin `EXACT_PORT`. Its sockets' address is `API_SOCKET_URL` (`ws:` for `http:`), which `./x`
makes from `API_BASE_URL`.

### Served by the server itself

The server can serve a web build of the app at its own origin, where the browser's session cookie
is the session, shared with the React app:

```sh
DC_BASE_URL=https://agent.example.com pnpm --filter @do-computer/web build:exact   # into apps/web/dist/exact
DC_EXACT_APP=apps/web/dist/exact DC_BASE_URL=https://agent.example.com pnpm --filter @do-computer/web start
```

Its files are at `/x/`. Exact reads a page's route from the whole path and knows no prefix, so
`/x/` (or `/x/a/…`) sets a cookie that picks the Exact app and opens the page at its own address,
`/`, `/a/…`, which from then on are the Exact app's for that browser; `/x/off` goes back to the
React app (`apps/web/src/server/exact-app.ts`). Node only for now. `tools/same-origin.sh` tests it.

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
- **Socket tickets.** A browser's WebSocket carries no header and, across origins, no cookie. So
  a client with a bearer session asks `POST /api/auth/socket/tickets` for a few tickets, and opens
  each socket with one as `?ticket=`: good once, for five minutes, while the session lasts, kept
  only as a hash. See `apps/web/src/server/socket-tickets.ts` and `socketUser` in `auth.ts`.
- **`DC_EXACT_APP`.** The server serving the app itself, above.

## What is not

- **Teams integration.** The transcript from `3d3af6f` is included, with settings, composer,
  library, Markdown, creature and transport. The teams worker's branch is not included: workspace
  home and people pages remain placeholders. See GAPS.md and COMPOSER.md for other chat seams.
- **Creature entry points.** Claiming a Dood hatched in a post, the waiting-list first run and
  public `/dood/:id` and `/hatch` pages are not part of the signed-in port.
- **Shell parity.** Calls, drag ordering and the collapsing rail are not all implemented. The creature native views exist; their presence does not claim the whole React shell.
- **Deployment and native hosts.** The address is a build setting. Server-served Exact works on
  Node via `DC_EXACT_APP`, not the Cloudflare Worker. Apple/Windows hosts and native push have
  not been validated by this web-only port. Remote computers work; Electron's local daemon
  controls do not exist in a plain browser. See GAPS.md for details and external-service limits.

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

## Initial tools-area checks (2026-11-10, before integration)

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

The initial tools pass temporarily used API port 3927 because another app occupied 3917.
The merge validation uses slot 6's normal API 3917 and Exact 8772; no unrelated server is
changed. The browser harness now lives in `tools/tools-check.mjs` and reads `API_BASE_URL`,
`TOOLS_EXACT_URL`, `TOOLS_SAME_ORIGIN` and `TOOLS_OUT` for reproducible integration checks.

The supplemental browser check and reference photographs are kept under `.exact/` in that
worktree (not committed): `.exact/integration.mjs` and `.exact/shots/tools/`. It starts local
MCP/OAuth and daemon-protocol fixtures, but drives the real Do Computer API and Exact page.
External Slack/apps credentials and real cloud-machine provisioning are not used.

The pre-merge verifier passed all 11 tests and ordinary phone/wide, light/dark and reload checks;
three findings remain only at its largest text size, in the shared heading/pill (GAPS.md).
Forty comparison screenshots (five sections × two sizes × two schemes × two apps) were read:
the settings layout, typography, cards and dark colours are recognisable against React.
Exact keeps a route rather than the dimmed-chat overlay, a fixed sidebar rather than React's
rail, a default rather than per-Dood accent, and slightly roomier computer rows. On a phone
Slack's picture explanation/download wraps rather than squeezing its text into a narrow column.

## Merged client validation (2026-11-10)

This branch joins `35595f7`, `687f84a` and `3d3af6f`: the final settings kit, library,
composer, Markdown, creature/first-run/care/wardrobe and complete rich chat transcript.
The teams-worker branch is not included; workspace home and people remain placeholders.
The incoming transcript and thread UI were retained rather than the former basic message row.

There is one shell Dood socket for the transcript **and** tools. Its shared counters include
skills, connectors, schedules and computers and are retained over reconnects. The workspace
Computers route uses the existing directory refresh without selecting a Dood from that list:
`doods` itself refreshes from `pulse`, so selecting `pulse` from `doodList` would be cyclic.
The real panel contains the shared connected-computer directory and pinned shelf. Computer
requests have one canonical above-composer chat card (including on a phone); jobs retain the
composer controls and transcript chips, not a duplicate panel UI. The panel-only directory
does not fetch computer requests. Chat-specific requests/threads are inactive on tools routes.

Validation and evidence:

- The final `./x test web` run passed **65/65 tests in all 23 files**, including all 14 new
  rich-transcript tests. The eight focused settings/shell navigation tests also pass after
  removing the cyclic workspace-stream selection.
- The previous server build's **22 tests** (OAuth returns, socket tickets and Exact serving)
  and the web TypeScript check passed. This transcript merge changes no server/package code.
- The browser tools checks passed on both the development origin and the app served by the
  server at `/x/`: real fixture OAuth redirect/return, MCP tools, live changes from another
  client, pairing, daemon update receipt, ownership transfer, chat-card denial/approval,
  revocation, Slack PNG and absence of bearer secrets in localStorage.
- Fresh comparison evidence for each origin is in `.exact/shots/tools-merged/` and
  `.exact/shots/tools-same-origin/`: 40 Exact/React section images in each, wide/phone and
  light/dark, four `compare-*.jpg` sheets, panel images, `exact-wide-light-chat-request.png`,
  `pico-slack.png` and `result.txt`. Both sets of sheets and the new chat/panel placement were
  opened for inspection. These are real browser renders, not mock-ups or a pixel-parity claim.

**Verifier status is not green.** The latest completed full verifier is from before the
transcript merge: 51 tests passed, then **9 problems** (1 driver failure, 8 findings). Its
first-screen drive collided with slot 6's occupied fixed Exact port 8772. Seven findings were
aggressive `overflow-wrap="anywhere"` declarations; these now use emergency `break-word`
wrapping instead (the affected settings/shell source has zero aggressive-word-breaking
findings). The remaining finding was an inactive threads query caught by the automations
fault test; that query is now chat-route-only. That verifier's largest-text tour reported
nothing spilling. There is no completed post-transcript full verifier result, no font
shrinking and no accessibility waiver. The requested final merge is not held for another
verifier/port-collision cycle. Lean is unavailable here; seeded model walks are not a
full real-host proof.

External Slack/Composio credentials, paid/shared cloud provisioning and a real daemon install
were not exercised. The local fixtures drive the real server/browser paths but are not those
external services. Browser-native OAuth uses an explicit same-window Continue step rather
than React's popup; Electron-only local daemon controls/native OAuth presentation remain
unwired. Automation creation/editing remains chat-based. See GAPS.md and the incoming port
documents for the remaining native, deployment and other-area limitations.

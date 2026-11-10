# Do Computer in Exact

Do Computer's signed-in web app written with [Exact](https://github.com/expo/exact): the view is
`app.contract` and the files in `views/`, the data module is `app.ts` and the files in `data/`.
One source could run on the web, iOS, macOS and Linux; it is built and tested for the web. It
talks to a deployment (`apps/web`) over the same HTTP API and sockets as the React, phone and
desktop apps, and the deployment can serve it itself, at its own origin, beside the React app.

[PORTING.md](PORTING.md) says how it is laid out and how to work on it; [GAPS.md](GAPS.md)
where it differs from the React app and why.

## What is here

Every page of the React app behind sign-in, at the same addresses, in its colours, type
(Geist, Geist Mono), icons and shapes, light and dark, wide and on a phone:

- **Signing in** with a password or making an account, on the React app's card; the session in
  the platform's secret store, or the browser's cookie when the deployment serves the app.
- **The shell.** The sidebar's Doods under each workspace, in the order you put them in, each
  with its creature, the last thing said and when, whether it is working or waiting on you, a
  mark for something new and who else is with it, kept current by the person's feed socket.
  Drag to reorder in a wide window, Move up and Move down on a phone, Sort by latest. A wide
  window has the sidebar beside the page; a phone the list, then the page over it. Deep links,
  reload, Back and Forward work.
- **A Dood from its first moment**: the first run's egg falling out of the night onto its island,
  naming it, its colour and what it thinks with, hatching at sunrise and flying into its chat,
  where it offers what to do first; hatching from the sidebar; its panel with its creature,
  petting, treats, the box and the wardrobe. Its pictures act out what its chat says.
- **A chat**, as the React app's transcript draws it: the reply as it is written over the Dood's
  socket, Markdown with highlighted code, tables and diagrams, tool calls as one line while they
  run, files, visuals (in a sandboxed frame), shared sites, pins, sub-agents and running
  commands as cards, notices, failures with Details and Try again, Sending and Delivered,
  earlier messages a page at a time. Over the composer, what the Dood waits on someone for:
  leave to do something, secrets or a login, a connector or a computer. Sub-agents', other
  Doods', Slack's and old side chats each lead back. In a team, who has the chat open and who is
  typing.
- **The composer**: drafts per chat, files picked, pasted or dropped, pictures made small, the
  model and how hard it thinks, the microphone, the call button, running commands with their
  output and Stop, and the Dood's other chats.
- **Settings**, as the React app's settings window: a Dood's profile (name, tagline, colour, look,
  voice, personality, moving and deleting it), memory, model and computers, skills, connectors
  and Slack, permissions and usage; the person's General, Notifications (web push), Doods and
  Workspaces; a workspace's People, Computers, Models and Passwords; and for whoever looks after
  the deployment, Global models and the waiting list.
- **Calls** with a Dood, wherever the deployment offers them: from the empty composer, the panel
  or the name menu, with its creature listening, thinking and speaking, mute, the live words,
  a card that stays while you go elsewhere, and a folded record in the chat afterwards.
- **Teams**: making one, inviting by email or GitHub, links to pass on, accepting or leaving an
  invitation (also signed out), roles, handing the team on, renaming and deleting it, and who
  is here now.
- **Skills, connectors, computers and automations**: installing a skill from a URL and reading its
  files; MCP connectors with a token or a sign-in, the apps gateway, Slack and its bot picture;
  the workspace's machines and paired computers with their Doods, access, owners, requests and
  daemon updates, and `/pair`; schedules with pause, resume, run now and their runs.
- **The library**: recent files and the tree, filtering, new documents, uploads, viewers for
  pictures, pages, PDFs, media, tables and text, Markdown editing with split preview, autosave
  and conflicts, renaming, moving, downloading, deleting and restoring, history, pins (beside
  the chat, in the Dood's panel) and sharing with the workspace or anyone with a link.

Not here: claiming a Dood hatched in a post, the
waiting list's own first run, and the public pages (`/dood/:id`, `/hatch`, `/s/…`, docs), which
the deployment serves to everyone. GAPS.md has the rest.

## Run it

Exact has no releases: an app uses a checkout of it by path, written into files made for each
machine and kept out of Git. Needs Rust (rustup), Bun 1.4.2, Chrome or Chromium (`CHROME=<path>`
for another) and this repository installed.

```sh
git clone https://github.com/expo/exact ~/exact && (cd ~/exact && bun scripts/exact.mjs setup)
pnpm --filter @do-computer/web build:node    # the deployment the tests and dev loop run
cd apps/do-exact
bun setup.mjs ~/exact && ./x update           # point this checkout at Exact
echo 0 > .slot                                # its ports: 3911 + slot (server), 8766 + slot (page)

./x test web                                  # every *.test.contract, against the real server
./x verify                                    # tests, layout light and dark, largest text, relaunch
./x web                                       # the dev loop (with `bun server.ts` beside it)
tools/same-origin.sh                          # the app served by the server itself
tools/tour.sh                                 # every screen beside the React app's, in .exact/shots/tour
```

`./x` puts the tools on `PATH`, takes the slot's ports and a lock on them, and sets
`API_BASE_URL` (the deployment, read in `app.ts`) and `API_SOCKET_URL`. `server.ts` starts
`apps/web` on the slot's port with an empty data folder, the echo model, saved logins and cards
on, and the page's origin trusted (`DC_CLIENT_ORIGINS`). The Exact app is not part of the pnpm
workspace (`pnpm-workspace.yaml`), so CI and `pnpm-lock.yaml` do not see it.

### Served by the server itself

```sh
DC_BASE_URL=https://agent.example.com pnpm --filter @do-computer/web build:exact   # into apps/web/dist/exact
DC_EXACT_APP=apps/web/dist/exact DC_BASE_URL=https://agent.example.com pnpm --filter @do-computer/web start
```

The build is served at `/x/`. Exact reads a page's route from the whole path and knows no
prefix, so `/x/` (or `/x/a/…`) sets a cookie that picks the Exact app for that browser and opens
the page at its own address (`/`, `/a/…`), which from then on are the Exact app's; `/x/off`
goes back to the React app (`apps/web/src/server/exact-app.ts`). The session is the browser's
cookie, shared with the React app: signing in or out of one is doing it in both. Node only;
without `DC_EXACT_APP` nothing changes.

## What the server gained for it

Each is small, tested, and changes nothing the React, phone or desktop apps see.

- **Sessions without cookies.** Better Auth's `bearer` plugin: a sign-in's reply carries the
  session in `set-auth-token`, sent back as `Authorization: Bearer`. A native host's `fetch` has
  no cookie jar, and a browser sends none across origins.
- **`DC_CLIENT_ORIGINS`.** Origins of client apps served elsewhere: they get CORS headers
  (without credentials) and may sign in (`client-origins.ts`).
- **Socket tickets.** A browser's WebSocket carries no header and, across origins, no cookie, so
  a bearer session asks `POST /api/auth/socket/tickets` for tickets and opens each socket with
  one: good once, for five minutes, kept only as a hash (`socket-tickets.ts`, `socketUser` in
  `auth.ts`), and not counted with sign-in tries (`rate-limit.ts`).
- **A connector's sign-in returns to a client.** `client_return`, to a trusted origin's
  connectors page only, carries the service's answer back to an app with no cookie, which
  finishes it with its session (`connectorClientReturn` in `connectors.ts`).
- **`DC_EXACT_APP`.** The server serving the app itself, above; `build:exact` makes the build.

## Things learned about Exact, 2026-11

- Public `main` builds and tests this app on Linux with nothing but `setup`. The pinned fork the
  [chat template](https://github.com/expo/exact-templates) needs depends on a private
  repository.
- `typescript.sources` crashes the web build on public `main` (a missing `snapback4/ts`);
  `setup.mjs` makes the empty folder that gets past it.
- An app that draws Markdown is run once at build to compile it, in a bundle that does not answer
  `exactTime` (GAPS.md, "Native views and verification").
- An import of a file outside the app's folder is refused unless mounted, and a mount works well:
  `./protocol/chat.ts` is `packages/protocol/src/chat.ts`, so the app applies chat events with
  the same `reduceChat` as every other client.
- Exact renames the app's fonts (`ExactPlanStack…`), so a native view's shadow DOM declares the
  same files again under names of its own (`modules/web/content-style.js`).

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
- A Dood's chat, as the React app's transcript draws it: opened at its newest message and
  following it, with a way back to the newest when the reader has scrolled away, the reply
  arriving as it is written over the Dood's WebSocket, and earlier messages a page at a time.
  The Dood's words as Markdown; what it does on its own as one line while it does it ("Running:
  …"); the files it sends, the visuals it draws (in a sandboxed frame), the sites it shares, what
  it pins, the sub-agents it starts and the commands it leaves running, each as a card that says
  how it stands now; notices of what it was told (a sub-agent reported back, someone allowed
  something, a command ended), a reply that failed in plain words with Details and Try again, a
  message that waits for the Dood as "Sending" and then "Delivered". Over the composer, what the
  Dood waits on someone for: leave to do something, secrets or a login to type, a connector to
  sign in to. A sub-agent's chat, a conversation with another Dood, a thread in Slack and an old
  side chat each say whose they are, lead back, and have their own foot in the composer's place.
  The composer (views/composer.contract) is under it. Its panel beside the chat, from its face
  in the pill, with what is pinned to it.
- Teams: create one with a colour, optional personal Doods and invitations; rename it, manage
  members and their roles, hand ownership on, leave, or delete an empty team. People and
  workspace settings use the shared settings frame; New team is in both its Workspaces list
  and the sidebar. Pending email/GitHub invitations can be
  renewed or withdrawn; links can be copied, previewed signed out, accepted or dismissed.
- The sidebar folds workspaces, opens their people/settings, renames/moves/deletes Doods and
  saves their order to the deployment. Drag a grip with a mouse in a wide window, use Move
  up/down on a phone, or give up a custom order with Sort by latest. Deleting a Dood here keeps its computers.
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
- The remaining automations, skills, connectors and computer-management bodies are placeholders.
- Every `*.test.contract` beside the app drives the real server. `server.ts` turns saved logins
  and cards on (`DC_SECRETS=on`) so Passwords can be tested. The teams screenshot tools compare
  React and Exact; `tools/teams-integration-shots.sh` captures the merged sidebar, settings and
  a second account accepting an invitation.

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
- **Socket tickets.** A browser's WebSocket carries no header and, across origins, no cookie. So
  a client with a bearer session asks `POST /api/auth/socket/tickets` for a few tickets, and opens
  each socket with one as `?ticket=`: good once, for five minutes, while the session lasts, kept
  only as a hash. See `apps/web/src/server/socket-tickets.ts` and `socketUser` in `auth.ts`.
- **`DC_EXACT_APP`.** The server serving the app itself, above.

## What is not

In the order it would be built:

1. **The remaining pages.** Automations, skills, connectors and computer-management bodies
   remain placeholders. Claiming a Dood hatched in a post, the waiting list's own first run and
   the public Dood page (`/dood/:id`, `/hatch`) remain outside this signed-in client.
2. **The rest of a chat.** Slash commands, MCP apps, authenticated screen pictures, visual
   message bridging and what GAPS.md's "Chat transcript" lists.
3. **The rest of the shell.** Touch drag ordering, calls, team live presence, and the React
   app's wide sidebar that folds to a column of faces.
4. **Any deployment.** The address is a constant. A person should type it at sign-in, as on the
   phone, which needs the grant `net.fetch https:` and the address kept in the store.
5. **Apple hosts.** Nothing here was built for iOS or macOS yet: that needs a Mac with Xcode.
   The native Linux build was the evidence, for the first slice, that the data module, the
   secret store and the stream work off the web; it has not been run since the app was split
   into areas. Sign-in with Google or GitHub would go through Exact's OAuth session. A
   native launch opens at the list of Doods: the open chat is not kept across launches.
6. **The app served on Cloudflare.** `DC_EXACT_APP` is the Node server's; the Worker would serve
   the build from its static assets, which the deploy would have to build with Exact's tools.
7. **What Exact has no answer for yet.** MCP app and visual embeds beyond a plain `iframe`,
   push on native hosts, and the desktop app's work: running the daemon and driving the screen
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

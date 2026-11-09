# Do Computer in Exact

A client for Do Computer written with [Exact](https://github.com/expo/exact): the view is
`app.contract`, the data module is `app.ts`, and one source runs on the web, iOS, macOS and Linux.
It talks to a deployment (`apps/web`) over the HTTP API the web and phone apps use.

It is a first slice, not a replacement for either of them yet. [What is here](#what-is-here) and
[what is not](#what-is-not) say where it stands.

## What is here

- Signing in with a password, or making an account. The session is kept in the platform's
  secret store and survives a relaunch.
- The list of your Doods, with the last thing said and whether each is working or asking.
  Hatching a Dood.
- A Dood's main chat: the transcript, opened at its newest message and following it, with the
  reply arriving as it is written over the chat's event stream. Text is drawn as Markdown;
  thinking, tool calls and notices each have a plain row.
- Sending a message.
- A test, `app.test.contract`, that does all of that against Do Computer's own server. It
  passes on the web host (headless Chrome) and on the native Linux host, which draws the app
  itself with no browser and runs `app.ts` on Hermes.

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
answers with the echo model. The address is `API` in `app.ts`.

The web build is served from its own origin, so the server has to be told about it:
`DC_CLIENT_ORIGINS=http://127.0.0.1:8766`, which `server.ts` sets and which is why the commands
above pin `EXACT_PORT`.

## What the server gained for it

- **Sessions without cookies.** Better Auth's `bearer` plugin: a sign-in's reply carries the
  session in `set-auth-token`, and a request sends it back as `Authorization: Bearer`. An Exact
  app's `fetch` has no cookie jar on a native host, and a browser sends none across origins.
- **`DC_CLIENT_ORIGINS`.** Origins of client apps served from somewhere else. They get CORS
  headers (without credentials) and may sign in. See `apps/web/src/server/client-origins.ts`.

## What is not

In the order it would be built:

1. **The rest of a chat.** Approvals, queued messages and Stop, earlier history, attachments and
   pictures, side chats and sub-agents, code blocks with highlighting, tables.
2. **The rest of the app.** Naming and hatching with the egg, the library, automations, skills,
   connectors, computers and pairing, permissions, settings, workspaces and teams.
3. **Any deployment.** The address is a constant. A person should type it at sign-in, as on the
   phone, which needs the grant `net.fetch https:` and the address kept in the store.
4. **Apple hosts.** Nothing here was built for iOS or macOS yet: that needs a Mac with Xcode.
   The native Linux build is the evidence that the data module, the secret store and the stream
   work off the web. Sign-in with Google or GitHub would go through Exact's OAuth session. A
   native launch opens at the list of Doods: the open chat is not kept across launches.
5. **A lossless stream.** Exact drops server-sent events that arrive faster than it commits them
   (`coalesced`), and a chat's events are deltas. The app notices and follows the chat again from
   a fresh snapshot (`heal`). The real fix is following over the WebSocket the server already
   has, which Exact delivers frame by frame, once a socket can carry a bearer session.
6. **What Exact has no answer for yet.** The creature (three.js; here it would be a wgpu or
   Canvas module written again), Mermaid and Shiki (npm packages with DOM or wasm needs), MCP app
   and visual embeds beyond a plain `iframe`, remote push, and the desktop app's work: running
   the daemon and driving the screen and browser. Windows is unfinished in Exact.

## Things learned about Exact, 2026-11-09

- Public `main` built and tested this app on Linux with nothing but `setup`. The pinned fork the
  [chat template](https://github.com/expo/exact-templates) needs does not build outside Expo: it
  depends on a private repository (`expo/snapback`).
- `typescript.sources` crashes the web build on public `main` (a missing `snapback4/ts`).
  `setup.mjs` makes the empty folder that gets past it.
- A reserved `exactTime()` resource failed this app's build ("sources[source] is not a
  function") though the same line works in the `one-screen` pattern. The app does without it.
- An import of a file outside the app's folder is refused unless it is mounted, and a mount
  works well: `./protocol/chat.ts` is `packages/protocol/src/chat.ts`, so the app applies chat
  events with the same `reduceChat` as every other client.

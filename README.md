# durable-computer

An open-source, self-hostable, always-on personal agent. Each agent has a name, an avatar, a
personality, memory and its own computer. It keeps working when the client is closed, runs
schedules, learns skills, and can work on your own machines.

One codebase deploys to Cloudflare Workers and to plain Node. Models are called through
[OpenRouter](https://openrouter.ai). The agent loop is
[pi-durable](https://earendil.com/posts/pi-durable/).

**Status:** early. The core works on both runtimes and is covered by tests; see
[PLAN.md](./PLAN.md) for what is built and what is not.

## Run it on Node

Needs Node 22.19 or newer and pnpm.

```sh
pnpm install
pnpm build
OPENROUTER_API_KEY=sk-or-... pnpm start     # http://127.0.0.1:3000
```

Open the address, create an account, and say hello to your agent. Data lives in `.data/` under
`apps/web` (set `DC_DATA_DIR` to move it): one SQLite file for accounts, and one per agent.

To reach it from another device, set `HOST` to the address to listen on and `DC_BASE_URL` to the
address you will open, for example `HOST=0.0.0.0 DC_BASE_URL=http://my-box.local:3000`. Sign-in
is only accepted from that one address. Plain http is fine for everything except dictation: a
browser only offers the microphone to pages on https or localhost. On a tailnet,
`tailscale serve --bg --https=3000 http://127.0.0.1:3000` gives you https with a real
certificate.

Without `OPENROUTER_API_KEY` the app runs on a built-in echo model. It repeats what you say, and a
message of the form `/tool <name> <json>` makes it call that tool, which is enough to try the
computer, schedules and skills without spending anything.

## Deploy to Cloudflare

```sh
cd apps/web
pnpm exec wrangler d1 create durable-computer      # put the printed id in wrangler.jsonc
pnpm exec wrangler r2 bucket create durable-computer
openssl rand -base64 32 | pnpm exec wrangler secret put DC_AUTH_SECRET
pnpm exec wrangler secret put OPENROUTER_API_KEY
pnpm run deploy
```

Each agent is a Durable Object with its own SQLite storage; accounts are in D1.

Instead of editing `wrangler.jsonc`, a deployment's own values can come from the environment,
which keeps them out of the repository. `pnpm run deploy` applies them to the build before it
uploads: `DC_D1_DATABASE_ID`, the address as `DC_ROUTE` (for example `agent.example.com/*`,
with `DC_ROUTE_ZONE` if needed) or `DC_CUSTOM_DOMAIN`, and any of the plain settings below such
as `DC_BASE_URL` and `DC_SANDBOX`. Keys stay Worker secrets, which a deploy leaves alone.

To deploy from GitHub on every push to `main`, after the tests pass, give the repository the
secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and the variable
`DC_D1_DATABASE_ID`, plus variables for the address and settings above. The token needs to edit
Workers scripts and routes and D1. Without that variable the deploy job is skipped, so a fork
runs the tests and nothing else.

## Configuration

| Variable                                   | Meaning                                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPENROUTER_API_KEY`                       | Pays for every model call on the deployment.                                                                                                                                         |
| `DC_DEFAULT_MODEL`                         | OpenRouter model id new agents start on, unless their owner chose a default of their own. Default `anthropic/claude-sonnet-5.5`.                                                     |
| `DC_BASE_URL`                              | Public origin, for example `https://agent.example.com`. Needed behind a proxy and for sign-in with Google or GitHub.                                                                 |
| `DC_AUTH_SECRET`                           | Signs sessions. Required on Cloudflare; on Node one is generated and kept in the data directory.                                                                                     |
| `DC_SIGNUP`                                | `invite` (default) or `open`. With `invite`, the first account needs no invitation; after that only `DC_ALLOWED_EMAILS` can sign up.                                                 |
| `DC_ALLOWED_EMAILS`                        | Comma-separated emails allowed to sign up.                                                                                                                                           |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Enable sign-in with Google.                                                                                                                                                          |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Enable sign-in with GitHub.                                                                                                                                                          |
| `DC_TRANSCRIPTION_MODEL`                   | OpenRouter speech-to-text model for dictation. Default `openai/whisper-large-v3`.                                                                                                    |
| `DC_SEARCH_MODEL`                          | OpenRouter model that reads web search results for the agent. Default `anthropic/claude-haiku-4.5`.                                                                                  |
| `DC_SUMMARY_MODEL`                         | OpenRouter model that sums up what the agent did after every run, and says which runs are big enough to list. Default `openai/gpt-4.1-nano`: it only needs to be cheap and reliable. |
| `DC_JUDGE_MODEL`                           | OpenRouter model asked whether an agent meant to stop, when it ends on a progress update. Default `mistralai/mistral-small-3.2-24b-instruct`.                                        |
| `DC_SANDBOX`                               | The computer a new agent gets: `just-bash` (default), `daytona`, `modal`, `cloudflare` or `none`. See [Computers](#computers).                                                       |
| `DC_SANDBOX_KINDS`                         | The kinds an agent can be given, comma-separated. Default: every kind that has what it needs.                                                                                        |
| `DC_SANDBOX_NETWORK`                       | `off` gives agents' computers no internet access, whichever kind they are. On by default.                                                                                            |
| `DC_ALLOW_PRIVATE_HOSTS`                   | `1` lets connectors, skill installs and the built-in computer reach this machine and private networks, and use plain http.                                                           |
| `DC_DATA_DIR`, `PORT`, `HOST`              | Node only.                                                                                                                                                                           |

## Computers

Each agent has one computer, of one of the kinds below. A remote machine is created the first
time an agent runs something, and stops by itself when the agent is not using it.

Which kind an agent has is chosen in the app. Its own page has a **Computer** section, and
**Settings** has the kind your new agents get. The server's environment decides what is on
offer: the built-in shell and no computer always, Daytona once `DAYTONA_API_KEY` is set, Modal
once its two tokens are, and a Cloudflare container when `DC_SANDBOX` is `cloudflare`. The keys
stay in the environment and are never shown or entered in the app. `DC_SANDBOX` is the kind an
agent gets when its owner has not chosen, and `DC_SANDBOX_KINDS` narrows what is offered, for
example `just-bash,daytona`.

Moving an agent does not copy its files. What it made stays on the computer it leaves, and is
there again if it is moved back; its memory, chats, skills and automations are with the agent
and are not affected. The agent is told it was moved, so it does not treat a file from the
other computer as lost. It cannot be moved while it is in the middle of a reply. Deleting an
agent deletes every computer it has had.

| Kind         | The computer                                                                                  | Runs on          | What persists                                | Settings                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `just-bash`  | A shell interpreter with a virtual filesystem. No real programs; the internet through `curl`. | Node, Cloudflare | The workspace, in the agent's own database   | none                                                                                                         |
| `daytona`    | A Linux machine on [Daytona](https://www.daytona.io)                                          | Node, Cloudflare | The whole disk                               | `DAYTONA_API_KEY`; optional `DAYTONA_API_URL`, `DAYTONA_TARGET`, `DC_DAYTONA_SNAPSHOT` or `DC_DAYTONA_IMAGE` |
| `modal`      | A Linux machine on [Modal](https://modal.com)                                                 | Node             | The workspace (`/workspace`, a Modal volume) | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`; optional `DC_MODAL_APP`, `DC_MODAL_IMAGE`, `MODAL_ENVIRONMENT`       |
| `cloudflare` | A Linux machine on [Cloudflare Containers](https://developers.cloudflare.com/containers/)     | Cloudflare       | The whole disk, as snapshots                 | the `containers` entry in `wrangler.jsonc`; optional `DC_CLOUDFLARE_IMAGE`, `DC_CLOUDFLARE_INSTANCE`         |
| `none`       | No computer of its own. It can still work on computers of yours that are paired with it.      | Node, Cloudflare |                                              | none                                                                                                         |

Things to know before choosing one:

- **Daytona** stops a machine after 15 minutes without use and starts the same machine again on
  the next command. A machine is only ever created when Daytona says there is none; if Daytona
  cannot be reached the agent is told so, and no empty replacement is made.
- **Modal** stops a machine after 15 minutes without use, and after a day at most. A stopped
  machine is gone, so the next command gets a new one with the same workspace. Packages installed
  outside `/workspace` last until then.
- **Cloudflare** needs the Workers Paid plan. Uncomment the `containers` line in
  `apps/web/wrangler.jsonc` and set `DC_SANDBOX` to `cloudflare`, or add `cloudflare` to
  `DC_SANDBOX_KINDS` to offer it without making it the default. Machines start from Cloudflare's
  managed Debian image, so there is nothing to build. A machine is saved as a snapshot after ten
  minutes without use, and every fifteen while in use, then started from that snapshot.
  Snapshots are in public beta and expire after 30 days, so a stopped machine is restored and
  saved again every 20 days; an agent can be left alone for months and keep its disk.
- On every remote machine, running processes do not survive a stop. Files do, as described above.
- Changing `DC_SANDBOX` changes what new agents get. Agents that exist stay on the kind they
  have until they are moved in the app.
- If a kind stops being offered, because its key was removed or `DC_SANDBOX_KINDS` changed, the
  agents on it use the default until it is offered again, and then go back to it. Their machines
  are not deleted meanwhile, and cannot be: delete such an agent while its kind is offered, or
  remove the machine at the provider.

Daytona has been run for real, on Node and in the Workers runtime: creating the machine, the
shell, file tools, stopping and coming back with its files, moving an agent to it from the
built-in shell and back, and deletion. To repeat that against
your own account: `DAYTONA_API_KEY=... pnpm --filter @durable-computer/sandbox exec vitest run
test/daytona.live.test.ts` (it creates one machine and deletes it). Modal and Cloudflare
Containers are tested against stand-ins that run real commands, and have not yet been run with a
real account: treat the first deployment on either as a trial.

## Limits worth knowing

Every model call is paid from the one deployment key and there are no per-user limits yet, which
is why sign-up is by invitation unless you open it.

## What an agent can do

- **Chat**, in as many separate chats as you like, all sharing its memory. A reply keeps being
  written when you close the tab, and is there when you come back. It can search what was said in
  its other chats, and so can you, from the chat list.
- **Be someone.** It names itself in its first conversation, picks its color, and keeps a
  personality, a profile of you and its own notes. They are capped, visible and editable under
  Identity and memory, and mirrored as `SOUL.md`, `IDENTITY.md`, `USER.md` and `MEMORY.md` in its
  workspace.
- **Look at pictures.** A picture attached or pasted into the message box is shown to the agent
  along with your words, if its model takes pictures; the box says so when it does not. The
  browser scales a copy down for that, and the original goes to the library as a file.
- **Keep going.** An agent's turn ends when it replies without using a tool, and some models
  send a progress update that way in the middle of a task, which would end the work there. So
  the agent has a `progress` tool to say such things with: you read them in the chat as its
  words, and it carries on. When a run still ends on what could be such an update, a small
  model is asked whether the agent meant to go on. If so, it is set going again, a few times in
  a row at most. A question to you is never treated that way.
- **Show its work, briefly.** Beside a chat, on a wide screen, each thing you asked for is one
  entry: a short title and a sentence on what came of it, with the commands, files and searches
  behind it inside for whoever wants them. A small model writes these in the background when a
  run ends and every few steps while one is going, so the agent spends no attention on it.
  Without a model key they are worked out from the run itself.
- **Be a creature.** You see your agent as a small creature that hatches from an egg when you
  first meet it. Its shape and face are grown from a roll of the dice, so no two agents look
  alike, and it acts out what the agent is doing: listening while you type, thinking, working
  at a command or a file or a search, speaking as its answer arrives, and dozing when nothing
  has happened for a while. `pnpm --filter @durable-computer/mascot demo` builds a page for
  trying every state and look.
- **Think with the model you choose.** Each agent can be set to any OpenRouter model that can
  call tools (about 400), from a searchable list on its page, and Settings holds the default your
  new agents start on.
- **Use its computer**: read, write and edit files and run shell commands in a workspace that
  persists. The default computer is [just-bash](https://github.com/vercel-labs/just-bash), a shell
  interpreter with a durable virtual filesystem that needs no machine; it has the usual text tools
  and `curl` for the internet, but no real programs. For a real Linux machine, see [Computers](#computers); on one, the agent
  also starts with a skill for driving a headless browser.
- **Run schedules.** Ask for something later or regularly. Each run happens in its own chat and
  reports back to the chat you asked in; see and pause them under Automations.
- **Learn skills**: saved instructions it loads when a task calls for them, writes for itself, and
  can install from a GitHub folder or a `SKILL.md` URL.
- **Search the web**, when the deployment has a model key: one request to OpenRouter searches,
  reads the results and answers with sources. It works on any computer, including the default one
  with no network, and its cost shows up under Usage with everything else.
- **Use your services.** Under Connectors, add a remote [MCP](https://modelcontextprotocol.io)
  server by its address, with an access token or by signing in to the service. Its tools become
  the agent's. Tokens stay on the server; the agent never sees them.
- **Write you documents.** The folder `library` in the agent's workspace is your Library: what it
  writes there, by hand or with a program, appears in the app in the same folders, and so do the
  files you upload and the edits you make. A Markdown document is read and edited in the app. An
  HTML document is shown as the page it is, and the styles, scripts and images beside it load.
  The files are kept outside the agent's computer, so they are there when it is asleep or gone,
  and it gets them back on a new one. Earlier contents of a file are kept as versions, and a
  deleted file can be brought back. A file the agent sends appears in the chat, and opens beside
  it.
- **Work on your own machines.** On a Mac or Linux box, run the command shown under Computers. It
  prints a link; confirm it and choose the agent. The agent can then run commands and read and
  write files there, and everything it does is logged in `~/.durable-computer/audit.log` on that
  machine. Add `--read-only` to allow reading only.

You can talk instead of typing: the microphone button records, and the server transcribes with
the same OpenRouter key (`DC_TRANSCRIPTION_MODEL`, default `openai/whisper-large-v3`).

## Trust

Agents act without asking first. That is the default on purpose, and it means a prompt injection
in something an agent reads can use whatever that agent can reach, including its connectors and a
paired computer. What limits the damage:

- **Permissions.** For each thing the agent can do, each connector and each of your computers,
  choose Allow, Ask first or Never. With Ask first the agent stops, a request with the exact
  command or arguments appears above the composer and as a notification, and nothing happens until
  you answer. A rule on one of your computers covers everything done there, reading included.
  A rule is about what happens, not which tool does it: "Create and change files" also governs
  commands, which can change files, and "Change its memory and identity" also stops it editing
  the files that mirror them.
- **Its own computer is not yours.** The default computer has no network and no real programs. A
  remote one is a separate machine at a provider.
- **Secrets stay on the server.** Connector tokens and sign-in grants are never in the model's
  context or on the agent's computer.
- **The server will not be used to reach inside your network.** Connector addresses and skill
  installs must be https on a public host, re-checked on every redirect. The built-in computer
  runs inside the server, so what an agent fetches with `curl` there goes through the same check:
  the public internet only, by http or https. On Node every host name is also looked up, so a
  public name pointing at a private address is refused too; a Worker cannot reach private
  networks to begin with. `DC_ALLOW_PRIVATE_HOSTS=1` lifts all of this for a deployment that
  wants services on its own network.
- **Revocation.** Removing a computer cuts its daemon off at once. Removing a connector deletes its
  credentials. Deleting an agent deletes its computer and everything it stored.

## Mobile app

`apps/mobile` is an Expo app for iOS and Android: chat with streaming replies, dictation, the
library, automations, skills, approval requests and push notifications. It talks to your own
deployment; on first launch it asks for the server's address.

```sh
pnpm mobile              # Expo dev server; open in a development build
```

Push notifications and the microphone need a development build, not Expo Go. The app's screens
are tested through its web build; they have not yet been run on a device from this repository.
That includes the agent's creature, which is drawn with `expo-gl`: on a device that cannot run
it, a still picture is shown instead.

## Development

```sh
pnpm dev                 # Node target, http://localhost:3000
pnpm dev:cloudflare      # the same app inside the Workers runtime (copy apps/web/.dev.vars.example)
pnpm check               # type-check everything, both targets
pnpm test                # unit and integration tests, on Node and in the Workers runtime
pnpm test:e2e            # browser tests against the built Node server
scripts/smoke.sh http://localhost:3000     # end-to-end check of any running deployment
```

Paired computers' daemons connect over a WebSocket that `pnpm dev` (the Vite dev server on the
Node target) does not serve; use `pnpm build && pnpm start` or `pnpm dev:cloudflare` to work on
pairing.

### Layout

```
apps/web          TanStack Start app: UI, API, and the server entry for each runtime
apps/mobile       the Expo app
apps/daemon       the daemon a user runs on their own computer
packages/runtime  one actor host interface (SQLite, alarm, blobs, sockets) over Durable Objects and Node
packages/agent    the agent actor: pi-durable harness, identity, chats, history, schedules, skills,
                  connectors, approvals, library
packages/sandbox  the sandbox interface, its adapter to pi-durable, and the providers: just-bash,
                  Daytona, Modal, Cloudflare Containers
packages/computers  the daemon protocol and the actor that holds a paired computer's connection
packages/protocol   types and reducers shared by server and clients
packages/client     API client and reconnecting event streams, for the web and mobile apps
```

Anything that touches a runtime is implemented for both and held to one conformance suite.

## License

MIT

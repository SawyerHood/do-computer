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

## Configuration

| Variable                                   | Meaning                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `OPENROUTER_API_KEY`                       | Pays for every model call on the deployment.                                                                                         |
| `DC_DEFAULT_MODEL`                         | OpenRouter model id for new agents. Default `anthropic/claude-sonnet-5.5`.                                                           |
| `DC_BASE_URL`                              | Public origin, for example `https://agent.example.com`. Needed behind a proxy and for sign-in with Google or GitHub.                 |
| `DC_AUTH_SECRET`                           | Signs sessions. Required on Cloudflare; on Node one is generated and kept in the data directory.                                     |
| `DC_SIGNUP`                                | `invite` (default) or `open`. With `invite`, the first account needs no invitation; after that only `DC_ALLOWED_EMAILS` can sign up. |
| `DC_ALLOWED_EMAILS`                        | Comma-separated emails allowed to sign up.                                                                                           |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Enable sign-in with Google.                                                                                                          |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Enable sign-in with GitHub.                                                                                                          |
| `DC_SANDBOX`                               | What computer agents get: `just-bash` (default) or `none`.                                                                           |
| `DC_DATA_DIR`, `PORT`, `HOST`              | Node only.                                                                                                                           |

Every model call is paid from the one deployment key and there are no per-user limits yet, which
is why sign-up is by invitation unless you open it.

## What an agent can do

- **Chat**, in as many separate chats as you like, all sharing its memory. A reply keeps being
  written when you close the tab, and is there when you come back.
- **Be someone.** It names itself in its first conversation, picks an avatar, and keeps a
  personality, a profile of you and its own notes. They are capped, visible and editable under
  Identity and memory, and mirrored as `SOUL.md`, `IDENTITY.md`, `USER.md` and `MEMORY.md` in its
  workspace.
- **Use its computer**: read, write and edit files and run shell commands in a workspace that
  persists. The default computer is [just-bash](https://github.com/vercel-labs/just-bash), a shell
  interpreter with a durable virtual filesystem that needs no machine; it has the usual text tools
  but no real programs.
- **Run schedules.** Ask for something later or regularly. Each run happens in its own chat and
  reports back to the chat you asked in; see and pause them under Automations.
- **Learn skills**: saved instructions it loads when a task calls for them, writes for itself, and
  can install from a GitHub folder or a `SKILL.md` URL.
- **Work on your own machines.** On a Mac or Linux box, run the command shown under Computers. It
  prints a link; confirm it and choose the agent. The agent can then run commands and read and
  write files there, and everything it does is logged in `~/.durable-computer/audit.log` on that
  machine. Add `--read-only` to allow reading only.

Agents act without asking first. A prompt injection in something an agent reads can therefore use
whatever that agent can reach, including a paired computer. Pair machines with that in mind.

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
apps/daemon       the daemon a user runs on their own computer
packages/runtime  one actor host interface (SQLite, alarm, blobs, sockets) over Durable Objects and Node
packages/agent    the agent actor: pi-durable harness, identity, chats, schedules, skills, computers
packages/sandbox  the sandbox interface, its adapter to pi-durable, and the just-bash provider
packages/computers  the daemon protocol and the actor that holds a paired computer's connection
packages/protocol   types and reducers shared by server and clients
packages/client     API client and reconnecting event streams, for the web and mobile apps
```

Anything that touches a runtime is implemented for both and held to one conformance suite.

## License

MIT

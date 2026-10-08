# durable-computer

An open-source, self-hostable, always-on personal agent. Each agent has a name, an avatar, a
personality and memory, and works on the computers of its workspace. It keeps working when the
client is closed, runs schedules, learns skills, and can work on your own machines. An agent can be yours alone or
shared by a [team](#teams).

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

Each agent is a Durable Object with its own SQLite storage; accounts and teams are in D1. Each
team has one more Durable Object, which holds its members' connections for who is where.

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

| Variable                                   | Meaning                                                                                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`                       | Pays for every model call on the deployment.                                                                                                                      |
| `DC_DEFAULT_MODEL`                         | OpenRouter model id new agents start on, unless their owner chose a default of their own. Default `anthropic/claude-sonnet-5.5`.                                  |
| `DC_BASE_URL`                              | Public origin, for example `https://agent.example.com`. Needed behind a proxy and for sign-in with Google or GitHub.                                              |
| `DC_AUTH_SECRET`                           | Signs sessions. Required on Cloudflare; on Node one is generated and kept in the data directory.                                                                  |
| `DC_SIGNUP`                                | `invite` (default) or `open`. With `invite`, the first account needs no invitation; after that only `DC_ALLOWED_EMAILS` and people invited to a team can sign up. |
| `DC_ALLOWED_EMAILS`                        | Comma-separated emails allowed to sign up.                                                                                                                        |
| `RESEND_API_KEY`, `DC_EMAIL_FROM`          | Send team invitations by email through [Resend](https://resend.com), from that address. Without both, an invitation is a link to pass on.                         |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Enable sign-in with Google.                                                                                                                                       |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Enable sign-in with GitHub.                                                                                                                                       |
| `DC_TRANSCRIPTION_MODEL`                   | OpenRouter speech-to-text model for dictation. Default `openai/whisper-large-v3`.                                                                                 |
| `DC_SEARCH_MODEL`                          | OpenRouter model that reads web search results for the agent. Default `anthropic/claude-haiku-4.5`.                                                               |
| `DC_JUDGE_MODEL`                           | OpenRouter model asked whether an agent meant to stop, when it ends on a progress update. Default `mistralai/mistral-small-3.2-24b-instruct`.                     |
| `DC_SANDBOX`                               | The kind of machine a workspace is given: `just-bash` (default), `daytona`, `modal`, `cloudflare` or `none`. See [Computers](#computers).                         |
| `DC_SANDBOX_KINDS`                         | The kinds of machine on offer, comma-separated. Default: every kind that has what it needs.                                                                       |
| `DC_SANDBOX_NETWORK`                       | `off` gives agents' computers no internet access, whichever kind they are. On by default.                                                                         |
| `DC_ALLOW_PRIVATE_HOSTS`                   | `1` lets connectors, skill installs and the built-in computer reach this machine and private networks, and use plain http.                                        |
| `DC_DATA_DIR`, `PORT`, `HOST`              | Node only.                                                                                                                                                        |

## Computers

An agent has no computer of its own. A workspace, your own or a team's, has machines of the
kinds below, and its agents work on them. A remote machine is created the first time something
runs on it, and stops by itself when nothing is using it.

- **Shared by default.** When you make an agent in a workspace that has no machine it could
  use, the workspace is given one, of the kind under **Default computer** in Settings. It is
  open to every agent of the workspace, so the agents you make afterwards share it.
- **A folder each.** On a machine an agent works in a folder of its own under the home
  directory, named after the agent the first time it works there. Nothing stops it leaving that
  folder: agents on one machine can read and change each other's files, which is how they hand
  work over, and it means a machine is not a wall between them.
- **More than one.** Under **Computers** in a workspace's settings you can add machines, and
  say for each whether every agent of the workspace can use it or only the ones you choose. An
  agent that can use one machine works there without being told to. One that can use several
  says which on each call, and one that can use none says so when a task needs one.
- **Asking.** An agent can see the computers of its workspace and ask to use one it was not
  chosen for; whoever it belongs to answers.

The server's environment decides which kinds are on offer: the built-in shell and no computer
always, Daytona once `DAYTONA_API_KEY` is set, Modal once its two tokens are, and a Cloudflare
container when `DC_SANDBOX` is `cloudflare`. The keys stay in the environment and are never
shown or entered in the app. `DC_SANDBOX` is the kind a workspace gets when nobody has chosen,
and `DC_SANDBOX_KINDS` narrows what is offered, for example `just-bash,daytona`.

Deleting a machine deletes it at the provider, with everything on it. Deleting an agent leaves
the machines it shared, and offers to delete one that only it could use. Moving an agent to
another workspace takes along a machine only it could use; there it has that workspace's
machines, and that workspace's library.

| Kind         | The computer                                                                                  | Runs on          | What persists                                | Settings                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `just-bash`  | A shell interpreter with a virtual filesystem. No real programs; the internet through `curl`. | Node, Cloudflare | The workspace, in one agent's own database   | none                                                                                                         |
| `daytona`    | A Linux machine on [Daytona](https://www.daytona.io)                                          | Node, Cloudflare | The whole disk                               | `DAYTONA_API_KEY`; optional `DAYTONA_API_URL`, `DAYTONA_TARGET`, `DC_DAYTONA_SNAPSHOT` or `DC_DAYTONA_IMAGE` |
| `modal`      | A Linux machine on [Modal](https://modal.com)                                                 | Node             | The workspace (`/workspace`, a Modal volume) | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`; optional `DC_MODAL_APP`, `DC_MODAL_IMAGE`, `MODAL_ENVIRONMENT`       |
| `cloudflare` | A Linux machine on [Cloudflare Containers](https://developers.cloudflare.com/containers/)     | Cloudflare       | The whole disk, as snapshots                 | the `containers` entry in `wrangler.jsonc`; optional `DC_CLOUDFLARE_IMAGE`, `DC_CLOUDFLARE_INSTANCE`         |
| `none`       | No machine is added. Agents can still work on computers of yours that are paired with them.   | Node, Cloudflare |                                              | none                                                                                                         |

Things to know before choosing one:

- **The built-in shell cannot be shared.** Its files are in one agent's database, so where it
  is the default every agent gets its own, which goes when the agent is deleted.
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
- Changing `DC_SANDBOX` changes what a workspace is given from then on. Machines that exist
  stay as they are.
- If a kind stops being offered, because its key was removed or `DC_SANDBOX_KINDS` changed, its
  machines cannot be reached until it is offered again, and cannot be deleted either: delete
  them while the kind is offered, or remove them at the provider.
- **Agents from before machines were shared** keep the machine each had, as a computer of its
  workspace that only that agent can use. Open it to the workspace, or connect other agents to
  it, under Computers.

Daytona has been run for real, on Node and in the Workers runtime: creating the machine, the
shell, file tools, stopping and coming back with its files, moving an agent to it from the
built-in shell and back, and deletion. To repeat that against
your own account: `DAYTONA_API_KEY=... pnpm --filter @durable-computer/sandbox exec vitest run
test/daytona.live.test.ts` (it creates one machine and deletes it). Modal and Cloudflare
Containers are tested against stand-ins that run real commands, and have not yet been run with a
real account: treat the first deployment on either as a trial.

## Limits worth knowing

Every model call is paid from the one deployment key and there are no per-user limits yet, which
is why sign-up is by invitation unless you open it. Everyone invited to a team spends on that key
too. So do agents that write to each other, and an exchange between them runs until they stop
answering or someone stops the conversation.

## What an agent can do

- **Chat.** Choosing an agent opens its main chat, one conversation that carries on. Anything
  else goes in a side chat, from the button on the agent's strip: its own conversation, with the
  same memory, open beside the main chat on a wide screen. A reply keeps being written when you
  close the tab, and is there when you come back. It can search what was said in its other chats.
- **Be someone.** It names itself in its first conversation, picks its color, and keeps a
  personality, a profile of you and its own notes. They are capped, visible and editable in
  its settings. They are kept with the agent and on no computer.
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
- **Use a computer**: read, write and edit files and run shell commands on a machine of its
  workspace, in a folder of its own that persists. An agent has no computer to itself: a
  workspace has machines, and its agents share them. The default is
  [just-bash](https://github.com/vercel-labs/just-bash), a shell interpreter with a durable
  virtual filesystem that needs no machine; it has the usual text tools and `curl` for the
  internet, but no real programs, and it is the one kind that each agent has to itself. For a
  real Linux machine, see [Computers](#computers); where a deployment offers one, an agent also
  starts with a skill for driving a headless browser.
- **Run schedules.** Ask for something later or regularly. Each run happens in its own chat and
  reports back to the chat you asked in; see and pause them under Automations.
- **Hand work to sub-agents.** For a piece of work that stands on its own, the agent can start
  a sub-agent: a copy of itself, with its memory, skills and computers, working in the
  background in a conversation of its own while the agent stays free to talk. Several can work
  at once. When one finishes, its report arrives in the chat that started it and the agent
  tells you what came of it. You can open a sub-agent's chat and read along, and stop it; only
  the agent writes in it.
- **Write to other agents.** An agent can see the other agents in its workspace and send one a
  message: for something that one knows or can do, or because you asked it to. The message
  opens a conversation of its own on the other agent, which answers as itself, with its own
  memory, skills and computer. The answer arrives in the chat that asked, and your agent tells
  you what came of it. You can open the conversation from either agent and read it, and stop
  it; only the two agents write in it. There is nothing to switch on, and nothing limits how
  long two agents go back and forth.
- **Learn skills**: saved instructions it loads when a task calls for them, writes for itself, and
  can install from a GitHub folder or a `SKILL.md` URL.
- **Search the web**, when the deployment has a model key: one request to OpenRouter searches,
  reads the results and answers with sources. It works on any computer, including the default one
  with no network, and its cost shows up under Usage with everything else.
- **Use your services.** Under Connectors, add a remote [MCP](https://modelcontextprotocol.io)
  server by its address, with an access token or by signing in to the service. Its tools become
  the agent's. Tokens stay on the server; the agent never sees them.
- **Write you documents.** A workspace has one Library, which all its agents share. On each of
  its machines the folder `~/library` is that library: what an agent writes there, by hand or
  with a program, appears in the app in the same folders, and so do the files you upload and the
  edits you make, on every machine. A Markdown document is read and edited in the app. An
  HTML document is shown as the page it is, and the styles, scripts and images beside it load.
  The files are kept outside any computer, so they are there when a machine is asleep or gone,
  and a new machine gets them. Earlier contents of a file are kept as versions, and a
  deleted file can be brought back. A file the agent sends appears in the chat, and opens beside
  it.
- **Work on your own machines.** On a Mac or Linux box, run the command shown under Computers. It
  prints a link; confirm it, say whose the computer is, and choose which agents get it. Those
  agents can then run commands and read and write files there, and everything they do is logged
  in `~/.durable-computer/audit.log` on that machine. Add `--read-only` to allow reading only.
  A computer is paired once and connected to as many agents as you like, in any of your
  workspaces: Computers lists each one with its agents, to add and remove. An agent that was not
  given a computer can see that it is there and ask for it. Whoever it belongs to gets a
  notification and a request in the app, and the agent is told the answer in the chat it asked
  from.

You can talk instead of typing: the microphone button records, and the server transcribes with
the same OpenRouter key (`DC_TRANSCRIPTION_MODEL`, default `openai/whisper-large-v3`).

## Teams

Everyone has a personal workspace, which only they can see. A team is a workspace several people
share: start one from the workspace menu at the top of the sidebar.

- **Inviting.** Ask people by email address or GitHub username. Each gets a link that works once,
  for seven days. An email address is written to where the deployment can send mail; otherwise
  the link is shown to whoever sent it, to pass on. An invitation to a GitHub username is waiting
  for that account when it signs in. On a deployment where sign-up is by invitation, being
  invited to a team is enough to sign up.
- **Sharing.** Every member can use every agent in the team, read all of its chats, write in
  them, and make new agents there. An agent of your own can be moved into a team, and back.
- **One chat, several people.** A message from someone else has their face and name on it, and
  the agent is told who is speaking. By default a message that arrives while the agent is
  working waits its turn; that is a setting on each agent.
- **Who is where.** The list of agents shows who is with which agent, a chat shows who is in it
  and who is writing, and the team's page lists everyone who is here.
- **Roles.** Members do all of the above. Admins also invite and remove people, rename the team,
  and move or delete its agents. The owner also decides who is an admin, and can hand the team
  on or delete it.

What a team shares is everything about its agents: what an agent remembers is the team's, a
connector someone signed in to acts as them for whoever is using the agent, and a computer
connected to a team's agent runs commands for all of them. Anyone in the team can answer what the
agent asks leave for, and the others see who did.

A computer belongs either to the person who paired it or to a team. Your own computer is yours
to hand out: only you connect it to agents, a team's agents included, and only you answer when
an agent asks for it. A team's computer can be connected to the team's agents by anyone in the
team, and anyone in the team can answer for it; whoever paired it, or an admin, can remove it. A
team's agent can see the team's computers and its members' own, and ask for any of them.
Removing someone from a team ends their access at once, disconnects their own computers from
the team's agents, and removes the computers they paired for the team, since those run as them.

## Slack

An agent can be put in Slack as a bot under its own name, from **Slack** in its settings. Each
agent is a Slack app of its own, which you make: the settings open Slack's page for that already
filled in, and you paste back the bot token and signing secret Slack gives the app. Nothing is
set on the deployment, which only needs an address Slack can reach.

- **Speaking to it.** Mention the bot in a channel it has been added to, or write to it directly.
  It answers in the thread. Mention it again there and it carries on the same conversation,
  having been given what others said in between.
- **Files.** A file attached to a message for the bot is kept in the library, as one attached
  in the app is, and a picture is shown to a model that can look at one. A file the agent
  sends in the thread's chat is posted to the thread, before the words that are about it.
- **In the app.** Each Slack thread is a conversation of the agent's, listed in its panel under
  "From Slack". It is read there and written in from Slack. A teammate's messages have their
  face; they are found by the email address of their account.
- **Everyone else.** Anyone in the Slack workspace can speak to the bot. For someone who is not
  one of the agent's people, using a connector or a computer one of you paired waits for an OK
  in the app, whatever the agent's permissions say.
- **Slack as a connector.** Separately, an agent can search Slack, read channels and send
  messages as a person, through Slack's own MCP server. Give the Slack app's client ID and
  secret when adding the agent to Slack, then press "Connect Slack as you". Slack's server does
  not let an app register itself, which is why the app's own id is needed; any connector can be
  given a client ID and secret the same way.

## Trust

Agents act without asking first. That is the default on purpose, and it means a prompt injection
in something an agent reads can use whatever that agent can reach, including its connectors and a
paired computer. What limits the damage:

- **Permissions.** For each thing the agent can do, each connector and each of your computers,
  choose Allow, Ask first or Never. With Ask first the agent stops, a request with the exact
  command or arguments appears above the composer and as a notification, and nothing happens until
  you answer. A rule on one of your computers covers everything done there, reading included.
  A rule is about what happens, not which tool does it: "Create and change files" also governs
  commands, which can change files.
- **A workspace's machine is not yours.** The built-in shell has no real programs and reaches
  only the public internet. A remote one is a separate machine at a provider.
- **Agents on one machine are not walled off from each other.** Each has its own folder, and any
  of them can read and change the others' files and stop their programs. What an agent
  remembers is not on a machine, so another agent cannot change it there. Give an agent whose
  permissions you have limited a machine that only it can use.
- **Secrets stay on the server.** Connector tokens and sign-in grants are never in the model's
  context or on the agent's computer.
- **The server will not be used to reach inside your network.** Connector addresses and skill
  installs must be https on a public host, re-checked on every redirect. The built-in computer
  runs inside the server, so what an agent fetches with `curl` there goes through the same check:
  the public internet only, by http or https. On Node every host name is also looked up, so a
  public name pointing at a private address is refused too; a Worker cannot reach private
  networks to begin with. `DC_ALLOW_PRIVATE_HOSTS=1` lifts all of this for a deployment that
  wants services on its own network.
- **A team's agent is reachable by its members and nobody else.** Who is in a team is checked
  on every request, from the session and the database, never from what the client says.
- **Agents write only to the agents beside them.** An agent reaches the other agents of its
  workspace, your own or a team's, and no others. That is looked up on the server each time a
  message or an answer is handed over, and a browser cannot send one in an agent's name. A
  message from another agent is marked as that agent's and not yours, and the agent that gets it
  is held to its own permissions. It does mean that what one agent was talked into by something
  it read can be passed on to another.
- **Slack is a wider room.** What Slack sends is taken in only when it is signed with the Slack
  app's secret, and recently. The bot's token and that secret are kept on the server and never
  sent back to a browser. Anyone in the Slack workspace can then speak to the agent, which
  answers with what it knows and can do: its memory, its chats, its workspace's machines. Only
  connectors and paired computers are held back for people who are not the agent's own, so an
  agent that knows things not everyone in your Slack should hear is not one to put there.
- **Asking for a computer changes nothing by itself.** An agent can see which computers the
  people it works for have paired, by name, owner and whether they are online, and nothing else
  about them. It gets one only when someone the computer belongs to says yes.
- **Revocation.** Removing a computer cuts its daemon off at once, and disconnecting an agent
  from one ends that agent's access to it: which agents may use a computer is looked up on the
  server before every use, not left to what the agent remembers. Removing a connector deletes its
  credentials. Deleting an agent deletes everything it stored, and offers to delete a machine
  that only it could use. Its files in the library are the workspace's, and stay.

## Notifications, and the app on a phone's home screen

The web app tells you when an agent answers in a chat you do not have open, needs your OK, or
reports on a schedule. Turn it on under your name, then **Notifications**, in each browser you
want it in. It uses Web Push, so it works with the app closed, and needs nothing set up: the
server makes its own signing keys the first time and keeps them with its data. The site has to
be served over HTTPS (or be `localhost`).

The site is also an installable app. On Android, Chrome offers **Install app** or **Add to Home
screen**. On an iPhone or iPad (iOS 16.4 or later), use Share, then **Add to Home Screen**; iOS
only delivers notifications to a site that was added there, and they are turned on from inside
the installed app. Nothing is kept for offline use.

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

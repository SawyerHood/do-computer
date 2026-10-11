# durable-computer

An open-source, self-hostable, always-on personal agent. Each agent has a name, an avatar, a
personality and memory, and works on the computers of its workspace. It keeps working when the
client is closed, runs schedules, learns skills, and can work on your own machines. An agent can be yours alone or
shared by a [team](#teams).

One codebase deploys to Cloudflare Workers and to plain Node. Models are called through
[OpenRouter](https://openrouter.ai) on the deployment's key, or through a provider a workspace
has [signed in to](#models). The agent loop is
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
The built-in shell runs agents' commands in Dynamic Workers (the `worker_loaders` entry in
`wrangler.jsonc`), which need the Workers Paid plan.

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

| Variable                                   | Meaning                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`                       | Pays for every call to the deployment's own models. A workspace signed in to a provider of its own pays for those. See [Models](#models).                                                                                                                                           |
| `DC_DEFAULT_MODEL`                         | Model new agents start on unless their owner chose one: `provider/model` or an OpenRouter id. Default `anthropic/claude-haiku-5.5`, or the first of `DC_MODELS`.                                                                                                                    |
| `DC_MODELS`                                | The only models the deployment itself offers, comma-separated: `provider/model` or OpenRouter ids. Default: all it can run. See [Models](#models).                                                                                                                                  |
| `DC_ADMIN_EMAILS`                          | Comma-separated emails of those who may sign the deployment itself in to model providers, for everyone. See [Models](#models).                                                                                                                                                      |
| `DC_BASE_URL`                              | Public origin, for example `https://agent.example.com`. Needed behind a proxy and for sign-in with Google or GitHub.                                                                                                                                                                |
| `DC_AUTH_SECRET`                           | Signs sessions. Required on Cloudflare; on Node one is generated and kept in the data directory.                                                                                                                                                                                    |
| `DC_SIGNUP`                                | `invite` (default), `waitlist` or `open`. With `invite`, the first account needs no invitation; after that only `DC_ALLOWED_EMAILS` and people invited to a team can sign up. With `waitlist` anyone can, and waits: see [Doods and the waiting list](#doods-and-the-waiting-list). |
| `DC_ALLOWED_EMAILS`                        | Comma-separated emails allowed to sign up.                                                                                                                                                                                                                                          |
| `DC_LANDING`                               | `1` shows the landing page at `/` to whoever is not signed in; without it `/` leads to the sign-in form. It says "coming soon" where sign-up is by invitation.                                                                                                                      |
| `RESEND_API_KEY`, `DC_EMAIL_FROM`          | Send team invitations by email through [Resend](https://resend.com), from that address. Without both, an invitation is a link to pass on.                                                                                                                                           |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Enable sign-in with Google.                                                                                                                                                                                                                                                         |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Enable sign-in with GitHub.                                                                                                                                                                                                                                                         |
| `DC_TRANSCRIPTION_MODEL`                   | OpenRouter speech-to-text model for dictation. Default `openai/whisper-large-v3`.                                                                                                                                                                                                   |
| `DC_SEARCH_MODEL`                          | OpenRouter model that reads web search results for the agent. Default `anthropic/claude-haiku-4.5`.                                                                                                                                                                                 |
| `DC_JUDGE_MODEL`                           | OpenRouter model asked whether an agent meant to stop, when it ends on a progress update. Default `mistralai/mistral-small-3.2-24b-instruct`.                                                                                                                                       |
| `DC_REVIEW_MODEL`                          | OpenRouter model that notes where each chat stands, for the agent's other chats. Default: the model that reads web search results.                                                                                                                                                  |
| `DC_SANDBOX`                               | The kind of machine a workspace is given: `just-bash` (default), `daytona`, `modal`, `cloudflare` or `none`. See [Computers](#computers).                                                                                                                                           |
| `DC_SANDBOX_KINDS`                         | The kinds of machine on offer, comma-separated. Default: every kind that has what it needs.                                                                                                                                                                                         |
| `DC_SANDBOX_NETWORK`                       | `off` gives agents' computers no internet access, whichever kind they are. On by default.                                                                                                                                                                                           |
| `DC_ALLOW_PRIVATE_HOSTS`                   | `1` lets connectors, skill installs and the built-in computer reach this machine and private networks, and use plain http.                                                                                                                                                          |
| `DC_DATA_DIR`, `PORT`, `HOST`              | Node only.                                                                                                                                                                                                                                                                          |

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

| Kind         | The computer                                                                                  | Runs on          | What persists                                                                                        | Settings                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `just-bash`  | A shell interpreter with a virtual filesystem. No real programs; the internet through `curl`. | Node, Cloudflare | The workspace: on Node in one agent's own database, on Cloudflare in a Durable Object of the shell's | on Cloudflare, the `worker_loaders` entry in `wrangler.jsonc`                                                |
| `daytona`    | A Linux machine on [Daytona](https://www.daytona.io)                                          | Node, Cloudflare | The whole disk                                                                                       | `DAYTONA_API_KEY`; optional `DAYTONA_API_URL`, `DAYTONA_TARGET`, `DC_DAYTONA_SNAPSHOT` or `DC_DAYTONA_IMAGE` |
| `modal`      | A Linux machine on [Modal](https://modal.com)                                                 | Node             | The workspace (`/workspace`, a Modal volume)                                                         | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`; optional `DC_MODAL_APP`, `DC_MODAL_IMAGE`, `MODAL_ENVIRONMENT`       |
| `cloudflare` | A Linux machine on [Cloudflare Containers](https://developers.cloudflare.com/containers/)     | Cloudflare       | The whole disk, as snapshots                                                                         | the `containers` entry in `wrangler.jsonc`; optional `DC_CLOUDFLARE_IMAGE`, `DC_CLOUDFLARE_INSTANCE`         |
| `none`       | No machine is added. Agents can still work on computers of yours that are paired with them.   | Node, Cloudflare |                                                                                                      | none                                                                                                         |

Things to know before choosing one:

- **On Node the built-in shell is not shared.** Its files are in one agent's database, so where
  it is the default every agent gets its own, which goes when the agent is deleted. On
  Cloudflare it is a machine like the others: a workspace is given one for its agents to share,
  each in a folder of its own, and more can be added under Computers.
- **On Cloudflare the built-in shell is [Cloudflare Computer](https://github.com/cloudflare/computer)'s.**
  Its files are in a Durable Object of its own (about 10 GB, read as they are needed), and each
  command runs in a Dynamic Worker started for it, which can reach those files and, through the
  server, the public internet, and nothing else. That needs the Workers Paid plan: Dynamic
  Workers are billed per shell per day it is used, after the first thousand a month. The
  package is a preview and says of itself that it is not for production. On Node the shell runs
  inside the server, with every file held in memory (64 MB at most). A shell that ran inside a
  Cloudflare deployment before this has its files moved over the first time it is used; the
  old tables stay in the agent's database as `dc_fs_moved` and `dc_fs_chunks_moved`.
- **What the Cloudflare shell does not do:** a command that its caller stops, or that runs past
  its time, is no longer waited for but runs on until ten minutes are up, since the shell's
  Worker cannot be told to stop; and what it prints arrives when it is over, not as it goes.
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

## Models

There are two places an agent's model can come from: the deployment, which offers its models to
everyone, and the agent's workspace, which can be signed in to a provider with an account of its
own.

**The deployment's models.** A deployment with `OPENROUTER_API_KEY` offers every OpenRouter model
that can call tools, and pays for them. It can also be signed in to any provider, in any of the
ways a workspace can be (below): someone named in `DC_ADMIN_EMAILS` finds **Server models** in
their workspace's settings, and what they sign the server in to there is offered to every
workspace as the deployment's own. Where anyone can sign up (`DC_SIGNUP=open`), an admin's
address also has to be one a Google or GitHub sign-in vouches for.

`DC_MODELS` narrows what the deployment offers to the models it names, for example

```sh
DC_MODELS=meta/muse-spark-1.3-contributor,anthropic/claude-haiku-5.5,openai/gpt-6-luna
```

Each is a model's whole id (`anthropic/claude-haiku-5-5` for Anthropic's own) or its OpenRouter
id. They are offered in that order, and new agents start on the first unless `DC_DEFAULT_MODEL`
names another of them. The deployment's key and sign-ins are then used for those models and for
no other, whatever an agent was set to before. The small models the server itself uses for web
search, notes and dictation are not chosen by anyone and are not narrowed.

**A workspace's own.** A workspace can be signed in to a model provider of its own, and its
agents can then be set to any of that provider's models, whatever `DC_MODELS` says:

- **With a subscription**, through the provider's own sign-in: Claude Pro or Max, ChatGPT (for
  OpenAI's models, and for Codex), GitHub Copilot, and a few more.
- **With a key**, for any of the providers [pi](https://github.com/earendil-works/pi) knows:
  Anthropic, OpenAI, Google, OpenRouter, Groq, Mistral, xAI and some thirty others.

A sign-in belongs to the workspace. Every agent in it can run on it, everyone in a team can set
an agent to its models, and what they use counts against whoever signed in. That holds for a
model the deployment offers too: a workspace signed in to its provider runs it on its own
account. Whoever signed in, or an admin of the team, can sign out; someone who leaves a team
takes their sign-ins along. Keys and tokens are kept on the server and are never sent to a
browser or shown to an agent.

It is under **Models** in a workspace's settings. A subscription is signed in to on the
provider's own page, which ends with a code to paste back or asks for a short code shown in the
app; nothing is installed and no address has to be registered with the provider. An agent's
model picker then lists those models under where they come from.

Someone new is asked in the first run what their agent should think with: one of the
deployment's models, or one of their own, which they can sign in to there and then.

An agent set to a model the deployment has since stopped offering goes on with the model new
agents start on. One whose workspace signed out of its model's provider says so in the chat
until it is signed in again or set to another model.

Amazon Bedrock and Google Vertex are not offered: they sign in with files and roles of the
machine the server runs on, which belong to no workspace.

## Limits worth knowing

Every call to one of the deployment's models is paid from the one deployment key and there are
no per-user limits yet, which is why sign-up is by invitation unless you open it. `DC_MODELS`
keeps what it can be spent on to the models you name. Everyone
invited to a team spends on that key too. So do agents that write to each other, and an exchange between them runs until they stop
answering or someone stops the conversation.

## What an agent can do

- **Chat.** Choosing an agent opens its main chat, one conversation that carries on. Anything
  else goes in a side chat, from the button on the agent's strip: its own conversation, which
  picks up from the main chat, open beside it on a wide screen. A reply keeps being written when
  you close the tab, and is there when you come back. Every chat, a Slack thread included, is
  told where the agent's other chats stand and what was finished in them, and it can search and
  read what was said there.
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
- **Be looked after, a little.** The creature earns a treat each time its agent answers you.
  Give it a few and it finds a box; inside is one of two hundred things to wear, from common to
  legendary, which it then wears wherever it is shown. It changes nothing about what the agent
  can do.
- **Think with the model you choose.** Each agent can be set to any OpenRouter model that can
  call tools (about 400), from a searchable list on its page, and Settings holds the default your
  new agents start on.
- **Use a computer**: read, write and edit files and run shell commands on a machine of its
  workspace, in a folder of its own that persists. An agent has no computer to itself: a
  workspace has machines, and its agents share them. The default is
  [just-bash](https://github.com/vercel-labs/just-bash), a shell interpreter with a durable
  virtual filesystem that needs no machine; it has the usual text tools and `curl` for the
  internet, but no real programs, and on Node it is the one kind that each agent has to itself. For a
  real Linux machine, see [Computers](#computers); where a deployment offers one, an agent also
  starts with a skill for driving a headless browser.
- **Run schedules.** Ask for something later or regularly. Each run happens in its own chat and
  reports back to the chat you asked in; see and pause them under Automations. A task that mostly
  finds nothing to do ("tell me when the build breaks") can have a check: a shell command that
  runs first each time, with no model. The agent is started only when the check prints
  something, or when what it prints changes, so looking often costs no tokens.
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
  the agent's. Tokens stay on the server; the agent never sees them. [Apps](#apps) is one
  that needs no address: one button, a sign-in at Composio, and the agent reaches your own
  accounts on Gmail, Google Calendar, Slack, Notion, GitHub and hundreds of other services.
- **Write you documents.** A workspace has one Library, which all its agents share. On each of
  its machines the folder `~/library` is that library: what an agent writes there, by hand or
  with a program, appears in the app in the same folders, and so do the files you upload and the
  edits you make, on every machine. A Markdown document is read and edited in the app. An
  HTML document is shown as the page it is, and the styles, scripts and images beside it load.
  The files are kept outside any computer, so they are there when a machine is asleep or gone,
  and a new machine gets them. Earlier contents of a file are kept as versions, and a
  deleted file can be brought back. A file the agent sends appears in the chat, and opens beside
  it.
- **Show you things, and share them.** Where a chart, a table or a diagram says more than
  prose, the agent draws one into the chat: a small page of its own, in the app's colors, kept in
  the Library under `visuals/`. Anything in the Library can be shared with a link of its own,
  by the agent or from its Share button: a page is shown as the page, a folder with an
  `index.html` as the website it is, a Markdown document as a document to read, a picture as
  the picture, any other folder as a list of its files, and anything else as a download. The
  link opens for the people in the workspace, signed in, until someone chooses "Anyone with the
  link"; an agent has to ask before making one public. A link shows the files as they are, so
  it changes when they do. Pages an agent wrote run apart from the app and from your account.
- **Work on your own machines.** On a Mac or Linux box, run the command shown under Computers. It
  prints a link; confirm it, say whose the computer is, and choose which agents get it. Those
  agents can then run commands and read and write files there, and everything they do is logged
  in `~/.durable-computer/audit.log` on that machine. Add `--read-only` to allow reading only.
  A computer is paired once and connected to as many agents as you like, in any of your
  workspaces: Computers lists each one with its agents, to add and remove. An agent that was not
  given a computer can see that it is there and ask for it. Whoever it belongs to gets a
  notification and a request in the app, and the agent is told the answer in the chat it asked
  from.
- **Use a browser on your computer.** On a computer you paired, an agent can run short scripts in
  a browser, with [dev-browser](https://github.com/SawyerHood/dev-browser), which the daemon
  fetches the first time. It uses your own Chrome when that is open and lets itself be used
  (tick "Allow remote debugging for this browser instance" at `chrome://inspect/#remote-debugging`,
  or start Chrome with a debugging port), and is then signed in wherever you are. Otherwise it
  keeps a browser of its own, with its own sign-ins, which nobody sees but in the chat. Start
  the daemon with `--no-browser` to allow neither.
- **Use your screen.** In the [desktop app](#desktop-app), under This Computer, you can let
  agents use the computer's screen, through [Cua Driver](https://github.com/trycua/cua). They
  work in one window at a time, behind whatever you have in front: they are shown that window
  and click and type in it without your mouse or keyboard, so you can carry on with your own
  work. What cannot be done that way (a drag on a Mac, most things on Linux) an agent does with
  the window brought forward for a moment, or on the whole screen with the mouse and keyboard.
  It is off until you switch it on there, and an agent cannot switch it on. While one is at
  work a bar says who it is and has Pause and Stop, and its pointer is drawn in its colour,
  with its name, where what it is clicking can be seen; while it has the whole screen there is
  a glow round it and Esc pauses too. A daemon run by hand has no screen for agents.
- **Watch either.** While an agent uses a screen or a browser, the chat has a small window of
  it, as it is, with the agent's pointer and what it is doing. It can be opened large, paused
  and stopped from there. Afterwards the window folds to one line, with the picture taken at
  each step behind it. Nothing is shown of a screen that no agent is using.

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
  the agent is told who is speaking. A message that arrives while the agent is working joins
  what it is doing; each agent has a setting to make it wait its turn instead.
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
set on the deployment, which only needs an address Slack can reach. The same settings give you
the agent's picture as a file, to set as the app's icon in Slack.

- **Speaking to it.** Mention the bot in a channel it has been added to, or write to it directly.
  It answers in the thread. Mention it again there and it carries on the same conversation,
  having been given what others said in between.
- **Files.** A file attached to a message for the bot is kept in the library, as one attached
  in the app is, and a picture is shown to a model that can look at one. A file the agent
  sends in the thread's chat is posted to the thread, before the words that are about it.
- **In the app.** Each Slack thread is a conversation of the agent's, listed in its panel under
  "From Slack". It is read there and written in from Slack. Someone whose address in Slack is
  an account's here has their face on their messages.
- **Everyone in the Slack workspace.** Anyone there can speak to the bot, and it works for them
  as it does for you in the app, with everything it knows and can do. The agent's Permissions
  hold there as they do anywhere.
- **On its own.** From any chat or automation the agent can go to Slack unasked: see which
  channels it has been added to, read one, and write in one or to a person, with a file from
  the library if it has one. It does this as the bot, so it reads and writes only where the bot
  has been added (`/invite @name` in a channel). "Write in Slack unasked" is one of its
  Permissions.

The bot is all an agent is in Slack: it does nothing there as a person. A connector to another
service can still be given a client ID and secret, for a service whose sign-in lets no app
register itself.

## Apps

An agent's Connectors offer **Connect apps**. One click adds a connector called Apps, which is
[Composio](https://composio.dev)'s MCP server, and sends you to Composio to sign in with an
account of your own, which is free to make. From then on the agent reaches the accounts you
connect there: Gmail, Google Calendar, Drive, Outlook, Slack, Notion, GitHub, Linear and
hundreds more. An agent can also add Apps itself when you ask for something in one of your
accounts: it asks leave as for any change to its connectors, and a Sign in button appears
beside the chat.

The deployment needs nothing for this: no key and no setting. Composio's calls are counted
against your Composio account, not the deployment.

- **Signing in to a service.** The first time a task needs one, the agent gives you a link in
  the chat. The page is Composio's and says so.
- **It asks first.** Apps starts on Ask first: finding tools and handing you a sign-in link go
  ahead, and anything else waits for your answer, with what would be run in front of you.
  Permissions can set it to Allow.
- **Whose accounts.** Those of whoever signed in to Composio for that agent. In a team, that
  is one person's accounts for everyone who uses the agent, as with any connector someone
  signs in to. Each agent is signed in separately.
- **What Composio holds.** The grants you give each service are kept by Composio, in your
  account there, and every call an agent makes in one passes through it. You see and
  disconnect them at Composio. Removing Apps from an agent takes away the server's sign-in to
  your Composio account and leaves your accounts there as they were.

## Doods and the waiting list

A **Dood** is a creature anyone can hatch with no account, at `/hatch`: an egg comes down, they
name it and choose its color, hatch another if they would rather, and keep one of the three
things in its present. It then has a page of its own, `/dood/<id>`, where anyone can stroke it
and give it a treat, one a day each. Both pages say in their heads that they are X's player
card, so a post on X that links to one plays it inside the post, 480 pixels square, where X
does that; elsewhere the link shows as a picture that opens the page. The pictures are in
`apps/web/public/dood` (made by `prototypes/dood-embed/posters.mjs`): one of an egg, and one
Dood of each color, since a Dood's own look cannot be drawn by the server.

Whoever hatched one can **claim** it by signing in, from the browser they hatched it in. It
becomes their first agent, named and looking as it did and wearing what it kept. From then on
the treats people give it on its page are eaten by the agent's creature, and fill presents as
its own treats do.

With `DC_SIGNUP=waitlist` anyone can make an account, in the first run or by claiming a Dood,
and has their Dood and nothing else: every other call answers 403 until they are let in. The
app is for whoever was there before the list, the first account, the addresses
`DC_ALLOWED_EMAILS` and `DC_ADMIN_EMAILS` name (once known to be theirs: sign in with Google
or GitHub), and anyone invited to a team. Someone `DC_ADMIN_EMAILS` names lets the rest in one
at a time under **Workspace settings → Waiting list**; with `RESEND_API_KEY` set they are sent
an email. `DC_SIGNUP=open` lets everyone in at once. A Dood that waited becomes its owner's
agent the first time they come back, with the treats it was given meanwhile.

A name is shown to anyone under the deployment's own address. It is kept to 20 letters,
digits and a little punctuation, and nothing that reads as a web address; there is no list of
words it refuses. `DELETE /api/doods/<id>`, as someone `DC_ADMIN_EMAILS` names, takes one down.

## Trust

Agents act without asking first. That is the default on purpose, and it means a prompt injection
in something an agent reads can use whatever that agent can reach, including its connectors and a
paired computer. What limits the damage:

- **A few things ask first from the start**, because they cost money or give the agent more
  reach: adding a machine to the workspace, adding or changing a connector, changing its own
  model and settings, and making another agent. Each can be set to Allow under Permissions.
  Removing a machine asks every time, and an agent can only remove one it added. Only a
  conversation with a person can do any of these: a sub-agent or a scheduled run cannot.
- **Secrets are typed into a form, not into the chat.** When an agent needs an API key or a
  password it asks with its `request_secret` tool. A form appears above the message box, and what
  is typed is written to a dotenv file on the agent's computer (or kept as a connector's access
  token) without passing through the conversation: the agent is told which names were saved and
  nothing else. The file is on a computer the agent works on, so this keeps a secret out of
  transcripts, search and the model's context, not out of reach of a command the agent runs.

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
  context or on the agent's computer. With [Apps](#apps), what you grant each service is kept
  by Composio, in your account there; the server keeps only its sign-in to that account.
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
  sent back to a browser. Anyone in the Slack workspace can then speak to the agent, and it
  works for them as it does for its own people: its memory, its chats, its machines, its
  connectors and the computers you paired. Nothing is held back for someone because they have
  no account here; only the agent's Permissions limit it. So an agent that knows or can reach
  things not everyone in your Slack should have is not one to put there.
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
it, a still picture is shown instead. There it wears what it was dressed in on the web; its treats, boxes
and wardrobe are not in the mobile app yet.

## Desktop app

`apps/desktop` is an Electron app for macOS, Windows and Linux. It is two things in one program:

- **The app, in a window of its own.** The window shows your deployment the way a browser
  does, so everything the web app can do is there and stays in step with it. On first launch it
  asks for the server's address, unless it was built for one.
- **The daemon for the computer it runs on.** While the app runs, the agents you connected to
  that computer can work on it. Closing the window leaves the app in the tray with the daemon
  going; **Quit** in the tray menu ends both. It can open when you sign in to the computer.

Pairing happens inside the app. Say that your agents may use the computer, on the first screen
or later under **This Computer…** in the tray menu, and once you are signed in the window shows
the page where you confirm it and choose the agents. Nothing is shared before that. The same
window shows whether the computer is connected and what agents did on it, and switches sharing
off and on again without pairing anew. To take the computer away for good, remove it under
Computers, as with any other.

```sh
pnpm desktop                                        # build it and run it from source
pnpm --filter @durable-computer/desktop package     # pack it for this system, into apps/desktop/release
DC_DESKTOP_SERVER=https://agents.example.com pnpm --filter @durable-computer/desktop package
                                                    # the same, opening that deployment without asking
```

The `Desktop` workflow builds, tests and packs the app on all three systems and keeps what it
packed with the run: a `.dmg`, an installer for Windows and an AppImage. Where the
repository variable `DC_BASE_URL` is set, those open that deployment.

Releases are made from tags. Pushing one named `desktop-v` and a version, `desktop-v0.2.0`,
packs the app as that version and, once it has passed on all three systems, publishes a
release with the three files, and with what the apps already installed read to update
themselves (a `.zip` of the Mac's app, and a `latest*.yml` for each system):

```sh
git tag desktop-v0.2.0 && git push origin desktop-v0.2.0
```

Things to know:

- **The Mac's app is signed where the repository has a certificate.** With the secrets
  `CSC_LINK` (a Developer ID Application certificate, as a `.p12` in base64) and
  `CSC_KEY_PASSWORD`, the `Desktop` workflow signs it, and with `APPLE_API_KEY_P8` (an App
  Store Connect API key), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` Apple checks a release, so
  that it opens from a double click. A signed app also keeps what its owner allowed it under
  Accessibility and Screen Recording from one version to the next. One signed by nobody is
  another app to macOS with every build: it has to be allowed both again (take the old entry
  out of each list first), and macOS will not open a downloaded copy from a double click:
  allow it under System Settings, Privacy & Security, or take the download's mark off it with
  `xattr -dr com.apple.quarantine` and the path of the app.
- **Nobody has signed the Windows one.** Windows shows "Windows protected your PC": choose
  More info, then Run anyway. That has not been tried on a real desktop yet.
- **A release keeps itself up to date.** It looks at the repository's newest release when it
  starts and every four hours, fetches a newer app, and becomes it: when it is quit, when
  **Restart to Update** is chosen in the tray menu or under **This Computer…**, or by itself
  once no window of it is showing and its daemon has been silent for five minutes. Restarted
  that way it comes back without a window. The window's pages are the server's and the daemon
  replaces itself from the server, as before; this is for the app around them. A copy that is
  not a release (packed by hand, or by a run of the workflow that was not for a tag) stays as
  it is, and This Computer says so. Things that follow from how each system does it:
  - **macOS** takes a newer app only from whoever signed the one it has, so a fork with no
    certificate has to be installed again by hand.
  - **Windows** runs the newer installer without showing it. Nobody has signed it: what says
    that it is the right file is that it came from the release, over HTTPS, with the checksum
    the release names.
  - **Linux** updates the AppImage, which is one file: a newer one is put where it was, named
    for its version, and what opens the app at sign-in is pointed at it. A launcher you made
    yourself is not. Run unpacked (`--appimage-extract`), the app cannot replace itself.
- **A fork's releases update from the fork.** The address is the repository the workflow ran
  in, and is put in the app as it is packed, not in a tracked file.
- **The server has to be at least as new as the app.** The daemon takes whichever version its
  server serves, and one from before the desktop app does not know how to be part of it.
- **It is a computer of its own.** The app keeps its daemon's credentials in its own folder, so
  a computer that already runs the daemon from `install.sh` is paired a second time, under a
  second name. Run one or the other.
- **On Windows** commands run in the bash that comes with [Git for
  Windows](https://gitforwindows.org) where that is installed, and in PowerShell where it is
  not. Agents write their commands for bash, so install it. Paths are shown to agents the way
  Git Bash writes them: `/c/Users/ada` for `C:\Users\ada`. Under PowerShell, a command left
  running in the background ends when the daemon restarts, as it does to update itself.
- **On Linux** a desktop without a tray (GNOME without the AppIndicator extension) has no icon
  to bring the window back with. Starting the app again does it.

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
apps/desktop      the Electron app: the deployment in a window, and the daemon run inside it
packages/runtime  one actor host interface (SQLite, alarm, blobs, sockets) over Durable Objects and Node
packages/agent    the agent actor: pi-durable harness, identity, chats, history, schedules, skills,
                  connectors, approvals, library
packages/sandbox  the sandbox interface, its adapter to pi-durable, and the providers: just-bash
                  (inside the server on Node, Cloudflare Computer on Cloudflare), Daytona, Modal,
                  Cloudflare Containers
packages/computers  the daemon protocol and the actor that holds a paired computer's connection
packages/protocol   types and reducers shared by server and clients
packages/client     API client, and following an agent over a socket or an event stream, for the
                    web and mobile apps
```

Anything that touches a runtime is implemented for both and held to one conformance suite.

## License

MIT. What in it is someone else's work, and on what terms, is in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

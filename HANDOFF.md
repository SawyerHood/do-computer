# Handoff

Written 2026-10-06 for whoever picks this project up next. It covers what exists, how it is run
and shipped, what the owner has asked for and decided, what is unfinished, and what has and has
not been checked. `README.md` describes the product for someone hosting it; `PLAN.md` is the
original plan with a status section. Where they disagree with this file, this file is newer.

This file is specific to the owner's own deployment and working habits. Trim or remove it before
the repository is made public.

## 1. What this is

durable computer is an open-source, self-hostable personal agent: a version of Meta's Muse built
on the pi-durable harness, with OpenRouter for models. Each user has persistent agents with a
name, a personality, memory, a computer of their own, scheduled automations, skills, connectors
(remote MCP servers) and the user's own paired computers. It runs on Cloudflare Workers (one
Durable Object per agent) and on plain Node, from the same code. There is a web app (TanStack
Start, shadcn, jotai, TanStack DB and Query, Better Auth) and an Expo mobile app.

The owner is Sawyer. The repository is private: `SawyerHood/durable-computer`.

## 2. Where it runs

- **Live:** https://do.computer, the Cloudflare Worker `durable-computer`, on the owner's
  Cloudflare account. It replaced an older app ("do-computer", from the `do-browser` repository),
  which was torn down on 2026-10-03.
- **Signing in:** GitHub sign-in is on, and so is email and password. The deployment is
  invite-only; the owner has the first account.
- **New agents** get a Daytona machine by default there (`DC_SANDBOX=daytona`). The built-in
  shell and "no computer" are also offered, per agent.
- **Models:** agents run on any OpenRouter model, chosen per agent with a default in Settings.
  Web search results are read by `anthropic/claude-haiku-4.5` (`DC_SEARCH_MODEL`). Summaries of
  what an agent did are written by `openai/gpt-4.1-nano` (`DC_SUMMARY_MODEL`). Whether an agent
  stopped by accident is judged by `mistralai/mistral-small-3.2-24b-instruct` (`DC_JUDGE_MODEL`).

## 3. How work is shipped

The owner's standing instructions, in their words:

- "please go ahead and be commiting and pushing to main and using gh to deploy from now on"
- "I give you permission from here out to commit and push to main because we have no production
  users"

So: commit to `main` and push. `.github/workflows/ci.yml` runs type checks, unit tests and
browser tests side by side, then its `deploy` job deploys to do.computer. Watch it with
`gh run watch <id> --exit-status`. A run takes about three minutes. If production users appear,
that permission's reason is gone: ask again. It never covered force pushes or rewriting history.

Nothing specific to the do.computer deployment is written into tracked files. The owner said of
deploying: "I don't want to make changes to this project". The deployment's values are:

- **GitHub repository variables:** `DC_D1_DATABASE_ID`, `DC_ROUTE`, `DC_ROUTE_ZONE`,
  `DC_BASE_URL`, `DC_SANDBOX`. Others the workflow passes through if set: `DC_CUSTOM_DOMAIN`,
  `DC_SIGNUP`, `DC_ALLOWED_EMAILS`, `DC_DEFAULT_MODEL`, `DC_SEARCH_MODEL`, `DC_SUMMARY_MODEL`,
  `DC_JUDGE_MODEL`, `DC_SANDBOX_KINDS`.
- **GitHub repository secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- **Worker secrets** (kept by Cloudflare across deploys): `DC_AUTH_SECRET`, `OPENROUTER_API_KEY`,
  `DAYTONA_API_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`. `RESEND_API_KEY` would go here,
  with `DC_EMAIL_FROM` as a repository variable, to send invitations by email; neither is set.

`apps/web/scripts/deploy-settings.mjs` applies those values to the built config before
`wrangler deploy` uploads it; `pnpm --filter @durable-computer/web run deploy` is what CI runs.
On the owner's Linux machine there is also `~/.config/durable-computer/deploy-do-computer.sh`,
outside the repository, which does the same from that machine. Wrangler is signed in there.

The address is a zone route (`do.computer/*`), not a custom domain, because the apex already has
a proxied DNS record.

## 4. Working on it

```sh
pnpm install
pnpm check                      # type checks, every package
pnpm test                       # unit and integration tests, on Node and in the Workers runtime
pnpm test:e2e                   # builds, then browser tests of the web app and the mobile web build
pnpm dev                        # Node target on http://localhost:3000
pnpm dev:cloudflare             # the same on the local Workers runtime
scripts/smoke.sh <base-url>     # end-to-end check of a running deployment (fresh, open sign-up)
pnpm --filter @durable-computer/mascot demo    # the creature's playground page
```

Without `OPENROUTER_API_KEY` the app answers with a built-in echo model. A message of the form
`/tool <name> <json>` makes it call a tool, which is how the tests exercise tools without a model.

The browser tests are in `apps/web/e2e`, a file to a subject. Each file is given a server of its
own on a fresh data directory (`e2e/fixtures.ts`), so the files run side by side while the tests
inside one run in order and build on each other. A file that begins with `asOwner()` starts with
the owner signed up and the agent named Juniper. The creature is not drawn live unless a file
asks for it with `test.use({ creature: true })`: a browser with no graphics card draws it in
software, which kept a whole core busy. CI deals the files out over several machines, two to a
machine, so a new file needs nothing but to be there.

Layout, briefly (`README.md` has the full table):

| Path                 | What                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| `packages/protocol`  | Types and pure functions shared by server and clients                                |
| `packages/runtime`   | The actor host over Durable Objects and Node; the address guard for outgoing fetches |
| `packages/sandbox`   | Agent computers: just-bash, Daytona, Modal, Cloudflare Containers                    |
| `packages/agent`     | The agent actor and everything it can do                                             |
| `packages/computers` | The link to a user's paired computer                                                 |
| `packages/mascot`    | The creature: one plain JavaScript file, typings, and a playground                   |
| `packages/client`    | The HTTP and event-stream client used by web and mobile                              |
| `apps/web`           | The web app and the gateway in front of the agents                                   |
| `apps/mobile`        | The Expo app                                                                         |
| `apps/daemon`        | The daemon a user runs to pair a computer                                            |
| `prototypes/`        | Design explorations that are not part of the app                                     |

The code has a consistent voice: comments explain why in plain sentences, tests are named as
statements of behaviour, and commit messages say what changed and why. Keep to it.

### On the owner's Linux machine

These are facts about that one machine (`bee`), where most of this was built:

- Browser tests use an already-downloaded Chromium:
  `PLAYWRIGHT_CHROMIUM_PATH=$HOME/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome pnpm exec playwright test`
  from `apps/web`, after `pnpm build:node` and
  `pnpm --filter @durable-computer/mobile export:web:test`.
- For a headless browser to draw the creature, launch Chromium with
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
- The local Workers runtime needs port 3112, because `apps/web/.dev.vars` sets the base URL to
  it, and `DC_SIGNUP=open` added to that file to sign up. Restore the file afterwards.
- There is no Docker, so Cloudflare Containers cannot run locally.
- Keys for real-service tests are in another project's file,
  `~/projects/do-browser/apps/do-computer/.env` (OpenRouter, Daytona, and others). The owner
  allowed their use for testing this project and for the do.computer deployment. Pass them to a
  child process without printing them, never write them into this repository, and delete any
  Daytona machines a test creates. That Cloudflare account holds other projects too: touch only
  `durable-computer` resources.
- The project is registered in the owner's `bb` tool as `proj_qbksnufyhz`. `bb` is not on the
  PATH there; it runs as `node ~/projects/bb/packages/bb-app/dist/bb.js`.

## 5. What was built, in order

The first milestone (2026-10-01 and 02) built the product described in `README.md`: the two
runtimes, the agent, memory and identity, chats with streaming, schedules, skills, the library,
paired computers, connectors with OAuth, approvals, history search, usage, agent deletion, the
four kinds of computer, web search, a bundled browsing skill, the mobile app, and a security
review with its fixes. `PLAN.md` section 0 records that, including what was run for real.

Since then, newest last:

1. **Chat fixes.** Chat works over plain http. The transcript rests at the newest message. Tool
   calls are not shown in the transcript: one status line says what the agent is doing.
2. **Any OpenRouter model**, per agent, from a searchable picker, with a default in Settings.
3. **Internet on agents' computers**, including `curl` in the built-in shell through a guarded
   fetch that refuses private addresses.
4. **The kind of computer is chosen per agent**, with a default in Settings, among the kinds the
   server's environment has keys for. Moving an agent does not copy files; each computer keeps
   its own, and the agent is told it was moved. Deleting an agent deletes every computer it had.
5. **Teal accent** with cool neutrals, replacing a brown one the owner disliked.
6. **Deploy from the environment and from GitHub Actions** (section 3).
7. **The creature** (`packages/mascot`). Every agent appears as a small low-poly creature with
   eyes, grown from a seed, drawn with three.js in a late-90s console style. It acts out what
   the agent is doing and hatches from an egg the first time its owner meets it. An avatar is
   now a color and an optional seed; the agent picks only its color. On web it is
   `apps/web/src/components/agent-avatar.tsx`, driven by `apps/web/src/lib/use-mascot-mood.ts`.
   On mobile it is `apps/mobile/src/components/avatar.tsx`, through `expo-gl`.
8. **The layout the owner asked for, after Muse.** On a wide screen (1280 px and up) a panel on
   the right of the chat holds the creature, the agent's name, a few words on what it is doing,
   the files it sent in this chat, and what it did in this chat. The sidebar starts closed, behind a button at the start of the agent's strip. The header
   above the chat exists only when the panel is closed, and pressing it reopens the panel. The
   creature moves in the panel, where it can also be petted, and beside each agent in the
   sidebar; elsewhere it is a still picture.
9. **The daemon starts with only the server's address.** It used to ignore the address unless
   `--name` was also given, so the install command the app shows did nothing.
10. **The list of what the agent did** (`packages/agent/src/log.ts`). The agent writes the
    entries itself, with a `log` tool: a short title and a sentence on the outcome, and only
    for substantial work, which its prompt and the tool's description ask of it. Nothing is
    stored for an entry. The call is in the transcript, and the panel reads the list from the
    chat (`chatRuns` in `packages/protocol/src/runs.ts`), with the run's other steps inside. A
    small model used to write an entry for every run in the background; that is gone, and what
    it cost is still counted in the agent's usage (`SmallCostDoc` in `keep-going.ts`).
11. **Pictures.** A picture pasted or attached is scaled down in the browser and sent with the
    message, so a model that takes pictures sees it. The original goes to the library as before.
12. **Keeping an agent going** (`packages/agent/src/keep-going.ts`). A turn ends when the model
    replies without calling a tool, and some models (Muse Spark, in the owner's chat) send a
    progress update that way mid-task, which ended the work. The owner asked for progress to be
    a tool call, so there is a `progress` tool: a call to it cannot end the turn, and
    `project.ts` shows it in the chat as the agent's words, not as a step. The prompt says how
    turns end and points at the tool. Nothing makes a model use it, so there is a backstop:
    when a run still ends on a short message that could be such an update, a small model is
    asked whether the agent meant to go on, and if so the run is continued with a note the chat
    does not show, three times in a row at most. `openai/gpt-4.1-nano` was tried for this and
    was wrong too often, including on "I'll check with you first"; Mistral Small was not.
    pi-durable has no such tool: continuing from `onYield`, as its `28-reviewer.ts` example
    does, is the way it offers.
13. **Documents in the library** (2026-10-07; `packages/agent/src/library.ts` and
    `library-sync.ts`, `apps/web/src/components/library`). The owner asked for a file tree with
    a Markdown editor and an HTML viewer, and chose how it is kept from the options put to them:
    "lets try the server-driven sync".
    - **The library has folders.** A file has a path, a revision that counts up with each change,
      up to ten earlier contents kept as versions, and a place among the last hundred deleted
      files it can be brought back from. Files from before got a path when the agent next
      opened: uploads under `uploads/`, the rest at the top.
    - **`library/` in the agent's workspace is a working copy of it.** Blob storage is the truth,
      which is why a file can be read while the computer is asleep. Before a tool that reads
      files, and after one that can write them, the server lists the folder and compares it with
      the library and with what the two held when they last agreed (kept per computer, in a
      document clients never see). Whichever side differs from that is the side that changed.
      Where both did, the folder wins and the library keeps the other as a version. A file
      missing from the folder is deleted from the library, restorably; one that reappears with
      the same content under another name is a rename. Hidden files, `node_modules`, links and
      files over 25 MB are left out, and the agent is told once about each file left out. On a
      machine with real programs the listing is one `find`; in the built-in shell it walks the
      directories. Nothing runs on the computer between tool calls, so what a background
      process writes after a run ends is picked up at the next run.
    - **An HTML document is served as a page** at `/d/<agent>/<key>/<path>`, where relative
      links resolve on their own. There is no session on that route. The key is signed with a
      secret of the agent's, is the same for six hours and works for up to twelve, and comes
      with the library listing. Every response carries `Content-Security-Policy: sandbox`
      without `allow-same-origin`, so a page has an origin of its own: the browser tests check
      that it cannot read cookies and that its requests to the app go without the session.
    - **The web app** shows the tree where the chat list is, a front page of recent files, and
      a viewer per kind: Markdown to read, edit or both side by side; a page with its source;
      pictures; other text as an editor. Edits save a moment after typing stops and name the
      revision they were made from, so one the agent made meanwhile becomes a choice between
      the two and is never overwritten silently. On a wide screen a file card in a chat opens
      the file beside the chat, in the place of the agent's panel, with the same viewer; on a
      narrow one it opens in the library. The panel lists the files sent in the chat, which
      open the same way, and the document's edge can be dragged as the panel's and the
      sidebar's can. `prototypes/library-docs` is the mock-up it was built
      from.
14. **Sub-agents** (2026-10-07; `packages/agent/src/subagents.ts`). The agent has a `subagent`
    tool: start, message, stop, list. A sub-agent is a conversation of its own with the
    agent's memory, skills and computer, and it only ever works in the background: starting
    one returns at once.
    - **It is a chat of kind `subagent`**, kept in the chat index like a scheduled run's, with
      what is known of it (the chat that started it, its task, how it is getting on) on its
      record. That is what makes its transcript, its steps, its spend and its place in history
      search work with nothing new. It is not owned by a task in pi-durable's sense, so stopping
      a reply in the chat that started it does not stop it.
    - **A report is its last answer once it has come to rest**: nothing admitted and unanswered
      in its conversation, and nothing it has asked the user's leave for. The report is written
      into the chat that started it as an entry of kind `dc.subagent`, and a note for the model
      alone then gives the agent a turn there. Both are keyed, so a crash can delay a report
      and cannot send it twice. One that failed is reported the same way. One the user stopped
      is written in without a turn.
    - **Only the agent writes in it.** The user reads it and can stop it; sending to it or
      starting it fresh is refused by the server. A sub-agent cannot start sub-agents or change
      schedules, and at most six work at once.
    - **Looking in on them runs under the actor's own context**, not the tool call's, which
      ends with the call: waiting on a sub-agent under it failed as soon as the agent had
      answered. The tests keep the wake-up interval long so that this path is the one tested.
    - **The web app** shows a chip where one was started, a marker with the report folded
      inside where one reported, and small creatures beside the agent's and a list in its
      panel. They are not listed in the side column, which says only how many of a chat's are
      at work: the owner found a third level there too much nesting. A sub-agent's creature
      grows from its chat's id. `prototypes/subagents` is the mock-up it was built from.

15. **Teams** (2026-10-07; `apps/web/src/server/teams.ts`, `prototypes/teams`). Everyone has a
    personal workspace, and a team is a workspace several people share.
    - **Where an agent lives is one column**, `dc_agents.workspace_id`. A personal workspace has
      no row: its id is `personal:<user id>`, and every agent from before teams was put in its
      owner's. `agentAccess` in `teams.ts` is the one place that decides who may reach an
      agent; the gateway, connectors, pairing and deletion all go through it. `teams.ts` knows
      nothing of requests or the platform, so its tests run against a database alone.
    - **Invitations** are by email address or GitHub username. Only the hash of a link's token
      is kept, so a link is shown once, when it is made, and "send again" makes a new one. An
      invitation finds a signed-in user by their GitHub account id, or by their address once it
      is verified: anyone can sign up with an address they do not hold. Being invited lets
      someone sign up on an invite-only deployment (`validateUserInfo` in `auth.ts`). Mail goes
      through Resend when `RESEND_API_KEY` and `DC_EMAIL_FROM` are set, and otherwise the
      sender is given the link.
    - **The agent is told who is speaking.** The gateway names the caller in a header it builds
      itself (`packages/agent/src/caller.ts`). In a team the note that travels with a message
      carries the sender, which is where a message's author comes from when the chat is drawn,
      and the system prompt says the agent is shared and its memory is the team's. A personal
      agent's prompt is word for word what it was.
    - **Who is where** is one actor per team (`presence-actor.ts`) holding a WebSocket per open
      tab, hibernating on Cloudflare. Where each socket is lives in the actor's database, not
      in memory. The same socket tells open tabs when the team changes. It is reached at
      `/api/presence/<team>`, which the server entries route before the framework, as they do
      for daemons; the gateway checks the session, the membership and the page's origin.
    - **The web app** has one sidebar and no rail. The workspace menu is at its top; under it
      are the workspace's agents, each with its chats folded under it on one line each; at its
      foot is the user's own menu, which leads to the workspace's settings. The end of a chat's
      row is a spinner while there is work going on in it, else when it was last used. A team
      has no page of its own: `/w/<id>` goes to its first agent, and stops only where there is
      none yet. Its people are a section of the workspace's settings. The invitation page
      (`/invite/<token>`) can be read before signing in.
    - **An agent's pages** are tabs in a strip above them (`components/shell/agent-strip.tsx`):
      Chat, Library and Automations. The strip also has the agent's name, which opens a menu of
      the other agents and its recent chats, the way into its settings, and the switch for its
      panel. The panel is beside every tab, and on the Library tab the sidebar's list is the
      library's files, put there through a portal (`sidebarSlotAtom`), so changing tab moves
      nothing. Settings are windows over the page, opened by the address: `?settings=<section>`
      for the agent (`components/settings/agent-settings.tsx`) and `?workspace=<section>` for
      the workspace. The old page addresses (`/a/<id>/skills` and the like) redirect to them.
      The mock-up this was built from is in `prototypes/agent-pages`.

16. **Computers that belong to someone, connected to many agents** (2026-10-07;
    `apps/web/src/server/computer-access.ts`). A pairing used to name one agent. Now a computer
    is paired once, belongs to a workspace, and is connected to agents one by one.
    - **Three tables.** `dc_computers.workspace_id` says whose it is: `personal:<user id>` of
      whoever paired it, or a team. `dc_computer_grants` has a row for each agent that can work
      on it. `dc_computer_requests` has a row for each agent that asked and has not been
      answered, one per computer and agent. The migration turned every old pairing into its
      pairer's own computer with one grant. `home` is kept on the computer now, since an agent
      has to be told it when connected; for an older computer it is taken from what its daemon
      said, or from an agent that has it (`homeOf` in `computers.ts`).
    - **Who may do what** is in `computer-access.ts`, which like `teams.ts` knows only the
      database. `fits` is the rule for whether a computer can serve an agent at all: someone's
      own serves any agent they can use, a team's serves the team's agents. The people a
      computer belongs to (its owner, or everyone in its team) connect it and answer for it.
      Whoever paired it, or an admin of its team, removes it, and only its pairer changes whose
      it is. When an agent moves, a computer changes hands or someone leaves a team, the
      connections that no longer fit are ended (`misfitsOfAgent`, `misfitsOfComputer`,
      `leftBehind`); a computer someone paired for a team is removed when they leave, since it
      runs as them. Deleting an agent no longer removes a computer, only the agent's part in it.
    - **The record is what counts, not what the agent was told.** The agent keeps its own list
      of its computers, which the gateway writes, and the link to a computer answers any agent.
      So before every use the agent's host asks the directory (`mayUse`): there must be a grant,
      and the computer must still fit where the agent is. A connection therefore ends when its
      row goes, even if telling the agent failed, and one that a missed tidy-up left behind
      gives nothing. `connect` looks again after it has told the agent, for the case where the
      agent was moved in between.
    - **The gateway judges a path as the actor will read it.** `proxyToAgent` refused the
      actor's own routes (`computers`, `init`, `destroy`, `team`) by the path as sent, and the
      actor reads it after it has been parsed, so `chats%2F..%2Fcomputers%2F<id>`, an encoded
      dot or a doubled slash went past. That was there before this work and mattered more with
      it, since a teammate can now see a computer's id. It parses first now, and the browser
      tests and `scripts/smoke.sh` try the dressed-up addresses.
    - **The agent asks through its host.** `computerDirectory` (`computer-directory.ts`) is
      handed to the agent actor as an option, with the database and the links, because the actor
      does not run where requests are served. The agent's `computers` tool
      (`packages/agent/src/paired.ts`) lists what the directory says is near: the computers of
      its workspace and the own computers of the people it works for, with whose each is and
      whether it is online. Asking records a request and sends a push notification to whoever
      can answer. The tool's argument is `name`, not `computer`, which on every other tool means
      "run this there" to the permission rules.
    - **The answer comes back like a sub-agent's report.** The gateway connects the agent, then
      posts to its `/computers/<id>/answer`; the agent writes a `dc.computer-access` entry into
      the chat that asked and gives itself a turn there, both keyed by the request. What it has
      asked for is also kept in its own document, so its prompt says it is waiting and the
      page hears of it through the agent's events.
    - **In the app** a request is a card above the message box in the agent's chats, with Allow
      and Don't allow for whoever the computer belongs to and "Waiting for ..." for everyone
      else, and the same card is at the top of Computers in the workspace's settings. Each
      computer there says whose it is and which agents it has. The pair page asks whose the
      computer is, where the user has a team, and which agents get it.

## 6. What the owner has said they want

Design, in their words where quoted:

- The creature: "Really kinda love the ps1 / dreamcast aesthetic", "It is like your little blob
  mascot", "I would love for the orbs to have eyes and for those to have expressions". They want
  it big on desktop.
- "should be only one animated copy of him on screen at a time", and never one beside the
  status line in the transcript.
- The side panel must be terse: "This should be maybe < 7 words for each one", "Maybe only show
  the titles for the activity log".
- "I also like keeping the chats hidden by default."
- No brown. Teal is the accent now.
- Muse is the reference for layout and for a living character.

Teams, decided on 2026-10-07: what an agent knows is the team's, not each person's ("I want the
agent to have team wide knowledge instead of personal knowledge"); connectors and paired
computers shared with the team are fine; whether a message sent while the agent is busy steers
it or waits is a setting; teammates spending on the one key is fine. The side column lists
agents, collapsible, with single-line chats; sub-agents are not listed in it ("too much
nesting"); and the row's last slot is a spinner or the time, "never ... together".

Computers, decided on 2026-10-07: "every user has a list of their computers (a computer can
belong to a person or a workspace) and then you can connect agents to different computers. The
agent also can have a tool to list computers and request access to one and it will send an async
notif to the person who owns it and they can approve."

Cost: they found Claude Haiku too expensive for the summaries a small model used to write of
each run, and on 2026-10-07 asked for those to go: the agent writes the list itself, and only
for big things. Web search still uses Haiku; they were told and have not asked to change it.

## 7. Open questions and unfinished work

### Waiting on the owner

- **The console-mascot UI.** `prototypes/console-ui` is a click-through exploration of the whole
  UI in that style, with a ranked list of ideas in its README. The owner has looked at it and has
  not said which to build. Ask before building any of it.
- **Old leftovers from the app this replaced**, which they were told about and have not asked to
  have removed: about a dozen Daytona machines named `do-computer-*` (one was running), a
  Telegram webhook pointing at an address that no longer exists, an R2 access token used for
  backups, and `~/do-computer-archive-2026-10-03` on the Linux machine, a copy of the old
  database and files that was taken before they were deleted. The old daemon is gone from that machine.
- **`www.do.computer`** times out. It needs a redirect rule to the apex in the Cloudflare
  dashboard; the API token at hand cannot edit zone rules.
- **Two credentials were pasted into a chat transcript**: the GitHub OAuth app's client secret
  and the Cloudflare API token used by CI. The owner was told they can be rotated. If they are,
  the Worker secret and the repository secret need setting again.

### Bugs that were reported and not reproduced

- **Attaching a file failed with "could not be attached: HTTPError"** on do.computer, once, on
  2026-10-05. That text is the server framework's message for an unhandled exception in the
  request. Uploads then succeeded everywhere it was tried: the local Workers runtime, a
  temporary copy of the app on the same Cloudflare account set up like the live one, by curl and
  by browser, from 20 KB to 24 MB, idle and mid-run; and the owner's own next upload on the live
  site succeeded. The cause is unknown. If it recurs, follow the live logs while they retry,
  which will show the exception: `wrangler tail durable-computer --format json`. Since then, a
  picture whose upload fails is still attached and shown to the agent.
- **A chat failed with OpenRouter's `model_not_found` from provider "Meta"**, once, the same
  day. Every Meta-served model in the picker then worked through the app, including with tools,
  web search and pictures. Probably a failure on Meta's or OpenRouter's side. Which model the
  agent was on is not known. The raw provider error is what the user saw; a friendlier message
  and a retry would be an improvement.

### Known gaps

- **Teams:** there are no private chats in a team, though the mock-up had an "Only you" one;
  no invite link that anyone can ask to join by; and no teams in the mobile app, which lists
  every agent the user can reach and shows no authors or presence. A chat's spinner in the side
  column knows about sub-agents everywhere but about the agent itself only in the chat on
  screen. Who is where does not work under `pnpm dev` on Node, which has no WebSocket server;
  it does on the built server and on Workers. Invitation email has never been sent for real.

- **Sub-agents on mobile** are only their reports, shown in the chat that started them. Their
  own chats cannot be opened there, and nothing shows that one is at work.
- **Mobile** has no model picker, computer picker, connectors, permissions or file attaching, and
  no agent panel. Its creature is checked only through the app's web build. It shows the answer
  to an agent's request for a computer but cannot give one: the notification opens the chat,
  and the request is answered on the web.
- **Never run for real:** the mobile app on a device, Modal, Cloudflare Containers, sign-in with
  Google, and a connector that needs a sign-in against a real service. Sign-in with GitHub is
  configured on the live site; nobody has reported how it went.
- **Not built:** usage limits, a rate limit on pairing codes, a reason and retry for provider
  errors.
- **The creature** was only ever seen through software rendering and screenshots by whoever
  built it. Its author's own list of rough edges: at 24 px the command and file variants are
  hard to tell apart; flat-shaded bodies can show a large white highlight; the error state greys
  the eye whites; the alternative "glass" look is less finished and unused by the app.
- **The library** on mobile is still the flat list with downloads. On the web, PDFs and other
  formats have no viewer; there are no empty folders, since a folder is only the paths of the
  files in it; a file's history shows who and when but not what changed; and a document changes
  on screen when the agent's tool call ends, not as it types, which the mock-up pretended.
- **A page from the library can load anything from the internet**, and could send what is in
  the library to wherever it likes, since it can read the files beside it. That is the price of
  letting pages use scripts and fonts from elsewhere. Serving them from a second domain would
  add a wall the sandbox already provides; forbidding outside requests would close this, and
  break those pages.
- **An activity entry shows a tick** when the agent answered, even if a step inside it failed.
- **Thinking and full tool output** are not in the transcript by design. Tool output is in the
  panel's entries, on wide screens only, and so only for work big enough to have an entry;
  thinking is not shown anywhere.
- **`PLAN.md` section 0** stops at 2026-10-03 and does not mention the creature, the panel, the
  summaries or pictures. This file does.

## 8. What has been checked, and how

- Unit and integration tests pass on Node and inside the Workers runtime, and browser tests pass
  for the web app and the mobile web build. CI was green on the last commit before this file.
- **Run against real services:** OpenRouter chat with tools, web search, transcription and
  schedules; Daytona machines, including moving an agent to one and back and deleting it, and
  the listing the library folder is read with (the whole sync has only run against the built-in
  shell and a local shell); a
  public MCP server as a connector; the bundled browsing skill; a vision model describing an attached picture; deploys to Cloudflare from this
  machine and from GitHub Actions.
- **On the live site**, without the owner's session, only this could be checked: it answers, its
  pages and assets load, the GitHub sign-in button leads to GitHub with the right callback, and
  the daemon downloaded from it starts pairing. The owner has since paired a computer, pasted
  pictures and chatted on it.
- Everything visual was judged from screenshots taken in headless Chromium.

## 9. Things that were learned the hard way

- **A blob key is a path on Node and only a name on R2.** A key that is another key plus
  `/more` needs the first to be a directory, which a file cannot be. A file's later revisions
  are therefore stored beside its first one (`library/<id>.r3`), not under it.
- **A page in a sandboxed frame may not even read `document.cookie`:** it throws. A script
  that does so stops there, which looks like the script not loading.
- **A Durable Object's SQLite row has a size limit** (about 2 MB) that Node's does not. A message
  is one row. That is why pictures are scaled down in the browser to fit a message, and why
  anything large belongs in blob storage, not in a document.
- **The harness cannot be closed and reopened on the same database on Node**, because closing it
  closes the database. A change that seems to need a reopen (such as switching an agent's
  computer) has to swap extensions in the registry while it stays open. Installing an extension
  under a name that is taken replaces it where it stands, which keeps hook order.
- **Tests must not count things machine-wide.** One counted every `sleep 300` process on the
  host and failed when something unrelated ran one.
- **Tests that always pass an option hide the default path.** The daemon bug in section 5 lived
  because every test passed `--name`.
- **Small models that reason spend a short token allowance on thinking and return nothing.**
  Three of the cheapest candidates for the summaries, when a model wrote those, failed that way.
- **Real services find what stand-ins do not.** Each time the app was first run against a real
  provider it turned up bugs the tests had missed. Treat the first run of anything on Modal,
  Cloudflare Containers or a phone as a trial.
- **A fresh deployment belongs to whoever signs up first.** The first account needs no
  invitation, so on a public address, sign up at once.

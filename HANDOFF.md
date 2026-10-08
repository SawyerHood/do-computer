# Handoff

Written 2026-10-06 for whoever picks this project up next. It covers what exists, how it is run
and shipped, what the owner has asked for and decided, what is unfinished, and what has and has
not been checked. `README.md` describes the product for someone hosting it; `PLAN.md` is the
original plan with a status section. Where they disagree with this file, this file is newer.

This file is specific to the owner's own deployment and working habits. Trim or remove it before
the repository is made public.

## 1. What this is

Do Computer is an open-source, self-hostable personal agent: a version of Meta's Muse built
on the pi-durable harness, with OpenRouter for models. Each user has persistent agents with a
name, a personality, memory, scheduled automations, skills, connectors (remote MCP servers) and
the user's own paired computers. An agent has no computer of its own: it works on the machines
of its workspace, which the workspace's agents share, and they share one library. It runs on Cloudflare Workers (one
Durable Object per agent) and on plain Node, from the same code. There is a web app (TanStack
Start, shadcn, jotai, TanStack DB and Query, Better Auth) and an Expo mobile app.

The owner is Sawyer. The repository is private: `SawyerHood/durable-computer`.

## 2. Where it runs

- **Live:** https://do.computer, the Cloudflare Worker `durable-computer`, on the owner's
  Cloudflare account. It replaced an older app ("do-computer", from the `do-browser` repository),
  which was torn down on 2026-10-03.
- **Signing in:** GitHub sign-in is on, and so is email and password. The deployment is
  invite-only; the owner has the first account.
- **A workspace** is given a Daytona machine there when an agent is made in one that has none
  (`DC_SANDBOX=daytona`), and its agents share it. Agents from before 2026-10-07 each keep the
  machine they had, for themselves alone, until someone opens it to the workspace.
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
| `packages/sandbox`   | The machines agents work on: just-bash, Daytona, Modal, Cloudflare Containers        |
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
      are the workspace's agents (item 18 says what choosing one does); at its foot is the
      user's own menu, which leads to the workspace's settings. A team
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
17. **Agents writing to each other** (2026-10-07; `packages/agent/src/peers.ts`,
    `apps/web/src/server/agent-directory.ts`). An agent has an `agents` tool: list, message. It
    reaches every other agent in its workspace with nothing to switch on. The owner turned down
    a switch for each pair and a cap on exchanges (section 6).
    - **A message opens a chat of kind `agent` on the receiver**, one for each chat of the
      sender's that writes to it, so more from the same chat carries on from what was said.
      What is known of it (which agent, which chat of theirs, how it is getting on) is on its
      record, as a sub-agent's is. The receiver works there as itself. Each time it comes to
      rest its last answer is handed back: written into the sender's chat as an entry of kind
      `dc.agent`, with a note for the model alone that gives the sender a turn. The user reads
      the conversation and can stop it, and the sender is then told and given a turn too, since
      its user may not be the one who stopped it.
    - **Only chats with a person and these conversations can send.** A scheduled run and a
      sub-agent each report once, when they come to rest, so a reply arriving later would have
      nowhere to go. A conversation sending is how a question is passed on to a third agent:
      the answer sets the conversation going again, and what it then says goes back to the
      agent it is with.
    - **The host carries the messages.** `agentDirectory` is handed to the actor as an option,
      as `computerDirectory` is, with the database and the agents' namespace. It looks up that
      the two agents are in one workspace (`areBeside`) each time a message or an answer is
      handed over, so an agent that was moved or deleted is not reached by what it was told
      before. The actor's routes for this (`peers/<agent>/message` and `/reply`) are among those
      the gateway keeps for itself, and the browser tests and `scripts/smoke.sh` try them.
    - **Nothing is said twice.** A message is keyed by the tool call that sent it, an answer by
      its conversation and how many answers that has sent. An answer that cannot be handed over
      is tried again on the agent's next wake-ups, five times. One whose asker is gone, or is
      somewhere else now, is given up and its conversation marked as failed.
    - **A reply that arrived while an answer was being handed back was lost**, until the tests
      found it: the conversation was marked as done after the hand-over, over the top of having
      been set going again. Each record now counts how often it was given something to answer
      (`woken`), and a look-in that finds the count changed leaves the conversation at work.
    - **The web app** shows a chip where a message was sent, a marker with the reply folded
      inside where it came back, the conversation on the receiving agent with the sender's face
      on its messages and no message box, and a list "From other agents" in the receiver's
      panel. Conversations are not in the side column.
18. **A main chat, and side chats** (2026-10-07; `prototypes/main-and-side-chats`). The owner
    found the chats folded under each agent in the sidebar unclear: "ideally you just pick an
    agent and you're talking to it". Of three mock-ups they chose the one where the sidebar
    lists agents and nothing else.
    - **The main chat.** An agent has one, the conversation that opens when the agent is
      chosen and carries on from day to day. Its id is `main` in the agent's `dc.chats`
      document, and its `ChatSummary` has `main: true`. `POST /chats/main` returns it and
      settles on one where there is none: an agent from before this gets the chat it was last
      talked to in, and one never talked to gets a new chat. The agent's index page calls it,
      and so does the agent's layout for an agent opened at another of its pages. The main chat
      cannot be archived (409); "Start fresh" is how it is cleared.
    - **Side chats** are the other chats of kind `chat`. `POST /chats` makes one, as it always
      made a chat. Nothing about how they run differs from the main chat: same agent, same
      memory, their own conversation.
    - **In the app** the sidebar's rows are links to `/a/<agent>`, which goes to the main chat.
      The agent's strip has a "Side chats" button with their number, whose menu lists them and
      starts a new one (`components/shell/side-chats.tsx`). Opened from the main chat on a wide
      screen, a side chat is a column beside it, in the place the agent's panel has, and the
      address says so: `/a/<agent>/c/<main>?side=<id>` (`components/chat/side-chat.tsx`). The
      column drags wider, as a document's does. It can be given the middle, which is its own
      address, `/a/<agent>/c/<id>`; a line under the strip then says it is a side chat and
      leads back. On a narrow screen a side chat always has the middle. What a chat page needs
      of a chat is in `lib/use-chat.ts`, which both columns use.

19. **Machines that belong to a workspace, and one library for it** (2026-10-07;
    `PLAN-shared-computers.md` is the plan, with what the owner decided and what was chosen for
    them). The owner asked whether every agent needed a VM of its own, then: "What if we kind of
    just got rid of the concept of having a home computer for an agent could they run without a
    computer and then they can just like like freely connect to the different ones".
    - **An agent has no computer.** Item 4 is undone: there is no kind to pick for an agent and
      no moving it between kinds. `packages/agent/src/computers.ts` (once `paired.ts`) holds
      every computer an agent can use, paired or a machine, in `ComputersDoc`. The file and
      shell tools, `send_file`, `library` and `skill` are wrapped to run on the computer a call
      names. A call that names none means the one machine the agent can use; with several it
      must say which; a paired computer is never meant without being named.
      `computer.ts` and `mirror.ts` are gone, and with them the memory files.
    - **A machine is a row in `dc_computers`** with a `kind`, a `machine_key` (what it is named
      after at its provider: its own id, or the agent's id for a machine from before) and an
      `access`: `open` to every agent of its workspace, or `chosen`, for the agents with a
      grant. `mayUse` is still the one rule and is asked before every use. `provideFor`
      (`computers.ts`) adds an open machine when an agent is made where it could use none. The
      built-in shell keeps its files in one agent's database, so each agent gets its own,
      `chosen`, and it cannot be shared or removed apart from its agent (`UNSHARED_KINDS`).
    - **The record is told to agents, whole.** `tellMachines` puts every machine an agent can
      use to it (`PUT /computers`), and the agent replaces what it had. An agent that was not
      told catches up by asking its host (`ComputerDirectory.machines`) the first time a name
      or the one machine it means is not there.
    - **Folders.** `dc_computer_folders` has each agent's folder on each machine, chosen by
      `folderFor` the first time the agent works there: `<home>/<its name then>`, never renamed,
      never `library`. The agent starts its calls there; `~` is still the machine's home.
      Nothing keeps an agent in its folder.
    - **Agents from before** hand over their machines the next time they are opened
      (`AgentActor.#adopt`, `computer-adoption.ts`): the one each was on becomes a `chosen`
      machine of its workspace with that agent alone, its home directory as its folder; ones it
      had left behind become machines with nobody on them. The four memory files are removed
      from its home directory the next time it works there.
    - **The library is an actor per workspace** (`library-actor.ts`, `LibraryObject` on
      Cloudflare, named by the workspace's id). `library-store.ts` is the store, which keeps its
      record through a small interface: rows in the actor's database there, or the agent's own
      documents where a host gives no library, which is what the agent package's tests and
      anyone using it alone get. `library.ts` is the agent's side: the tools, the prompt and the
      sync. The gateway sends `/api/agents/<id>/library` and `/d/<agent>/...` straight to the
      library of the agent's workspace, so the clients did not change. A file records the agent
      that made it, and a listing names a file's chat only to that agent, since chats are
      numbered agent by agent.
    - **One `~/library` folder per machine.** The pass that brings it into step still runs in
      the agent that used the machine. The library hands out one pass per machine at a time and
      keeps what each folder held; an agent waits up to 20 seconds for another's pass. A pass
      that nothing else interrupted records where the library stood, so the next read on that
      machine skips the pass until the library changes.
    - **An agent's own library moves in** when it is next opened (`#moveLibrary`): files,
      versions and deleted files, by the same ids. Where a path is taken the file goes under a
      folder named for its agent. What each machine's folder held moves too, which is what
      keeps a taken path from being read as a change.
    - **Departures from the plan.** A page is served at `/d/<agent>/<key>/<path>`, not at
      `/d/<workspace>/...`, so the clients' addresses stayed as they were; any agent of the
      workspace serves the same library. The prompt names the other agents' folders on a
      machine, not the agents. There is no mock-up in `prototypes/`. The mobile app was not
      changed: its library and settings work through the same calls.

20. **Nothing waits for the server before it moves** (2026-10-07; `prototypes/loading-states` is
    the mock-up, with what was measured). The owner noticed "a long pause when switching between
    agents". With 150 ms added to every request, a click on an agent changed nothing for 555 ms
    and showed the chat at 785 ms: four trips in a row (who is signed in, the agent, a redirect
    that asked who is signed in again, the chat's stream). It is now one trip, with the frame
    changed on the click.
    - **Who is signed in is asked once** (`routes/_app.tsx`, `meQuery`). `beforeLoad` runs on
      every move between pages and used to fetch `/api/me` each time. A session that ends is
      found out by the next thing asked for: a 401 from any query or mutation loads the page
      again at the sign-in. Signing out loads the page again too, and signing in clears what
      the query client kept.
    - **The frame is drawn from the list of agents**, which has an agent's name, creature and
      color before the agent's own state has arrived (`useListedAgent`). The agent's layout no
      longer draws nothing until that state is here.
    - **Choosing an agent goes straight to its main chat.** `/a/<agent>` redirects without
      asking when the main chat is known, from the agent's cached state or from
      `dc-main-chats` in the browser's storage, where it is kept once seen. Otherwise the page
      holds the chat's place, asks, and goes on. A remembered chat the agent turns out not to
      have is forgotten and asked for again.
    - **Routes start what they need and do not wait for it.** A route's `loader` calls
      `prefetchQuery` without `await`, so pointing at a link (`defaultPreload: "intent"`) starts
      the fetch and choosing it never blocks. Pointing at a chat also follows its stream until
      its state arrives (`warmChat` in `lib/use-live-chat.ts`); a chat is followed by one stream
      however many hold it, so opening it carries on with that one.
    - **Placeholders** (`components/placeholders.tsx`) stand in for what has not arrived, each
      in the shape of what it stands for, and show only after 100 ms. Where a part of a page is
      nothing but something fetched, it is a `useSuspenseQuery` inside `Loads`
      (`components/loads.tsx`), which is a Suspense boundary with a line and a "Try again" for
      when it fails: automations, the library, and the lists in settings. A chat is a stream and
      not a promise, so its placeholder is chosen by `live.loaded`. Nothing says "empty", and the
      panel does not say "Ready", until it is known.
    - **The first paint is the frame.** `_app` is drawn in the browser only, and its
      `pendingComponent` (`components/shell/app-skeleton.tsx`) is sent in the page's HTML. A
      script in the head says on `<html>` how the sidebar and panel were left, so the frame is
      laid out as the app will lay it out. On the first load, who is signed in, the lists, the
      agent and the open chat are all asked for at once.
    - **A message is in the chat the moment it is sent** (`lib/sending.ts`, used by
      `lib/use-chat.ts`). The owner asked for it while this was being built. It is shown after
      the chat's own messages with the agent already "Thinking", or, sent while the agent is at
      work, among what is waiting for it. The chat's copy has an id of the chat's own and does
      not carry the request's, so it is known to have arrived by its words: the first message
      of the user's with those words that was not there when it was sent. One that does not go
      is taken back out and put back in the box, as before.
    - **Not done.** The gateway still does not know an agent's main chat, so an agent that has
      never been open in this browser takes two trips (its state, then its chat). The native
      mobile app was not changed.

21. **Notifications in the browser, and the web app on a home screen** (2026-10-07). The owner
    asked for web notifications, and whether they would work with the app set up as a PWA on
    iOS and Android. They do: the server already notified the Expo app (`server/push.ts`), and a
    browser is now one more kind of device there.
    - **Web Push with nothing to set up** (`server/web-push.ts`). The message is encrypted for
      the browser (RFC 8291) and the request signed with the deployment's own keys (VAPID), all
      with WebCrypto, so it is the same code on Node and Workers and there is no library. The
      keys are made the first time they are needed and kept in `dc_meta`, not in the
      environment: a deployment gets notifications without a new secret.
    - **A browser's subscription is a row in `dc_push_tokens`**: its token is the address its
      push service gave it, with the two keys beside it. A row a push service answers 404 or 410
      for is deleted. The address comes from the browser, so it is checked like a connector's
      (`checkAddress`) and redirects from it are not followed.
    - **In the browser** (`lib/notifications.ts`, `public/sw.js`): the service worker shows what
      is pushed and, when tapped, asks an open window to go to the page or opens one. It handles
      no requests, so nothing is cached. It is registered once someone is signed in; a browser
      that is already subscribed is then registered to whoever that is, and signing out takes it
      off the account without unsubscribing it. Turned on under the user's name, **Notifications**
      (`components/settings/notifications.tsx`), which also sends a test.
    - **The app on a home screen**: `public/manifest.webmanifest`, icons, and the tags in
      `routes/__root.tsx`. An iPhone only delivers notifications to a site added to the Home
      Screen, and the settings say so there. Opened that way the page ends above the phone's
      home bar (`styles.css`), which is why the frame is `h-full` of the body and not `h-dvh`.
    - **The app is called Do Computer.** The owner said so when they saw "durable" under the
      home screen icon. That is the name wherever a person reads one: the page's title, the
      manifest, notifications, invitations, sign-in, the name given to connectors and to
      OpenRouter, the mobile app and the daemon's service. The repository and its packages keep
      `durable-computer`.
    - **Checked:** the encryption against the example in the RFC; a real push service
      (Mozilla's) taking a message signed this way and delivering it, and refusing a stranger's
      key; and on the Workers dev server, an agent's answer in a chat nobody had open arriving
      at a fake push service. **Not checked:** a real phone, Apple's and Google's push services,
      and how the installed app looks on iOS.

22. **An agent in Slack** (2026-10-08; `packages/agent/src/slack.ts`,
    `apps/web/src/server/slack.ts`, `prototypes/slack`). The owner asked for a bot that can be
    mentioned in Slack, for the Slack chat to be readable in the agent, and for agents to search
    and write in Slack through a connector. They approved a written plan, then asked for a
    mock-up before the build, and said of it: "I love all of this ship it please".
    - **One Slack app for each agent**, made by whoever adds it, so the bot has the agent's
      name. Nothing is set on the deployment. `slackManifest` fills in Slack's "create an app"
      page: the bot's scopes, the Messages tab, and where events go
      (`/api/slack/events/<agent>`). What is pasted back is a row in `dc_slack_apps`: the bot
      token and signing secret. The token is tried on Slack (`auth.test`) before it is kept,
      which also says the workspace and the bot's name. Neither is ever sent back to a
      browser.
    - **What Slack sends** (`slackEvent`) is taken only when signed with the app's secret within
      five minutes. The one exception is Slack trying the address, which it does when the app
      is made and before the secret can be here: that is answered with Slack's own word, which
      gives nothing away. A mention in a channel (`app_mention`) or a direct message
      (`message.im`) from a person is handed to the agent at `/slack/message`, a route the
      gateway keeps for itself. Slack wants an answer in three seconds and sends again without
      one, so the request ends once the agent has the message, and the agent takes a message it
      was told of twice as one (`requestId`).
    - **A thread is a chat of kind `slack`** (`SlackChats`), kept and looked in on the way a
      conversation with another agent is (item 17): what is known of it is on its chat's record
      (`SlackRecord`), and each time the agent comes to rest there its last reply is posted.
      Slack has no way to say a thing once, so a crash between posting and noting it can post
      twice; nothing else can. A mention outside a thread starts one under itself; a direct
      message is one conversation for the whole channel unless it was in a thread.
    - **The host reaches Slack.** `slackDirectory` is handed to the actor as an option, as the
      other directories are. `describe` says who wrote a message (name, and the user of the
      app they are, matched by email among the people of the agent's workspace), the channel's
      name, the thread's address, and what others said in the thread since the agent was last
      given it. `post` sends the answer as a markdown block with the same words in Slack's own
      markup beside it, in pieces if it is long, and falls back to the plain words if Slack
      refuses the block. `working` shows "is thinking…" in the thread, or marks the message
      with eyes where Slack will not.
    - **Files go both ways** (added the same day, when the owner asked for the agent to read
      them). What is attached to a message comes with the event; the host fetches each as the
      Slack app (`fetch`), and the agent keeps it in the library as an upload in that chat and
      says "Attached: …" in the message, as the app does. A model that takes pictures is shown
      the smaller copy Slack makes of one, since a message has to stay small and nothing on
      the server scales a picture. A file the agent sends with `send_file` is put into the
      thread (`upload`, Slack's three steps) before its words, once: the calls that sent files
      already posted are kept on the chat's record. The app's token is only ever sent to an
      address that is Slack's (`isSlacks`), though both addresses come from Slack. A message
      Slack tells of twice is known by its id (`told`) before anything is fetched for it.
    - **Everyone in the Slack workspace is someone the agent works for** (changed the same day,
      once it had run against Slack for real). It was first built to treat someone whose Slack
      address was not an account's in the agent's workspace as a guest: answered, but with
      connectors and paired computers asked about first, whatever the rules said. The owner's
      own Slack address was not their account's, so they were the guest, the agent was guarded
      with them, and nothing in the app could fix it. They asked for it to go ("can we just say
      anyone in the slack can message the bot"), and chose "Everyone is trusted" when the cost
      was put to them. The guest rule is gone from `Approvals`; the note with a message says
      everyone there is someone to work for; the match by email is kept only to put a
      teammate's face on their messages. A rule the agent's people set still holds in a
      thread, and is answered on the thread's page.
    - **The agent goes to Slack unasked** (asked for the same day: "can the bot proactively post
      to slack?", then "I think I want this instead of the normal slack connection"). The
      `slack` tool, in every conversation of an agent that is in Slack: `channels` (the ones
      the bot was added to), `read` (a channel's latest, or a thread, oldest first) and `post`
      (to a channel, a thread or `@` a person, with a file of the library). The host does it
      as the bot (`whoami`, `channels`, `read`, `say`), so it reaches only where the bot has
      been added, and says in words the agent can act on why something could not be done.
      Posting is an ability of its own in Permissions (`tool:slack_post`), allowed unless set
      otherwise. The first time the agent hears of a thread it is given its own earlier words
      there too, since the thread may be one it started.
    - **Slack as a connector is gone from the Slack section.** It was Slack's own MCP server,
      signed in to as a person with the Slack app's client id and secret. The owner wanted the
      bot instead, so the app is no longer asked for anything as a person: no user scopes, no
      MCP, no redirect address in `slackManifest`, no client fields in the settings, and the
      two columns are dropped from `dc_slack_apps`. What stays is general: any connector can
      still be given a client id and secret (`AddConnectorRequest`), for a service that lets
      no app register itself, so Slack's server can still be added by hand under Connectors.
    - **In the app:** a Slack section in the agent's settings, "From Slack" in its panel, a
      thread's page with a line under the strip and no message box (`slack-threads.tsx`), and
      who wrote each message with "in Slack" beside it. Threads are not in the sidebar.
    - **The bot's picture** (asked for the same day: "We should also give you an image of your
      bot to add to slack"). Slack lets nobody but a person set an app's icon, so the Slack
      section hands the agent's creature over as a file, `<name>.png`, with where to put it.
      `lib/agent-picture.ts` draws it in the browser: a creature of its own on no page, stepped
      to its pose and drawn once, as the tab's icon is (`lib/favicon.ts`), then made large in
      whole blocks on a ground of its own color, 1024 pixels a side. Where the creature cannot
      be drawn, the plain one that stands in for it is.

23. **The agent can do in the app what a person can** (2026-10-08). The owner asked for an audit
    of what can be done in the app against the agent's tools (`PLAN-agent-tools.html`), agreed
    to all of it, and asked for one more thing: a way for the agent to ask for a secret that is
    typed into a form and saved to a file without entering its context, as a plugin of `bb` does.
    - **Some abilities ask first by default** (`approvals.ts`). An entry in `ABILITIES` can cover
      some actions of a tool (`actions`), start on Ask first (`ask`), or ask every time with no
      rule to set (`locked`). The rules the app is told are the ones that hold, defaults
      included, so the Permissions page needed no change. These are refused outright outside a
      conversation with a person. An ability's id must not be a tool's name: a call with no
      ability of its own answers to `tool:<name>`, and `connectors list` was asking first until
      the ability was renamed `tool:connectors_change`.
    - **`computers`** gained `add`, `remove` and `connect_own`. Adding goes through
      `ComputerDirectory.add`, which the server answers with `addMachineFor` in
      `server/computers.ts`: the same checks as "Add computer". The machine belongs to whoever
      the agent was answering (`ChatRecord.lastBy`, set on every message) and remembers the agent
      that added it (`dc_computers.added_by_agent`), which is the only agent that can remove it.
    - **`connectors`** is a new tool: `list`, `add`, `reconnect`, `enable`, `disable`, `remove`.
      A connector the agent added that wants a sign-in records the chat it was added from
      (`askedIn`); the app shows a Sign in card above the message box, which starts the sign-in
      the same way the Connectors page does, so the state is tied to whoever pressed it. When
      they come back the agent is told in that chat (`dc.connector` entry) and the callback
      returns them to it. For a service with an access token the agent passes `needs_token` and
      the token is asked for in the secrets form. The agent needs the app's address for this:
      `appUrl` (from `DC_BASE_URL`), or else the address its gateway was last reached at, which
      the gateway sends with every request (`x-dc-origin`).
    - **`request_secret`** (`secrets.ts`, `dotenv.ts`, `components/chat/secrets.tsx`). The
      request is kept in the agent's store with the names and the destination, never the values.
      The form posts to `/secrets/<id>`; the actor checks the values, merges them into the dotenv
      file on the computer (an assignment that is there is changed in place, the rest of the
      file is untouched, mode 0600), and writes a `dc.secret` entry that names what was saved.
      A file under the library folder is refused, since that folder is copied off the machine.
    - **Smaller ones:** `schedule run` and a timezone on `schedule update`; `settings` (`get`
      and `set` for model, thinking, when busy and timezone, with cost so far); `agents create`
      (`createAgentBeside` in `server/agents.ts`); and a section of the prompt that names the
      app's screens with links (`app-guide.ts`).
    - **A run the agent starts itself must not use the tool call's context.** `schedule run`
      first left the run "running" for ever: the run was submitted under the context of the tool
      call, which ends with it. The scheduler is now given the actor's own.
    - **Checked:** unit tests of each tool against a stand-in host (`app-tools.test.ts`), the
      server's side against a real database with stand-in agents and machines
      (`agent-requests.test.ts`), and in a browser with the echo model: the secrets form, a
      sign-in started from the chat, a token asked for in the form, and the approval cards
      (`e2e/agent-tools.spec.ts`). **Not checked:** adding or deleting a machine at a real
      provider from the tool (the test server offers only the built-in shell, which cannot be
      added), a real model using any of these tools, a sign-in against a real service, and the
      Workers runtime beyond its type check and the existing Workers tests. The mobile app shows
      none of the new cards.

24. **Automations that look before they start the agent** (2026-10-08;
    `packages/agent/src/schedules.ts`). Every run of a schedule used to be a model run, and
    `[SILENT]` only kept the message back. The owner asked for runs that are programmatic and
    start the agent only when a condition is met, as Hermes does with its cron scripts.
    - **A schedule can have a check:** a shell command, the computer it runs on, and what
      starts the agent. "output": the command printed something. "change": it printed
      something other than the time before; the first look is only taken note of.
    - **A fire with a check makes no chat.** The run is pending with no chat, the command is
      run on the machine with no model in it, and the chat is made only if there is something
      to do, with what the check printed in front of the prompt. Otherwise the run ends as
      "skipped". The check runs in the background, and the agent stays awake for it
      (`Scheduler.working`), so a slow machine holds up nothing else.
    - **A check that fails** (a non-zero exit, a minute gone by, a machine out of reach) starts
      the agent once, to say so. While it stays broken the runs end as "check-failed" and the
      agent is not started. Changing the check starts the count again.
    - **A check answers to the rule for running commands.** Making or changing one is asked
      about where commands are, and it is not run where they have been switched off since.
      Only the `schedule` tool sets a check; the app's own request to change a schedule cannot.
    - **A crash can run a check twice,** so a check only looks. What has been reported already
      belongs in a file the check reads and the run writes. The agent is told this in the tool
      and in the planning-automations skill, and can try a check with `schedule check`.
    - **Left out:** a check that is the whole job with no agent at all, and watching an address
      from the agent itself without a machine. A check still wakes the machine it runs on.
    - **Not tried on a real provider.** The tests run it on the built-in shell. On Cloudflare
      Containers, Daytona or Modal a check has not been run.

25. **Treats, boxes and a wardrobe for the creature** (2026-10-08; `packages/mascot/src/wardrobe.js`,
    `packages/protocol/src/wardrobe.ts`, `prototypes/gamification`). The owner asked for a
    little gamification of the creature, chose from two rounds of a mock-up, and asked for it to
    be built. None of it changes what an agent can do.
    - **The loop.** The creature earns a treat each time its agent answers someone in a chat or
      in Slack, and each time a scheduled run reports. A treat is given by carrying it onto the
      creature or pressing the pile; it opens its mouth, eats it in three bites and is pleased.
      Four treats fill a box (`TREATS_PER_BOX`). A box holds one thing to wear that the creature
      does not have yet: the rarity is drawn first (60, 25, 10, 4 and 1 in a hundred, among the
      rarities that still have something to find), then a thing of it. Every creature starts
      with one box waiting, as a welcome, including the agents from before this.
    - **Where it is kept.** In the agent's own store, as `CreatureDoc` (`packages/agent/src/docs.ts`):
      treats, how far the next box is filled, boxes waiting, what it has, what it has on. The
      routes are `/creature`, `/creature/feed`, `/creature/open` and `/creature/outfit` on the
      actor, reached through the usual proxy, so anyone who can use the agent can do all four.
      What a box holds is decided there and not in the browser. The agent's summary carries
      `outfit`, so every drawing of it is dressed; an agent event `creature` says when any of it
      changed. The agent itself has no tool for any of this and is not told about it.
    - **The hundred things** are named, placed and given a rarity in
      `packages/protocol/src/wardrobe.ts` (41 for the head, 20 for the eyes, 20 for the face, 19
      for the neck; 45 common, 29 uncommon, 18 rare, 6 epic, 2 legendary). Their shapes are in
      `packages/mascot/src/wardrobe.js` under the same ids, and a test holds the two lists to
      each other. To add one: a row in the first, an `item(...)` in the second.
    - **Fitting.** Every creature is grown from a seed, so nothing is placed by a fixed number.
      A stiff hat is open underneath and is lowered along its own axis until the head touches
      its underside. A soft thing (a beanie, a scarf, a beard) is made out of the skin itself,
      lifted a little, with a hole where a tail or an ear comes through. Ears in a small hat's
      way flop out sideways and are smaller for it; under a wide brim or a cap they lie flat, as
      a horn, a tuft or an antenna does, and all come back when the hat comes off. A last pass
      moves anything that still has a corner in the body straight out. `Wardrobe.audit(orb)`
      measures how far the deepest corner is inside the body; `apps/web/src/lib/wardrobe.test.ts`
      holds it at nothing for all hundred things on sixty seeds.
    - **In the core** (`orb-core.js`): `orb.offer()`, `orb.bite()` and `orb.cheer()` for eating,
      `orb.hidden` to draw a creature's stage without it, and `orb.worn`, which the wardrobe
      sets and the core calls after each update, after a change of size or seed, and on
      dispose. The wardrobe is a second plain file handed the same three.js and the core, so
      the core still stands alone for the playground and the mock-ups.
    - **The box** is opened on the creature's own stage, by the same renderer, as the hatch is:
      `Wardrobe.unwrap(orb)` shows a box in the creature's place. Pressed, it rattles while the
      agent is asked what is inside; then it jolts once for each rarity up to the thing's own,
      the light at its seam stepping through their colors, gathers itself, and bursts: the lid
      is blown off, the walls fall open, confetti and rings fly, and the thing rises into a beam
      and hangs there. The rarer the thing, the longer the wait. With reduced motion it is
      simply open.
    - **In the web app** (`apps/web/src/components/creature`): the treats and the box are two
      small buttons at the creature's lower corners in its panel, and a shirt button by its name
      opens the wardrobe. Nothing is added to the chat. The agent's picture at the top of its
      pages is now a button of its own that opens the wardrobe, with a dot when a box is
      waiting; its name beside it is still the way to another agent. On a narrow screen, where
      there is no panel, the wardrobe window fills the screen and has the creature, its treats
      and its box at its top, so that is where it is looked after. A thing not found yet is a
      question mark in the color of its rarity.
    - **In the Expo app** the creature wears what it has on, and that is all: there are no
      treats, no box and no wardrobe there yet.
    - **Checked:** the rules and the catalog (`packages/protocol/test/wardrobe.test.ts`); the
      agent's routes, earning, and the event (`packages/agent/test/creature.test.ts`); fitting,
      eating and the box's timeline without a browser (`wardrobe.test.ts`); and in a browser
      with the echo model, earning, feeding, opening a box, wearing and the wardrobe
      (`e2e/creature.spec.ts`). The drawing itself was judged from screenshots taken in headless
      Chromium, which draws in software. **Not checked:** on a phone or in Safari (carrying a
      treat by touch above all), the Workers runtime beyond its type check, the Expo app on a
      device, and a team where two people feed or dress one creature at the same moment.
26. **Commands that run in the background** (2026-10-08; `packages/sandbox/src/jobs.ts`,
    `packages/agent/src/jobs.ts`, `packages/computers/src/node-jobs.ts`,
    `PLAN-background-commands.md`, `prototypes/background-commands`). The owner said agents
    "sometimes take a long time to run bash commands" and asked for them to run in the
    background, by request or by themselves, "like claude code does". They approved the plan
    with "Yeah these all sound good! Go forth please".
    - **Every command is a job.** On a machine of the workspace a command runs in a session of
      its own, with what it prints going to `~/.do-computer/jobs/<agent id>/<folder>/output.log`,
      and a call to `bash` is a wait for it. One shell command starts it and follows it, so a
      quick command still costs one call to the provider. A folder is removed when its command
      ended in time and printed little; otherwise it stays for seven days.
    - **A slow command moves by itself.** One still running after 60 seconds is written down
      (`JobsDoc`, ids `b1`, `b2`, ...) and the call returns what it printed so far. With
      `run_in_background` it is written down after a second. With `timeout` and no
      `run_in_background`, the agent waits that long, ten minutes at most, and the command is
      stopped, as before. A background command is stopped after an hour unless `timeout` says
      otherwise, a day at most; eight can run at once; one that prints over 100 MB is ended.
    - **The agent is told.** When a command ends, the chat that started it gets an entry
      (`dc.job`, shown as a `command` notice) and the agent gets a turn, the way a sub-agent's
      report arrives. Stopped by the agent, nothing is said; stopped by a person, the entry is
      written and no turn is given. The `background` tool lists them, shows what one printed
      since the agent last looked, and stops one.
    - **Who waits.** A sub-agent, a conversation with another agent, or a thread in Slack that
      left a command running has not come to rest until it ends, so it reports once, with what
      it said after. Stopping a sub-agent stops what it left running. Keep-going does not
      nudge a chat that is waiting on a command. Stop on a turn stops the command the turn is
      waiting for, at once on every kind of computer, and leaves background ones alone.
    - **Looking in.** Running commands count as live work, so the agent's wake-up looks at them,
      one call per machine, and that is also what keeps Daytona from stopping the machine. A
      timer in the process looks sooner (every 5 seconds for the first two minutes), so word
      of a short command is not 20 seconds late. A request to the agent used to put the
      wake-up off each time; it no longer does, or a client that kept asking would have kept
      a finished command from being noticed.
    - **Paired computers** keep jobs in the daemon, through Node, because macOS has neither
      `setsid` nor `timeout`: `job` frames in `packages/protocol/src/daemon.ts`, and a daemon
      says `jobs: true` when it connects. One that does not is from before: `bash` there works
      as it did, and `run_in_background` says the daemon wants updating. A job runs on when
      the daemon restarts, and the daemon that comes back finds it by its folder.
    - **The built-in shell** has no processes. `run_in_background` fails there with a sentence
      saying so.
    - **What the app shows so far:** the entry in the transcript when a command ends, on web
      and phone, and "Starting in the background" in the status line. The rest of the mock-up
      (the command where it was started, the list in the panel and above the message box,
      Stop, reading output as it comes) is not built: see section 7. The routes it needs are
      there: `GET /jobs`, `GET /jobs/:id/output`, `POST /jobs/:id/stop`.
    - **Checked:** the runner against real coreutils and, on 2026-10-08, against a real
      Daytona machine (`packages/sandbox/test/jobs.live.test.ts`: a job outlives the call
      that started it, a second call reaches the machine while a first waits, a quick command
      costs no more than before); the agent's side with the test model
      (`packages/agent/test/jobs.test.ts`, and `paired.test.ts` for a paired computer); the
      daemon's side with real processes (`packages/computers/test/computers.test.ts`). On the
      Node server with the echo model and a Daytona machine: a 75-second command moved at
      the minute, word of its end reached the chat 4 seconds after it ended, and Stop from
      the app took effect in 150 ms. `scripts/smoke.sh` now leaves a command running on the
      paired computer and waits to be told. **Not checked:** Cloudflare Containers and Modal
      (no Docker here and no Modal keys), where the same shell commands are used; macOS, where
      the daemon's side has never run; whether looking at a job really holds off Daytona's
      15-minute stop (nothing ran that long); a command that outlives its machine being
      stopped, outside the tests; and a real model, which may or may not use
      `run_in_background` when it should.

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

Machines and the library, decided on 2026-10-07: a workspace has machines, perhaps several,
and it can be chosen which agents use which; an agent has no home computer and uses the ones
it can reach; "maybe the agents have different like starting working directories that makes a
lot of sense to me"; the library is shared by a workspace's agents; and memory is no longer
mirrored as files, which was put to them as the cost of this and accepted. Section 7 of
`PLAN-shared-computers.md` lists what was chosen for them and can be changed.

Agents writing to each other, decided on 2026-10-07: "maybe we don't need the permissions and
agent can message any other agent in a workspace. I'm not worried about loops". So there is no
switch to allow it and no cap on how long an exchange runs.

Slack, decided on 2026-10-08 from a plan and then a mock-up (`prototypes/slack`): one Slack app
for each agent; threads in the agent's panel and not the sidebar, opening in the middle; a
thread is read in the app and answered only from Slack; no switches for who may use the bot; a
thread in a private channel or a direct message being readable by everyone in the workspace.
Changed the same day, once they had used it in their own Slack: everyone in the Slack workspace
is worked for alike, with no OK step for people without an account ("can we just say anyone in
the slack can message the bot", and "Everyone is trusted" when asked); and the agent is in
Slack as its bot only, writing and reading there on its own, with the connector that acted as a
person taken out ("I think I want this instead of the normal slack connection").

The creature's game, decided on 2026-10-08 from two rounds of a mock-up
(`prototypes/gamification`): treats and not food ("They're not necessarily like you know the food
he needs to live"); a loot box once it is happy enough, holding one random thing, with rarity
tiers; a hundred things in all, not a hundred of each kind; little room taken, since "This is
mainly like a productivity app", with no bond level and the treats beside the creature; a page of
its own for looking after it on a phone; hats that do not sit inside heads, whatever the seed;
and the box opened with "a really juicy three.js opening animation like the hatching". Chosen for
them and not confirmed: one treat for each answer, four treats to a box, the odds, that a box
never repeats a thing, that every creature starts with a box, that ears flop or lie flat under a
hat, and that a team shares one creature with one outfit.

Cost: they found Claude Haiku too expensive for the summaries a small model used to write of
each run, and on 2026-10-07 asked for those to go: the agent writes the list itself, and only
for big things. Web search still uses Haiku; they were told and have not asked to change it.

## 7. Open questions and unfinished work

### Waiting on the owner

- **How background commands look in the app.** `prototypes/background-commands` draws it: the
  command in the transcript where it was started, a list in the panel and above the message
  box with Stop, the end of the output on opening one. The owner has not seen it yet. Build
  it once they have said yes; the server side is done (section 5, item 26).

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
  every agent the user can reach and shows no authors or presence. A side chat's spinner in
  the strip's menu knows about sub-agents everywhere but about the agent itself only in a chat
  on screen. Who is where does not work under `pnpm dev` on Node, which has no WebSocket server;
  it does on the built server and on Workers. Invitation email has never been sent for real.

- **Main and side chats:** an agent's row in the sidebar says nothing of what the agent last
  said or whether it is working, which the mock-up's rows did: the list of agents comes from the
  gateway, which does not know, and asking every agent would wake each one. A side chat cannot
  be renamed or brought back from the app once archived (the API can do both). Someone typing
  in a side chat that is beside the main chat is not shown as typing, and is counted as being
  in the main chat. The mobile app still lists every chat alike.

- **Agents writing to each other:** nothing limits an exchange, by the owner's choice; one is
  ended by stopping the conversation from its chat. Sub-agents and scheduled runs cannot send.
  Nothing on the sender's side shows that it is waiting to hear back. The native app shows the
  replies and cannot open the conversations.
- **Slack:** a picture attached there is looked at only by a model that takes pictures, and
  only as the smaller copy Slack makes; at most five files of a message are taken in. A Slack
  app made before files were added lacks the two permissions for them (`files:read`,
  `files:write`): it has to be given them and installed again, and until then the agent says a
  file could not be had. An answer is posted when it is finished, not as it
  is written. A thread cannot be answered from the app. A chat from Slack cannot send to
  another agent, and a scheduled report into one is not posted. The bot hears only mentions
  and direct messages: a reply in its thread that does not mention it is read the next time it
  is mentioned. Anyone in the Slack workspace has the agent as its own people do, connectors
  and paired computers included, by the owner's choice; only its Permissions limit it. The bot
  cannot search Slack: it reads the latest of a channel or a thread, and only where it has
  been added. Writing to a person needs a permission (`im:write`) that a Slack app made
  before 2026-10-08 lacks; the agent is told so when it tries. The tokens are kept as they are
  in the app database, as connectors' are in the agent's. Threads are listed in the agent's panel, which a narrow screen
  does not have: there a thread is reached from a notification or its address. The mobile app
  does not list them.
- **Sub-agents on mobile** are only their reports, shown in the chat that started them. Their
  own chats cannot be opened there, and nothing shows that one is at work.
- **Machines:** agents on one machine are not walled off from each other, by the owner's
  choice of sharing; a Unix user per agent would be the wall and was not built. The built-in
  shell cannot be shared. A machine cannot be renamed. Nothing shows what a machine costs or
  when it last ran. When an agent is moved to another workspace, the cards in its old chats
  point at files in the library it left, and open only if they are also in the new one. The
  move of an agent's own library into its workspace's runs once, when the agent is next
  opened, and cannot be undone.
- **What the agent can do in the app:** the form for secrets, the Sign in card and the notes
  about them are in the web app only. A secret the agent asked for is in a file on a computer it
  works on, so it is kept out of the conversation and not out of the agent's reach. In a thread
  from Slack the agent can do none of this, since the cards that go with it are in the app. Left for
  later from the audit: putting back a deleted library file or an older version, opening a
  machine to chosen agents, renaming a chat, and a list of who is in the team.
- **Mobile** has no model picker, connectors, permissions or file attaching, and
  no agent panel. Its creature is checked only through the app's web build. It shows the answer
  to an agent's request for a computer but cannot give one: the notification opens the chat,
  and the request is answered on the web.
- **Never run for real:** two agents sharing a machine on Modal or Cloudflare Containers,
  the mobile app on a device, Modal, Cloudflare Containers, sign-in with
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
  machine and from GitHub Actions; one agent asking another for something in its memory and
  passing the answer on, on the Node server; two agents sharing one Daytona machine, each in
  its own folder, with the workspace's library on it and on a second machine, an edit made in
  the app arriving there, taking an agent off a machine, and deleting both machines, on the
  Node server with the echo model. On Workers, where an agent reaches another through
  its own Durable Object namespace, that has run only in the tests' local runtime with the echo
  model.
- **Slack against Slack itself.** The owner made the Slack app from the link, installed it,
  and on 2026-10-08 wrote to their agent on the live site: it answered, twice, in one
  conversation, which showed in the app. So the manifest, the signing, an event and a posted
  answer work for real. Everything else has only met the tests' stand-in for Slack's Web API:
  whether a mention carries its attached files as a direct message does, fetching and sharing
  a real file, the "thinking" status, and all of the `slack` tool (listing the bot's channels,
  reading one, writing unasked, writing to a person).
- **On the live site**, without the owner's session, only this could be checked: it answers, its
  pages and assets load, the GitHub sign-in button leads to GitHub with the right callback, and
  the daemon downloaded from it starts pairing. The owner has since paired a computer, pasted
  pictures and chatted on it.
- Everything visual was judged from screenshots taken in headless Chromium.
- **How long a page takes to move** was measured on the built Node server with 150 ms added to
  every request by the browser test tool, before and after item 20. It has not been measured on
  the live site, where an agent's Durable Object may also have to wake.

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
- **A route's `beforeLoad` runs on every navigation, for every route above the page**, and
  nothing on screen changes until all of them have returned. One fetch in the top one made
  every click in the app wait a round trip. Keep what it needs in the query client, and start
  a page's fetches in `loader` without awaiting them.
- **A fresh deployment belongs to whoever signs up first.** The first account needs no
  invitation, so on a public address, sign up at once.

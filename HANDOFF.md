# Handoff

Written 2026-10-06 for whoever picks this project up next. It covers what exists, how it is run
and shipped, what the owner has asked for and decided, what is unfinished, and what has and has
not been checked. `README.md` introduces the product and `docs/reference` describes it for
someone hosting it; `PLAN.md` is the original plan with a status section. Where they disagree with this file, this file is newer.

**This file is in a public repository, and everyone can read it.** Keep out of it, and out of
every other tracked file: credentials, and where they are kept; the identifiers of accounts and
deployments; the owner's machines, their names, their paths and how they are reached; other
projects that are not public; what is left over on the owner's accounts; and a weakness of a
running deployment that is not fixed yet. Tell the owner those privately. What belongs here is
what was built, why, what the owner decided, and what has and has not been checked.

## 1. What this is

Do Computer is an open-source, self-hostable personal agent: a version of Meta's Muse built
on the pi-durable harness, with OpenRouter for models. Each user has persistent agents with a
name, a personality, memory, scheduled automations, skills, connectors (remote MCP servers) and
the user's own paired computers. An agent has no computer of its own: it works on the machines
of its workspace, which the workspace's agents share, and they share one library. It runs on Cloudflare Workers (one
Durable Object per agent) and on plain Node, from the same code. There is a web app (TanStack
Start, shadcn, jotai, TanStack DB and Query, Better Auth) and an Expo mobile app.

The owner is Sawyer. The repository is `SawyerHood/do-computer`.

## 2. Where it runs

- **Live:** https://do.computer, the Cloudflare Worker `durable-computer`, on the owner's
  Cloudflare account. It replaced an older app, which was torn down on 2026-10-03.
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
  `DC_SIGNUP`, `DC_LANDING`, `DC_ALLOWED_EMAILS`, `DC_DEFAULT_MODEL`, `DC_SEARCH_MODEL`, `DC_SUMMARY_MODEL`,
  `DC_JUDGE_MODEL`, `DC_SANDBOX_KINDS`.
- **GitHub repository secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- **Worker secrets** (kept by Cloudflare across deploys): `DC_AUTH_SECRET`, `OPENROUTER_API_KEY`,
  `DAYTONA_API_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`. `RESEND_API_KEY` would go here,
  with `DC_EMAIL_FROM` as a repository variable, to send invitations by email; neither is set.

`apps/web/scripts/deploy-settings.mjs` applies those values to the built config before
`wrangler deploy` uploads it; `pnpm --filter @do-computer/web run deploy` is what CI runs.

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
pnpm --filter @do-computer/mascot demo    # the creature's playground page
node scripts/icons.mjs          # draws the app's icons again: its creature on the first run's island, or on its own color
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

Layout, briefly (`README.md` has it too):

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
| `apps/desktop`       | The Electron app: the deployment in a window, and the daemon run inside it           |
| `prototypes/`        | Design explorations that are not part of the app                                     |

The code has a consistent voice: comments explain why in plain sentences, tests are named as
statements of behaviour, and commit messages say what changed and why. Keep to it.

### On a Linux machine with no graphics card and no Docker

Most of this was built on one, and these are what it took:

- Browser tests use an already-downloaded Chromium:
  `PLAYWRIGHT_CHROMIUM_PATH=$HOME/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome pnpm exec playwright test`
  from `apps/web`, after `pnpm build:node` and
  `pnpm --filter @do-computer/mobile export:web:test`.
- For a headless browser to draw the creature, launch Chromium with
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
- The local Workers runtime needs port 3112, because `apps/web/.dev.vars` sets the base URL to
  it, and `DC_SIGNUP=open` added to that file to sign up. Restore the file afterwards.
- There is no Docker, so Cloudflare Containers cannot run locally.
- Keys for real-service tests are not in this repository. Pass them to a child process without
  printing them, never write them into a tracked file, and delete any Daytona machines a test
  creates.

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
   Where a page cannot get WebGL as it opens, a still picture stands in and `loadMascot`
   (`apps/web/src/lib/mascot.ts`) tries again: after 1, 5 and 30 seconds, and whenever the page
   is come back to. It used to keep the first answer for the life of the page, which in the
   desktop app is until the app is quit; that was seen once on macOS (2026-10-09), and why WebGL
   was not there that time is not known. The packed app does get WebGL on GitHub's Mac.
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
      panel for those at work: one that has ended is in the transcript only. They are not
      listed in the side column, which says only how many of a chat's are at work: the owner
      found a third level there too much nesting. A sub-agent's creature grows from its chat's
      id. `prototypes/subagents` is the mock-up it was built from.

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
    - **The web app** has one sidebar and no rail. It lists the user's agents, under their
      workspaces' names where they are in a team (item 62, which replaced the workspace menu
      this was built with; item 18 says what choosing an agent does); at its foot is the
      user's own menu. A team
      has no page of its own: `/w/<id>` goes to its first agent, and stops only where there is
      none yet. Its people are a section of the workspace's settings. The invitation page
      (`/invite/<token>`) can be read before signing in.
    - **An agent's pages** are tabs in a strip above them (`components/shell/agent-strip.tsx`):
      Chat, Library and Automations. The strip also has the agent's name, which opens a menu of
      the other agents and its recent chats, the way into its settings, and the switch for its
      panel. The panel is beside every tab, and on the Library tab the sidebar's list is the
      library's files, put there through a portal (`sidebarSlotAtom`), so changing tab moves
      nothing. Settings are a window over the page, opened by the address (item 58, which
      replaced the two windows this was built with). The old page addresses (`/a/<id>/skills`
      and the like) redirect to it.
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
      memory, their own conversation. Since item 30 one begins with the main chat's context.
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
      (That is Node. On Cloudflare it is a machine like the others since item 47.)
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
    - **Something asked for says so at once** (2026-10-13). Whatever is pressed that goes to
      the server shows it is at work from the press: a spinner in place of its icon, or its
      words changed ("Removing…"), and it cannot be pressed twice. What goes wrong is said
      beside it (`role="alert"`); there are no toasts. A menu's row that starts something
      stays open while it does (`closeOnClick={false}`), which is where its failure is said.
      Making an agent (`lib/new-agent.ts`) puts a row for it in the sidebar from the press.
    - **What the server just answered is not asked for again.** `POST /api/agents` answers
      with the agent and the main chat it was given, so the app puts the agent in the list
      (`listAgent`), remembers the chat and opens it: it used to ask for the whole list, which
      waits for every agent, and then for the agent's state twice. A new side chat, and a main
      chat settled on, are put among the agent's chats the same way (`keepChat`); deleting an
      agent or leaving a team takes agents out of the list (`unlistAgents`). Each is followed
      by asking again, which nothing waits for.
    - **Not done.** The gateway still does not know an agent's main chat, so an agent that has
      never been open in this browser, and was not made in it, takes two trips (its state, then
      its chat). The native mobile app was not changed.

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
      OpenRouter, the mobile app and the daemon's service. The packages were `@durable-computer/*`
      until item 66.
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
    - **The loop.** A box turns up beside the creature six hours after its last one was
      opened (`BOX_EVERY_MS`), whatever the agent did or did not do meanwhile. It has one box of
      its own waiting at most: nothing more turns up while that waits, and the wait for the next
      starts when it is opened (`nextBoxAt` in `CreatureDoc`, set by `#openBox` in
      `packages/agent/src/actor.ts`). Nothing wakes for a box. One that has come due is counted
      when the creature is next looked at (`#boxDue`), and the page asks again when the time
      comes, so a box turns up while it is open. Once everything is found no more turn up. The
      boxes that other people's treats make for a claimed Dood (every four, `TREATS_PER_BOX`,
      `joy`; item 55) are besides that one and wait together however many there are: `shared`
      counts them, the creature's own box is opened before them, and opening one of them starts
      no wait. An agent from before this keeps the boxes it had, as its own: its next turns up
      six hours after the last of them is opened, or after the first look where it had none.
      Treats are for nothing but the pleasure of it: there is always one to give, by carrying
      it onto the creature or pressing, and it opens its mouth, eats it in three bites and is
      pleased. All that is kept is how many it has had (`fed`), which decides the kind of the
      next. A treat that is carried is followed from the window and not from the button it was
      taken from.
      It was first built otherwise: a treat earned with every answer, four treats to a box. The
      owner found that "waaaaay too quickly" (2026-10-12) and asked first for one treat an hour
      at most, then, before that was merged, for "a new present every 12 hours ... they just
      show up there ... and you can have multiple ... The feeding is just a cute interaction
      ... maybe you have infinite snacks", and then "You can have max 1 present waiting at a
      time ... unless they are from sharing your dude, but otherwise max one". Chosen for them:
      that the wait runs from the opening of the last box and not from its turning up, so
      that two are never opened within the same wait. Twelve hours then felt "too slow" to
      them (2026-10-13) and they asked for six. A wait that was set when it was twelve is cut
      to six from the next look (`#boxDue`), so nobody is told of more hours than the whole
      wait; that cut was chosen for them. A phone app built before this still fills its box
      button over twelve hours. The browser tests set
      `DC_BOX_EVERY_MS` to a few seconds to see a box turn up; nothing else should set it.
      A box holds one thing to wear that the creature
      does not have yet: the rarity is drawn first (60, 25, 10, 4 and 1 in a hundred, among the
      rarities that still have something to find), then a thing of it. Every creature starts
      with one box waiting, as a welcome, including the agents from before this.
    - **Where it is kept.** In the agent's own store, as `CreatureDoc` (`packages/agent/src/docs.ts`):
      treats it has had, when the next box is due, boxes waiting, what it has, what it has on. The
      routes are `/creature`, `/creature/feed`, `/creature/open` and `/creature/outfit` on the
      actor, reached through the usual proxy, so anyone who can use the agent can do all four.
      What a box holds is decided there and not in the browser. The agent's summary carries
      `outfit`, so every drawing of it is dressed; an agent event `creature` says when any of it
      changed. The agent itself has no tool for any of this and is not told about it.
    - **The two hundred things** are named, placed and given a rarity in
      `packages/protocol/src/wardrobe.ts` (81 for the head, 40 for the eyes, 40 for the face, 39
      for the neck; 90 common, 58 uncommon, 36 rare, 12 epic, 4 legendary). Their shapes are in
      `packages/mascot/src/wardrobe.js` under the same ids, and a test holds the two lists to
      each other. To add one: a row in the first, an `item(...)` in the second. The second
      hundred were added on 2026-10-10 after the first, in both files, so that what a creature
      already has keeps its id and its place in the wardrobe. A thing thinner than about 0.035
      of the body's radius is less than a pixel at the size the creature is drawn, and is not
      seen.
    - **Fitting.** Every creature is grown from a seed, so nothing is placed by a fixed number.
      A stiff hat is open underneath and is lowered along its own axis until the head touches
      its underside. A soft thing (a beanie, a scarf, a beard) is made out of the skin itself,
      lifted a little, with a hole where a tail or an ear comes through. Ears in a small hat's
      way flop out sideways and are smaller for it; under a wide brim or a cap they lie flat, as
      a horn, a tuft or an antenna does, and all come back when the hat comes off. A last pass
      moves anything that still has a corner in the body straight out. `Wardrobe.audit(orb)`
      measures how far the deepest corner is inside the body; `apps/web/src/lib/wardrobe.test.ts`
      holds it at nothing for all two hundred things on sixty seeds.
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
      and its box at its top, so that is where it is looked after. A box opened there opens
      over the wardrobe, which is still open once the box is done with (it used to take the
      wardrobe's place, and closing it left the chat). A thing not found yet is a question mark
      in the color of its rarity.
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
    - **What the app shows** (`apps/web/src/components/chat/commands.tsx`), built on
      2026-10-09 after the owner saw the mock-up and said "Yeah the ui looks good go build!".
      The app has no rows for tool calls, so a command is shown as a sub-agent is. Where the
      agent left it running there is a chip in the transcript: the command, its computer, "in
      the background" and a clock, or "still going after a minute, now in the background" for
      one that was moved. Opened, it shows the end of what the command has printed, read
      again every four seconds, with Stop. Once the command has ended the chip says how, and
      what it printed is with the word of its end, further down. The running commands of a
      chat are listed in the agent's panel and from a count above the message box, each with
      its last line and Stop; a row opens the command in the chat. The agent reads "Waiting
      on a command" in its panel and "Waiting on pnpm build" in the sidebar. Jobs reach the
      page by `GET /jobs`, asked again when the agent's event stream says `jobs` changed.
    - **Where that differs from the mock-up:** the sidebar says what an agent is waiting on
      only for the agent on screen, since the list of agents does not know what the others
      are doing. A side chat has the chips and no count. On a phone there is no count and no
      list, as drawn. The Expo app shows a line where a command was left running and the
      word of its end, and nothing live. How long a command took is what its computer
      measured, not when the agent noticed.
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
      `run_in_background` when it should. The app's side was checked in a browser with the
      echo model and a real daemon (`e2e/computers.spec.ts`), and judged from screenshots at
      1440 and 390 pixels wide; not in Safari, not on a phone, and not against Daytona.
27. **A daemon that keeps itself up to date** (2026-10-09; `apps/daemon/src/update.ts`,
    `supervisor.ts`). A daemon was installed once and never changed, so a paired computer could
    not do what newer servers ask of it, as item 26 showed. The owner called that "a critical
    hole in the application" and asked for the daemon to update itself.
    - **How.** The server already said which daemon it serves (`/api/daemon-version`, a hash of
      its code); it now also says what the file at `/daemon.js` adds up to. A connected daemon
      asks when it connects, which is also when a deploy has dropped its connection, and every
      six hours. When the version is not its own it downloads the daemon, checks it against
      that sum, runs it with `--version` to see that it starts here and is what it was said
      to be, keeps the old file as `daemon.cjs.previous`, puts the new one in its place in one
      step, waits up to fifteen minutes for whatever the agent is doing there to end, and
      exits with code 75.
    - **The server can tell it to.** The owner asked next whether the server could send a
      signal, "like an agent needs a new capability". It sends an `update` frame, and a daemon
      that keeps itself up to date looks at once. The computer's link sends it when a daemon
      that is not the one served connects or is used (at most once a minute), when the
      Computers page lists one that is behind, and when something is asked of a daemon that
      it cannot do. In that last case the request waits up to twenty seconds for the daemon
      to come back as one that can, so the agent's call goes through instead of failing; a
      daemon that is not back in time, or does not update itself, is said to be so in words
      the agent passes on. Today the only such ability is `jobs`, which every daemon that
      updates itself already has, so the waiting is for whatever comes next.
    - **Two processes.** The daemon now runs as a supervisor and a worker. The supervisor only
      starts the worker again when it exits with 75, so the same thing happens under systemd,
      under launchd and in a terminal, and nothing about the service files changed. A worker
      that fails within thirty seconds of an update has the old daemon put back, and the
      version is written to `update.json` so it is not fetched again; a later version is.
      Commands left running in the background carry on across an update, as across any
      restart of the daemon.
    - **Switching it off.** `--no-auto-update`, remembered like `--read-only`, and
      `--auto-update` to switch it back. The Computers page says so beside the install command.
    - **What the app shows.** A daemon says `updates: true` when it connects. The Computers
      page says of a connected computer whose daemon is not the server's and does not update
      itself that the install command has to be run there again (`daemon` on
      `ComputerSummary`).
    - **Daemons from before this** cannot update themselves. The owner asked whether there
      was something to run "to make sure they all get updated", so the Computers page has an
      Update button on a connected computer whose daemon is out of date
      (`POST /api/computers/:id/update`, `apps/web/src/server/daemon-reinstall.ts`). For one
      that keeps itself up to date it sends the `update` frame. For an old one it sends a
      command through the daemon's own way of running commands: find the daemon that is
      running this, download the served one, see that it starts and is the right version,
      keep the old file, swap, and start the new daemon a second later. The new one
      connecting is what ends the old one, since a computer has one connection; under a
      service manager the service then starts again from the new file and takes over. Only
      whoever may remove the computer can press it, and not for a read-only computer, which
      runs nothing it is sent: there the install command has to be run by hand.
    - **Mine, not the owner's:** that it is on by default, including on a read-only computer,
      where it lets whoever runs the server run code that the agent cannot. The server
      already gave that computer the daemon it runs; the owner has not been asked.
    - **Checked:** the updater and the supervisor in `apps/daemon/test/update.test.ts`. With
      the built server and a real daemon on this machine: an older build paired, downloaded
      the server's, and was running as it a tenth of a second later, and the agent ran a
      command through it; and with a server whose daemon could not start, the old one was
      put back, reconnected, and did not fetch that version again; and a build that never
      asks by itself updated the moment it connected, which only the server's frame can
      have caused. The Update button was pressed in a browser on a daemon built from the
      commit before item 26, which then ran a command in the background; the same was done
      through the route for one started plainly and one under a loop that starts it again
      whenever it ends, as a service manager does. The waiting for an ability is checked in
      `packages/computers/test/computers.test.ts` with a stand-in for the daemon coming
      back. **Not checked:** macOS or
      launchd, a daemon run by systemd, a deploy to Cloudflare dropping a live connection
      (which is what makes the check prompt), and an update while a command was being
      waited for.

28. **Signing a workspace in to model providers** (2026-10-09; `packages/agent/src/model-access.ts`,
    `model-providers.ts`, `apps/web/src/server/model-access.ts`, `prototypes/model-sign-in`).
    Every model call was paid from the deployment's one OpenRouter key. The owner asked for
    "all of the different login methods for pi", and said the main thing was "log-in with codex
    and claude". Built on the server first, then the screens, as drawn in the mock-up. The
    owner was shown the mock-up and did not say it was right before the screens were built.
    - **What pi has.** pi-ai 1.1.0 gives each provider its own sign-in: a key typed in, or the
      provider's own flow for a subscription (Claude Pro/Max, ChatGPT for OpenAI and for Codex,
      GitHub Copilot, xAI, Kimi, Meta, OpenRouter). A flow is a function that asks questions
      and says things (`AuthInteraction`: a page to open, a code to enter there, a code to
      paste), written for a terminal. Nothing here re-implements one: the app hosts them.
    - **One actor per workspace** (`createModelAccessActor`, the `MODEL_ACCESS` Durable Object,
      migration `v6`; `model-access/` under the data directory on Node), named by the
      workspace's id. It keeps the credentials (`dc_model_credentials` in its own database),
      runs a sign-in in memory while someone is doing it, and hands a credential to the
      workspace's agents. A sign-in under way is lost if the actor is unloaded, and is started
      again; the app asks for it with `?rev=&wait=`, which holds the request until something
      changes and so keeps the actor loaded.
    - **A token is exchanged in one place.** A subscription's token runs out and is exchanged
      for a new one, and a provider that sees the old one used twice may sign the account out.
      So agents never exchange one: an agent's `Models` reads through `workspaceCredentials`,
      and the workspace's actor exchanges a token with less than ten minutes left before
      handing it over, one exchange at a time. pi's own `modify`, which is how it would
      exchange one itself, is answered with what the workspace keeps.
    - **Which providers.** Every one pi has (39), less three: Amazon Bedrock and Google Vertex
      sign in with files and roles of the server's own machine, and Radius by a page that has
      to reach the server on its own address. Anthropic's sign-in asks how, and the way that
      ends on a page showing a code is chosen for the person (`CHOSEN`), since the other ends
      at an address on the server. OpenAI's two ways are both offered.
    - **What an agent can run on** is the deployment's models and those of the providers its
      workspace is signed in to (`workspaceModels` on the actor's options; `GET
/api/models?workspaceId=`). A sign-in in a workspace takes the deployment's place for
      that provider there: a workspace signed in to OpenRouter spends on its own account.
      A new agent starts on its maker's default where the workspace offers it, and otherwise
      on the workspace's: the deployment's, or the first suggested model of a sign-in where
      the deployment has only its echo. An agent moved to a workspace that does not offer its
      model is set to that workspace's.
    - **Who may.** Anyone in a workspace can sign it in, and only they can read or answer
      their own sign-in. Whoever signed in, or an admin, can sign out. Someone who leaves a
      team, or is taken out, takes their sign-ins with them. A credential is never sent to a
      browser, and the gateway has no route to the one address that returns one.
    - **When it is gone.** An agent set to a model of a provider its workspace is not signed
      in to gets a failed reply that says so (`signIn` in `chat-error.ts`).
    - **The screens** (`apps/web/src/components/settings/models.tsx`). A Models section in the
      workspace's settings lists the deployment's own models and the providers, the seven most
      asked for first and the rest behind one line. The sign-in window draws whatever the
      sign-in is at (a choice, a page to open, a code to enter there, something to type), so a
      provider pi adds needs nothing new here; only the two ways OpenAI offers are given words
      of their own (`WAYS`). The model picker puts models under where they come from once
      there is more than one place, and a model on a subscription says so in place of a
      price (`signIn` on `ModelOption`). A reply that failed because the sign-in is gone has
      "Sign in again" and "Pick another model".
    - **Where the app differs from the mock-up:** a provider's mark is its first letter on
      grey, not in its own color; the code to enter at OpenAI has no countdown; the two ways
      of signing in to ChatGPT are chosen between first and "Choose another way" goes back,
      where the mock-up switched between them in place; a model group is named "Anthropic
      subscription", not "Claude subscription".
    - **Not built:** signing in from the Expo app, which only lists what it is given. Web
      search, the judge and dictation still run on the deployment's OpenRouter key and are
      absent without it. A sign-in that has run out is not marked in the Models section
      until an agent fails on it.
    - **pi-claude-bridge** (the owner asked whether it could be supported) cannot be loaded.
      It is an extension for the pi coding agent, which this app does not run, and it works by
      starting Claude Code as a process on the same machine with the login in `~/.claude`.
      A Worker cannot start a process, and a server shared by many people has no one `~/.claude`.
      What it buys is that use counts as Claude Code's own; signing in to Anthropic through pi,
      which is what is built, is the other way, and the owner said that was acceptable.
    - **Mine, not the owner's:** that a sign-in belongs to a workspace and not to a person or
      to one agent; who may sign out; that leaving takes a sign-in along; the three providers
      left out; the models suggested first for each provider.

29. **A desktop app that is also the daemon** (2026-10-09; `apps/desktop`,
    `apps/daemon/src/events.ts`, `packages/computers/src/shell.ts`, `paths.ts`, `kill.ts`,
    `.github/workflows/desktop.yml`). The owner asked for "an electron app that can stay
    running and the background and also work as the daemon for you agents", as "a ui around
    the app to use it from you desktop (it can just hit the main server)", on "mac, windows,
    and linux". They gave no design; the choices below are mine.
    - **The window is the deployment.** The app's main window loads the server's own pages,
      so there is no second user interface. Links that lead off the deployment open in the
      browser; signing in with GitHub and connectors' sign-ins stay in the window, since they
      come back to it. A page of the deployment is given nothing of the app: the script every
      window has (`preload.ts`) hands its few calls only to pages that are files of the app,
      and the app checks who is asking as well (`own` in `main.ts`).
    - **The app's own pages** are three files (`src/pages`): choosing the server on a first
      run, **This Computer** (whether agents can use it, the code while a pairing waits,
      read-only, opening at sign-in, what the daemon did), and one for when the server cannot
      be reached. Closing a window hides it; the tray menu, or starting the app again, brings
      it back, and Quit in the tray ends the app.
    - **The daemon is the same daemon**, not a part of the app. The app copies the bundle it
      came with into its own folder (`<app data>/daemon/bin/daemon.cjs`) and runs it as a
      process, with the app's own executable as Node (`ELECTRON_RUN_AS_NODE`). A process of
      its own is what lets it go on replacing itself from the server (item 27); built into
      the app it would be stuck at the app's version, and the server would call it old. The
      file is written again only when a newer app brings a different one (`seedDaemon`).
    - **What the daemon learned for it** (`DC_DAEMON_EMBEDDED=1`): it also prints how things
      stand as lines that start `@dc-event ` (`events.ts`), which the app folds into what it
      shows (`status.ts`); it exits when its input closes, which is how the app stops it and
      what happens if the app dies; and it takes `ELECTRON_RUN_AS_NODE`, with its own
      settings, out of the environment agents' commands inherit, putting it back only to try
      a downloaded daemon. Without that last one an Electron app an agent started would run
      as Node.
    - **Pairing without a link to copy.** When its owner says agents may use the computer,
      the app waits until the window is signed in and the account has an agent (it asks
      `/api/agents` with the window's own session) and then shows the page the daemon is
      waiting at. A new account has no agent until the page it lands on has made one, and the
      page that confirms a pairing is where the agents are chosen: shown too soon, it offers
      none. A run on a macOS machine showed that. Started at sign-in with a
      pairing left unfinished, it does not push that page forward; This Computer has a
      button for it.
    - **Its own computer.** The app's daemon keeps its credentials in the app's folder, not
      `~/.durable-computer`, so it cannot fight a daemon installed by hand for the same
      connection. A machine with both is two computers.
    - **Commands get the PATH of a terminal.** An app started from the dock has a bare PATH;
      the app asks the owner's login shell for theirs once and gives that to the daemon
      (`login-path.ts`).
    - **Windows.** The daemon had never run there. Commands go to Git for Windows' bash when
      it is installed, never to `bash` from the PATH, which is WSL's; otherwise to PowerShell,
      with the failed program's exit code put back. The server reads every path as a POSIX
      one (`resolvePosix`), so a Windows daemon shows its home as `/c/Users/ada` and reads
      such paths back (`paths.ts`). A command's tree is stopped with `taskkill /T /F`, since
      there are no process groups. A background command is not started apart from the daemon
      there: a process with no console prints nothing, in bash or PowerShell, which the first
      run on a Windows machine showed. Under Git's bash the script around a job writes which
      Windows process it is, and that one outlives the daemon; under PowerShell a job ends
      with the daemon. Agents are told what a Windows computer is like (`WINDOWS_NOTE` in
      `packages/agent/src/computers.ts`).
    - **Packing** is electron-builder's (`electron-builder.yml`): a universal `.dmg`, an NSIS
      installer and an AppImage. `DC_DESKTOP_SERVER` at build time is the deployment
      the app opens without asking; the workflow passes the repository's `DC_BASE_URL`, so
      nothing about do.computer is in a tracked file. A tag named `desktop-v` and a version makes a
      release of that version, published once the app has passed on all three systems. The
      owner asked for releases after finding there were none ("Can we add releases for these
      that would be great"); the first, `desktop-v0.1.0`, was made on 2026-10-09.
    - **Checked:** `apps/desktop/e2e/desktop.spec.ts` starts the app itself against the built
      Node server: a first run, a wrong address, signing up, the page to confirm on appearing
      by itself, an agent running a command on the machine with the window closed, that
      command not being told it is inside an Electron app, switching sharing off and on,
      quitting ending the daemon, starting again connecting without asking, and the daemon
      replacing itself with the server's newer one from inside the app. The `Desktop`
      workflow runs that on Linux, macOS and Windows, against the build and again against
      the packed app, along with `packages/computers/test/windows.test.ts`, which runs
      commands, files and background commands through the daemon's own code on each system,
      in Git's bash and in PowerShell on Windows. Here it runs under `xvfb-run -a`.
      **Not checked:** anything on a real desktop. Nobody has seen the tray, opened the
      `.dmg` or the installer, been warned about an unsigned app, or had the app start at
      sign-in. A daemon restarting under a running background command has not been tried on
      Windows, nor has the app against do.computer.
    - **Signing (2026-10-10).** The Mac's app is signed with the owner's Developer ID
      and checked by Apple, where the repository has the secrets `CSC_LINK`,
      `CSC_KEY_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`, which
      it now has. Why: an app signed by nobody is another app to macOS with every build, so
      a Mac refused Accessibility and Screen Recording to 0.3.1 while System
      Settings showed both on, granted to 0.2.0 (`tccd` logs "Failed to match existing code
      requirement"). `electron-builder.yml` is the signed app (hardened runtime,
      `assets/entitlements.mac.plist`); `electron-builder.unsigned.yml` extends it for a pack
      with no certificate, which is what `pnpm package` and a repository without the secrets
      make. The workflow puts the certificate in a keychain of its own and points the packing
      at it (`CSC_KEYCHAIN`): electron-builder 26.15.3 given `CSC_LINK` hands macOS the
      certificate's password for the keychain's, which macOS 26 refuses. Apple is asked for a
      release and for a run from the Actions tab, not for a push to main. A run from the
      Actions tab on the branch signed, was checked by Apple and passed the packed app's
      tests, the driver's among them, and that build was installed on a Mac.
      **Mine, not the owner's:** asking Apple only then; no `disable-library-validation`,
      which the unsigned app had from electron-builder's defaults; the Apple Events
      entitlement, for `osascript` in an agent's command. **Never run:** whether the two
      permissions are kept from one signed version to the next, which is the point of it; an
      agent's `osascript` under the stricter rules; a signed release from a tag.
    - **Not built:** a signature Windows would recognise, so Windows warns before opening
      it; the app updating itself; a link to the app from the web app; a way to remove the
      computer from the app's own window (it is removed under Computers, and the app notices);
      changing read-only after pairing other than by tightening it.
    - **Mine, not the owner's:** all of the above, and in particular that the window loads
      the server and is not a client of its own; that sharing the computer and opening at
      sign-in are both ticked on the first screen; that the app's daemon is a separate
      computer from a hand-installed one; PowerShell as the fallback on Windows. No mock-up
      was shown first, against the usual habit: the only new screens are the three small
      pages, and the owner was sent pictures of them as built.

30. **Chats that know about each other** (2026-10-09; `packages/agent/src/journal.ts`,
    `history.ts`, `persona.ts`). The owner noticed that "different threads can kind of lose
    context for the same agent", asked what OpenClaw and Hermes Agent do (both were cloned and
    read), and said of five recommendations "lets try all of these". Until then a chat was given
    the agent's two stores of notes and nothing else, the notes were written only when the model
    thought to, and the `history` tool walked whole transcripts and gave up after 10,000 entries.
    - **What the other chats have been about** is a section of the prompt, `recent`, in every
      chat but a sub-agent's, Slack threads included (the owner was asked, and said they should
      see it). It is read from one document, `dc.journal`: for each chat a note of where it
      stands, and a list of finished work. It shows the six most recent notes and the ten most
      recent pieces of work from the other chats, each with its chat's id, so the agent can read
      the chat with `history`. pi-durable sends a section again only when it changed, so it
      costs a request little.
    - **Finished work** is what the agent writes up with the `log` tool, which now also adds to
      the journal, and what a scheduled run reported. A schedule keeps one entry, its latest.
    - **Where a chat stands** is written by a small model (`DC_REVIEW_MODEL`; default: the one
      that reads web searches) each time the agent comes to rest in a chat, before a compaction,
      and before "Start fresh". It is given the note as it stands, what is remembered, and what
      was said since, and rewrites the note in at most 60 words. It is never waited for, and a
      failed one is made up the next time, from the same place. The same answer may add one
      lasting fact to each store of notes, where it was said by a person, in the app or in Slack, and
      not saved. It only adds: what the agent keeps is never removed or rewritten for it. What
      it costs is in the agent's usage. With no OpenRouter key on the deployment there is no
      small model, and the other chats are shown the finished work only.
    - **A side chat branches off the main chat** (`#branchChat` in `actor.ts`). It is a
      pi-durable fork at the main chat's last entry, or at the agent's last finished answer
      while it is working there, so the agent arrives with the main chat in front of it. Its
      chat record has `fork: { chatId, at }`. What it carries is not shown as its own: the
      transcript, the earlier pages and the search begin after `at`, at a `dc.branch` entry
      shown as "Continues from the main chat". With nothing answered there yet, a side chat
      starts empty. It used to start empty past 60,000 tokens of main chat too, which in a main
      chat in long use was most of the time: item 75 is what it does now.
    - **Searching** reads a table, `dc_history` in the agent's own database, holding the words of
      every message and nothing else. It is filled when a search is made, from where it left
      off in each chat, 10,000 entries at a time, so an agent's whole past is reachable and a
      first search of a long one says it is not complete yet. Matching is as it was (every
      word, else the messages with the most of the telling ones). For the agent, sub-agents'
      chats are left out and scheduled runs' matches come last; the app's own search has both.
      The tool gained `list`: the twenty most recent chats, each with its note.
    - **The notes are larger:** 6,000 characters of the agent's own and 4,000 about its people,
      up from 2,200 and 1,375. Each store is shown with how full it is.
    - **Mine, not the owner's:** every number above; that the small model writes notes after
      every answer and not every few; that it may add to the notes at all, and not from a
      conversation with another agent (from Slack it may: the owner said "assume that if it is
      in slack it is trusted"); that sub-agents and scheduled runs get no note; that a side chat always
      branches where it can, with no way to ask for an empty one but "Start fresh" in it; that
      nothing in the main chat marks that a side chat left it.
    - **Never run:** the note-writing against a real model in Slack or in a team; anything of
      this on a deployed Worker; the native app showing a branched side chat.

31. **Agents that use a screen and a browser** (2026-10-09; `packages/protocol/src/screen.ts`,
    `packages/agent/src/uses.ts`, `packages/computers/src/use.ts` and `browser/`,
    `apps/desktop/src/screen.ts`, `screen-driver.ts`, `overlay.ts`,
    `apps/web/src/components/chat/uses.tsx`). The owner asked for the daemon and the desktop
    app to have Cua (`trycua/cua`) "to control your computer", with "a little window of the
    agent controlling it" in the chat and the agent seen to "move around your computer like it
    is the mouse", and the same for a browser, pointing at their own dev-browser and at how bb
    uses it. It was drawn first (`prototypes/computer-use`), and they answered the four things
    put to them: the pointer has the agent's name; the screen is off until switched on, on the
    computer; the agent uses "your own" browser "if availible"; and the screen is the desktop
    app's first.
    - **Two tools**, `screen` and `browser`, each taking the `computer` argument the file tools
      take, and only for somebody's own computer. `screen` does one thing to a call
      (screenshot, click, double and right click, move, drag, scroll, type, key, wait) and
      answers with a picture of the screen afterwards; places are in that picture's pixels.
      `browser` runs a dev-browser script and answers with what it printed and the pictures it
      took. Each call carries a `note`, a few words for whoever watches. The calls of one round
      start together and are done one after another. A model that cannot see pictures is
      refused the screen and told so; the echo model may use it, so it can be tried. The model
      is sent only the newest four pictures of a screen or a page (`dropOldPictures`, a hook
      before every request): each costs about a page of text.
    - **On the wire** there are two new frames to the daemon, `screen` (`act`, `view`, `hold`)
      and `browser` (`run`, `view`, `hold`, `close`), both answered by `use_result`, and a new
      error code, `refused`, for what the owner has off or stopped. A daemon says `screen` and
      `browser` in its hello. One that says neither is from before, and is told to update as
      for background commands. One that says no answers for itself why not.
    - **Who is using it** is one small class for both, `UseState`: in use from the first thing
      done until 45 seconds after the last; paused by its owner, when the agent waits where it
      is, for five minutes at most; stopped by its owner, when what the agent is doing fails
      and so does what it tries for the next minute.
    - **The screen is the app's, not the daemon's.** The daemon is plain Node. One the app runs
      is told so (`DC_DAEMON_SCREEN=1`) and asks the app, a line to a call (`@dc-call`, in
      `apps/daemon/src/events.ts`), which the app answers on the daemon's input. In the app's
      main process `ScreenService` does it with Cua Driver, `@trycua/cua-driver` 0.34.1, loaded
      from `dist/driver` and, packed, from `resources/driver`, outside the one file the app is
      packed into. Cua's own cursor is switched off: the app draws the pointer. The driver's
      pictures are PNG, and are made JPEG by Electron. A daemon run by hand says it has no
      screen for agents, and `DC_DAEMON_FAKE_SCREEN=1` gives it a pretend one for tests.
    - **On the computer itself** the app draws over everything else (`overlay.ts`): the agent's
      pointer in its colour with its name, a bar saying who is using the computer and what they
      are doing, with Pause and Stop, and a glow round the screen. Esc pauses, and is taken
      only while an agent is at work and not pressing keys itself. The overlay is kept out of
      pictures of the screen on macOS and Windows. On Linux it cannot be, so there it is in
      what the agent sees and what the chat shows, and its buttons cannot be clicked: Esc and
      the chat are the ways to pause.
    - **The switches** are in the app, under This Computer: the screen (off to begin with) and a
      browser (on). They are kept in the app's settings on that computer, and changing one
      starts the daemon again so that it says so. A computer that is read-only has neither. On
      macOS the page says whether the app has been allowed Accessibility and Screen Recording,
      and leads to each. A daemon run by hand takes `--no-browser`.
    - **The browser** is the daemon's (`packages/computers/src/browser`), ported from bb's
      plugin. It fetches a pinned dev-browser the first time. It uses the owner's own Chrome
      when it finds one that lets itself be used: a `DevToolsActivePort` file in a usual
      profile folder, which Chrome 144 writes when remote debugging is allowed at
      `chrome://inspect`, or a debugging port from 9222 to 9229. Otherwise it starts a headless
      Chrome of its own, with a profile kept in the daemon's folder.
    - **Watching** is asked of the computer and never kept: `GET /api/agents/:id/use/view`
      waits up to five seconds for a picture newer than the last, and answers with nothing for
      a screen no agent is using, of which no picture is taken. The app asks a few times a
      second while the window is on screen. `POST …/use/hold` pauses. The picture each call
      ended with is kept, in the agent's own blobs under `shots/`, and served by
      `GET …/shots/:id`; that is what "What it did" shows afterwards. They are removed with the
      agent and not before.
    - **In the chat** (`uses.tsx`, `use-live-view.ts`, `chatUses` in
      `packages/protocol/src/activity.ts`) a use is the `screen` calls, or the `browser` calls,
      on one computer within one turn, whatever the agent says between them. It is one window
      where the first of them is: the picture as it is now, the agent's pointer drawn over it
      from where the computer says it is, and a line for what it is doing, with Pause, Open
      large and Stop. Stop is the chat's own. The agent's panel has the same small, under "On
      (computer) now". One question is asked of each computer for all of them, only while one
      is on screen in a tab that is looked at. A use counts as going while a step is, or the
      chat is busy and only words have followed it; the last one of a chat is also shown for
      as long as the computer says it is still in use. Afterwards it is one line, "(agent) used
      (computer)'s screen for 1m 12s · 8 steps", and "What it did" has each step's picture.
    - **Approvals** have a rule for each ("Use a computer's screen", "Use a browser on a
      computer"), and both answer to a computer's own rule.
    - **Mine, not the owner's:** every number above (45 seconds, five minutes, a minute, four
      pictures, 1280 pixels, a picture every 400 ms); that the app draws the pointer and Cua's
      own is off; that Esc pauses; that the browser kept for agents is headless; that the
      owner's Chrome is used with no switch of its own beyond the browser's, since Chrome asks
      for itself; that read-only means neither; that the kept pictures are never tidied away;
      that the mobile app shows none of this; that whoever can read an agent's chats can watch
      a screen while that agent uses it, a teammate included; that dev-browser is pinned at 1.0.0-rc.3 and
      fetched from its GitHub release, checked against hashes written in the code.
    - **Checked on GitHub's machines** (pull request #39, and a run of the `Desktop` workflow
      on the branch from the Actions tab, which is how a branch is tried on macOS): on macOS,
      Windows and Linux the app is packed with the driver beside it, on a Mac for both kinds of
      chip, the other fetched with `npm pack`; the packed Mac app is sealed; and the real
      driver loads from beside the packed app and says how large the screen is
      (`e2e/driver.spec.ts`). The overlay's window is made on all three, and the app answers a
      real daemon's call for a pretended screen.
    - **Never run:** an agent using a real screen on macOS or Windows: a click, a key, a
      picture taken there; the two macOS permissions (an unsigned app loses them with every
      build: see Signing under the desktop app);
      how the overlay looks on a real desktop, its clicks, its being kept out of pictures, and
      Esc. The screen with a real model. The owner's own Chrome through Chrome 144's switch
      (since run, and found to ask far more than twice: item 72). The browser on
      macOS. dev-browser has no Windows build, so on Windows the browser tool says so. On a
      Linux machine: the driver in Electron under Xvfb clicked, typed, scrolled and
      dragged in a real window; the browser ran for real through a built server and a real
      daemon, fetching dev-browser and a Chrome by itself.
    - **Learned the hard way:** an effect that hands React what `scrollIntoView` answered
      crashes on a newer Chrome, which answers with a promise that React then calls on the way
      out. The Chromium this was built with is older and did not show it; CI's did.

32. **A page that cannot start says so** (2026-10-09; `apps/web/src/lib/boot.ts`,
    `components/page-error.tsx`, `routes/_app.index.tsx`). The owner reported that the desktop
    app "sometimes gets stuck loading", with a picture of the frame of placeholders and nothing
    in it. It was not reproduced (see section 7). What was found is that the frame had three
    things to wait for, none with an end:
    - **The app's own address no longer waits for the list of agents.** The desktop app starts
      there every time. `GET /api/agents` asks every agent's object what it is and answers
      when the slowest has: 0.6 to 1.5 s on do.computer against 0.15 to 0.25 s for
      `/api/me`. The agent that was open last is now gone to without the list. One that turns
      out to be gone is forgotten by its page, which sends the visitor back to the address,
      where the list is then asked for.
    - **Who is signed in, and the list of agents, are waited for fifteen seconds**
      (`patience` in `lib/client.ts`), then asked once more, as any failed query is. After
      that the page says "This could not be loaded" with Try again, which loads it afresh.
      That is the router's `defaultErrorComponent` now, in place of the framework's own, so a
      page whose code is no longer on the server, as after a deploy, says the same.
    - **Scripts that do not arrive** (`BOOT_GUARD_SCRIPT`, in the head before anything else):
      the page loads itself again after 0.3, 3 and 10 seconds, counted in `sessionStorage`
      and forgotten once the app has started, and after that puts up a button that says it
      did not load. Only scripts under `/assets/` count.
    - **Mine, not the owner's:** all of it, the numbers included. The desktop app itself is
      unchanged, since its window shows the deployment's pages; no release was needed.
    - **Not done:** the list of agents still waits for every agent. One that never answers
      leaves the sidebar's rows as placeholders for fifteen seconds and then failed.

33. **Creatures that went blank** (2026-10-09; `apps/web/src/components/agent-avatar.tsx`,
    `packages/mascot/src/orb-core.js`). The owner asked whether "the 3d renders disappear"
    because of too many WebGL contexts. It is not that: every creature on a page is drawn by
    one context (`Stage`), and each has a 2D canvas that takes a copy. Two things did blank
    them, and both are reproduced by a test in `e2e/agents.spec.ts`:
    - **A still picture was held before it was drawn.** A still (the one above the chat, in
      menus and lists, in the wardrobe) is let move for 350 ms and then paused. The loop that
      moves it draws nothing in a window that is not showing or of a canvas off the screen,
      so a page opened behind another, or in the desktop app's closed window, held a blank
      for good. It is now drawn as it is paused.
    - **A context the browser took away wiped every creature**, each frame, by copying from
      it. The copy is now left out while the context is lost, so the last picture stays. A
      context that has not come back in three seconds is let go of and another asked for, at
      most every three seconds.
    - **Not done:** the context is still let go of whenever the last creature leaves the page
      and made again for the next, which is a new context for most moves between pages. That
      costs time, not pictures.
    - **What the Mac had recorded** (read the next day): macOS restarted the
      GPU five times on 2026-10-09 with the app's GPU process named as the cause
      (`/Library/Logs/DiagnosticReports/gpuEvent-Do Computer Help-*.ips`, "MMU interrupt"),
      each within a minute of the app starting, and Chrome's on other days. Each restart
      takes the context away, which is the second of the two. Why the GPU faults is not
      known: it is macOS 27.0.1 with Electron 44, and one fault came 0.3 s after "Metal
      Compiling Shader" in the GPU process.

34. **Who is signed in is never waited for for good** (2026-10-10;
    `apps/web/src/server/auth-guard.ts`, `server/auth.ts`). This is what the stuck frame of
    item 32 was, found the day after by asking do.computer with curl: on about a quarter of
    new connections every request that checks who is signed in (`/api/me`, `/api/agents`,
    `/api/settings`, with no cookie at all) never answered, while `/api/health` and
    `/api/auth-methods` on the same connection answered at once. In `wrangler tail` each
    showed as `canceled` with 0 ms of CPU and the wall time the client waited. A connection
    stays with one isolate, so an app on a bad one stayed stuck however often it was started.
    - **The cause** is in Better Auth (1.7.7, `@better-auth/core/dist/async_hooks`): it keeps
      the promise of `import("node:async_hooks")` for the life of the process and waits on it
      in every call until its three stores are made. On Workers that promise is never settled
      if the request that was running when it started goes away first. The same is described
      at zenn.dev/coji/articles/cloudflare-workers-better-auth-hanging-promise, which names
      better-auth issue 10315. The app's own `getAuth` kept a promise the same way until
      2026-10-08 (pull request #25); this one is the library's.
    - **That was not the promise, or not the only one.** After it was deployed the same
      check still found isolates that did not answer, and the log said the second try, of a
      new instance, did. So the promise is kept on the instance: Better Auth compares the
      tables with what it expects when an instance is first used, once, and every
      `auth.api` call waits for that one comparison (`createSchemaCheck` in
      `@better-auth/core/dist/db/schema-check.mjs`, awaited in
      `better-auth/dist/api/to-auth-endpoints.mjs`). A page abandons one of its requests a
      quarter of a second after it loads, and when that is the request the comparison was
      started in, it is never finished. It is switched off
      (`advanced.database.validateSchema: false`, `NO_SHARED_SCHEMA_CHECK`): the tables are
      brought up to date before an instance is made. Two tests say that the library still
      keeps one promise by default, and that the app's instance has none.
    - **The stores are made as the module loads** (`seedAuthStores`), from an import nothing
      waits for, on Better Auth's shared object (`Symbol.for("better-auth:global")`). A test
      makes a real call and fails if the library has a store that was not made for it, which
      is what an upgrade that adds one would do.
    - **`getUser` waits five seconds**, then lets go of the instance and asks a new one, and
      after five more fails the request. It logs `[auth] no answer…` each time, which is what
      to look for in the live logs if the frame is ever stuck again.
    - **Not reproduced on this machine**: `wrangler dev` starts the Worker before any request
      and passes on no cancellation. The only proof is the live site: ask `/api/health` and
      then `/api/me` over one connection, a dozen times, each with a few seconds' limit.
      Before any of this 12 of 42 connections did not answer; with the stores and the
      second try, 5 of 50 took five seconds; with the comparison switched off, 70 of 70
      answered at once, 40 of them after 200 requests had been abandoned 5 to 300 ms in,
      and the live log had no `[auth]` line.
    - **Mine, not the owner's:** the five seconds and the second try.

35. **Clients that catch up after a lost stream** (2026-10-10; `packages/client/src/index.ts`,
    `apps/web/src/lib/collections.ts`, `packages/agent/src/actor.ts`). The owner: "when I have
    multiple clients connected to the same do computer chat they can get out of sync. For
    example when requesting a secret form and submitting on one it will stay open on the
    others", and asked for a fix that is not only for that form.
    - **With both clients connected it already worked**, for every document of an agent: the
      agent's event stream says which changed and the page asks for it again. Two browsers
      on one chat show a secrets form and an approval closing on the other
      (`e2e/two-clients.spec.ts`).
    - **A client whose stream had been down missed whatever changed meanwhile**, and nothing
      asked again until the page was loaded again. The stream's first event on every
      connection is `ready`; the page now asks again for all it has of the agent when it hears
      one (`catchUpAgent`), the first time too: a page that opens as something changes has
      asked too soon to see it and too late to be told, which a test on a slow machine
      showed. What is still on its way is let arrive first. The mobile app does the same on a
      reconnect.
    - **A stream that had died without ending was never noticed.** The server sends a
      heartbeat every 15 seconds; a stream that says nothing for 45 is now given up and asked
      for again, one that was never answered included. That last is what an isolate stuck as
      in item 34 does to a client, which is the likeliest way the owner's clients fell out
      of step, though that is a guess.
    - **One list** (`TOLD` in the actor) says which documents are made up front and told of,
      and a `what` a client has no name for makes it ask for everything of the agent.
    - **Still not told to other clients:** an agent's usage total; anything of the workspace
      or the account (agents made or deleted, members, model sign-ins, settings), for which
      there is no stream.
    - **Mine, not the owner's:** the 45 seconds; asking for everything again on a reconnect
      in place of the server replaying what was missed.
    - **Never run:** on Workers, in the desktop app, on a phone; the watch on silence against
      a connection that really died (only with a clock the test moves).

36. **A route that waits for the list of agents asks again when the request is cancelled**
    (2026-10-10; `listedAgents` in `apps/web/src/lib/collections.ts`). The run on main after
    pull request #44 failed in `teams.spec.ts`, "a team is started from the workspace menu":
    the team's page said "This could not be loaded: CancelledError". The route waits for the
    list before it shows anything, the sidebar shows the same list, and a request that is
    let go of while it is on its way is given up for everyone waiting on it. It is asked for
    again, up to five times. Both routes that wait for the list do this (the app's own
    address and a team's).
    - **Not reproduced here**, with every core busy; GitHub's machines have two. What let go
      of the request was not found. The page's own words in the failed run's artifact are
      what this rests on, and a test that cancels the request the same way.
    - **Two runs on main failed in a row** after thirty-five that had not, both in a browser
      test that waits five seconds: the one before in a test of two clients (item 35's gap).
      A failed run skips the deploy. `gh run rerun <id> --failed` runs the failed job again.

37. **Creatures come back after the graphics card's process dies** (2026-10-10;
    `packages/mascot/src/orb-core.js`, `apps/web/src/components/agent-avatar.tsx`,
    `apps/desktop/src/main.ts`). The owner asked for the GPU restarts on their Mac (item 33)
    to be fixed. What makes the card fault was not found. What the app does about it was
    found wanting twice over, on that Mac, by killing the GPU process of a second copy of the
    installed app (its own folder, `--remote-debugging-port`, a test server on another
    machine, driven from here with Playwright over CDP):
    - **After one death, every creature stayed blank for good**, item 33's change
      notwithstanding. The browser gives the WebGL context back within a second, and every
      2D canvas too, wiped. three (r128) then makes every draw call and draws nothing. So a
      renderer of the stage's own that has lost its context once is let go of and another
      made, and a creature held still is drawn again once its canvas is back (`owed`). On
      the Mac: blank for good before, drawn again within 1.5 s after.
    - **After two deaths in a few seconds, Chromium refuses WebGL to the page** for as long
      as the app runs. Chrome puts up a bar that offers to load the page again; Electron puts
      up nothing. The app now calls `app.disableDomainBlockingFor3DAPIs()`. On the Mac, with
      the same thing as a switch (`--disable-domain-blocking-for-3d-apis`): refused for good
      before, drawn again within 1.5 s after. Where it is still refused, as in an app that
      has not been updated, the still picture stands in after a second or so.
    - **What was tried to find the fault, and did not:** the creature's own page with freshly
      compiled shaders, every state and every reaction (five runs in Chrome 154, four in the
      app's Electron 44); all hundred things to wear; the box opened five times over; the
      real pages from signing up through chatting, a treat, the box, the wardrobe and typing
      (twice). Once in those, as the box's window opened, the GPU process died twice in two
      seconds with no report from macOS. The same steps again did not do it.
    - **Checked here:** a browser test kills the browser's GPU process and fails without the
      change (`e2e/agents.spec.ts`). A desktop test kills the app's twice and fails without
      the app's call (`apps/desktop/e2e/graphics.spec.ts`). It starts an app of its own that
      draws 3D in software, since the other tests' app is started with no GPU at all and so
      has no 3D to lose, on GitHub's Mac included.
    - **The desktop app has to be released again** for its half: `desktop-v0.3.0`.

38. **The browser an agent uses is in a window, unless its workspace says otherwise**
    (2026-10-10; `packages/computers/src/browser`, `apps/web/src/server/teams.ts`,
    `components/settings/computers.tsx`). The owner: "Would it be possible to start the
    browsers that do computer controls on your computer headed so you can see them", and
    while it was being built, "the browser being visible be default should be a toggle on and
    off in your workspace settings".
    - **The choice is the workspace's**, on until someone there switches it off: Workspace
      settings, Computers, "Show the browser agents use". It is kept in a table of its own
      (`dc_workspace_settings`, since a personal workspace has no row with the teams), read
      and changed at `/api/workspaces/:id/settings`, by a team's admins and by the owner of a
      personal workspace. A member sees it and cannot change it.
    - **It travels with each use of the browser**: the agent asks its host what its workspace
      has chosen (`showsBrowser`, from `browser-directory.ts`, on both servers) and sends
      `shown` on the daemon's `browser` frame. So nothing is kept anywhere that can go stale,
      a change holds from the next use, an older daemon ignores it, and the desktop app
      needed no release.
    - **On the computer** the browser kept for agents is started without `--headless` when
      asked to be shown, and is closed and started again, with its profile, when it is
      asked for the other way than it is running. With no display (Linux with neither
      `DISPLAY` nor `WAYLAND_DISPLAY`) it stays out of sight and the log says so once. If it
      cannot open a window it is started without one. The owner's own Chrome, where that is
      what is used, is as it was.
    - **Mine, not the owner's:** everything but those two sentences of theirs. No switch in
      the desktop app, which I had begun and took out when they named workspace settings; no
      flag for a daemon run by hand; that a member sees the switch disabled.
    - **Never run:** a browser with a window on macOS or Windows, where nothing has been
      seen of it: whether it comes to the front, where it opens, and on Windows whether the
      window shows at all (the program that starts it was told to hide windows, and is now
      told not to for this one). Under Xvfb on Linux it was started both ways and asked
      which it was. Two workspaces that have chosen differently and share one computer
      have the browser start again at each change of hands.
39. **A first run that is a scene** (2026-10-10; `prototypes/onboarding` is the mock-up;
    `packages/mascot/src/sky.js`, `apps/web/src/components/welcome`, `apps/web/src/routes/welcome.tsx`,
    `apps/web/src/server/desktop-handoff.ts`, `apps/desktop/src/page-bridge.ts`,
    `apps/desktop/src/browser-sign-in.ts`). The owner asked for "a really nice onboarding when
    you first open the desktop app": the egg of the first agent comes down from the sky, the
    agent walks its owner through setup as it hatches, and it ends in the chat with it "rather
    than taking you to the settings screen". After the mock-up: "We should also have a
    variation of this on web", and "we support sign in with github. Can we make oauth in the
    desktop app happen in a pop up or the user's browser that redirects".
    - **The scene is a page of the deployment's, `/welcome`**, for a browser and the desktop app
      alike. It is drawn over the page (`WelcomeHost` in the root), so it is still there as the
      chat comes up under it and the creature is seen going to its place. The sky and the
      island are `sky.js` in the mascot package; the egg is the mascot's own, laid over it.
      Where WebGL is not to be had the same card is shown over a plain night. With less
      motion there is no fall and no waiting on the words.
    - **Until the creature has landed it is in the scene only.** The chat comes up under the
      scene a few tenths of a second before the creature leaves the island, and the chat's
      own large picture of it was showing for that long: it was seen in two places at once
      (the owner, of a recording: "you see pip in the left and right at the same time as he
      starts to animate over"). The chat's large pictures are now kept out of sight from
      before the page changes until the flight is over (`unseen` in `scene.tsx`), and the
      scene is taken down in the same step as they are shown again. A browser test looks for
      them after every frame for as long as the scene is there.
    - **The egg is not shown until it is known where it starts.** It can be drawn before the
      server has said whether anyone is signed in, and for as long as that answer took it
      stood small in an empty night, before the sky had come up and before it was put at the
      top to fall (the owner: "the egg flashes in the first frame before it appears"). One
      frame on this machine; longer over a real network. `placed` in `scene.tsx` keeps it
      out of sight until it has been sent to fall, or set down. `welcome-scene.spec.ts` holds
      the server's answer back and looks; it is the one first-run file that draws the scene
      (`creature: true`), the others run with WebGL off.
    - **A card comes back closed.** What a card asks for opens under its words once they are
      said. It was one element for every step, so it was still open on the last answer when
      the card came back: the card faded in as tall as the next form, with that form showing
      through, shut as the words began, and opened again when they were said (the owner:
      "some snapping when animating between the forms"). It is now a new element for each
      step (`key={view.step}`), which starts shut. The test counts closing transitions:
      there are none. It is in `welcome.spec.ts`, where the scene is not drawn: beside the
      drawn scene it failed on main the first time it ran there, because a build machine
      that draws the sky in software wrote the egg's words too slowly for the test's wait,
      and a failed run on main is a deploy that does not happen.
    - **What it asks**, each answer a crack in the shell: who they are (an account, or signing
      in, with the providers the deployment has), a name and a color for the agent, and, in
      the desktop app on its first run, whether it may work on this computer. Then it
      hatches. The agent is made as it is named, with the seed its egg was drawn from.
    - **Who is sent there:** someone with no agent (`_app.index.tsx` no longer makes one),
      and "Create an account" on the sign-in page.
      Someone who has an agent is sent on, in the desktop app too since item 84: before it,
      in a desktop app that had not been through its first run, their own agent came out of
      the egg and asked about the computer.
    - **Every account is made there** (2026-10-11; the owner: "anytime you sign up for an
      account you get the welcome setup screen ... instead of the sign up so you get
      onboarded"). `/signup` was still the plain form: whoever opened it made the account
      there and met the egg only afterwards, and someone who signed up from an invitation
      went back to it, joined, and never met an agent of their own. `/signup` now leads to
      `/welcome` and carries `next`. A scene that was sent by a page (`sentFrom` in
      `lib/welcome.ts`) ends at that page and not in the chat: "On to your invitation". An
      invitation opened by someone signed in who has no agent sends them to the scene first,
      which is how an account made by a provider on the sign-in page gets there too. The one
      plain form left is `/signup?next=/desktop/sign-in…`, in the browser the desktop app sent
      its owner to: the app's own window is showing the scene. The mobile app has its own
      form and no scene. `signUp` in the browser tests makes the account over the API.
      Not chosen by the owner: that someone invited meets an agent of their own before they
      join, and that the scene then ends at the invitation.
    - **In its chat it says hello first**: the empty chat of an agent just met says who it is
      and offers a few things to start with, by what it was given (`meetingWith`, kept for
      the window's life; item 64). These are the app's words, not a model's, and are gone once the chat has
      a message. An agent named by its owner, and with no personality yet, is still told that
      this is its first conversation (`bootstrapNamed` in `persona.ts`, `namedByOwner`).
    - **The desktop app** opens `/welcome` until the first run is over (`welcomed` in its
      settings; an app that already had a server counts as through it). An app built for a
      deployment that answers skips its own form. The form now asks only for the server.
    - **The page is given a little by the app** (`window.doComputer`, only to the top page of
      the main window on the deployment's origin): to sign in through the browser, to share
      this computer, and to say the first run is over. Sharing can be asked for by a page only
      during the first run; afterwards it is the app's own window's to do, as before. The
      page confirms the pairing itself with the code it is handed.
    - **Signing in through the browser:** the app listens on a port of this computer and opens
      the browser on `/desktop/sign-in`; whoever is signed in there (or signs in, with GitHub
      at once if that was asked for) agrees, and the page sends a one-minute, single-use
      token to that port. The app's window exchanges it for a session of its own
      (`POST /api/auth/desktop/token` and `/desktop/session`, a small Better Auth plugin). The
      sign-in form in the app does the same for its provider buttons.
    - **Mine, not the owner's:** naming and coloring in the scene, where the agent used to
      name itself in conversation; the browser and not a pop-up; no click to agree when the
      tab itself has just come back from the provider; the hello and its three starters; the
      scene for someone who signs in again on a new computer; that a page may share the
      computer during the first run without a second question from the app.
    - **Run on a Mac once:** the packed build from this branch, on a MacBook Air and
      its own graphics card, through a whole first run against a server on another machine.
    - **On a phone** (2026-10-10, the owner asked whether it works there and then for what was
      found to be fixed): the card stops 5rem short of the top and scrolls inside itself, so a
      phone held sideways, or a page a keyboard has shrunk, keeps the egg in view and every
      field in reach; the creature over the hello in the chat is sized to the height of the
      screen (`100dvh - 31rem`, between 8rem and 18rem), where it used to be cut off above on
      a screen under about 780px tall; the color swatches take a touch 5px outside themselves;
      the plain egg stands in the room above the card. Tried in Chromium with touch at
      375×667, 393×659, 360×740, 320×568, 375×548 and 740×360. Never on a phone or in
      Safari: a keyboard that lies over the page and does not shrink it is not handled.
    - **Never run:** a real GitHub or Google sign-in through any of this; the token exchange
      on Workers (`adapter.consumeOne` against D1); Windows outside CI.

40. **The app's icons are one of its creatures** (2026-10-10; `scripts/icons.mjs`,
    `apps/web/public`, `apps/desktop/assets`, `apps/desktop/src/mark.ts`). The owner asked for
    the logo, "default favicon and app icon from scratch", and said "Maybe use one of our
    rendered mascots". It had been a flat teal oval with a smile.
    - **Which creature:** the one the seed `Do` grows, in the teal the old logo had
      (`#3b9d9d`): a drop with a ball floating over its head. `scripts/icons.mjs` draws it in
      a Chromium with the app's own drawing code and writes every picture, so they are drawn
      again by running it, and change with the creature.
    - **The app's icon** is the creature on a dark teal square whose glow is dithered as the
      creature's shading is: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` and
      `apple-touch-icon.png` for a phone, `icon.png` for the desktop app, and `icon-mac.png`,
      the same in a square of 824 inside 1024, which is how a Mac's own icons are drawn
      (`electron-builder.yml` names it for the Mac).
    - **The tab's icon and the mark** are the creature alone, without its ball: `favicon.svg`
      is its 32 pixels as shapes, and the same file is the mark on the desktop app's own pages
      (`assets/mark.svg`, an `<img>`, for which their rule about what they may load now
      names images) and in the page a browser is shown after signing in (`src/mark.ts`).
      `favicon.ico` is new, for whatever asks for that address without reading the page.
    - **The tray** is the creature alone; while this computer is not shared it is grey and
      asleep. `badge.png` is its shape in white with its eyes as holes.
    - **Mine, not the owner's:** which creature; that it speaks in the large pictures and
      listens in the small ones, where an open mouth is a hole; the square and its glow; no
      ball below 48 pixels; the sleeping tray; the room around the Mac's icon.
    - **Never seen:** any of it on a phone's home screen, in a Mac's Dock or menu bar, or in a
      Windows taskbar. The pictures were looked at in Chromium, and the two pages in the
      built app on Linux.

41. **What the creatures cost a computer, and the GPU process that died** (2026-10-10;
    `packages/mascot/src/orb-core.js`, `apps/web/e2e/agents.spec.ts`). The owner asked for a
    profile of the client, that it "doesn't melt your cpu or gpu", and while it was under way:
    "I'm also still getting the gpu crashes and it is mainly in the desktop app". Measured on
    a MacBook Air (Chrome 154 and the installed app, its own graphics card, over
    CDP) and in headless Chromium here.
    - **What was fine:** a chat of eighty long messages. Typing in it, scrolling it and an
      answer streaming into it each took 6 to 14% of one core's main thread. Nothing was
      changed there.
    - **What was not: the page at rest.** With nothing happening, a page with the sidebar open
      (ten creatures) took about 21% of a core in the page and 44% in the GPU process, for as
      long as it was showing. Almost all of it was the creatures' loop: they were drawn one
      at a time, each copied out of the graphics card by itself, and spread over every frame
      the screen showed, so the page was drawn again sixty times a second. The loop counted
      frames, so on a 120 Hz screen it would have drawn everything twice as often.
    - **Now** the creatures are drawn on beats: thirty a second by the clock, whatever the
      screen's rate, every other one for those in the sidebar (fifteen a second; it was
      twenty). All that are due are drawn side by side into one picture and each takes its
      square of it, so there is one copy out of the card per beat. Each starts on a whole
      tile of the dither (`TILE`, four pixels): the dither is laid over the whole picture, and
      a creature's place in it changes with which others are due, so without that its dither
      shifted from beat to beat and flickered, the box's most of all. The same page, measured
      in the same sitting, three runs of each: about 15% and 21%. Script time on the page
      went from about 7% to 4%. Where there is no graphics card and the creatures are
      drawn in software, as in headless Chromium here, the same page kept more than four
      cores busy and now keeps two and a half; one creature alone is still a whole core.
    - **Why the GPU process died.** The app's own log, from a second copy started with
      `--enable-logging=stderr`: `[Device] is lost` from Skia's Dawn device, then "Restarting
      GPU process due to unrecoverable error. Context was lost." After three of those within
      a few seconds Chromium starts the GPU process with `--use-gl=disabled`, and the app is
      drawn in software until it is started again: the owner's own copy was found that way,
      its GPU process replaced three times in five seconds, 1 min 45 s after it started.
      What sets it off is the WebGL context being thrown away while canvases still hold what
      they copied from it. That happened whenever the last creature left the page: at the
      start, where the tab's icon draws a creature and lets it go before the others exist,
      and on every move from one agent to another with the sidebar shut. Moving between two
      agents that way killed the GPU process in 2 of 6 starts of the old code, each time
      within fourteen moves, and in none of 20 starts of the new.
    - **Now** what a creature was drawn with is kept for ten seconds after it goes
      (`Stage.retire`): its shaders, and with them the context. The creatures of the next
      page find both. The picture they are drawn into starts with room for a page's worth and
      only grows. A test counts the contexts a page asks for while it moves between agents.
    - **Mine, not the owner's:** fifteen pictures a second in the sidebar where it was
      twenty; ten seconds.
    - **Tried and left out:** sleeping through the frames between beats with a timer (no
      cheaper, and beats came late); a layer of its own for each creature's canvas (no
      cheaper).
    - **Left as it was:** the box that hops while it waits to be opened, and its twinkle, are
      CSS animations that run for good and cost about 4% of a core in the page and 3% in the
      GPU process while a box is waiting. A page that is not showing draws nothing, as before.
    - **Not known:** whether this is every way the GPU process dies. macOS recorded GPU
      restarts of its own on 2026-10-09 (item 33), and none while these were reproduced. (It
      did record them: see item 45, which found the cause.)

42. **What a thousand people would cost or break on Cloudflare** (2026-10-10;
    `apps/web/src/server/rate-limit.ts`, `packages/protocol/src/bytes.ts`,
    `packages/client/src/attention.ts`). The owner: "I want to roll this out for public launch
    with 1000 users what are scaling issues on cloudflare that i should be aware of? Can you
    fix any of those".
    - **A hidden tab lets go of what it follows** a minute after it is hidden, and takes it up
      again when it shows (`attention` in the client's options). It also no longer counts as
      someone watching a chat, so an answer that arrives meanwhile is notified.
    - **Signing in, signing up and asking to pair a computer are counted by address** with
      Cloudflare's rate limiting binding (`PUBLIC_LIMIT` in `wrangler.jsonc`): twenty a
      minute, then 429. Better Auth's own limiter counts in one isolate's memory. The places
      for computers waiting to be paired went from 200 to 2,000, so that one address cannot
      take them all.
    - **The binding does not count exactly.** Cloudflare says it is "permissive, eventually
      consistent"; locally the 21st is refused every time. A limit that holds exactly is a
      rate limiting rule on the zone, or a count kept in an object.
    - **An upload is held in memory once** where it was held three times in the Worker and
      twice in the library's object: `readLimited` is told the declared length.
    - **Reconnects wait a random part longer**, so the clients a deploy cuts off do not all
      come back in the same instant.
    - **Not done, and the owner's to decide:** what the Daytona account allows with a machine
      for each workspace; that every deploy cuts off everyone.
    - **Mine, not the owner's:** the minute, the twenty a minute, the 2,000.

43. **Agents are followed over sockets that hibernate** (2026-10-10;
    `packages/protocol/src/socket.ts`, `packages/agent/src/followers.ts`,
    `packages/client/src/follow.ts`, `apps/web/src/server/agent-socket.ts`). The owner, after
    item 42: "do a move for us to hibernating web sockets".
    - **Why.** An event stream keeps the agent's Durable Object in memory for as long as it is
      open, and memory is paid for by the second: about $4 a month for one object kept all
      month, and a page held two streams, the second of which kept the library's object too.
      A WebSocket the runtime holds does not: an idle object is put away with its sockets
      still connected.
    - **One socket for each agent a page follows** (`/api/agents/<id>/socket`), carrying what
      the agent's event stream said and every chat the page asks for (`follow`, `unfollow`),
      and one to the library of its workspace (`/api/agents/<id>/library/socket`), which says
      its revision. The gateway checks them as it checks presence. `client.agent(id).watch`
      and `watchChat` are as they were; the web app turns sockets on (`sockets: true`).
    - **What a socket follows is kept with the socket** (`ActorSocket.note`, a Durable
      Object's attachment), because the agent comes back with nothing in memory. Opening the
      agent attaches its sockets again, and each is told where things stand: `resumed`, with a
      fingerprint (`digest`) of every document and of every chat it follows. A client that
      holds something else asks again. Nothing changes while an agent is put away, so a
      client that heard everything holds what is there and nothing is sent twice; the
      fingerprints are for the agent that died without being put away.
    - **pi-durable kept every agent in memory for ten minutes after each answer.** It keeps a
      quiet chat's context by a timer, and means to keep none where timers cannot be
      unreferenced. With `nodejs_compat` a timer has an `unref`, which does nothing, so the
      timer was kept and a pending timer keeps a Durable Object from being put away. On
      Cloudflare the agent is now made with `contextRetentionMs: 0`. Since pi-durable 1.2.0
      a document that nothing watches is kept in memory the same way, by the same kind of
      timer, so the agent is made with `documentRetentionMs: 0` there too; the test below
      fails without it.
    - **Checked in the Workers runtime:** a test follows a chat over a socket, leaves the
      object alone for fourteen seconds, and asserts that it came back with `resumed` and
      sent the next answer as changes (`agent.workers.test.ts`); it fails if anything keeps
      the object in memory. In a browser against `DC_TARGET=cloudflare vite dev`: no event
      stream was asked for, the object was put away within fifteen seconds of the page going
      quiet, and reading the agent then took 34 ms against 20 ms from memory.
    - **Where there is no socket, the streams.** A socket that cannot be had while the server
      answers plainly is tried twice and then everything is followed by stream, for the
      life of the page. That is what `pnpm dev` on Node does, whose dev server now refuses
      the app's sockets at once where it used to leave them unanswered. The streams are
      still served, and are what the mobile app uses and what `scripts/smoke.sh` reads.
    - **`NodeActorNamespace.evict`** unloads an actor under its sockets, for testing what a
      Durable Object does when it hibernates.
    - **Not done:** the mobile app still follows by stream (its sockets would have to carry
      the session by hand, and it has never been run on a phone); a socket has no way to slow
      an agent that sends faster than a client reads.
    - **Not known:** what any of this costs on Cloudflare itself. Nothing here was run on a
      deployed Worker.
    - **Mine, not the owner's:** the fingerprints in place of sending everything again; the
      fall back to streams; sixteen chats to a socket; leaving the mobile app as it is.
44. **Agents work in one window, behind what the owner has in front** (2026-10-10;
    `packages/protocol/src/screen.ts`, `packages/agent/src/uses.ts`,
    `apps/desktop/src/screen.ts`, `screen-driver.ts`, `overlay.ts`). The owner asked whether
    Cua has "a mode that lets the agent control your computer without taking over your mouse
    and keyboard like codex computer use", and then for the app to be rewritten to use it. It
    has: Cua Driver sends what is done in a window to that window's program alone, and until
    now the app asked for everything on the whole screen, which is the one target the driver
    can only do with the real pointer.
    - **The `screen` tool** has two more actions and two more arguments. `windows` lists the
      windows there are (id, app, title, size, and whether it is showing); `open` starts an app
      by name without bringing it forward. With `window` set to an id, every other action is
      done in that window alone, the picture that comes back is of that window whether or not
      it can be seen, and places are in that picture. `in_front: true` has the window brought
      forward for the one action. Without `window` everything is as it was: the whole screen,
      with the computer's own mouse and keyboard. The agent is told to work in a window where
      it can.
    - **On the wire** the three new things are actions of their own (`windows`, `open`,
      `in_window`, which carries the window and what to do in it), not arguments to the old
      ones. An app from before does nothing with an action it does not know and answers with
      a picture of the screen; had `window` been one more argument to `click`, it would have
      clicked that place on the whole screen. The server knows an old app by its answer, which
      has no `window` or `windows` in it, and tells the agent so. The answer's picture is now
      optional (`windows` has none), and it can carry a `note`.
    - **In the app** `ScreenService` finds the window by its id each time, takes a picture of
      it before acting (the driver takes a place to be in the picture it last took, and a
      picture taken for someone watching is taken apart from those), moves the places where
      the window has changed size since the agent saw it, and answers with a picture taken
      afterwards. A window that is gone afterwards (the agent closed it) answers with the
      windows there are. Someone watching is shown the window the agent last worked in, with
      its name where "The screen" was.
    - **What the driver refuses** behind what is in front is told to the agent with what to ask
      for: on a Mac a drag, and keys to a program with more than one window. Where it sent a
      click or keys to the program without being able to tell whether they were taken, the
      answer says so. Nothing is ever brought forward without the agent asking.
    - **On the computer itself** the bar says "(agent) is working in the background", there is
      no glow round the screen, and Esc is left to its owner, who is at their own work. The
      agent's pointer is drawn only where the window is the one to be seen at that place.
      With the whole screen, or a window brought forward, all of that is as before.
    - **Two things found on a Mac that were broken before this.** The driver ends
      the name everything is asked under after five minutes without hearing it, and refuses
      everything under it from then on: an agent that came back to a screen later was refused
      until the app was started again. The app now starts the name again and asks once more
      (`sessionEnded`). And a program made of web pages (Electron, Chrome) tells the system
      what is in its window only once it has been asked, so the first click there pressed
      nothing: the first picture an agent is given of a program's window now asks.
    - **Checked on a MacBook Air** (macOS 27, a signed build of the branch run as a
      second copy against a server on another machine, while the Mac was in use): through the whole chain, chat to driver, an agent listed the windows, opened
      Calculator behind what was in front and worked a sum in it, with the pointer where it
      was and the app in front unchanged; typed, pressed keys and scrolled in a TextEdit
      window that was covered by others; filled in a form in an Electron window behind
      Calculator; was refused a drag and did it with `in_front`; closed a window. Sonnet 5.5
      was given "use the Calculator app to work out 127 × 49" with "do not take over my mouse
      or keyboard" and did it in a window, unprompted, in about half a minute. It is the first
      time an agent used a real screen on a Mac at all.
    - **Not run:** Windows and Linux, where the driver can do much less behind what is in
      front (on X11 little more than a left click; on Hyprland nothing), so that there an
      agent will mostly be told to ask for `in_front` or use the whole screen. Nobody has
      looked at the bar and the pointer by eye while an agent worked in a window. A window on
      another desktop, a minimized one, a second display. Chrome and Safari themselves.
    - **Mine, not the owner's:** that the whole screen stays as a way to work, for what is in
      no window; that bringing a window forward is the agent's to ask for and is never done
      for it; that the app's own windows are left out of the list; that the picture is of the
      window and nothing is read from the system's outline of it; no glow and no Esc while
      working behind; that a first picture wakes the program.
    - **Learned the hard way:** a signed Mac app with one file changed inside it is not run by
      macOS at all ("is damaged and can't be opened", a dialog on the screen), so new
      code cannot be tried in a copy of the installed app any more. What works: start the
      installed app a second time with `--inspect=9230` and its own data folder, bundle the
      code to try as one CommonJS file, and `require` it into that process over the
      inspector, where the driver has the app's permissions; and for the whole chain, a
      signed build of the branch from the Actions tab (`gh workflow run desktop.yml --ref
<branch>`), run as a second copy from a folder of its own.

45. **The creatures' own shader was what reset the Mac's graphics card** (2026-10-10;
    `packages/mascot/src/orb-core.js`). The owner: "I'm still getting gpu crashes on my mac. Is
    there anything out of the ordinary we are doing in this codebase that could cause it", and
    then "I think it happens without screen use". It was the body's vertex shader, and it is
    changed. Found on a MacBook Air (M2, macOS 27.0.1) with a copy of the installed
    app (Electron 44.7, Chromium 152) showing test pages, over CDP.
    - **What a fault is.** macOS's log (`eventMessage CONTAINS "Caused GPU"`) names a process
      whose work on the card hung or read a place that was not there, and the card is
      restarted under everyone. It named WindowServer and Apple's own programs far more often
      than the app. The app is the one that shows it: it is nearly always drawing, so it is
      caught by every restart, and after three Chromium draws without the card (item 41). The
      `gpuEvent-*.ips` files stopped being written on 2026-10-09 and are not the record.
    - **What sets one off** is another program starting to draw while creatures are being
      drawn: an app opening, the lock screen, the screen-use overlay. Opening Font Book did it
      nearly every time. Counted as faults in the log over twelve openings (six where marked):
      nothing of ours running, 0 in 21 openings of three apps; the app on a blank page, 0 in
      21; a plain WebGL canvas, 0 (6); the same scene copied into eleven 2D canvases as the
      creatures are, 0 (6); 2D canvases alone, 0 (6); eleven creatures, 7, 5 (6) and 11.
    - **Which part.** Creatures without their bodies, 0 (6). Bodies with a plain fragment
      shader and their own vertex shader, 9 (6); the other way about, 0 (6). In the vertex
      shader, with the noise taken out, 0; with the shape worked out once for a vertex and
      not three times, 0, and 0 with forty-one creatures. One creature alone, 0. It is not
      load: the page that faults uses a tenth of the card, and one that uses a fifth does
      not. It is not numbers that are no numbers: a page that sends vertices to infinity or
      to NaN on purpose faults nothing. Why this shader does it is not known; it is the
      driver's to answer.
    - **Now** the noise is taken once for a vertex, with its slope (`snoise` gives both), and
      the two neighbours the normal is found from are given the noise the slope says they
      have. Eight takings of the noise in the shader became four. The old file against the
      new, twelve openings each: 11 faults and 0. Forty-one creatures with the new, over
      twenty-one openings of three apps: 0.
    - **The look** is the same to the eye. Drawn side by side from the same moments on that
      Mac, seven creatures in three states: those shaded flat are the same in every pixel,
      and those shaded smooth differ in about one pixel in a hundred, dots of dither along
      the edges of their shading.
    - **Item 41 is wrong in one place:** macOS did record faults while the GPU process was
      made to die there by going back and forth (22:37:57 and 22:41:59 that evening, the
      app's GPU process named). Throwing the context away is one more way of setting off the
      same fault, and keeping it for ten seconds made that rarer.
    - **Not done:** the screen-use overlay and the pictures taken for someone watching
      (every 400 ms, a `screencapture` each) were suspected first and are not the cause; they
      are as they were. Nothing was reported to Apple or to Chromium.
    - **Checked here:** the browser tests of the creatures pass with it (`e2e/agents.spec.ts`,
      drawn in software). There is no test of the fault itself: it needs that Mac. How it was
      counted: a copy of the app with `--remote-debugging-port`, a page of creatures, Font
      Book opened with `open -a` and stopped with `pkill -x` twelve times, seven seconds
      apart, then the log.
    - **Not known:** whether other Macs or other versions of macOS do this; whether a
      creature wearing things, or the box, can still set it off (neither uses the noise);
      whether the owner's own app is quiet now, which it can only be once this is deployed,
      since the app draws what do.computer serves.
46. **A deployment names the models it offers, can be signed in to any provider, and the first
    run asks what to think with** (2026-10-10; `packages/agent/src/models.ts`,
    `model-access.ts`, `actor.ts`, `apps/web/src/server/models.ts`, `model-access.ts`,
    `apps/web/src/components/settings/models.tsx`, `components/welcome/thinking.tsx`). The
    owner asked that "any of the authentication methods can be ... set as ... the default
    server one", for "a server level" list in the config of "the only … models you're allowed
    to pick" (for do.computer: OpenRouter with Muse Spark 1.3 Contributor, Claude Haiku 5.5
    and GPT-6 Luna), with people still free to "bring their own keys, their own logins" and
    "pick anything they want", and for the first run to show the built-in models, "login with
    ChatGPT or with Claude", and "a little … more section for all the other" providers.
    - **`DC_MODELS`** is the list. Each name is a model's whole id or its OpenRouter id. The
      deployment offers those, in that order, and new agents start on the first unless
      `DC_DEFAULT_MODEL` names another of them. Nothing is checked against a catalog when the
      server starts: a name that matches nothing offers nothing, and a deployment left with
      nothing real offers the echo.
    - **It is kept at the call, not only in the picker.** `createAgentModels` makes two sets
      of models and puts one `Models` in front of them (`routed`): a model the deployment
      names is called with the workspace's own sign-in, then the deployment's sign-in, then
      its key; any other model is called with the workspace's sign-in or not at all. So an
      agent that was set to another model before, or a workspace that signs out of its own
      OpenRouter key, cannot spend the deployment's key on a model it does not name. Without
      `DC_MODELS` there is one set and nothing is routed.
    - **The server signed in** is the same actor a workspace has (`createModelAccessActor`),
      under the name `deployment`, which no workspace has. The gateway's rule for a workspace
      (`inWorkspace` in `server/model-access.ts`) lets someone named in `DC_ADMIN_EMAILS` in
      under that name and nobody else, and where sign-up is open the address must be one a
      social sign-in vouches for. So the routes, the client and the settings screen are the
      ones there were: **Server models** in workspace settings is the Models section with
      other words. An agent reads the deployment's credentials after its workspace's
      (`credentialChain`), and asks which providers the deployment has at most twice a minute
      (`cachedSignIns`), since that one actor is every agent's.
    - **What a deployment offers is now asked each time** (`AgentModels.offered`,
      `deploymentModels()` on the server, `deploymentModels` in the agent's options), since
      someone can sign the server in while it runs. Its models are offered as its own, with
      no word of who signed in.
    - **A model both have is the workspace's** (`offeredModels`): a workspace signed in to a
      provider runs that provider's models on its own account, the ones the deployment offers
      too, and the picker now lists them under the workspace's sign-in. Before, such a model
      was listed as the deployment's and still called with the workspace's credential.
    - **An agent on a model the deployment stopped offering moves** to the one new agents
      start on (`#keepRunnable`, looked at when the agent is first used and about once a
      minute after). Only where the deployment still has the model's provider: an agent whose
      workspace signed out of a provider nobody else has still says so in the chat, with the
      ways back, as before.
    - **The first run** has one more card, after the name: "What should I think with?". It
      is a few choices and not a list of models (since 2026-10-12, when the owner asked for
      "Included" with its model "under it small with the ability to change it as like a muted
      link", then ChatGPT, Claude, and "other providers at the bottom"): **Included**, with
      the model the deployment starts agents on small under it and "Change", a menu of the
      deployment's models (the suggested few where there are hundreds); **ChatGPT** and
      **Claude**, each a row that opens its sign-in; and "Other providers" under them for
      every provider and key (the settings' own list and sign-in window). What was signed in
      to becomes a choice in that provider's row, or a row of its own after them, under its
      own name, with its first model chosen and its own "Change", and the card sets the agent
      to what is chosen. The choices are `sources` in `apps/web/src/lib/welcome-models.ts`,
      with its test beside it. The titles, the lines under ChatGPT and Claude, and the menu
      were the builder's, not the owner's. Someone
      who already has an agent is not asked.
    - **The small models the server uses itself** (search, notes, judging, dictation) are
      still OpenRouter's on `OPENROUTER_API_KEY`, are not narrowed by `DC_MODELS`, and are
      not there on a deployment that is only signed in to something else.
    - **Checked here:** unit tests of the list, the routing, the move, and the server's
      sign-in and who may change it; browser tests of Server models and of the new card
      (`models.spec.ts`, `welcome.spec.ts`); by eye, the card with the three models, with a
      key added, and at phone width.
    - **Not run:** a real key or subscription, as the server's or in the first run; the
      Workers runtime; the desktop app's first run with the new card beyond its own test.
    - **Mine, not the owner's:** that the server's sign-ins are changed by people named in
      `DC_ADMIN_EMAILS`, from workspace settings; that only `OPENROUTER_API_KEY` is read from
      the environment and every other key is typed in there; the name `DC_MODELS` and that it
      takes OpenRouter ids; that a workspace's own sign-in wins for a model both have; the
      move to the default model; where the card is in the first run, its words, and that it
      lists a few models and not all; that the first run's choice is for that agent and does
      not become the person's default for new ones.

47. **On Cloudflare the built-in shell is Cloudflare Computer's** (2026-10-10;
    `packages/sandbox/src/worker-shell`, `apps/web/src/server/sandbox.cloudflare.ts`). The
    owner, of https://github.com/cloudflare/computer: "would it be possible to make this with
    the just bash backend one of the built in computer options? We can configure this to be the
    default on cloudflare runs. since it would be very cheap", and then "roll it out and
    replace our just bash version please".
    - **What it is.** The kind is still `just-bash`. On Cloudflare `cloudflareProviders` now
      answers for it: `workerShellSandbox` talks over Workers RPC to a `ShellObject`, one
      Durable Object per shell, named after the machine's key (the agent's id). The object
      holds a `Workspace` from `@cloudflare/computer` over its own SQLite storage, with the
      `WorkerShellBackend`: each command runs in just-bash in a Dynamic Worker (`LOADER`),
      which reaches the files through `WorkspaceServiceProxy` and nothing else of the server.
      Its requests leave through `ShellGateway`, which is `guardedFetch` as before, so the
      rule about private addresses is the same. On Node nothing changed: the shell inside the
      server, with `DurableFs`.
    - **Why an object of its own and not the agent's storage:** so that the shell could be a
      workspace's machine with no files to move.
    - **It is a workspace's machine there** (the same day, after the owner sent a picture of
      Add a computer offering only Daytona: "also this still shows daytona"). What is one
      agent's alone now depends on where the server runs: `unsharedKinds(target)` in
      `sandbox.ts` is `just-bash` on Node and nothing on Cloudflare, and a kind says so to the
      app as `perAgent`. So on Cloudflare a workspace is given one shell, open to its agents,
      each in a folder under `/workspace`; one can be added, opened, closed and removed like
      any machine. A shell from the few hours before, which was one agent's, is a row with
      that agent's id as its key and stays that agent's until someone opens it. Only a shell
      whose key is the asking agent's id has old files moved into it. Daytona is still
      offered beside it: taking a kind off offer cuts off the machines of that kind.
    - **Files from before.** `movedFromDatabase` copies what `dc_fs` holds in the agent's
      database into the object the first time the shell is used, then renames the tables to
      `dc_fs_moved` and `dc_fs_chunks_moved`. Nothing drops them. Modification times are not
      kept.
    - **What the package cannot do, found by trying.** `yq`, `sqlite3`, `python3` and `js-exec`
      do not run in a Worker, so they are not offered; `jq`, `xan`, `file`,
      `html-to-markdown`, `rg`, `gzip` and `tar` are. A command is answered only when it is
      over, so nothing is streamed. `killExec` does nothing (the shell's Worker keeps the
      running commands in an object that each call gets a new one of), so `abort` stops
      waiting and the command runs on until its time is out: ten minutes at most
      (`MAX_RUN_MS`, a number of mine). The object's log fills with "uncaught exception"
      lines for files that `rg` looks for and does not find; they are the package's.
      Appending to a file with `>>` sets its mode back to 644, which the shell inside the
      server did not do; writing it anew does in both.
    - **The `experimental` flag** the package's README asks for was not needed, in
      Cloudflare's Vitest plugin or in `vite dev`.
    - **Tested:** `packages/sandbox/test/workers` runs both conformance suites, the network
      rules, deletion and the move inside the Workers runtime; `scripts/smoke.sh` passes
      against `vite dev` on Cloudflare with it. The move was also made for real: an agent
      wrote a file, a link to it and a mode with the commit before this one, the same
      `.wrangler` state was started with this one, and the agent read all three back.
    - **Not known:** what it costs with real use; how it behaves with files of hundreds of
      megabytes; `git`, which the package has (isomorphic-git) and which was not turned on.

48. **A landing page** (2026-10-10; `apps/web/src/components/landing`,
    `apps/web/src/routes/index.tsx`, `prototypes/landing`). The owner: "Can you design a nice
    landing page for the site at do.computer that features our little guys! ... Ideally this
    can we an env variable that you can flip on (it should be on for our deployment). Also if
    open access isn't availible we should disable sign up and have coming soon with a small
    link for if you have access already". Four looks were drawn; they chose the character
    select, asked for it to say "your open source personal assistant" and not "little guy",
    for pictures of the app, eight to choose from, and a pixel face that is easier to read.
    - **`DC_LANDING=1`** makes `/` the landing page for whoever is not signed in. Without it
      `/` leads to the sign-in form, as it always did: someone hosting it for themselves has
      no use for a page that sells it. The workflow passes the variable through, and the
      deploy script writes it into the build.
    - **`/` is a route of its own**, no longer one of the pages behind sign-in. A visitor
      with no session cookie is a stranger: the server draws the page and sends it whole, so
      it is there before any script. For anyone with a session cookie, and for the desktop
      app, the server sends the app's frame and the browser decides, as before: someone
      signed in goes to their agent, and a session that has ended finds the landing page.
    - **Whether a stranger may sign up** is `open` in what `/api/auth-methods` answers: true
      where `DC_SIGNUP=open`, and where nobody has an account yet, since the first to arrive
      is the deployment's owner. While it is false the page has no way to make an account:
      "Coming soon", and "Already have access? Sign in". The sign-in form then drops "Create
      an account", unless a page sent the visitor there to come back to it, as an invitation
      does. `/welcome`, and `/signup` which leads to it, are still there for whoever knows
      them: the server refuses an account to anyone not invited, as it did.
    - **The page** was first a console's character select, at night, in a pixel face. On
      2026-10-11 the owner found it had "too many agent blobs" under the select, pointed at
      x.ai/bot and chatgpt.com/features/dots, asked for "a more professional version of this
      site in the style of the references", and chose it from a mock-up
      (`prototypes/landing-pro`): "i love it ... then build for real". What they kept from the
      old one, in their words: "that rotating choose your character selection if you can switch
      between the personas but it doesn't need to be a character select screen", and, of chips
      of words tried in its place, "don't like the pill treatment liked the grid of guys more".
    - **What it is now**: a light page in plain type, the same by day and by night. At the top,
      the headline and the way in beside a panel: one creature large, which is each of eight in
      turn (seven jobs and an egg) with what it was asked and what it is doing, and the eight
      small under it in two rows of four; choosing one, or a mouse over one, stops the turning,
      and the panel takes a tint of whoever is on it. Then the app in a window whose tabs change
      the picture (a phone where the window would be too small); what it does, as small pictures
      of the product drawn in HTML and played through their steps by a timer, three beside
      their words on panels of color and two side by side; where it is, with Slack's own mark;
      open source with the three lines that run it; the app's own box opening; questions; and
      the way in again. Ten creatures: nine at the top, one under a hat. They are `AgentAvatar`,
      as everywhere else, so where they cannot be drawn their still pictures stand in. Its
      styles are one file under `.lp`, which is also what scrolls. The pixel face
      (`@fontsource/jersey-25`) is gone from the app. "Download for Mac" leads to the
      repository's latest release.
    - **The page calls an agent a Dood** (2026-10-11). The owner, asked for another headline
      than "Your open source personal assistant.": "I'm thinking of calling the agents Doods is
      there anything with that for the headline", and to "Meet your Dood.", "Do it!". The name
      is in the headline, the copy under it, the questions (the first is "What is a Dood?") and
      the page's description. It was on this page only until item 70, which took it to the
      whole app.
    - **The pictures of the app** in `apps/web/public/landing` are real: taken from the built
      server with a real model (`prototypes/landing/README.md` says how), and are the light
      ones. They will go out of date as the app changes.
    - **Not done:** the repository is private, so the page's GitHub links lead nowhere until
      it is made public; nothing collects the addresses of people who want to be told when it
      opens; the page has no picture for a link's preview; and it has not been seen in Safari.

49. **The app's picture is a creature on its island, and in the desktop app its owner's own**
    (2026-10-10; `packages/mascot/src/portrait.js`, `scripts/icons.mjs`,
    `apps/web/src/lib/app-icon.ts`, `apps/desktop/src/page-bridge.ts` and `main.ts`). The
    owner asked for an icon that "screams windows 98 .exe logo", turned down three rounds
    that added a treatment to the creature (beige furniture, a spooky game, a glossy one),
    and settled it with "can it just be a render of a character on a background", "on the
    spawning island background", "do teal mochi sunrise for default. before you've made one
    show the egg. then build the dynamic one now!". The mock-ups are in `prototypes/app-icon`.
    - **The picture** is the island of the first run (`sky.js`) with a creature standing on
      it at rest, each drawn by its own code, one pixel of each to one pixel of the picture,
      and nothing done to either. `portrait.js` draws it: the scene is drawn 2.1 times as
      tall as the picture, so that there is sky over the creature, and the picture is the
      square of it with the ground four fifths of the way down. The creature's own shadow
      is left out and one is put on the grass.
    - **The app's own icons** (item 40) are now this picture of the teal mochi, seed
      `agt_ct5dka`, at sunrise, in place of the drop on a dark square: the phone's four, the
      desktop app's two. A phone's are drawn from further back, since it cuts their corners
      off. The tray, the tab and the mark are that creature alone.
    - **In the desktop app the picture follows its owner's agent.** `useAppIcon` is given the
      agent whose pages are open; `app-icon.ts` draws the same picture of it, in what it has
      on, and hands it to the app as a PNG's address through `setIcon` on the page bridge.
      The app shows it with `app.dock.setIcon` on a Mac and on its main window elsewhere.
      Until an agent hatches it is its egg; on `/welcome`, before there is an agent, it is
      the egg of the app's own creature; on the sign-in pages it is the usual picture again.
      Other pages leave it as it was.
    - **It lasts as long as the app runs.** Quit, and in Finder, Launchpad and Spotlight, the
      app has the picture it was built with. Its file is signed and is not changed.
    - **What the app accepts:** only from the top page of its main window while that is on
      the deployment, as with the rest of the bridge; only a PNG's address under two
      million characters, of a square of 64 to 1024 pixels. Anything else is left unanswered.
    - **The island is drawn once for a page**, when the page is idle, with a graphics context
      of its own that is given back at once (`WEBGL_lose_context`). Where it cannot be drawn
      the app keeps the picture it has. An app older than this has no `setIcon` and is not
      asked.
    - **Mine, not the owner's:** that it is the agent whose chat is open (as the tab's icon
      is); that an agent still in its egg is shown as its egg; the usual picture when signed
      out; that Windows and Linux get it too, on the window; the tray staying the app's own
      creature.
    - **Tested:** `apps/web/e2e/app-icon.spec.ts`, where the app is stood in for by what it
      gives a page, and `apps/desktop/test/page-bridge.test.ts`.
50. **Visuals in a chat, and pages of the library shared as websites** (2026-10-11;
    `packages/protocol/src/visual.ts` and `sites.ts`, `packages/agent/src/visuals.ts` and
    `sites.ts`, `apps/web/src/server/sites.ts` and `site-directory.ts`,
    `apps/web/src/components/chat/visual.tsx` and `site-card.tsx`,
    `apps/web/src/components/sites`). The owner asked for agents to be able to "create inline
    visualizations (look at t3 code for how they can render code in the chat)" and "to be able
    to share websites like claude artifacts. They are scoped so only people in the workspace
    can see them for now and you can set to make them public". `prototypes/visuals-and-sites`
    is the mock-up, which the owner was shown and had not answered when this was built.
    - **A visual** is what T3 Code calls an HTML render, done the way it does it. The agent has
      a `visual` tool that takes a title and one self-contained HTML page. The page is kept in
      the library as `visuals/<title>.html`, and the chat shows it in a frame where the tool
      call is: no border, on the chat's own background, as wide as the answer. It needs no
      computer. The tool's result tells the agent that the person sees the page and not to
      describe it.
    - **What is put in the page** (`prepareVisual`), at the start of its head: the app's colors
      as CSS variables, light and dark, and a short script. The script takes the theme from
      the address's fragment and drops the fragment, takes later changes by message, says how
      tall the page is whenever that changes, and has links to other sites opened by whoever
      shows the page. The messages are the MCP Apps ones (`ui/notifications/size-changed`,
      `ui/open-link`, `ui/notifications/host-context-changed`), as in T3 Code. A page shown
      by itself, in the library or as a site, has margins and a measure; in a chat it has
      neither. The frame is the library's `/d/<agent>/<key>/...` address (item 13), so it is
      sandboxed the same way and its script runs as nobody.
    - **A site** is a page of the library, or a folder with an `index.html` (and since item 51,
      anything in it), given an address:
      `/s/<id>`, sixteen random characters. It is a row in `dc_sites` in the app database, by
      workspace. It shows what is in the library there as it is now; nothing is copied. A
      page named by itself is shared alone, and nothing beside it is served; naming a
      folder's `index.html` shares the folder.
    - **Who may open one** is decided once, for the address itself: anyone if the site is
      public, otherwise someone signed in who is in its workspace. Someone signed out is
      shown a page that says so and sends them to sign in and back. The address answers
      with nothing but a frame the size of the window. What the frame loads is
      `/s/<id>/~<key>/<path>`, served by the workspace's library from the site's page or
      folder (`LibraryStore.site`), with `Content-Security-Policy: sandbox` and no
      `allow-same-origin`. A site's page is sent nobody's session, which is why its files
      need the key: it is signed with a secret of the site's own, is the same for six hours
      and works for up to twelve. Making a public site the workspace's again changes the
      secret, so the keys already given out stop working at once.
    - **The agent shares with a `share` tool**: `publish`, `public`, `private`, `stop`, `list`.
      Publishing is allowed without asking. `public` is an ability of its own that asks a
      person first (item 20's approvals), like adding a connector.
    - **In the app:** a site the agent shared is a card in the chat, with its address, who can
      open it now, Copy link, Open, and a menu to choose who can open it or stop. A visual
      has two buttons when pointed at: open beside the chat, and share. A page open in the
      library or beside a chat has a Share button, and the library's front page lists what
      is shared. In a personal workspace "the workspace" reads "Only you".
    - **Elsewhere:** the phone app shows a visual as a file to open and a site as a link.
      Slack is sent a visual as the file.
    - **Mine, not the owner's:** that a visual is a file in the library and not something
      kept with the chat; that a site follows the library and is not a copy; that the agent
      must ask before making one public, and can share with the workspace unasked; that any
      member of a workspace can change or stop any of its sites; the frame around a site
      with no bar of the app's on it; `noindex` on every site; 512 KB as the most a visual
      can be and 200 sites to a workspace.
    - **Tested:** `packages/protocol/test/visual.test.ts`, `packages/agent/test/sharing.test.ts`,
      `apps/web/src/server/sites.test.ts`, and in a browser `apps/web/e2e/visuals.spec.ts` and
      `sites.spec.ts`, which check that a site's script cannot read cookies, that its requests
      to the app go without the session, and that nothing outside the shared folder is served.
51. **Anything in the library can be shared** (2026-10-11; `apps/web/src/server/site-pages.tsx`,
    `LibraryStore.site`, `siteRoot` in `packages/protocol/src/sites.ts`). Item 50 shared only
    pages. The owner asked "Is there a reason people can't share anything from their library?
    That might unify things a bit", and there was none.
    - **What is shared** is a file of any kind, alone, or a folder, with or without an
      `index.html`. Naming a folder's `index.html` still shares the folder. The whole library
      is never one site.
    - **What its address shows** is decided where the file is asked for. A page is the page.
      For someone going to anything else (`Sec-Fetch-Dest` of `document` or `iframe`), the
      gateway makes a page of it in the app's colors: Markdown is rendered to read, text is
      shown as text, a picture, a film or a sound is shown by itself, a folder with no front
      page is a list of what is in it, and what cannot be shown, or is text over 1 MB, is its
      name with a Download button. For a page that loads a file, as its picture, its
      stylesheet or its data, the file is what it gets, and so it is for a browser that does
      not say what it is asking for. `?download` hands the file over under its own name.
    - **A site's page can read the files beside it.** A sandboxed page's origin is nobody's,
      so to it the files beside it are another site's: it can show a picture of one but not
      `fetch` it, load a module or use a font. A site's files now say
      `Access-Control-Allow-Origin: *`: they are all shared with whoever has the page, and no
      session goes with the request. A page in the library's own viewer (item 13) still
      cannot, since the address it is viewed at opens the whole library. So a page that reads
      a file beside it works as a site and not in the viewer.
    - **In the app** every file in the library has the Share button, not only a page; a file's
      card in a chat has one; a folder is shared from its row in the tree, and a shared file
      or folder carries a lock or a globe there. The words are "Shared with a link" where
      they were "Shared as a website".
    - **A document shared by itself brings its pictures.** A file shared alone serves nothing
      beside it, so at first a Markdown document's own pictures did not load, and the owner
      asked for them. The page made of the document asks for each picture beside it by its
      place in the library (`?picture=notes/chart.svg` on the document's own address), and
      the library serves it if the document refers to it and it is a picture
      (`markdownFiles` in `packages/protocol/src/library-links.ts`, read from the document
      as it is now). Nothing else rides along: not a picture the document does not name, and
      not a file it only links to. In a shared folder a picture is at its own address, as
      any file is.
    - **Mine, not the owner's:** how each kind is shown; that a PDF is a download, as it is in
      the library; 1 MB as the most text that is shown, and as the largest document read for
      its pictures; that a document's links to other files beside it lead nowhere when it is
      shared alone.
    - **Tested:** `apps/web/src/server/site-pages.test.ts`, and the last two tests of
      `apps/web/e2e/sites.spec.ts`. `scripts/smoke.sh` shares a document.
52. **The desktop app keeps itself up to date** (2026-10-11; `apps/desktop/src/update.ts`,
    `main.ts`, `electron-builder.yml`, `.github/workflows/desktop.yml`). The owner asked: "Can
    you support updating in all of the desktop apps now that it is a public repo?" Until then
    a newer app was installed by hand over the old one. They gave no design; the choices
    below are mine.
    - **A release reads the repository's newest release.** electron-updater does the work.
      A tag's run packs the app knowing one address, `<repository>/releases/latest/download`
      (flags to electron-builder in `Pack it`; nothing is in a tracked file, and a fork's
      releases read the fork's), and packing leaves a `latest*.yml` beside each system's
      file, which says the version, the file and its checksum. Those, and a `.zip` of the
      Mac's app, are published with the release. The app asks for its system's `.yml` when it
      starts and every four hours (`UPDATE_EVERY_MS`), and fetches what it names when that is
      newer. The repository had to be public for this: a private one's files need a token.
    - **Only a release does.** A copy packed by hand, or by a run that was not for a tag, has
      no `app-update.yml` beside it and looks nowhere (`notUpdating`); it would otherwise be
      replaced by the newest release within minutes of being tried. `DC_DESKTOP_UPDATES`
      names another address for one run, or none: the tests use both.
    - **When it becomes the newer one** (`restartToUpdate`, `mayRestart`): when it is quit;
      when its owner chooses **Restart to Update** in the tray menu or under This Computer,
      which shows the version and how far along it is; or by itself, once no window of it is
      showing, no agent is using the screen and the daemon has said nothing for five minutes
      (`QUIET_MS`). The app runs for weeks on machines nobody sits at, which is where it was
      being installed by hand. Restarted by itself it opens no window when it comes back
      (`restarted` in its settings). A command an agent left running for longer than five
      silent minutes is cut off by that restart, as it is by the daemon's own after fifteen.
    - **Each system's way.** macOS: Squirrel takes the `.zip`, and only from whoever signed
      the app it has, so an unsigned build cannot update. Windows: the newer NSIS installer
      is run unseen; it is unsigned, and what vouches for it is the release's checksum over
      HTTPS. Linux: the AppImage file is replaced by one named for the newer version, the
      file that opens the app at sign-in is pointed at it, and the app starts it itself, from
      a shell that waits for the old one to go, with what the old one was started with:
      electron-updater starts it with nothing, and Electron's own relaunch runs from the
      AppImage's mount, which is gone by then. That shell closes what it was handed open, or
      the old AppImage stays mounted for as long as the newer app runs.
    - **The AppImage starts itself with the newer runtime** (`toolsets.appimage` 1.0.3). The
      older one needs libfuse2, which the owner's Linux machine does not have: the app ran
      there unpacked, and an unpacked copy cannot replace itself. The newer one mounted there.
    - **Checked here, on Linux, with real AppImages:** a 0.9.0 started hidden against a feed
      with 0.9.1 fetched it, replaced its file, rewrote the sign-in entry and was running as
      0.9.1 with the same arguments a minute and a half later, the old mount gone; one with
      its window showing fetched 0.9.2 and stayed as it was until it was quit, when the file
      was replaced and nothing was left running; that 0.9.2, packed with the newer runtime,
      then started. `apps/desktop/e2e/update.spec.ts` gives the app a feed of its own: on
      every system it finds, fetches and offers the newer version, and on Linux restarting
      puts the file in place and starts it. `test/update.test.ts` has the rules.
      **Not checked:** an update on macOS or Windows from one real version to the next. What
      is fetched in the test is no app, so there the test ends at the offer (on a Mac, at
      macOS refusing it). The first release with this in it cannot be updated _to_ by the
      apps before it, which have to be installed by hand once more; the release after that is
      the first real trial on all three.

53. **Apps: people's own accounts on other services, through Composio** (2026-10-11;
    `packages/agent/src/connectors.ts`, `apps/web/src/components/settings/connectors.tsx`).
    The owner asked what a "1-click composio integration to connect all of your accounts for
    agent access" would be like, said "Composio handles gmail right which is a huge one", and
    then "please go forth and add the composio integration". In the same conversation they
    asked for the default model to be Claude Haiku 5.5 (`DEFAULT_OPENROUTER_MODEL`). That is
    what a deployment with only an OpenRouter key starts new agents on. One that names its
    models and no default still starts on the first it names, so do.computer is unchanged
    until `DC_DEFAULT_MODEL` is set for it.
    - **What it is.** Apps is an ordinary connector whose address is Composio's own MCP server,
      `https://connect.composio.dev/mcp` (`APPS_URL`). That server has people sign in with a
      Composio account of their own and lets an app register itself, so the sign-in is the one
      every connector has and the deployment holds no key. A connector at that
      address has `kind: "apps"`, whether it was added by the button or typed in by hand.
    - **Adding it** is `POST /connectors` with `{ "apps": true }`, which the Connect apps button
      sends and which fills in the name and the address, or the agent's `connectors` tool with
      `add_apps`, which asks leave like any change to connectors and puts a Sign in button
      beside the chat. There is one: asked for again, it is the one there is, tried again.
    - **Permissions.** When it is added, before anyone has signed in, its rule is set to Ask
      first (`appsAdded`). Three of Composio's tools are let through (`APPS_LOOKUPS`): the
      search, the schemas, and the one that makes a sign-in link for a service. Everything
      else it offers is asked about, by name or not.
    - **What any connector's call may bring back** is now cut at 60,000 characters, with a
      line saying so. A mailbox came back whole otherwise.
    - **`DC_APPS_URL`** moves Apps for the browser tests, as `DC_SLACK_API_URL` moves Slack.
    - **A first version was built and thrown away the same day.** It used a Composio project
      key held by the deployment (`COMPOSIO_API_KEY`), with accounts kept per workspace and
      listed in the app. The owner asked "I thought composio lets people oauth themselves",
      which it does, and then for the key to go: "add the per person button and replace the
      key mode if possible". What that version showed about Composio's REST API is not needed
      by anything here.
    - **Mine, not the owner's:** Ask first to begin with, and which tools are let through; the
      name Apps; that a hand-typed Composio address counts as Apps; the cut at 60,000
      characters; no mock-up was made first.
    - **Not done, or not known:** nobody has signed in to Composio through this, so which
      tools its server offers a signed-in person is taken from the keyed version (search,
      schemas, connections, run) and from Composio's documents. If their names differ, Apps
      still works and simply asks about all of them. Composio's sandbox tools cannot be
      switched off this way. A sign-in is per agent: a second agent signs in again. The
      agent's chat is not told when someone finishes signing in to a service, only to Composio.
    - **Tested:** `packages/agent/test/apps.test.ts` and `apps/web/e2e/connectors.spec.ts`,
      against a stand-in. By hand, on the Node server with no setting at all: Connect apps led
      to Composio's sign-in page, and the connector was left waiting with its rule on Ask
      first. Nothing was run on Workers.

54. **The app database is read less** (2026-10-11; `apps/daemon/src/pairing.ts`, `main.ts`,
    `apps/web/src/server/auth.ts`). The owner asked what is in D1, what its limits are with
    thousands of users, and whether to move to Postgres. The answer was to stay: it holds only
    who exists and who owns what, a few rows a person, read by key; chats, memory and the
    library are in each agent's and workspace's own storage. One database answers one query at
    a time, so what matters is how often it is asked. They then asked for the two things that
    asked most to be fixed. The numbers below are mine.
    - **A daemon waiting to be paired asks less often.** It asked every three seconds for as
      long as nobody confirmed its code, which an app left installed and never signed in to
      does for good: on do.computer that was four in five of a day's reads. It now asks every
      three seconds for its first five minutes and every thirty seconds after (`pollDelay`),
      about a tenth as often over a day. The price: a code confirmed more than five minutes
      after the daemon started is collected within thirty seconds, not three.
      `DC_DAEMON_POLL_MS` still sets the first pace, for tests.
    - **Who is signed in is kept in a cookie for five minutes** (Better Auth's `cookieCache`,
      `SESSION_CACHE_SECONDS`). Every signed-in request read the session and then its user. A
      request that brings the cookie is answered from it, and one whose cookie has run out
      reads the database and is given a new one, by the app's own routes as well as Better
      Auth's. The price: a session ended from elsewhere, or a changed name, is believed on
      other devices for up to five minutes. Signing out clears it on the device that did.
    - **Not done:** a daemon in an installed desktop app is replaced only by a newer app, so
      apps already installed and unpaired ask as before until a release. The mobile app keeps
      its own cookies and is not given the new one by the app's routes, so its requests read
      the database as before. Read replicas or smart placement, for people far from the
      database, were described to the owner and not built.
    - **Tested:** `apps/daemon/test/pairing.test.ts`. By hand on the Node server and on the
      Workers runtime: signed up, deleted the session's row, and a request with the cookie was
      still answered as signed in while one without it was refused; a request with no cookie
      of the kind was given one by `/api/me`; signing out cleared both.

55. **Doods in a post, and a waiting list** (2026-10-11; `apps/web/src/server/doods.ts`,
    `apps/web/src/server/waitlist.ts`, `apps/web/src/components/dood`,
    `packages/protocol/src/dood.ts`, `prototypes/dood-embed`). The owner linked a game that is
    played inside a post on X and asked "Can we make it so you can hatch a Dood and share it
    on twitter embedded?", with a button to sign up and claim it. To the mock-up: "I love
    this!", treats given to a claimed one should "actually get presents", "a loot box present
    with 3 choices in the flow", and "randomly reroll your guy if you don't like him". Then,
    for claiming while the deployment is shut: "a new release mode called waitlist where the
    admin and people they invite can use the app but everyone else is waitlisted".
    - **How a page gets into a post.** X's player card: the page's head says `twitter:card`
      `player`, its own address as `twitter:player`, 480 by 480, and a picture. X shows the
      picture and, played, the page in a frame. The game the owner linked does exactly this.
      X stopped playing such cards for some hours on 2026-10-08 and started again; whether it
      plays one from this deployment's address is only found out by posting one.
    - **A Dood** is a row of `dc_doods`: a name, a color, a seed, at most one thing on, and
      the hash of a key its hatcher's browser keeps (`localStorage`, `dc-dood`). `/hatch` and
      `/dood/<id>` are one component (`DoodCard`) over the first run's `Stage`. Making,
      stroking and feeding one need no account and are counted by address (`rate-limit.ts`;
      strokes apart from the rest, since they are told every four seconds). The three things
      in a present follow from the seed (`dealPresent`), so the server can tell that what was
      kept was in the box without keeping anything.
    - **Claiming** is `/welcome?dood=<id>&key=<key>`: the first run with the Dood out already,
      asking only who they are. Signed in, `POST /api/doods/:id/claim` makes it theirs and
      `POST /api/doods/:id/agent` makes it their agent (`wakeDood`: an agent in their own
      workspace, named and looking the same, with what it wore and the treats it was given
      while it waited). A treat for one that is an agent goes to the actor's `/gifts`, which
      only the gateway can call; the row keeps how far along the next present is, so that a
      page anyone can open never wakes an agent to be drawn. A change of the agent's name,
      look or outfit is copied to the row (`followAgent`, from the agents' proxy route).
    - **The waiting list** is `DC_SIGNUP=waitlist`. `getUser` answers nobody for someone who
      is waiting, which is what shuts the whole app, sockets included; `getSignedIn` is for
      the few things they may do (`/api/me`, their Dood, accepting an invitation). What is
      written down is who was let in (`dc_admitted`), never who waits, so that a failed write
      leaves someone out. Let in without a row: accounts from before the list began (its
      start is kept in `dc_meta` as the sign-in is first set up), the first account, the
      addresses the settings name where they are vouched for, and anyone in a team or asked
      into one by address. With any sign-up but `invite`, an address the settings name counts
      only if it is verified, or the account is from before, or it is the first
      (`vouchedFor`). Someone waiting is sent to `/welcome` from every page of the app, where
      their Dood is; with none yet, the scene hatches one for them and not an agent.
    - **Mine, not the owner's:** two taps to crack the egg; that the reroll keeps the name and
      color and comes after the hatch; the three choices being a common, an uncommon and a
      rare or epic thing; four treats a present (the app's own number); one treat a day from
      an address; that an unclaimed Dood only counts its treats; that a Dood's picture in a
      post is a stock one of its color; no list of refused words; that a waiting person who
      signs up from the landing page gets no present to choose from (their agent has the
      app's own first box); that being invited to a team lets someone in; the email on being
      let in; every line of copy.
    - **Not done:** nothing limits how many unclaimed Doods there can be beyond the rate
      limit, and none is ever removed. The mobile and desktop apps know nothing of the list:
      someone waiting who signs in to either is refused everywhere with a 403 the apps show
      as an error. The list shows the 200 who have waited longest and has no search.
    - **Tested:** `packages/protocol/test/dood.test.ts`, `packages/agent/test/creature.test.ts`
      (gifts), `apps/web/src/server/waitlist.test.ts`, `apps/web/e2e/dood.spec.ts` and
      `apps/web/e2e/waitlist.spec.ts`. By hand on the Node server, with the creature drawn:
      the whole path from the egg at 480 by 480 to claiming, waiting, being let in and the
      chat; the page in a frame of another origin. On the Workers runtime locally, over the
      API: the list, letting someone in, a Dood woken into an agent, a treat reaching its
      actor, and both pages' heads. Not run: a real post on X, a sign-in with GitHub or Google
      along the way, the email, a phone, the deployed Worker.
56. **Guides on the site, which an agent can be given** (2026-10-11; `docs/`,
    `apps/web/src/lib/docs.ts`, `apps/web/src/components/docs`, `prototypes/docs`). The owner
    asked for "a docs page on the website that has guides", the first being how to self host,
    and that "you should also be able to give the guide to an agent via a link to set it up".
    They chose the mock-up ("I love this can you build this for real"), said the README's
    sections could be replaced, and that the guides are served on every deployment. The rest
    is mine.
    - **A guide is one Markdown file in `docs/`**, served twice: `/docs/<name>` is a page, sent
      whole, and `/docs/<name>.md` is the file itself. So what a person reads and what their
      agent follows are the same text. `/docs` opens the first guide, and `/llms.txt` lists
      them. A file added to `docs/` is a guide; `ORDER` in `lib/docs.ts` says which come first.
    - **The page** has the landing page's top line and colors, the guides at the side with the
      open one's sections, and a card, "Have an agent set it up", whose prompt holds the
      address of the file at that deployment. Three things are drawn specially and each is
      plain Markdown in the file: `**Needs you:**` is the mark on a step that waits for the
      person, a paragraph that starts `Check:` gets a tick, and a quote is a note set apart.
    - **The guide, `docs/self-hosting.md`,** took over the README's "Run it on Node" and
      "Deploy to Cloudflare". It is written to be followed by an agent as well: a note to
      agents first, a check under each step, and keys only ever typed by the person. On Node a
      key goes in a settings file read with `node --env-file`, which the user service reads
      too, so no key passes through a chat.
    - **What was run.** The Node half, from a clean clone on this machine: install, build,
      start, the health check, the settings file, and the user service, which came back after
      being killed. **The Cloudflare half has not been run from nothing.** Its order differs
      from the old README's: it deploys before it sets the secrets, so that `wrangler secret
put` never has to ask whether to make a Worker. The first person to follow it on a new
      account is its test.

57. **A restyle of every page** (2026-10-11; `apps/web/src/styles.css`, `components/ui`,
    `components/shell`, `components/chat`, `prototypes/polish`). The owner showed T3 Code and
    asked whether anything could be taken from it "to make the app look a little more
    professional", naming "typeography, shadows, and layout". They saw the chat page restyled,
    asked for "a restyle of all of the pages", and then for it to be merged. They did not answer
    which typeface or whether their own messages should be pale, so both are mine.
    - **Three levels over a frame.** The app sits in a tinted frame (`bg-frame`) and the page is
      a rounded sheet on it. Above that are `shadow-raised` (what is chosen in a list, a card),
      `shadow-card` (the page) and `shadow-float` (the message box, menus, windows). Each is a
      hairline with a shadow under it, and in the dark theme each is a step lighter. They are
      set in `styles.css`; nothing else should draw a shadow of its own.
    - **Type.** Geist in place of Inter, which the landing page and the guides keep. What the
      agent says is the page's own text at 16px with no bubble; a person's own messages are a
      pale tint of the agent's color, and other people's stay grey. Labels are in sentence
      case. The chat's column is 45rem.
    - **The shell.** The sidebar has no line beside it and the strip none under it. The open
      agent, the open file in the library and the open section of a settings window are raised
      rows. The strip's tabs are one control. The agent's panel, a side chat and a document
      beside a chat are cards in the sheet, `BESIDE_GAP` in from its edge, and a document is
      still no wider than leaves the chat `DOC_PANEL_LEAVES`.
    - **Fields and cards.** Fields are white with a hairline where they were grey fills. Cards
      are white and raised where they were grey with a border: automations, computers, file
      cards, and the cards an agent asks through. Sign-in, pairing a computer, the desktop
      app's sign-in and an invitation are a card on the frame.
    - **A fault it fixed.** With a file open in the library, the Chat tab was marked as the
      open page as well as Library, because a link to the agent's own address is taken as open
      on every page under it. That link is now matched exactly.
    - **Left alone:** the landing page, the guides, the first run, the Dood pages, the creature
      and the inside of its wardrobe, and the native app in `apps/mobile`.
    - **What was looked at.** `prototypes/polish/tour.mjs` takes a picture of every page from a
      running server, and was run against the build before and the build after: the chat, an
      empty chat, a side chat, a document beside a chat, the library, automations, every
      section of both settings windows, the menus, the wardrobe and sign-in, some of them in
      the dark theme and at a phone's width. **Not seen:** an approval or a secret being asked
      for, an agent using a screen, sub-agent chips, Slack threads and a team with other people
      in it, which the echo model does not produce, and Safari. Three measurements in
      `e2e/layout.spec.ts` changed with the look.
58. **One settings window** (2026-10-12; `apps/web/src/lib/settings.ts`,
    `components/settings/settings.tsx`, `settings-dialog.tsx`, `lists.tsx`). The owner found
    "the IA between all of the settings, workspace / user / agent" confusing. There were two
    windows for four owners: the agent's, and the workspace's, which also held what is the
    user's own (the defaults for new agents, notifications) and the deployment's (server models,
    the waiting list), and opened from the menu on the user's name. They were shown one window
    grouped by owner, asked instead for "an Agents tab that lists the agents and you can click
    on them", the same for workspaces, with the agent's settings icon "just a short cut there",
    saw that mocked up, and said to build it.
    - **The top of it** is what is the user's own (General: the theme, and the model and
      computer a new agent starts with; Notifications), two lists (Agents, by workspace, each
      saying its model and computers; Workspaces, with invitations and New team), and for
      whoever looks after the deployment, Server (Models, Waiting list).
    - **Inside an agent or a workspace** the list of sections becomes its own, under a way back
      to the list it was chosen from. An agent has Profile, Memory, Model and computers,
      Skills, Connectors, Permissions and Usage; a workspace has People (a team only),
      Computers and Models. The sliders icon on an agent's strip, and Settings in the menu of
      its row, go straight inside that agent; Workspace settings, now in the workspace's menu
      at the top of the sidebar, goes straight inside that workspace; Settings in the menu on
      the user's name opens the top.
    - **The address** is one parameter: `?settings=general`, `?settings=agent.<id>.memory`,
      `?settings=workspace.<id>.computers`, and with no section (`agent.<id>`, or `all` for the
      top) the list itself. A wide screen shows the first section beside the list; a narrow one
      shows the list alone and then the section chosen from it, with a bar at its top that
      leads back. Addresses from before (`?settings=identity`, `?workspace=team`) still open
      where they led, on the agent or workspace on screen.
    - **What moved, which is mine and was in the mock-ups:** Identity is Profile, with moving
      and deleting the agent at its foot where they were a section of their own; "About you"
      (or "About the team") is under Memory; Slack is a card among the Connectors that opens
      its own page; the theme is a choice of three under General (System is new: it forgets
      what was kept and follows the device) where it was a row of the user's menu, which is now
      Settings, Invite people and Sign out.
    - **Also mine:** a workspace's Computers list only what is that workspace's or what one of
      its agents works on, where every workspace used to list every computer the user could
      see. A link from one level to another (an agent's model to its workspace's Models) goes
      inside that workspace, and the way back from there leads to Workspaces and not to the
      agent.
    - **Checked:** `e2e/settings.spec.ts` (the lists, the ways in, old addresses, the theme, a
      phone) and `src/lib/settings.test.ts`; every other browser test opens settings through
      the helpers in `e2e/helpers.ts`, which follow the new ways in. Looked at on a wide screen
      and at a phone's width, in the light theme. **Not seen:** a team with several people and
      agents in the lists, an invitation in the Workspaces list, the Server group as an admin
      by eye (its tests pass), and Safari. The native app in `apps/mobile` is as it was.
59. **One row at the top of an agent's pages on a phone** (2026-10-12;
    `components/shell/agent-strip.tsx`, `app-skeleton.tsx`, `lib/use-wide.ts`). The owner sent
    a picture of their phone and said "this two tier tabs and header is a bit strange on
    mobile". They were shown three drawings (the pages in the name's menu; the tabs in the row
    in place of the name; two rows made to look like one header) and chose the first.
    - Under `md` the strip is one 48px row and has no tabs in it. The menu on the agent's name
      starts with Chat, Library and Automations, with the open one ticked, and the other
      agents are under them as before. Off the chat the name is followed by the page
      ("Juniper · Library"); a long name is cut short before the page is.
    - Seeing that, the owner said "i don't like that we are now missing the back button" and
      "it looks hard to go back to main chat". So on Library and Automations the row starts
      with an arrow back to the chat, where the button for the agents is on the chat. The
      agents are still reached there by a swipe from the left and from the name's menu. That
      the arrow takes the place of that button, and is not beside it, is mine.
    - From `md` up nothing changed: the tabs are in the strip and the menu lists agents only.
      The pages are left out of the menu there by `useMedia`, not hidden with a class, so the
      arrow keys cannot land on one that is not shown.
    - The name's button is called "…: pages and other agents" on a narrow screen and
      "…: another agent" on a wide one.
    - **What was looked at:** the chat, the open menu, the library and automations at 393 and
      320 pixels wide and the menu at 1280, in Chromium, light theme. **Not seen:** a real
      phone, Safari, a team's chat with other people's faces in the row.

60. **A guide to Apps, with pictures, linked from the app** (2026-10-12; `docs/apps.md`,
    `docs/images`, `apps/web/src/lib/docs.ts`, `components/settings/connectors.tsx`,
    `prototypes/guide-pictures`). The owner asked to "add to the docs about composio and tell
    them what they get and how to set it up with screen shots and why they would and then link
    it from the app". The rest is mine.
    - **The guide** is for whoever uses Apps, not whoever runs the deployment: what they get,
      why, the steps, asking the agent instead, what is asked first, what Composio holds, a
      team, disconnecting. It is the second guide (`ORDER`).
    - **A guide can show pictures.** They are PNG files in `docs/images`, named in the guide
      as `images/<name>.png`, which is also what shows them on GitHub. The page shows each from
      the app's own files (`pictureOf`), and `/docs/images/<name>` sends whoever follows the
      file's own address on to it. A test fails a picture that is missing or has no words.
    - **The card beside this guide** has no address in it. It says "Connect my apps.", for the
      person's own agent, which adds Apps when asked (`agentPrompt`, `handOffOf`).
    - **In the app,** the Your apps card and the Apps connector's card each link to the guide,
      which opens beside the app and leaves the settings open.
    - **How the pictures were made.** `prototypes/guide-pictures/shoot.mjs` takes all five, and
      is what to run when the app's look has changed. It starts the built Node server with a
      real model, twice: once as
      it is, for the Connect apps card, the agent adding Apps when asked, and Composio's own
      sign-in page; once with `DC_APPS_URL` at a stand-in that offers Composio's tool names
      (from Composio's reference) and canned answers, for the Connected card and the agent
      asking before it sends an email. The window was 1280 by 860 at twice the size. Nobody
      has signed in to Composio through Apps yet (item 53), so what follows its sign-in page
      is written from how the connector is built, not from having seen it.
      Each run makes new agents, whose creatures are drawn at random, and the agent's words
      are its own: the pictures kept are from a run where the two looked alike.
    - **Not done:** nothing retakes the pictures by itself; the first paragraph of Connectors
      still says an agent uses connectors "without asking first", which is not so for Apps.

61. **A README for a public repository** (2026-10-12; `README.md`, `docs/reference`,
    `docs/screenshots`). The owner said the README was sloppy, that the project is called Do
    Computer and should be called that everywhere, and asked for pictures of the app and for
    it to be tidied into what a public repository shows. The rest is mine.
    - **The README** is now short: the name and icon, a picture of a chat (the dark one for
      whoever reads GitHub in the dark), what an agent can do in a line each, four more
      pictures, a quick start, where it can be hosted, where it is used, links to the guides
      and the reference, and development.
    - **Nothing was thrown away.** What the README said at length is in `docs/reference`, a
      file to a subject, in the words it had: configuration, computers, models, security and
      trust, what an agent can do, teams, Slack, Apps, Doods and the waiting list,
      notifications, the desktop app and the mobile app. They are not guides: only a file
      directly in `docs/` is served under `/docs`. The self-hosting guide's link to the full
      list of settings goes there now.
    - **The pictures** are in `docs/screenshots`, not `docs/images`, since every picture in
      `docs/images` is built into the web app. They are six of `prototypes/polish/tour.mjs`'s,
      made 1600 wide (its README says how).
    - **The name.** `PLAN.md`'s title and the old mock-ups that said "durable computer" say Do
      Computer. Still named durable-computer, and not changed then: the packages (renamed in
      item 66), the Worker, database and bucket, and `~/.durable-computer` on a paired
      computer. Renaming those last changes running deployments and paired machines.
62. **The sidebar lists every workspace's agents** (2026-10-12;
    `apps/web/src/components/shell/agent-list.tsx`, `workspace-menu.tsx`, `sidebar.tsx`,
    `lib/atoms.ts`). The owner sent a picture of another app's list of agents (headings that
    fold, and under each its agents, every row with the agent's latest line, a time and a dot)
    and asked for a mock-up "where we keep the workspaces in the sidebar separated". Of the
    mock-up they asked whether "the selection state should be flush with the workspace
    header", were shown it both ways, and said: "can you build this also don't show any
    sections unless you have a workspace". The mock-ups were pages shown in the thread and are
    not in `prototypes/`.
    - **The list.** Someone in a team has every workspace of theirs in the sidebar at once,
      their own first, each under its mark and name. The name folds its agents away, which is
      kept in the browser (`dc-folded-workspaces`); folded, the heading shows a few of the
      creatures. Someone in no team has their agents under "Agents" and no workspace's name,
      as before. A heading has no padding of its own, so its two ends are where the chosen
      row's are, and so are the ends of the row at the top, which is now the app's name and
      the button that hides the sidebar. A row is as it was: the creature, the name and the
      agent's tagline, in the order the agents were made.
    - **A heading's name is level with its mark by its letters, not by its line.** The owner
      sent a picture in which the name sat a pixel and a half above the middle of the mark.
      It did not here: a line of text is as tall as its font says, and that is read
      differently from one system to the next. So the name, "Agents" and the app's name at
      the top are trimmed to the height of a capital (`text-box`, the `LEVEL` class in
      `agent-list.tsx`), and what is centred is the letters. A browser without `text-box`
      (Firefox, at the time) lays them out as before. Checked here by giving the name a font
      whose line is laid out higher, which moved it 1.25px without the trim and not at all
      with it; not seen on the owner's machine.
    - **What moved.** There is no workspace menu: nothing is switched between. A heading has
      the workspace's own menu (its settings, and inviting people to a team) and a + that
      makes an agent in that workspace. New team and the invitations waiting for the user are
      at the foot of the list. The panel that said who is where in a team is gone: the people
      in the team now are faces on its heading (which opens People), and whoever is with an
      agent is a face on its row, as before. That is known only for the team on screen, so a
      row with nobody at it has the agent's tagline, where a team's rows used to say "Quiet":
      of another team's agents that would not be known to be so.
    - **What was built and taken out again: the latest line.** The first version of this had
      what the mock-up's rows had: the latest thing said to an agent or by it with a time, a
      spinner on the creature while it worked and a "?" while it waited on someone, and a dot
      for what its reader had not seen. The agent kept its latest line in a document of its
      own and reported it with `working` and `asking`; the gateway kept when each person last
      looked at an agent. Rows of agents that were not open were kept fresh by asking for the
      list again every 30 seconds, which asks every agent, and the owner asked "is there a
      way to do that in a more efficient way than polling". There is (the agent tells the
      gateway when its row changes, and one hibernating socket for each person carries that
      to their open tabs), and it is not built. They then said: "what if we build this without
      the latest line? just the new sections". That first version is the first commit of the
      pull request this was merged from. Item 63 is that socket.
    - **Mine, not the owner's:** New team and invitations at the foot of the list, where the
      mock-up had them; the menu and the + on each heading; that the who-is-where panel went.
    - **Checked:** `e2e/sidebar.spec.ts` (no headings without a team, the headings, a new
      agent from a heading, folding, the heading's menu) and `e2e/teams.spec.ts` (faces on the
      heading and the row); the other browser tests reach a workspace's settings through
      `workspaceMenu` in `e2e/helpers.ts`. Looked at with pretend agents in three workspaces
      on the built Node server: light and dark, folded, and at a phone's width. **Not seen:**
      a team with other people in it by eye (the tests cover it), Safari, a real phone, the
      desktop app, and Workers. The native app in `apps/mobile` is as it was.

63. **A row in the sidebar says the latest from its agent, pushed and not polled**
    (2026-10-12; `packages/agent/src/actor.ts`, `apps/web/src/server/feed.ts`,
    `presence-actor.ts`, `agent-seen.ts`, `apps/web/src/lib/latest.ts`,
    `components/shell/agent-list.tsx`). This is what item 62 took out, put back the way the
    owner asked for when it went: "do a follow up change to show the last response / if the
    agent is working efficiently like we talked about".
    - **A row** is the creature, the name with a time beside it, and under it the latest thing
      said to the agent or by it, on one line: "You: …" or a teammate's first name for what a
      person wrote, the agent's answer as it is, a scheduled task's title before what it came
      to, "From Scout: …" for another agent's message, and what it is asking for when it has
      stopped to ask. The creature has a spinner on it while the agent is at work and a "?"
      while it waits for someone. A row with something its reader has not seen has a bold
      name, a dot and its time in the accent color. Agents are in the order they were last
      heard from, and one that never was counts from when it was made. A folded workspace's
      heading has a dot when one of its agents has something new or is waiting.
    - **The agent keeps its latest line** in a document of its own (`LatestDoc`), written when
      a person writes to it, when a run ends with an answer in a chat of theirs, when a
      scheduled run reports, when another agent writes to it, when it answers in Slack and
      when it asks for an OK or for something to be typed in. No transcript is read for it.
      What it asked for stays its line until someone answers. Its summary has `latest`,
      `working` (a run going or waiting its turn, or a sub-agent still to report; a command
      left running in the background is not) and `asking` (a request nobody has answered).
      An agent from before this has no line until something is next said.
    - **How a row stays current.** Each time one of the three changes, the agent says so
      (`onActivity`), once for each change. The server looks up who the agent works for, its
      owner or everyone in its team, and tells each of them on a feed of their own
      (`feed.ts`), which their open tabs hold one WebSocket to. The page puts what it is told
      into the list of agents, which every row is drawn from. Nothing is asked for on a
      timer: the list is asked for when the page loads and each time the socket comes back
      up, since what is said while it is down is said to nobody.
    - **A person's feed is the presence actor of their personal workspace.** A team's presence
      actor says who is where; a personal workspace has nobody to be present for, so its
      address (`/api/presence/personal:<user>`) is its owner's feed, and only they are let
      in. It is the same Durable Object class and the same namespace, chosen by the actor's
      name (`createLiveActor`), so nothing was added to the Worker's bindings or migrations.
      The actor keeps nothing and its sockets hibernate. Telling someone with no tab open
      costs one request to an actor that has nobody to pass it to.
    - **What is new to whom** is the gateway's: `dc_agent_seen` holds, for each person apart,
      when they last looked at an agent (`PUT /api/agents/<id>/seen`, by the server's clock),
      and the list carries it as `seenAt`. The page says so when an agent is opened and
      whenever something comes from it while the page is the one being looked at, and the
      person's other tabs and devices are told on the same feed. What a person wrote
      themselves is not new to them. An agent they have never opened since this was kept is
      not marked at all: there is nothing to measure against.
    - **Mine, not the owner's.** The order (latest first; they were asked and did not say),
      the times (now, 9:20 AM, Yesterday, Fri, Oct 2), that an agent never looked at is not
      marked, that a row's menu comes out over its time under a pointer and is not there on
      a touch screen, where the agent's strip has the same pages, and that the feed shares
      the presence actor's class.
    - **Where a row can be behind.** If new work arrives in the moment an agent is found to
      have come to rest, that it stopped is said at its next request or wake-up, up to twenty
      seconds on. An answer that finishes after the agent's process was restarted is not kept
      as its line: the row says it is no longer working and keeps what was said to it. When a
      request is answered or withdrawn and nothing more is said, the "?" goes and the line
      still has what was asked. An update that arrives while the list itself is being fetched
      can be overwritten by the fetch, until the next update.
    - **In the browser tests** `page.getByText` leaves the rows' lines out (the `page` fixture
      in `e2e/fixtures.ts`, by the `data-latest` on a row's line): a row repeats the start of
      what was just said a moment after it is said, so the same words would be one thing or
      two by how fast the row caught up. A test about a row asks the row. A page a test opens
      for itself is not covered by that.
    - **Checked:** `e2e/sidebar.spec.ts` (a row of an agent that is not open changes with no
      request for the list; the marks; unread and what takes it away, on a second tab too;
      nobody else's feed can be joined), `src/server/feed.test.ts`, `agent-seen.test.ts`,
      `src/lib/latest.test.ts` and the agent's own tests. Looked at with pretend agents on the
      built Node server. **Not seen:** a real model's answers in the rows, Slack and another
      agent's message in a row by eye, a team with other people in it by eye, Safari, a real
      phone, the desktop app, and Workers, where the feed's sockets have only run in the
      tests' local runtime if at all. Under `pnpm dev` on Node there is no WebSocket server,
      so rows there change only when the list is next asked for. The native app in
      `apps/mobile` is as it was.

64. **What a new agent offers to do first shows what it can do** (2026-10-12;
    `apps/web/src/lib/starters.ts`, `components/chat/chat-view.tsx`,
    `apps/desktop/src/page-bridge.ts`, `main.ts`). The owner asked for "a few different pills
    of things you can have it do" at the end of the first run, to "show off the power of do
    computer", and named one: "draw a picture with a painting app on my computer", so that
    "it can pop it up and you can watch it like doodle on it". They chose from a list.
    - **The buttons** under the agent's hello, by what it was given in the first run. On a
      computer it may work on: Draw me a picture, Make me a little game, What's filling up
      this computer?, Check in with me every morning. With no computer, or one it may only
      read: Make me a little game, Research three things at once, Check in with me every
      morning. A button says a whole sentence for whoever pressed it, which the chat shows as
      theirs (`say` in `starters.ts`): the game is asked for in the chat itself, the disk as a
      chart, the research with sub-agents, the check-in for nine each morning.
    - **Drawing takes the screen, which is off until its owner says otherwise** (item 31). So
      the button asks the desktop app first (`askForScreen` on the page's bridge), and the app
      asks its owner itself, in a message box of its own: "Let agents use this computer's
      screen?". A page cannot draw that question or answer it. Allow switches the screen on,
      starts the daemon again and waits for it to be connected, and only then is the agent
      asked. Not Now leaves everything as it was and nothing is said. With the screen on
      already, nobody is asked. On a Mac that has still to allow Accessibility or Screen
      Recording, the app opens its window about this computer, which has a button for each,
      and the page says to allow them and ask again. Where the screen cannot be asked for
      (no driver, not shared, read-only) the page says why. An app from before this has
      nothing to ask: the sentence is sent and the agent says whose it is to switch on.
    - **Mine, not the owner's.** The wording of each sentence, that the agent draws itself,
      nine in the morning, which three are offered with no computer, that a read-only
      computer gets those three, and that a page of the deployment may now make the app put
      the screen question at any time, not only in a first run. No stroke was added to the
      screen tool: a drag is still one straight line a call, and the owner said drawing
      "works ok" as it is.
    - **Checked:** `apps/desktop/e2e/desktop.spec.ts` (Not Now, then Allow, with the message
      box answered from the test; the daemon says it has the screen before the agent is
      asked), `apps/web/e2e/welcome.spec.ts`, `src/lib/starters.test.ts`,
      `apps/desktop/test/page-bridge.test.ts`; the buttons looked at on the built Node server
      at window and phone width. **Not seen:** any of the five done by a real model, the
      message box by eye, anything on macOS or Windows, and the two macOS permissions being
      asked for from here. The desktop half reaches people in the next desktop release.

65. **The native app does what the web app does on a phone, and is laid out as an iOS app**
    (2026-10-12; `apps/mobile`, `packages/client/src/index.ts`, `apps/web/e2e/mobile.spec.ts`,
    `scripts/island.mjs`, `scripts/icons.mjs`, `prototypes/ios-app`). The owner asked for "a
    full pass on the mobile app to make sure it has all of the features of the mobile web and
    … make it feel like a native ios app", chose from a mock-up (`prototypes/ios-app`), and
    then asked for it to be built and tried on their MacBook Air. The app was five tabs for
    one agent. It was written again from its data layer up; only the creature's drawing, the
    Markdown parser and the dictation and push helpers were kept.
    - **Layout.** No tab bar. The app opens on the agents under their workspaces
      (`app/(app)/index.tsx`), as the web's sidebar has them, with the latest line pushed
      over the person's feed. An agent's row opens its main chat. The agent's name in a chat
      opens a page of its own (`a/[agentId]/info.tsx`) that holds what the web splits between
      the agent's panel and its settings, so a phone has the running work, the files shared in
      a chat, the steps behind an answer and Start fresh. Settings are a sheet from the
      person's face. `app/(app)/_layout.tsx` names the routes that arrive as sheets.
    - **The kit** is `apps/mobile/src/ui`: text in iOS's styles, grouped rows, buttons, SF
      Symbols on iOS and drawings elsewhere (`icons.ts`), Liquid Glass where there is any
      (`expo-glass-effect`), the bar's own buttons and pull-down menus (`Stack.Toolbar`),
      swipe actions, haptics, and a confirmation before anything that cannot be taken back. A
      file that has an iOS version beside it (`menu.ios.tsx`) must not import its own base
      name: on iOS that is itself.
    - **What it shares with the web.** `packages/client` opens its feed and presence sockets
      with the constructor it is given, so the phone passes one that sends its session
      cookie, and follows agents over sockets as the web does. Nothing else outside
      `apps/mobile` changed but the browser tests and the icon script.
    - **Four things that had never worked on a device**, found by running it: the session
      cookie was read as if it were at hand when the auth library hands it over later, so no
      signed-in request could succeed; three.js could not start in a GL view, which has no
      canvas of its own, so no creature was ever drawn; a phone's JavaScript has no `crypto`,
      which the shared code makes ids with, so nothing could be sent; and two GL views
      started at the same moment do not always both reach the screen, so each now waits its
      turn (`src/ui/gl-turn.ts`).
    - **Checked.** Built on the owner's MacBook Air (Xcode 27, an iPhone 17 simulator on iOS 27) and driven there with Maestro against the built Node server: signing in and out,
      the agents list with the feed changing a row, a chat with a streamed reply and the
      keyboard up, the side chats sheet, the agent's page and each of its settings pages,
      the wardrobe, opening a box and wearing what was in it, the library with a folder, a
      Markdown document and a table, the share sheet, automations and one automation,
      settings and General, new team, pairing, and the first run as far as the naming card.
      `apps/web/e2e/mobile.spec.ts` was written again for the new app (13 tests through the
      browser build), and the app's unit tests grew from 1 file to 8.
    - **Not seen:** a physical phone; Android; dark mode on the simulator; a real model;
      dictation, the camera, the photo picker and attaching files; a visual, a screen in use,
      sub-agents and background commands in a native chat (their code is the web's rules,
      drawn natively, and only type-checked and run in the browser build); a team with other
      people; a paired computer; signing a workspace in to a model provider; GitHub and
      Google sign-in; an invitation; push notifications; the rest of the first run after the
      name (the browser tests do go through it). Signing up in the simulator stopped at the
      system's strong-password offer, which the test tool could not answer. Creatures start
      one after another, about half a second each in the simulator, with their still
      picture until then. A hold on a row brings up the system's sheet of actions and not a
      context menu with a preview: the menu views either hid the row from VoiceOver or let
      it be only as wide as its words.
    - **Chosen without the owner being asked:** no tab bar and the agent's page (both were in
      the mock-up they approved), turn-taking for creatures, do.computer as the server a
      phone starts on, sockets for following agents, and leaving the mock-up's "Outside the
      app" extras unbuilt.

66. **The packages are `@do-computer/*`, and the phone app has names of its own**
    (2026-10-12; every `package.json`, every import, `.github/workflows`,
    `apps/mobile/app.config.ts`, `apps/web/src/server/auth.ts`). The owner asked how much work
    it would be to call everything do-computer and whether it would break the live site, and
    then for the parts that would not.
    - **Renamed:** the package scope (`@durable-computer/*` to `@do-computer/*`) and the
      root package; the name the server gives itself to GitHub, to connectors and in a few
      labels (`user-agent`, the MCP client name, the label on a Daytona machine, the default
      address notifications are signed with); and the phone app's Expo slug, its address
      scheme (`docomputer://`, which the server trusts sign-ins from and must match), and its
      ids: `computer.do.app` on iOS, beside the desktop app's `computer.do.desktop`, and
      `com.docomputer.app` on Android, where a part of a package name may not be `do`.
    - **Not renamed, on purpose:** the Worker, the D1 database and the R2 bucket
      (`durable-computer` in `wrangler.jsonc`): a Worker's Durable Objects belong to it by
      name, so a renamed one would start without any agent's chats or memory, and the
      database and bucket cannot be renamed at all. `~/.durable-computer` on a paired
      computer, the daemon's service names and its command: a daemon that looked elsewhere
      would lose its pairing. The default Modal app, which is where existing machines are
      found. None of these is seen by anyone using the app.
    - **For whoever runs commands by hand:** `pnpm --filter @do-computer/web …` where it was
      `@durable-computer/web`. A script outside the repository that names a package has to
      be changed with it.
    - **Checked:** `pnpm check`, every package's tests, the web and desktop builds, and the
      browser tests. **Not seen:** a deploy from the renamed tree, and a phone app built
      under the new ids, which nobody had installed under the old ones.

67. **The phone app has an Expo project, so a build of it can be notified** (2026-10-12;
    `apps/mobile/app.config.ts`, `apps/mobile/eas.json`, `docs/reference/mobile.md`). The owner
    asked whether ordinary notifications worked on the phone. They did not: the app asks Expo
    for the token the server sends to, and Expo gives one only to a build that belongs to a
    project.
    - **What there is now:** the project's id in `app.config.ts`, which `EAS_PROJECT_ID`
      replaces for somebody else's build, and `eas.json` with three profiles (`development`,
      `preview` for registered phones, `production` for TestFlight and the store), which pin
      the Node and pnpm the workspace uses.
    - **Nothing changed on the server.** It already sent to Expo's push service
      (`server/push.ts`) and needs no key for it, as long as the project's "enhanced security"
      is left off.
    - **The first build in Expo's cloud failed, and why:** `babel.config.js` names
      `babel-preset-expo`, which the app did not depend on. Run through pnpm (`pnpm mobile`,
      `expo export`) it is found anyway, because pnpm's wrapper for a command adds its hidden
      folder of every package to `NODE_PATH`. Xcode's release build runs the bundler with
      `node` and no wrapper, and the preset was not found
      (`Cannot read properties of undefined (reading 'transformFile')` is what is left of that
      by the end of the log). It is a dependency of `apps/mobile` now. To run that step as
      Xcode does, without a Mac, from `apps/mobile`:

      ```sh
      env -u NODE_PATH node <@expo/cli>/build/bin/cli export:embed --platform ios --dev false \
        --entry-file node_modules/expo-router/entry.js \
        --bundle-output <file> --assets-dest <folder>
      ```

    - **Checked:** the Expo tools read the id, and the app bundles for iOS as a release build
      does. **Not checked:** a build in Expo's cloud, which needs the owner's Apple sign-in,
      and so a notification arriving on a phone, or a tap on one opening its chat.

68. **First things found on a real phone: dictation, and the agents list** (2026-10-12;
    `apps/mobile/src/lib/device-fetch.ts`, `apps/mobile/app/(app)/index.tsx`). The first build
    installed on the owner's iPhone.
    - **Dictation said `Audio of type "null" cannot be transcribed.`** Expo's fetch, which the
      app uses on a device because it can stream a reply, sends a blob under the blob's own
      type and drops the Content-Type the request names. A file read from the phone's disk is
      a blob with no type. `keepingType` wraps that fetch and hands over the blob's bytes, so
      the named type stands. The same path carries a picked attachment and a file put in the
      library, which would have arrived with no type too.
    - **The agents list looked off beside the web app's.** It had been laid out as a list of
      its own (large bold workspace names, arrows on the left, two lines under a name, lines
      between rows) and not after the web app's. It now follows `agent-list.tsx`: a workspace's
      line is small and grey and starts at the margin with whose it is (the person's face, or
      the team's tile), then its name and the arrow that folds it; a row is a creature, a name,
      the time, and one line under it with the unread dot at its end; "New team" is a grey line
      under a rule. Creatures are 44 points in a row, near the web app's 40.
    - **The message box while listening is one line.** It said "Listening" under the bars,
      which the owner did not want; the bars and the buttons say it, and the words are kept
      for a screen reader.
    - **Checked:** a test of `keepingType`, the app's other tests, and the browser tests. The
      list and the one-line box were looked at in an iOS simulator. **Not checked:** dictation
      in the simulator, which gets no microphone from a Mac reached over SSH, so the listening
      state was forced for its picture; and the upload fix on a phone since it was written.
      The owner asked for no more cloud builds for now: they are paid for.

69. **The message box has a button for the model and how hard it thinks** (2026-10-13;
    `apps/web/src/components/chat/thinks-with.tsx`, `model-picker.tsx`, `composer.tsx`). The
    owner asked for a mock-up of the model and effort pickers inside the message box
    (`prototypes/model-in-composer`), then asked whether so advanced a thing should be hidden
    a little, and chose the arrangement with one quiet button: "I love this lets ship it".
    - **One button beside the paperclip** opens a menu: a search and the models, under where
      each comes from, and under them the thinking levels of the one chosen. Each choice is
      saved as it is made and the menu stays open, so a model and then its level are one
      visit. Pointing at the button says what is chosen. Shut with Escape, it gives the cursor
      back to the message.
    - **It is the agent's own setting**, the one under Model and computers, which is still
      there: it holds for every chat with the agent, for whoever else talks to it, and for
      sub-agents started afterwards. A choice for one chat alone would be server work and was
      not asked for.
    - **Nothing is drawn where there is nothing to choose**: one model that thinks one way,
      which is a server with no key and no sign-in.
    - **The list is the settings' list.** `ModelList` is `ModelPicker` with nothing to open,
      over the same rows (`inline` on Base UI's combobox); in the menu a row leaves the model's
      id out, which there is not the room across for beside its price.
    - **A menu a button of the box opens is drawn elsewhere on the page, and what is pressed in
      it still reaches the box's own handlers**, which keep the cursor in the message: they now
      leave alone what is not inside the box. Without that the search could not be typed in.
    - **Mine, not the owner's:** the button is a brain where the mock-up had sliders, because
      sliders already open the agent's settings from the bar above the chat; and the word is
      "Thinking", as in settings, where they said "effort".
    - **Checked:** a browser test (`models.spec.ts`) that changes both from the box and finds
      them in settings and after a reload, one that the button is absent with a single model,
      and the menu looked at in both themes and at a phone's width. **Not checked:** the side
      chat's box, which gets the same button and was only type-checked; a team, with another
      person's page open on the same agent; a real model. The phone app has no such button.
70. **The app calls an agent a Dood, wherever a person reads** (2026-10-13;
    `packages/agent/src/persona.ts`, and copy in every app). The owner: "Can we make sure that
    in all of the user facing copy we refer to the agents as Doods?" Until then only the
    landing page did (item 48).
    - **What says Dood now.** Every label, sentence, error a person is shown, notification,
      invitation email, permission and line of activity in the web app, the phone app, the
      desktop app and the daemon ("New Dood", "Doods" over the sidebar's list, "Your Dood",
      "Dood not found"); a Dood's Slack app description; the phone and desktop apps' reasons
      for asking for the microphone; the desktop release notes; `README.md`, the guides in
      `docs/` and the pages in `docs/reference`. "Dood" keeps its capital inside a sentence,
      which is why the settings window's "Back to …" no longer lower-cases every label.
    - **What still says agent, on purpose.** Code, and every address and name a program reads:
      `/a/<id>`, `/api/agents`, `?settings=agent.<id>`, the `agents` and `subagent` tools,
      `packages/agent`. What the model is told (tool descriptions and results, the notes
      between chats), except one sentence added to the persona, `CALLED`, which tells it that
      the app's word for it is Dood: without it "make me another Dood" would mean nothing to
      it, and it would call itself an agent beside a page that says Dood. A guide's first
      block, "If you are an agent", and the card beside a guide, "Have an agent set it up",
      which are for Claude Code, Codex and the like. The README's first line, which says what
      kind of thing this is to someone who has not met the word, and the sentence after it,
      which introduces it ("agents, called Doods"). The titles of tests.
    - **Chosen for the owner, not confirmed:** "sub-agent" is left as it was ("Sub-agents at
      work", "Only the Dood talks to its sub-agents."), since nobody has said what a Dood's
      copy of itself is called; the sentence in the persona; "Meet your Dood, an always-on
      personal assistant." as the installed web app's description.
    - **How it was done**, for the next sweep of this kind: a script read each file with
      TypeScript's parser and changed the word only inside string literals, the pieces of
      template strings and JSX text, leaving identifiers, addresses and one-word lower-case
      strings (ids) alone. Three things it got wrong at first are worth knowing: a file whose
      name has a `# Handoff

Written 2026-10-06 for whoever picks this project up next. It covers what exists, how it is run
and shipped, what the owner has asked for and decided, what is unfinished, and what has and has
not been checked. `README.md` introduces the product and `docs/reference` describes it for
someone hosting it; `PLAN.md` is the original plan with a status section. Where they disagree with this file, this file is newer.

**This file is in a public repository, and everyone can read it.** Keep out of it, and out of
every other tracked file: credentials, and where they are kept; the identifiers of accounts and
deployments; the owner's machines, their names, their paths and how they are reached; other
projects that are not public; what is left over on the owner's accounts; and a weakness of a
running deployment that is not fixed yet. Tell the owner those privately. What belongs here is
what was built, why, what the owner decided, and what has and has not been checked.

## 1. What this is

Do Computer is an open-source, self-hostable personal agent: a version of Meta's Muse built
on the pi-durable harness, with OpenRouter for models. Each user has persistent agents with a
name, a personality, memory, scheduled automations, skills, connectors (remote MCP servers) and
the user's own paired computers. An agent has no computer of its own: it works on the machines
of its workspace, which the workspace's agents share, and they share one library. It runs on Cloudflare Workers (one
Durable Object per agent) and on plain Node, from the same code. There is a web app (TanStack
Start, shadcn, jotai, TanStack DB and Query, Better Auth) and an Expo mobile app.

The owner is Sawyer. The repository is `SawyerHood/do-computer`.

## 2. Where it runs

- **Live:** https://do.computer, the Cloudflare Worker `durable-computer`, on the owner's
  Cloudflare account. It replaced an older app, which was torn down on 2026-10-03.
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
  `DC_SIGNUP`, `DC_LANDING`, `DC_ALLOWED_EMAILS`, `DC_DEFAULT_MODEL`, `DC_SEARCH_MODEL`, `DC_SUMMARY_MODEL`,
  `DC_JUDGE_MODEL`, `DC_SANDBOX_KINDS`.
- **GitHub repository secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- **Worker secrets** (kept by Cloudflare across deploys): `DC_AUTH_SECRET`, `OPENROUTER_API_KEY`,
  `DAYTONA_API_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`. `RESEND_API_KEY` would go here,
  with `DC_EMAIL_FROM` as a repository variable, to send invitations by email; neither is set.

`apps/web/scripts/deploy-settings.mjs` applies those values to the built config before
`wrangler deploy` uploads it; `pnpm --filter @do-computer/web run deploy` is what CI runs.

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
pnpm --filter @do-computer/mascot demo    # the creature's playground page
node scripts/icons.mjs          # draws the app's icons again: its creature on the first run's island, or on its own color
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

Layout, briefly (`README.md` has it too):

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
| `apps/desktop`       | The Electron app: the deployment in a window, and the daemon run inside it           |
| `prototypes/`        | Design explorations that are not part of the app                                     |

The code has a consistent voice: comments explain why in plain sentences, tests are named as
statements of behaviour, and commit messages say what changed and why. Keep to it.

### On a Linux machine with no graphics card and no Docker

Most of this was built on one, and these are what it took:

- Browser tests use an already-downloaded Chromium:
  `PLAYWRIGHT_CHROMIUM_PATH=$HOME/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome pnpm exec playwright test`
  from `apps/web`, after `pnpm build:node` and
  `pnpm --filter @do-computer/mobile export:web:test`.
- For a headless browser to draw the creature, launch Chromium with
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
- The local Workers runtime needs port 3112, because `apps/web/.dev.vars` sets the base URL to
  it, and `DC_SIGNUP=open` added to that file to sign up. Restore the file afterwards.
- There is no Docker, so Cloudflare Containers cannot run locally.
- Keys for real-service tests are not in this repository. Pass them to a child process without
  printing them, never write them into a tracked file, and delete any Daytona machines a test
  creates.

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
   Where a page cannot get WebGL as it opens, a still picture stands in and `loadMascot`
   (`apps/web/src/lib/mascot.ts`) tries again: after 1, 5 and 30 seconds, and whenever the page
   is come back to. It used to keep the first answer for the life of the page, which in the
   desktop app is until the app is quit; that was seen once on macOS (2026-10-09), and why WebGL
   was not there that time is not known. The packed app does get WebGL on GitHub's Mac.
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
      panel for those at work: one that has ended is in the transcript only. They are not
      listed in the side column, which says only how many of a chat's are at work: the owner
      found a third level there too much nesting. A sub-agent's creature grows from its chat's
      id. `prototypes/subagents` is the mock-up it was built from.

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
    - **The web app** has one sidebar and no rail. It lists the user's agents, under their
      workspaces' names where they are in a team (item 62, which replaced the workspace menu
      this was built with; item 18 says what choosing an agent does); at its foot is the
      user's own menu. A team
      has no page of its own: `/w/<id>` goes to its first agent, and stops only where there is
      none yet. Its people are a section of the workspace's settings. The invitation page
      (`/invite/<token>`) can be read before signing in.
    - **An agent's pages** are tabs in a strip above them (`components/shell/agent-strip.tsx`):
      Chat, Library and Automations. The strip also has the agent's name, which opens a menu of
      the other agents and its recent chats, the way into its settings, and the switch for its
      panel. The panel is beside every tab, and on the Library tab the sidebar's list is the
      library's files, put there through a portal (`sidebarSlotAtom`), so changing tab moves
      nothing. Settings are a window over the page, opened by the address (item 58, which
      replaced the two windows this was built with). The old page addresses (`/a/<id>/skills`
      and the like) redirect to it.
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
      memory, their own conversation. Since item 30 one begins with the main chat's context.
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
      (That is Node. On Cloudflare it is a machine like the others since item 47.)
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
    - **Something asked for says so at once** (2026-10-13). Whatever is pressed that goes to
      the server shows it is at work from the press: a spinner in place of its icon, or its
      words changed ("Removing…"), and it cannot be pressed twice. What goes wrong is said
      beside it (`role="alert"`); there are no toasts. A menu's row that starts something
      stays open while it does (`closeOnClick={false}`), which is where its failure is said.
      Making an agent (`lib/new-agent.ts`) puts a row for it in the sidebar from the press.
    - **What the server just answered is not asked for again.** `POST /api/agents` answers
      with the agent and the main chat it was given, so the app puts the agent in the list
      (`listAgent`), remembers the chat and opens it: it used to ask for the whole list, which
      waits for every agent, and then for the agent's state twice. A new side chat, and a main
      chat settled on, are put among the agent's chats the same way (`keepChat`); deleting an
      agent or leaving a team takes agents out of the list (`unlistAgents`). Each is followed
      by asking again, which nothing waits for.
    - **Not done.** The gateway still does not know an agent's main chat, so an agent that has
      never been open in this browser, and was not made in it, takes two trips (its state, then
      its chat). The native mobile app was not changed.

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
      OpenRouter, the mobile app and the daemon's service. The packages were `@durable-computer/*`
      until item 66.
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
    - **The loop.** A box turns up beside the creature six hours after its last one was
      opened (`BOX_EVERY_MS`), whatever the agent did or did not do meanwhile. It has one box of
      its own waiting at most: nothing more turns up while that waits, and the wait for the next
      starts when it is opened (`nextBoxAt` in `CreatureDoc`, set by `#openBox` in
      `packages/agent/src/actor.ts`). Nothing wakes for a box. One that has come due is counted
      when the creature is next looked at (`#boxDue`), and the page asks again when the time
      comes, so a box turns up while it is open. Once everything is found no more turn up. The
      boxes that other people's treats make for a claimed Dood (every four, `TREATS_PER_BOX`,
      `joy`; item 55) are besides that one and wait together however many there are: `shared`
      counts them, the creature's own box is opened before them, and opening one of them starts
      no wait. An agent from before this keeps the boxes it had, as its own: its next turns up
      six hours after the last of them is opened, or after the first look where it had none.
      Treats are for nothing but the pleasure of it: there is always one to give, by carrying
      it onto the creature or pressing, and it opens its mouth, eats it in three bites and is
      pleased. All that is kept is how many it has had (`fed`), which decides the kind of the
      next. A treat that is carried is followed from the window and not from the button it was
      taken from.
      It was first built otherwise: a treat earned with every answer, four treats to a box. The
      owner found that "waaaaay too quickly" (2026-10-12) and asked first for one treat an hour
      at most, then, before that was merged, for "a new present every 12 hours ... they just
      show up there ... and you can have multiple ... The feeding is just a cute interaction
      ... maybe you have infinite snacks", and then "You can have max 1 present waiting at a
      time ... unless they are from sharing your dude, but otherwise max one". Chosen for them:
      that the wait runs from the opening of the last box and not from its turning up, so
      that two are never opened within the same wait. Twelve hours then felt "too slow" to
      them (2026-10-13) and they asked for six. A wait that was set when it was twelve is cut
      to six from the next look (`#boxDue`), so nobody is told of more hours than the whole
      wait; that cut was chosen for them. A phone app built before this still fills its box
      button over twelve hours. The browser tests set
      `DC_BOX_EVERY_MS` to a few seconds to see a box turn up; nothing else should set it.
      A box holds one thing to wear that the creature
      does not have yet: the rarity is drawn first (60, 25, 10, 4 and 1 in a hundred, among the
      rarities that still have something to find), then a thing of it. Every creature starts
      with one box waiting, as a welcome, including the agents from before this.
    - **Where it is kept.** In the agent's own store, as `CreatureDoc` (`packages/agent/src/docs.ts`):
      treats it has had, when the next box is due, boxes waiting, what it has, what it has on. The
      routes are `/creature`, `/creature/feed`, `/creature/open` and `/creature/outfit` on the
      actor, reached through the usual proxy, so anyone who can use the agent can do all four.
      What a box holds is decided there and not in the browser. The agent's summary carries
      `outfit`, so every drawing of it is dressed; an agent event `creature` says when any of it
      changed. The agent itself has no tool for any of this and is not told about it.
    - **The two hundred things** are named, placed and given a rarity in
      `packages/protocol/src/wardrobe.ts` (81 for the head, 40 for the eyes, 40 for the face, 39
      for the neck; 90 common, 58 uncommon, 36 rare, 12 epic, 4 legendary). Their shapes are in
      `packages/mascot/src/wardrobe.js` under the same ids, and a test holds the two lists to
      each other. To add one: a row in the first, an `item(...)` in the second. The second
      hundred were added on 2026-10-10 after the first, in both files, so that what a creature
      already has keeps its id and its place in the wardrobe. A thing thinner than about 0.035
      of the body's radius is less than a pixel at the size the creature is drawn, and is not
      seen.
    - **Fitting.** Every creature is grown from a seed, so nothing is placed by a fixed number.
      A stiff hat is open underneath and is lowered along its own axis until the head touches
      its underside. A soft thing (a beanie, a scarf, a beard) is made out of the skin itself,
      lifted a little, with a hole where a tail or an ear comes through. Ears in a small hat's
      way flop out sideways and are smaller for it; under a wide brim or a cap they lie flat, as
      a horn, a tuft or an antenna does, and all come back when the hat comes off. A last pass
      moves anything that still has a corner in the body straight out. `Wardrobe.audit(orb)`
      measures how far the deepest corner is inside the body; `apps/web/src/lib/wardrobe.test.ts`
      holds it at nothing for all two hundred things on sixty seeds.
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
      and its box at its top, so that is where it is looked after. A box opened there opens
      over the wardrobe, which is still open once the box is done with (it used to take the
      wardrobe's place, and closing it left the chat). A thing not found yet is a question mark
      in the color of its rarity.
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
    - **What the app shows** (`apps/web/src/components/chat/commands.tsx`), built on
      2026-10-09 after the owner saw the mock-up and said "Yeah the ui looks good go build!".
      The app has no rows for tool calls, so a command is shown as a sub-agent is. Where the
      agent left it running there is a chip in the transcript: the command, its computer, "in
      the background" and a clock, or "still going after a minute, now in the background" for
      one that was moved. Opened, it shows the end of what the command has printed, read
      again every four seconds, with Stop. Once the command has ended the chip says how, and
      what it printed is with the word of its end, further down. The running commands of a
      chat are listed in the agent's panel and from a count above the message box, each with
      its last line and Stop; a row opens the command in the chat. The agent reads "Waiting
      on a command" in its panel and "Waiting on pnpm build" in the sidebar. Jobs reach the
      page by `GET /jobs`, asked again when the agent's event stream says `jobs` changed.
    - **Where that differs from the mock-up:** the sidebar says what an agent is waiting on
      only for the agent on screen, since the list of agents does not know what the others
      are doing. A side chat has the chips and no count. On a phone there is no count and no
      list, as drawn. The Expo app shows a line where a command was left running and the
      word of its end, and nothing live. How long a command took is what its computer
      measured, not when the agent noticed.
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
      `run_in_background` when it should. The app's side was checked in a browser with the
      echo model and a real daemon (`e2e/computers.spec.ts`), and judged from screenshots at
      1440 and 390 pixels wide; not in Safari, not on a phone, and not against Daytona.
27. **A daemon that keeps itself up to date** (2026-10-09; `apps/daemon/src/update.ts`,
    `supervisor.ts`). A daemon was installed once and never changed, so a paired computer could
    not do what newer servers ask of it, as item 26 showed. The owner called that "a critical
    hole in the application" and asked for the daemon to update itself.
    - **How.** The server already said which daemon it serves (`/api/daemon-version`, a hash of
      its code); it now also says what the file at `/daemon.js` adds up to. A connected daemon
      asks when it connects, which is also when a deploy has dropped its connection, and every
      six hours. When the version is not its own it downloads the daemon, checks it against
      that sum, runs it with `--version` to see that it starts here and is what it was said
      to be, keeps the old file as `daemon.cjs.previous`, puts the new one in its place in one
      step, waits up to fifteen minutes for whatever the agent is doing there to end, and
      exits with code 75.
    - **The server can tell it to.** The owner asked next whether the server could send a
      signal, "like an agent needs a new capability". It sends an `update` frame, and a daemon
      that keeps itself up to date looks at once. The computer's link sends it when a daemon
      that is not the one served connects or is used (at most once a minute), when the
      Computers page lists one that is behind, and when something is asked of a daemon that
      it cannot do. In that last case the request waits up to twenty seconds for the daemon
      to come back as one that can, so the agent's call goes through instead of failing; a
      daemon that is not back in time, or does not update itself, is said to be so in words
      the agent passes on. Today the only such ability is `jobs`, which every daemon that
      updates itself already has, so the waiting is for whatever comes next.
    - **Two processes.** The daemon now runs as a supervisor and a worker. The supervisor only
      starts the worker again when it exits with 75, so the same thing happens under systemd,
      under launchd and in a terminal, and nothing about the service files changed. A worker
      that fails within thirty seconds of an update has the old daemon put back, and the
      version is written to `update.json` so it is not fetched again; a later version is.
      Commands left running in the background carry on across an update, as across any
      restart of the daemon.
    - **Switching it off.** `--no-auto-update`, remembered like `--read-only`, and
      `--auto-update` to switch it back. The Computers page says so beside the install command.
    - **What the app shows.** A daemon says `updates: true` when it connects. The Computers
      page says of a connected computer whose daemon is not the server's and does not update
      itself that the install command has to be run there again (`daemon` on
      `ComputerSummary`).
    - **Daemons from before this** cannot update themselves. The owner asked whether there
      was something to run "to make sure they all get updated", so the Computers page has an
      Update button on a connected computer whose daemon is out of date
      (`POST /api/computers/:id/update`, `apps/web/src/server/daemon-reinstall.ts`). For one
      that keeps itself up to date it sends the `update` frame. For an old one it sends a
      command through the daemon's own way of running commands: find the daemon that is
      running this, download the served one, see that it starts and is the right version,
      keep the old file, swap, and start the new daemon a second later. The new one
      connecting is what ends the old one, since a computer has one connection; under a
      service manager the service then starts again from the new file and takes over. Only
      whoever may remove the computer can press it, and not for a read-only computer, which
      runs nothing it is sent: there the install command has to be run by hand.
    - **Mine, not the owner's:** that it is on by default, including on a read-only computer,
      where it lets whoever runs the server run code that the agent cannot. The server
      already gave that computer the daemon it runs; the owner has not been asked.
    - **Checked:** the updater and the supervisor in `apps/daemon/test/update.test.ts`. With
      the built server and a real daemon on this machine: an older build paired, downloaded
      the server's, and was running as it a tenth of a second later, and the agent ran a
      command through it; and with a server whose daemon could not start, the old one was
      put back, reconnected, and did not fetch that version again; and a build that never
      asks by itself updated the moment it connected, which only the server's frame can
      have caused. The Update button was pressed in a browser on a daemon built from the
      commit before item 26, which then ran a command in the background; the same was done
      through the route for one started plainly and one under a loop that starts it again
      whenever it ends, as a service manager does. The waiting for an ability is checked in
      `packages/computers/test/computers.test.ts` with a stand-in for the daemon coming
      back. **Not checked:** macOS or
      launchd, a daemon run by systemd, a deploy to Cloudflare dropping a live connection
      (which is what makes the check prompt), and an update while a command was being
      waited for.

28. **Signing a workspace in to model providers** (2026-10-09; `packages/agent/src/model-access.ts`,
    `model-providers.ts`, `apps/web/src/server/model-access.ts`, `prototypes/model-sign-in`).
    Every model call was paid from the deployment's one OpenRouter key. The owner asked for
    "all of the different login methods for pi", and said the main thing was "log-in with codex
    and claude". Built on the server first, then the screens, as drawn in the mock-up. The
    owner was shown the mock-up and did not say it was right before the screens were built.
    - **What pi has.** pi-ai 1.1.0 gives each provider its own sign-in: a key typed in, or the
      provider's own flow for a subscription (Claude Pro/Max, ChatGPT for OpenAI and for Codex,
      GitHub Copilot, xAI, Kimi, Meta, OpenRouter). A flow is a function that asks questions
      and says things (`AuthInteraction`: a page to open, a code to enter there, a code to
      paste), written for a terminal. Nothing here re-implements one: the app hosts them.
    - **One actor per workspace** (`createModelAccessActor`, the `MODEL_ACCESS` Durable Object,
      migration `v6`; `model-access/` under the data directory on Node), named by the
      workspace's id. It keeps the credentials (`dc_model_credentials` in its own database),
      runs a sign-in in memory while someone is doing it, and hands a credential to the
      workspace's agents. A sign-in under way is lost if the actor is unloaded, and is started
      again; the app asks for it with `?rev=&wait=`, which holds the request until something
      changes and so keeps the actor loaded.
    - **A token is exchanged in one place.** A subscription's token runs out and is exchanged
      for a new one, and a provider that sees the old one used twice may sign the account out.
      So agents never exchange one: an agent's `Models` reads through `workspaceCredentials`,
      and the workspace's actor exchanges a token with less than ten minutes left before
      handing it over, one exchange at a time. pi's own `modify`, which is how it would
      exchange one itself, is answered with what the workspace keeps.
    - **Which providers.** Every one pi has (39), less three: Amazon Bedrock and Google Vertex
      sign in with files and roles of the server's own machine, and Radius by a page that has
      to reach the server on its own address. Anthropic's sign-in asks how, and the way that
      ends on a page showing a code is chosen for the person (`CHOSEN`), since the other ends
      at an address on the server. OpenAI's two ways are both offered.
    - **What an agent can run on** is the deployment's models and those of the providers its
      workspace is signed in to (`workspaceModels` on the actor's options; `GET
/api/models?workspaceId=`). A sign-in in a workspace takes the deployment's place for
      that provider there: a workspace signed in to OpenRouter spends on its own account.
      A new agent starts on its maker's default where the workspace offers it, and otherwise
      on the workspace's: the deployment's, or the first suggested model of a sign-in where
      the deployment has only its echo. An agent moved to a workspace that does not offer its
      model is set to that workspace's.
    - **Who may.** Anyone in a workspace can sign it in, and only they can read or answer
      their own sign-in. Whoever signed in, or an admin, can sign out. Someone who leaves a
      team, or is taken out, takes their sign-ins with them. A credential is never sent to a
      browser, and the gateway has no route to the one address that returns one.
    - **When it is gone.** An agent set to a model of a provider its workspace is not signed
      in to gets a failed reply that says so (`signIn` in `chat-error.ts`).
    - **The screens** (`apps/web/src/components/settings/models.tsx`). A Models section in the
      workspace's settings lists the deployment's own models and the providers, the seven most
      asked for first and the rest behind one line. The sign-in window draws whatever the
      sign-in is at (a choice, a page to open, a code to enter there, something to type), so a
      provider pi adds needs nothing new here; only the two ways OpenAI offers are given words
      of their own (`WAYS`). The model picker puts models under where they come from once
      there is more than one place, and a model on a subscription says so in place of a
      price (`signIn` on `ModelOption`). A reply that failed because the sign-in is gone has
      "Sign in again" and "Pick another model".
    - **Where the app differs from the mock-up:** a provider's mark is its first letter on
      grey, not in its own color; the code to enter at OpenAI has no countdown; the two ways
      of signing in to ChatGPT are chosen between first and "Choose another way" goes back,
      where the mock-up switched between them in place; a model group is named "Anthropic
      subscription", not "Claude subscription".
    - **Not built:** signing in from the Expo app, which only lists what it is given. Web
      search, the judge and dictation still run on the deployment's OpenRouter key and are
      absent without it. A sign-in that has run out is not marked in the Models section
      until an agent fails on it.
    - **pi-claude-bridge** (the owner asked whether it could be supported) cannot be loaded.
      It is an extension for the pi coding agent, which this app does not run, and it works by
      starting Claude Code as a process on the same machine with the login in `~/.claude`.
      A Worker cannot start a process, and a server shared by many people has no one `~/.claude`.
      What it buys is that use counts as Claude Code's own; signing in to Anthropic through pi,
      which is what is built, is the other way, and the owner said that was acceptable.
    - **Mine, not the owner's:** that a sign-in belongs to a workspace and not to a person or
      to one agent; who may sign out; that leaving takes a sign-in along; the three providers
      left out; the models suggested first for each provider.

29. **A desktop app that is also the daemon** (2026-10-09; `apps/desktop`,
    `apps/daemon/src/events.ts`, `packages/computers/src/shell.ts`, `paths.ts`, `kill.ts`,
    `.github/workflows/desktop.yml`). The owner asked for "an electron app that can stay
    running and the background and also work as the daemon for you agents", as "a ui around
    the app to use it from you desktop (it can just hit the main server)", on "mac, windows,
    and linux". They gave no design; the choices below are mine.
    - **The window is the deployment.** The app's main window loads the server's own pages,
      so there is no second user interface. Links that lead off the deployment open in the
      browser; signing in with GitHub and connectors' sign-ins stay in the window, since they
      come back to it. A page of the deployment is given nothing of the app: the script every
      window has (`preload.ts`) hands its few calls only to pages that are files of the app,
      and the app checks who is asking as well (`own` in `main.ts`).
    - **The app's own pages** are three files (`src/pages`): choosing the server on a first
      run, **This Computer** (whether agents can use it, the code while a pairing waits,
      read-only, opening at sign-in, what the daemon did), and one for when the server cannot
      be reached. Closing a window hides it; the tray menu, or starting the app again, brings
      it back, and Quit in the tray ends the app.
    - **The daemon is the same daemon**, not a part of the app. The app copies the bundle it
      came with into its own folder (`<app data>/daemon/bin/daemon.cjs`) and runs it as a
      process, with the app's own executable as Node (`ELECTRON_RUN_AS_NODE`). A process of
      its own is what lets it go on replacing itself from the server (item 27); built into
      the app it would be stuck at the app's version, and the server would call it old. The
      file is written again only when a newer app brings a different one (`seedDaemon`).
    - **What the daemon learned for it** (`DC_DAEMON_EMBEDDED=1`): it also prints how things
      stand as lines that start `@dc-event ` (`events.ts`), which the app folds into what it
      shows (`status.ts`); it exits when its input closes, which is how the app stops it and
      what happens if the app dies; and it takes `ELECTRON_RUN_AS_NODE`, with its own
      settings, out of the environment agents' commands inherit, putting it back only to try
      a downloaded daemon. Without that last one an Electron app an agent started would run
      as Node.
    - **Pairing without a link to copy.** When its owner says agents may use the computer,
      the app waits until the window is signed in and the account has an agent (it asks
      `/api/agents` with the window's own session) and then shows the page the daemon is
      waiting at. A new account has no agent until the page it lands on has made one, and the
      page that confirms a pairing is where the agents are chosen: shown too soon, it offers
      none. A run on a macOS machine showed that. Started at sign-in with a
      pairing left unfinished, it does not push that page forward; This Computer has a
      button for it.
    - **Its own computer.** The app's daemon keeps its credentials in the app's folder, not
      `~/.durable-computer`, so it cannot fight a daemon installed by hand for the same
      connection. A machine with both is two computers.
    - **Commands get the PATH of a terminal.** An app started from the dock has a bare PATH;
      the app asks the owner's login shell for theirs once and gives that to the daemon
      (`login-path.ts`).
    - **Windows.** The daemon had never run there. Commands go to Git for Windows' bash when
      it is installed, never to `bash` from the PATH, which is WSL's; otherwise to PowerShell,
      with the failed program's exit code put back. The server reads every path as a POSIX
      one (`resolvePosix`), so a Windows daemon shows its home as `/c/Users/ada` and reads
      such paths back (`paths.ts`). A command's tree is stopped with `taskkill /T /F`, since
      there are no process groups. A background command is not started apart from the daemon
      there: a process with no console prints nothing, in bash or PowerShell, which the first
      run on a Windows machine showed. Under Git's bash the script around a job writes which
      Windows process it is, and that one outlives the daemon; under PowerShell a job ends
      with the daemon. Agents are told what a Windows computer is like (`WINDOWS_NOTE` in
      `packages/agent/src/computers.ts`).
    - **Packing** is electron-builder's (`electron-builder.yml`): a universal `.dmg`, an NSIS
      installer and an AppImage. `DC_DESKTOP_SERVER` at build time is the deployment
      the app opens without asking; the workflow passes the repository's `DC_BASE_URL`, so
      nothing about do.computer is in a tracked file. A tag named `desktop-v` and a version makes a
      release of that version, published once the app has passed on all three systems. The
      owner asked for releases after finding there were none ("Can we add releases for these
      that would be great"); the first, `desktop-v0.1.0`, was made on 2026-10-09.
    - **Checked:** `apps/desktop/e2e/desktop.spec.ts` starts the app itself against the built
      Node server: a first run, a wrong address, signing up, the page to confirm on appearing
      by itself, an agent running a command on the machine with the window closed, that
      command not being told it is inside an Electron app, switching sharing off and on,
      quitting ending the daemon, starting again connecting without asking, and the daemon
      replacing itself with the server's newer one from inside the app. The `Desktop`
      workflow runs that on Linux, macOS and Windows, against the build and again against
      the packed app, along with `packages/computers/test/windows.test.ts`, which runs
      commands, files and background commands through the daemon's own code on each system,
      in Git's bash and in PowerShell on Windows. Here it runs under `xvfb-run -a`.
      **Not checked:** anything on a real desktop. Nobody has seen the tray, opened the
      `.dmg` or the installer, been warned about an unsigned app, or had the app start at
      sign-in. A daemon restarting under a running background command has not been tried on
      Windows, nor has the app against do.computer.
    - **Signing (2026-10-10).** The Mac's app is signed with the owner's Developer ID
      and checked by Apple, where the repository has the secrets `CSC_LINK`,
      `CSC_KEY_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`, which
      it now has. Why: an app signed by nobody is another app to macOS with every build, so
      a Mac refused Accessibility and Screen Recording to 0.3.1 while System
      Settings showed both on, granted to 0.2.0 (`tccd` logs "Failed to match existing code
      requirement"). `electron-builder.yml` is the signed app (hardened runtime,
      `assets/entitlements.mac.plist`); `electron-builder.unsigned.yml` extends it for a pack
      with no certificate, which is what `pnpm package` and a repository without the secrets
      make. The workflow puts the certificate in a keychain of its own and points the packing
      at it (`CSC_KEYCHAIN`): electron-builder 26.15.3 given `CSC_LINK` hands macOS the
      certificate's password for the keychain's, which macOS 26 refuses. Apple is asked for a
      release and for a run from the Actions tab, not for a push to main. A run from the
      Actions tab on the branch signed, was checked by Apple and passed the packed app's
      tests, the driver's among them, and that build was installed on a Mac.
      **Mine, not the owner's:** asking Apple only then; no `disable-library-validation`,
      which the unsigned app had from electron-builder's defaults; the Apple Events
      entitlement, for `osascript` in an agent's command. **Never run:** whether the two
      permissions are kept from one signed version to the next, which is the point of it; an
      agent's `osascript` under the stricter rules; a signed release from a tag.
    - **Not built:** a signature Windows would recognise, so Windows warns before opening
      it; the app updating itself; a link to the app from the web app; a way to remove the
      computer from the app's own window (it is removed under Computers, and the app notices);
      changing read-only after pairing other than by tightening it.
    - **Mine, not the owner's:** all of the above, and in particular that the window loads
      the server and is not a client of its own; that sharing the computer and opening at
      sign-in are both ticked on the first screen; that the app's daemon is a separate
      computer from a hand-installed one; PowerShell as the fallback on Windows. No mock-up
      was shown first, against the usual habit: the only new screens are the three small
      pages, and the owner was sent pictures of them as built.

30. **Chats that know about each other** (2026-10-09; `packages/agent/src/journal.ts`,
    `history.ts`, `persona.ts`). The owner noticed that "different threads can kind of lose
    context for the same agent", asked what OpenClaw and Hermes Agent do (both were cloned and
    read), and said of five recommendations "lets try all of these". Until then a chat was given
    the agent's two stores of notes and nothing else, the notes were written only when the model
    thought to, and the `history` tool walked whole transcripts and gave up after 10,000 entries.
    - **What the other chats have been about** is a section of the prompt, `recent`, in every
      chat but a sub-agent's, Slack threads included (the owner was asked, and said they should
      see it). It is read from one document, `dc.journal`: for each chat a note of where it
      stands, and a list of finished work. It shows the six most recent notes and the ten most
      recent pieces of work from the other chats, each with its chat's id, so the agent can read
      the chat with `history`. pi-durable sends a section again only when it changed, so it
      costs a request little.
    - **Finished work** is what the agent writes up with the `log` tool, which now also adds to
      the journal, and what a scheduled run reported. A schedule keeps one entry, its latest.
    - **Where a chat stands** is written by a small model (`DC_REVIEW_MODEL`; default: the one
      that reads web searches) each time the agent comes to rest in a chat, before a compaction,
      and before "Start fresh". It is given the note as it stands, what is remembered, and what
      was said since, and rewrites the note in at most 60 words. It is never waited for, and a
      failed one is made up the next time, from the same place. The same answer may add one
      lasting fact to each store of notes, where it was said by a person, in the app or in Slack, and
      not saved. It only adds: what the agent keeps is never removed or rewritten for it. What
      it costs is in the agent's usage. With no OpenRouter key on the deployment there is no
      small model, and the other chats are shown the finished work only.
    - **A side chat branches off the main chat** (`#branchChat` in `actor.ts`). It is a
      pi-durable fork at the main chat's last entry, or at the agent's last finished answer
      while it is working there, so the agent arrives with the main chat in front of it. Its
      chat record has `fork: { chatId, at }`. What it carries is not shown as its own: the
      transcript, the earlier pages and the search begin after `at`, at a `dc.branch` entry
      shown as "Continues from the main chat". With nothing answered there yet, a side chat
      starts empty. It used to start empty past 60,000 tokens of main chat too, which in a main
      chat in long use was most of the time: item 75 is what it does now.
    - **Searching** reads a table, `dc_history` in the agent's own database, holding the words of
      every message and nothing else. It is filled when a search is made, from where it left
      off in each chat, 10,000 entries at a time, so an agent's whole past is reachable and a
      first search of a long one says it is not complete yet. Matching is as it was (every
      word, else the messages with the most of the telling ones). For the agent, sub-agents'
      chats are left out and scheduled runs' matches come last; the app's own search has both.
      The tool gained `list`: the twenty most recent chats, each with its note.
    - **The notes are larger:** 6,000 characters of the agent's own and 4,000 about its people,
      up from 2,200 and 1,375. Each store is shown with how full it is.
    - **Mine, not the owner's:** every number above; that the small model writes notes after
      every answer and not every few; that it may add to the notes at all, and not from a
      conversation with another agent (from Slack it may: the owner said "assume that if it is
      in slack it is trusted"); that sub-agents and scheduled runs get no note; that a side chat always
      branches where it can, with no way to ask for an empty one but "Start fresh" in it; that
      nothing in the main chat marks that a side chat left it.
    - **Never run:** the note-writing against a real model in Slack or in a team; anything of
      this on a deployed Worker; the native app showing a branched side chat.

31. **Agents that use a screen and a browser** (2026-10-09; `packages/protocol/src/screen.ts`,
    `packages/agent/src/uses.ts`, `packages/computers/src/use.ts` and `browser/`,
    `apps/desktop/src/screen.ts`, `screen-driver.ts`, `overlay.ts`,
    `apps/web/src/components/chat/uses.tsx`). The owner asked for the daemon and the desktop
    app to have Cua (`trycua/cua`) "to control your computer", with "a little window of the
    agent controlling it" in the chat and the agent seen to "move around your computer like it
    is the mouse", and the same for a browser, pointing at their own dev-browser and at how bb
    uses it. It was drawn first (`prototypes/computer-use`), and they answered the four things
    put to them: the pointer has the agent's name; the screen is off until switched on, on the
    computer; the agent uses "your own" browser "if availible"; and the screen is the desktop
    app's first.
    - **Two tools**, `screen` and `browser`, each taking the `computer` argument the file tools
      take, and only for somebody's own computer. `screen` does one thing to a call
      (screenshot, click, double and right click, move, drag, scroll, type, key, wait) and
      answers with a picture of the screen afterwards; places are in that picture's pixels.
      `browser` runs a dev-browser script and answers with what it printed and the pictures it
      took. Each call carries a `note`, a few words for whoever watches. The calls of one round
      start together and are done one after another. A model that cannot see pictures is
      refused the screen and told so; the echo model may use it, so it can be tried. The model
      is sent only the newest four pictures of a screen or a page (`dropOldPictures`, a hook
      before every request): each costs about a page of text.
    - **On the wire** there are two new frames to the daemon, `screen` (`act`, `view`, `hold`)
      and `browser` (`run`, `view`, `hold`, `close`), both answered by `use_result`, and a new
      error code, `refused`, for what the owner has off or stopped. A daemon says `screen` and
      `browser` in its hello. One that says neither is from before, and is told to update as
      for background commands. One that says no answers for itself why not.
    - **Who is using it** is one small class for both, `UseState`: in use from the first thing
      done until 45 seconds after the last; paused by its owner, when the agent waits where it
      is, for five minutes at most; stopped by its owner, when what the agent is doing fails
      and so does what it tries for the next minute.
    - **The screen is the app's, not the daemon's.** The daemon is plain Node. One the app runs
      is told so (`DC_DAEMON_SCREEN=1`) and asks the app, a line to a call (`@dc-call`, in
      `apps/daemon/src/events.ts`), which the app answers on the daemon's input. In the app's
      main process `ScreenService` does it with Cua Driver, `@trycua/cua-driver` 0.34.1, loaded
      from `dist/driver` and, packed, from `resources/driver`, outside the one file the app is
      packed into. Cua's own cursor is switched off: the app draws the pointer. The driver's
      pictures are PNG, and are made JPEG by Electron. A daemon run by hand says it has no
      screen for agents, and `DC_DAEMON_FAKE_SCREEN=1` gives it a pretend one for tests.
    - **On the computer itself** the app draws over everything else (`overlay.ts`): the agent's
      pointer in its colour with its name, a bar saying who is using the computer and what they
      are doing, with Pause and Stop, and a glow round the screen. Esc pauses, and is taken
      only while an agent is at work and not pressing keys itself. The overlay is kept out of
      pictures of the screen on macOS and Windows. On Linux it cannot be, so there it is in
      what the agent sees and what the chat shows, and its buttons cannot be clicked: Esc and
      the chat are the ways to pause.
    - **The switches** are in the app, under This Computer: the screen (off to begin with) and a
      browser (on). They are kept in the app's settings on that computer, and changing one
      starts the daemon again so that it says so. A computer that is read-only has neither. On
      macOS the page says whether the app has been allowed Accessibility and Screen Recording,
      and leads to each. A daemon run by hand takes `--no-browser`.
    - **The browser** is the daemon's (`packages/computers/src/browser`), ported from bb's
      plugin. It fetches a pinned dev-browser the first time. It uses the owner's own Chrome
      when it finds one that lets itself be used: a `DevToolsActivePort` file in a usual
      profile folder, which Chrome 144 writes when remote debugging is allowed at
      `chrome://inspect`, or a debugging port from 9222 to 9229. Otherwise it starts a headless
      Chrome of its own, with a profile kept in the daemon's folder.
    - **Watching** is asked of the computer and never kept: `GET /api/agents/:id/use/view`
      waits up to five seconds for a picture newer than the last, and answers with nothing for
      a screen no agent is using, of which no picture is taken. The app asks a few times a
      second while the window is on screen. `POST …/use/hold` pauses. The picture each call
      ended with is kept, in the agent's own blobs under `shots/`, and served by
      `GET …/shots/:id`; that is what "What it did" shows afterwards. They are removed with the
      agent and not before.
    - **In the chat** (`uses.tsx`, `use-live-view.ts`, `chatUses` in
      `packages/protocol/src/activity.ts`) a use is the `screen` calls, or the `browser` calls,
      on one computer within one turn, whatever the agent says between them. It is one window
      where the first of them is: the picture as it is now, the agent's pointer drawn over it
      from where the computer says it is, and a line for what it is doing, with Pause, Open
      large and Stop. Stop is the chat's own. The agent's panel has the same small, under "On
      (computer) now". One question is asked of each computer for all of them, only while one
      is on screen in a tab that is looked at. A use counts as going while a step is, or the
      chat is busy and only words have followed it; the last one of a chat is also shown for
      as long as the computer says it is still in use. Afterwards it is one line, "(agent) used
      (computer)'s screen for 1m 12s · 8 steps", and "What it did" has each step's picture.
    - **Approvals** have a rule for each ("Use a computer's screen", "Use a browser on a
      computer"), and both answer to a computer's own rule.
    - **Mine, not the owner's:** every number above (45 seconds, five minutes, a minute, four
      pictures, 1280 pixels, a picture every 400 ms); that the app draws the pointer and Cua's
      own is off; that Esc pauses; that the browser kept for agents is headless; that the
      owner's Chrome is used with no switch of its own beyond the browser's, since Chrome asks
      for itself; that read-only means neither; that the kept pictures are never tidied away;
      that the mobile app shows none of this; that whoever can read an agent's chats can watch
      a screen while that agent uses it, a teammate included; that dev-browser is pinned at 1.0.0-rc.3 and
      fetched from its GitHub release, checked against hashes written in the code.
    - **Checked on GitHub's machines** (pull request #39, and a run of the `Desktop` workflow
      on the branch from the Actions tab, which is how a branch is tried on macOS): on macOS,
      Windows and Linux the app is packed with the driver beside it, on a Mac for both kinds of
      chip, the other fetched with `npm pack`; the packed Mac app is sealed; and the real
      driver loads from beside the packed app and says how large the screen is
      (`e2e/driver.spec.ts`). The overlay's window is made on all three, and the app answers a
      real daemon's call for a pretended screen.
    - **Never run:** an agent using a real screen on macOS or Windows: a click, a key, a
      picture taken there; the two macOS permissions (an unsigned app loses them with every
      build: see Signing under the desktop app);
      how the overlay looks on a real desktop, its clicks, its being kept out of pictures, and
      Esc. The screen with a real model. The owner's own Chrome through Chrome 144's switch
      (since run, and found to ask far more than twice: item 72). The browser on
      macOS. dev-browser has no Windows build, so on Windows the browser tool says so. On a
      Linux machine: the driver in Electron under Xvfb clicked, typed, scrolled and
      dragged in a real window; the browser ran for real through a built server and a real
      daemon, fetching dev-browser and a Chrome by itself.
    - **Learned the hard way:** an effect that hands React what `scrollIntoView` answered
      crashes on a newer Chrome, which answers with a promise that React then calls on the way
      out. The Chromium this was built with is older and did not show it; CI's did.

32. **A page that cannot start says so** (2026-10-09; `apps/web/src/lib/boot.ts`,
    `components/page-error.tsx`, `routes/_app.index.tsx`). The owner reported that the desktop
    app "sometimes gets stuck loading", with a picture of the frame of placeholders and nothing
    in it. It was not reproduced (see section 7). What was found is that the frame had three
    things to wait for, none with an end:
    - **The app's own address no longer waits for the list of agents.** The desktop app starts
      there every time. `GET /api/agents` asks every agent's object what it is and answers
      when the slowest has: 0.6 to 1.5 s on do.computer against 0.15 to 0.25 s for
      `/api/me`. The agent that was open last is now gone to without the list. One that turns
      out to be gone is forgotten by its page, which sends the visitor back to the address,
      where the list is then asked for.
    - **Who is signed in, and the list of agents, are waited for fifteen seconds**
      (`patience` in `lib/client.ts`), then asked once more, as any failed query is. After
      that the page says "This could not be loaded" with Try again, which loads it afresh.
      That is the router's `defaultErrorComponent` now, in place of the framework's own, so a
      page whose code is no longer on the server, as after a deploy, says the same.
    - **Scripts that do not arrive** (`BOOT_GUARD_SCRIPT`, in the head before anything else):
      the page loads itself again after 0.3, 3 and 10 seconds, counted in `sessionStorage`
      and forgotten once the app has started, and after that puts up a button that says it
      did not load. Only scripts under `/assets/` count.
    - **Mine, not the owner's:** all of it, the numbers included. The desktop app itself is
      unchanged, since its window shows the deployment's pages; no release was needed.
    - **Not done:** the list of agents still waits for every agent. One that never answers
      leaves the sidebar's rows as placeholders for fifteen seconds and then failed.

33. **Creatures that went blank** (2026-10-09; `apps/web/src/components/agent-avatar.tsx`,
    `packages/mascot/src/orb-core.js`). The owner asked whether "the 3d renders disappear"
    because of too many WebGL contexts. It is not that: every creature on a page is drawn by
    one context (`Stage`), and each has a 2D canvas that takes a copy. Two things did blank
    them, and both are reproduced by a test in `e2e/agents.spec.ts`:
    - **A still picture was held before it was drawn.** A still (the one above the chat, in
      menus and lists, in the wardrobe) is let move for 350 ms and then paused. The loop that
      moves it draws nothing in a window that is not showing or of a canvas off the screen,
      so a page opened behind another, or in the desktop app's closed window, held a blank
      for good. It is now drawn as it is paused.
    - **A context the browser took away wiped every creature**, each frame, by copying from
      it. The copy is now left out while the context is lost, so the last picture stays. A
      context that has not come back in three seconds is let go of and another asked for, at
      most every three seconds.
    - **Not done:** the context is still let go of whenever the last creature leaves the page
      and made again for the next, which is a new context for most moves between pages. That
      costs time, not pictures.
    - **What the Mac had recorded** (read the next day): macOS restarted the
      GPU five times on 2026-10-09 with the app's GPU process named as the cause
      (`/Library/Logs/DiagnosticReports/gpuEvent-Do Computer Help-*.ips`, "MMU interrupt"),
      each within a minute of the app starting, and Chrome's on other days. Each restart
      takes the context away, which is the second of the two. Why the GPU faults is not
      known: it is macOS 27.0.1 with Electron 44, and one fault came 0.3 s after "Metal
      Compiling Shader" in the GPU process.

34. **Who is signed in is never waited for for good** (2026-10-10;
    `apps/web/src/server/auth-guard.ts`, `server/auth.ts`). This is what the stuck frame of
    item 32 was, found the day after by asking do.computer with curl: on about a quarter of
    new connections every request that checks who is signed in (`/api/me`, `/api/agents`,
    `/api/settings`, with no cookie at all) never answered, while `/api/health` and
    `/api/auth-methods` on the same connection answered at once. In `wrangler tail` each
    showed as `canceled` with 0 ms of CPU and the wall time the client waited. A connection
    stays with one isolate, so an app on a bad one stayed stuck however often it was started.
    - **The cause** is in Better Auth (1.7.7, `@better-auth/core/dist/async_hooks`): it keeps
      the promise of `import("node:async_hooks")` for the life of the process and waits on it
      in every call until its three stores are made. On Workers that promise is never settled
      if the request that was running when it started goes away first. The same is described
      at zenn.dev/coji/articles/cloudflare-workers-better-auth-hanging-promise, which names
      better-auth issue 10315. The app's own `getAuth` kept a promise the same way until
      2026-10-08 (pull request #25); this one is the library's.
    - **That was not the promise, or not the only one.** After it was deployed the same
      check still found isolates that did not answer, and the log said the second try, of a
      new instance, did. So the promise is kept on the instance: Better Auth compares the
      tables with what it expects when an instance is first used, once, and every
      `auth.api` call waits for that one comparison (`createSchemaCheck` in
      `@better-auth/core/dist/db/schema-check.mjs`, awaited in
      `better-auth/dist/api/to-auth-endpoints.mjs`). A page abandons one of its requests a
      quarter of a second after it loads, and when that is the request the comparison was
      started in, it is never finished. It is switched off
      (`advanced.database.validateSchema: false`, `NO_SHARED_SCHEMA_CHECK`): the tables are
      brought up to date before an instance is made. Two tests say that the library still
      keeps one promise by default, and that the app's instance has none.
    - **The stores are made as the module loads** (`seedAuthStores`), from an import nothing
      waits for, on Better Auth's shared object (`Symbol.for("better-auth:global")`). A test
      makes a real call and fails if the library has a store that was not made for it, which
      is what an upgrade that adds one would do.
    - **`getUser` waits five seconds**, then lets go of the instance and asks a new one, and
      after five more fails the request. It logs `[auth] no answer…` each time, which is what
      to look for in the live logs if the frame is ever stuck again.
    - **Not reproduced on this machine**: `wrangler dev` starts the Worker before any request
      and passes on no cancellation. The only proof is the live site: ask `/api/health` and
      then `/api/me` over one connection, a dozen times, each with a few seconds' limit.
      Before any of this 12 of 42 connections did not answer; with the stores and the
      second try, 5 of 50 took five seconds; with the comparison switched off, 70 of 70
      answered at once, 40 of them after 200 requests had been abandoned 5 to 300 ms in,
      and the live log had no `[auth]` line.
    - **Mine, not the owner's:** the five seconds and the second try.

35. **Clients that catch up after a lost stream** (2026-10-10; `packages/client/src/index.ts`,
    `apps/web/src/lib/collections.ts`, `packages/agent/src/actor.ts`). The owner: "when I have
    multiple clients connected to the same do computer chat they can get out of sync. For
    example when requesting a secret form and submitting on one it will stay open on the
    others", and asked for a fix that is not only for that form.
    - **With both clients connected it already worked**, for every document of an agent: the
      agent's event stream says which changed and the page asks for it again. Two browsers
      on one chat show a secrets form and an approval closing on the other
      (`e2e/two-clients.spec.ts`).
    - **A client whose stream had been down missed whatever changed meanwhile**, and nothing
      asked again until the page was loaded again. The stream's first event on every
      connection is `ready`; the page now asks again for all it has of the agent when it hears
      one (`catchUpAgent`), the first time too: a page that opens as something changes has
      asked too soon to see it and too late to be told, which a test on a slow machine
      showed. What is still on its way is let arrive first. The mobile app does the same on a
      reconnect.
    - **A stream that had died without ending was never noticed.** The server sends a
      heartbeat every 15 seconds; a stream that says nothing for 45 is now given up and asked
      for again, one that was never answered included. That last is what an isolate stuck as
      in item 34 does to a client, which is the likeliest way the owner's clients fell out
      of step, though that is a guess.
    - **One list** (`TOLD` in the actor) says which documents are made up front and told of,
      and a `what` a client has no name for makes it ask for everything of the agent.
    - **Still not told to other clients:** an agent's usage total; anything of the workspace
      or the account (agents made or deleted, members, model sign-ins, settings), for which
      there is no stream.
    - **Mine, not the owner's:** the 45 seconds; asking for everything again on a reconnect
      in place of the server replaying what was missed.
    - **Never run:** on Workers, in the desktop app, on a phone; the watch on silence against
      a connection that really died (only with a clock the test moves).

36. **A route that waits for the list of agents asks again when the request is cancelled**
    (2026-10-10; `listedAgents` in `apps/web/src/lib/collections.ts`). The run on main after
    pull request #44 failed in `teams.spec.ts`, "a team is started from the workspace menu":
    the team's page said "This could not be loaded: CancelledError". The route waits for the
    list before it shows anything, the sidebar shows the same list, and a request that is
    let go of while it is on its way is given up for everyone waiting on it. It is asked for
    again, up to five times. Both routes that wait for the list do this (the app's own
    address and a team's).
    - **Not reproduced here**, with every core busy; GitHub's machines have two. What let go
      of the request was not found. The page's own words in the failed run's artifact are
      what this rests on, and a test that cancels the request the same way.
    - **Two runs on main failed in a row** after thirty-five that had not, both in a browser
      test that waits five seconds: the one before in a test of two clients (item 35's gap).
      A failed run skips the deploy. `gh run rerun <id> --failed` runs the failed job again.

37. **Creatures come back after the graphics card's process dies** (2026-10-10;
    `packages/mascot/src/orb-core.js`, `apps/web/src/components/agent-avatar.tsx`,
    `apps/desktop/src/main.ts`). The owner asked for the GPU restarts on their Mac (item 33)
    to be fixed. What makes the card fault was not found. What the app does about it was
    found wanting twice over, on that Mac, by killing the GPU process of a second copy of the
    installed app (its own folder, `--remote-debugging-port`, a test server on another
    machine, driven from here with Playwright over CDP):
    - **After one death, every creature stayed blank for good**, item 33's change
      notwithstanding. The browser gives the WebGL context back within a second, and every
      2D canvas too, wiped. three (r128) then makes every draw call and draws nothing. So a
      renderer of the stage's own that has lost its context once is let go of and another
      made, and a creature held still is drawn again once its canvas is back (`owed`). On
      the Mac: blank for good before, drawn again within 1.5 s after.
    - **After two deaths in a few seconds, Chromium refuses WebGL to the page** for as long
      as the app runs. Chrome puts up a bar that offers to load the page again; Electron puts
      up nothing. The app now calls `app.disableDomainBlockingFor3DAPIs()`. On the Mac, with
      the same thing as a switch (`--disable-domain-blocking-for-3d-apis`): refused for good
      before, drawn again within 1.5 s after. Where it is still refused, as in an app that
      has not been updated, the still picture stands in after a second or so.
    - **What was tried to find the fault, and did not:** the creature's own page with freshly
      compiled shaders, every state and every reaction (five runs in Chrome 154, four in the
      app's Electron 44); all hundred things to wear; the box opened five times over; the
      real pages from signing up through chatting, a treat, the box, the wardrobe and typing
      (twice). Once in those, as the box's window opened, the GPU process died twice in two
      seconds with no report from macOS. The same steps again did not do it.
    - **Checked here:** a browser test kills the browser's GPU process and fails without the
      change (`e2e/agents.spec.ts`). A desktop test kills the app's twice and fails without
      the app's call (`apps/desktop/e2e/graphics.spec.ts`). It starts an app of its own that
      draws 3D in software, since the other tests' app is started with no GPU at all and so
      has no 3D to lose, on GitHub's Mac included.
    - **The desktop app has to be released again** for its half: `desktop-v0.3.0`.

38. **The browser an agent uses is in a window, unless its workspace says otherwise**
    (2026-10-10; `packages/computers/src/browser`, `apps/web/src/server/teams.ts`,
    `components/settings/computers.tsx`). The owner: "Would it be possible to start the
    browsers that do computer controls on your computer headed so you can see them", and
    while it was being built, "the browser being visible be default should be a toggle on and
    off in your workspace settings".
    - **The choice is the workspace's**, on until someone there switches it off: Workspace
      settings, Computers, "Show the browser agents use". It is kept in a table of its own
      (`dc_workspace_settings`, since a personal workspace has no row with the teams), read
      and changed at `/api/workspaces/:id/settings`, by a team's admins and by the owner of a
      personal workspace. A member sees it and cannot change it.
    - **It travels with each use of the browser**: the agent asks its host what its workspace
      has chosen (`showsBrowser`, from `browser-directory.ts`, on both servers) and sends
      `shown` on the daemon's `browser` frame. So nothing is kept anywhere that can go stale,
      a change holds from the next use, an older daemon ignores it, and the desktop app
      needed no release.
    - **On the computer** the browser kept for agents is started without `--headless` when
      asked to be shown, and is closed and started again, with its profile, when it is
      asked for the other way than it is running. With no display (Linux with neither
      `DISPLAY` nor `WAYLAND_DISPLAY`) it stays out of sight and the log says so once. If it
      cannot open a window it is started without one. The owner's own Chrome, where that is
      what is used, is as it was.
    - **Mine, not the owner's:** everything but those two sentences of theirs. No switch in
      the desktop app, which I had begun and took out when they named workspace settings; no
      flag for a daemon run by hand; that a member sees the switch disabled.
    - **Never run:** a browser with a window on macOS or Windows, where nothing has been
      seen of it: whether it comes to the front, where it opens, and on Windows whether the
      window shows at all (the program that starts it was told to hide windows, and is now
      told not to for this one). Under Xvfb on Linux it was started both ways and asked
      which it was. Two workspaces that have chosen differently and share one computer
      have the browser start again at each change of hands.
39. **A first run that is a scene** (2026-10-10; `prototypes/onboarding` is the mock-up;
    `packages/mascot/src/sky.js`, `apps/web/src/components/welcome`, `apps/web/src/routes/welcome.tsx`,
    `apps/web/src/server/desktop-handoff.ts`, `apps/desktop/src/page-bridge.ts`,
    `apps/desktop/src/browser-sign-in.ts`). The owner asked for "a really nice onboarding when
    you first open the desktop app": the egg of the first agent comes down from the sky, the
    agent walks its owner through setup as it hatches, and it ends in the chat with it "rather
    than taking you to the settings screen". After the mock-up: "We should also have a
    variation of this on web", and "we support sign in with github. Can we make oauth in the
    desktop app happen in a pop up or the user's browser that redirects".
    - **The scene is a page of the deployment's, `/welcome`**, for a browser and the desktop app
      alike. It is drawn over the page (`WelcomeHost` in the root), so it is still there as the
      chat comes up under it and the creature is seen going to its place. The sky and the
      island are `sky.js` in the mascot package; the egg is the mascot's own, laid over it.
      Where WebGL is not to be had the same card is shown over a plain night. With less
      motion there is no fall and no waiting on the words.
    - **Until the creature has landed it is in the scene only.** The chat comes up under the
      scene a few tenths of a second before the creature leaves the island, and the chat's
      own large picture of it was showing for that long: it was seen in two places at once
      (the owner, of a recording: "you see pip in the left and right at the same time as he
      starts to animate over"). The chat's large pictures are now kept out of sight from
      before the page changes until the flight is over (`unseen` in `scene.tsx`), and the
      scene is taken down in the same step as they are shown again. A browser test looks for
      them after every frame for as long as the scene is there.
    - **The egg is not shown until it is known where it starts.** It can be drawn before the
      server has said whether anyone is signed in, and for as long as that answer took it
      stood small in an empty night, before the sky had come up and before it was put at the
      top to fall (the owner: "the egg flashes in the first frame before it appears"). One
      frame on this machine; longer over a real network. `placed` in `scene.tsx` keeps it
      out of sight until it has been sent to fall, or set down. `welcome-scene.spec.ts` holds
      the server's answer back and looks; it is the one first-run file that draws the scene
      (`creature: true`), the others run with WebGL off.
    - **A card comes back closed.** What a card asks for opens under its words once they are
      said. It was one element for every step, so it was still open on the last answer when
      the card came back: the card faded in as tall as the next form, with that form showing
      through, shut as the words began, and opened again when they were said (the owner:
      "some snapping when animating between the forms"). It is now a new element for each
      step (`key={view.step}`), which starts shut. The test counts closing transitions:
      there are none. It is in `welcome.spec.ts`, where the scene is not drawn: beside the
      drawn scene it failed on main the first time it ran there, because a build machine
      that draws the sky in software wrote the egg's words too slowly for the test's wait,
      and a failed run on main is a deploy that does not happen.
    - **What it asks**, each answer a crack in the shell: who they are (an account, or signing
      in, with the providers the deployment has), a name and a color for the agent, and, in
      the desktop app on its first run, whether it may work on this computer. Then it
      hatches. The agent is made as it is named, with the seed its egg was drawn from.
    - **Who is sent there:** someone with no agent (`_app.index.tsx` no longer makes one),
      and "Create an account" on the sign-in page.
      Someone who has an agent is sent on, in the desktop app too since item 84: before it,
      in a desktop app that had not been through its first run, their own agent came out of
      the egg and asked about the computer.
    - **Every account is made there** (2026-10-11; the owner: "anytime you sign up for an
      account you get the welcome setup screen ... instead of the sign up so you get
      onboarded"). `/signup` was still the plain form: whoever opened it made the account
      there and met the egg only afterwards, and someone who signed up from an invitation
      went back to it, joined, and never met an agent of their own. `/signup` now leads to
      `/welcome` and carries `next`. A scene that was sent by a page (`sentFrom` in
      `lib/welcome.ts`) ends at that page and not in the chat: "On to your invitation". An
      invitation opened by someone signed in who has no agent sends them to the scene first,
      which is how an account made by a provider on the sign-in page gets there too. The one
      plain form left is `/signup?next=/desktop/sign-in…`, in the browser the desktop app sent
      its owner to: the app's own window is showing the scene. The mobile app has its own
      form and no scene. `signUp` in the browser tests makes the account over the API.
      Not chosen by the owner: that someone invited meets an agent of their own before they
      join, and that the scene then ends at the invitation.
    - **In its chat it says hello first**: the empty chat of an agent just met says who it is
      and offers a few things to start with, by what it was given (`meetingWith`, kept for
      the window's life; item 64). These are the app's words, not a model's, and are gone once the chat has
      a message. An agent named by its owner, and with no personality yet, is still told that
      this is its first conversation (`bootstrapNamed` in `persona.ts`, `namedByOwner`).
    - **The desktop app** opens `/welcome` until the first run is over (`welcomed` in its
      settings; an app that already had a server counts as through it). An app built for a
      deployment that answers skips its own form. The form now asks only for the server.
    - **The page is given a little by the app** (`window.doComputer`, only to the top page of
      the main window on the deployment's origin): to sign in through the browser, to share
      this computer, and to say the first run is over. Sharing can be asked for by a page only
      during the first run; afterwards it is the app's own window's to do, as before. The
      page confirms the pairing itself with the code it is handed.
    - **Signing in through the browser:** the app listens on a port of this computer and opens
      the browser on `/desktop/sign-in`; whoever is signed in there (or signs in, with GitHub
      at once if that was asked for) agrees, and the page sends a one-minute, single-use
      token to that port. The app's window exchanges it for a session of its own
      (`POST /api/auth/desktop/token` and `/desktop/session`, a small Better Auth plugin). The
      sign-in form in the app does the same for its provider buttons.
    - **Mine, not the owner's:** naming and coloring in the scene, where the agent used to
      name itself in conversation; the browser and not a pop-up; no click to agree when the
      tab itself has just come back from the provider; the hello and its three starters; the
      scene for someone who signs in again on a new computer; that a page may share the
      computer during the first run without a second question from the app.
    - **Run on a Mac once:** the packed build from this branch, on a MacBook Air and
      its own graphics card, through a whole first run against a server on another machine.
    - **On a phone** (2026-10-10, the owner asked whether it works there and then for what was
      found to be fixed): the card stops 5rem short of the top and scrolls inside itself, so a
      phone held sideways, or a page a keyboard has shrunk, keeps the egg in view and every
      field in reach; the creature over the hello in the chat is sized to the height of the
      screen (`100dvh - 31rem`, between 8rem and 18rem), where it used to be cut off above on
      a screen under about 780px tall; the color swatches take a touch 5px outside themselves;
      the plain egg stands in the room above the card. Tried in Chromium with touch at
      375×667, 393×659, 360×740, 320×568, 375×548 and 740×360. Never on a phone or in
      Safari: a keyboard that lies over the page and does not shrink it is not handled.
    - **Never run:** a real GitHub or Google sign-in through any of this; the token exchange
      on Workers (`adapter.consumeOne` against D1); Windows outside CI.

40. **The app's icons are one of its creatures** (2026-10-10; `scripts/icons.mjs`,
    `apps/web/public`, `apps/desktop/assets`, `apps/desktop/src/mark.ts`). The owner asked for
    the logo, "default favicon and app icon from scratch", and said "Maybe use one of our
    rendered mascots". It had been a flat teal oval with a smile.
    - **Which creature:** the one the seed `Do` grows, in the teal the old logo had
      (`#3b9d9d`): a drop with a ball floating over its head. `scripts/icons.mjs` draws it in
      a Chromium with the app's own drawing code and writes every picture, so they are drawn
      again by running it, and change with the creature.
    - **The app's icon** is the creature on a dark teal square whose glow is dithered as the
      creature's shading is: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` and
      `apple-touch-icon.png` for a phone, `icon.png` for the desktop app, and `icon-mac.png`,
      the same in a square of 824 inside 1024, which is how a Mac's own icons are drawn
      (`electron-builder.yml` names it for the Mac).
    - **The tab's icon and the mark** are the creature alone, without its ball: `favicon.svg`
      is its 32 pixels as shapes, and the same file is the mark on the desktop app's own pages
      (`assets/mark.svg`, an `<img>`, for which their rule about what they may load now
      names images) and in the page a browser is shown after signing in (`src/mark.ts`).
      `favicon.ico` is new, for whatever asks for that address without reading the page.
    - **The tray** is the creature alone; while this computer is not shared it is grey and
      asleep. `badge.png` is its shape in white with its eyes as holes.
    - **Mine, not the owner's:** which creature; that it speaks in the large pictures and
      listens in the small ones, where an open mouth is a hole; the square and its glow; no
      ball below 48 pixels; the sleeping tray; the room around the Mac's icon.
    - **Never seen:** any of it on a phone's home screen, in a Mac's Dock or menu bar, or in a
      Windows taskbar. The pictures were looked at in Chromium, and the two pages in the
      built app on Linux.

41. **What the creatures cost a computer, and the GPU process that died** (2026-10-10;
    `packages/mascot/src/orb-core.js`, `apps/web/e2e/agents.spec.ts`). The owner asked for a
    profile of the client, that it "doesn't melt your cpu or gpu", and while it was under way:
    "I'm also still getting the gpu crashes and it is mainly in the desktop app". Measured on
    a MacBook Air (Chrome 154 and the installed app, its own graphics card, over
    CDP) and in headless Chromium here.
    - **What was fine:** a chat of eighty long messages. Typing in it, scrolling it and an
      answer streaming into it each took 6 to 14% of one core's main thread. Nothing was
      changed there.
    - **What was not: the page at rest.** With nothing happening, a page with the sidebar open
      (ten creatures) took about 21% of a core in the page and 44% in the GPU process, for as
      long as it was showing. Almost all of it was the creatures' loop: they were drawn one
      at a time, each copied out of the graphics card by itself, and spread over every frame
      the screen showed, so the page was drawn again sixty times a second. The loop counted
      frames, so on a 120 Hz screen it would have drawn everything twice as often.
    - **Now** the creatures are drawn on beats: thirty a second by the clock, whatever the
      screen's rate, every other one for those in the sidebar (fifteen a second; it was
      twenty). All that are due are drawn side by side into one picture and each takes its
      square of it, so there is one copy out of the card per beat. Each starts on a whole
      tile of the dither (`TILE`, four pixels): the dither is laid over the whole picture, and
      a creature's place in it changes with which others are due, so without that its dither
      shifted from beat to beat and flickered, the box's most of all. The same page, measured
      in the same sitting, three runs of each: about 15% and 21%. Script time on the page
      went from about 7% to 4%. Where there is no graphics card and the creatures are
      drawn in software, as in headless Chromium here, the same page kept more than four
      cores busy and now keeps two and a half; one creature alone is still a whole core.
    - **Why the GPU process died.** The app's own log, from a second copy started with
      `--enable-logging=stderr`: `[Device] is lost` from Skia's Dawn device, then "Restarting
      GPU process due to unrecoverable error. Context was lost." After three of those within
      a few seconds Chromium starts the GPU process with `--use-gl=disabled`, and the app is
      drawn in software until it is started again: the owner's own copy was found that way,
      its GPU process replaced three times in five seconds, 1 min 45 s after it started.
      What sets it off is the WebGL context being thrown away while canvases still hold what
      they copied from it. That happened whenever the last creature left the page: at the
      start, where the tab's icon draws a creature and lets it go before the others exist,
      and on every move from one agent to another with the sidebar shut. Moving between two
      agents that way killed the GPU process in 2 of 6 starts of the old code, each time
      within fourteen moves, and in none of 20 starts of the new.
    - **Now** what a creature was drawn with is kept for ten seconds after it goes
      (`Stage.retire`): its shaders, and with them the context. The creatures of the next
      page find both. The picture they are drawn into starts with room for a page's worth and
      only grows. A test counts the contexts a page asks for while it moves between agents.
    - **Mine, not the owner's:** fifteen pictures a second in the sidebar where it was
      twenty; ten seconds.
    - **Tried and left out:** sleeping through the frames between beats with a timer (no
      cheaper, and beats came late); a layer of its own for each creature's canvas (no
      cheaper).
    - **Left as it was:** the box that hops while it waits to be opened, and its twinkle, are
      CSS animations that run for good and cost about 4% of a core in the page and 3% in the
      GPU process while a box is waiting. A page that is not showing draws nothing, as before.
    - **Not known:** whether this is every way the GPU process dies. macOS recorded GPU
      restarts of its own on 2026-10-09 (item 33), and none while these were reproduced. (It
      did record them: see item 45, which found the cause.)

42. **What a thousand people would cost or break on Cloudflare** (2026-10-10;
    `apps/web/src/server/rate-limit.ts`, `packages/protocol/src/bytes.ts`,
    `packages/client/src/attention.ts`). The owner: "I want to roll this out for public launch
    with 1000 users what are scaling issues on cloudflare that i should be aware of? Can you
    fix any of those".
    - **A hidden tab lets go of what it follows** a minute after it is hidden, and takes it up
      again when it shows (`attention` in the client's options). It also no longer counts as
      someone watching a chat, so an answer that arrives meanwhile is notified.
    - **Signing in, signing up and asking to pair a computer are counted by address** with
      Cloudflare's rate limiting binding (`PUBLIC_LIMIT` in `wrangler.jsonc`): twenty a
      minute, then 429. Better Auth's own limiter counts in one isolate's memory. The places
      for computers waiting to be paired went from 200 to 2,000, so that one address cannot
      take them all.
    - **The binding does not count exactly.** Cloudflare says it is "permissive, eventually
      consistent"; locally the 21st is refused every time. A limit that holds exactly is a
      rate limiting rule on the zone, or a count kept in an object.
    - **An upload is held in memory once** where it was held three times in the Worker and
      twice in the library's object: `readLimited` is told the declared length.
    - **Reconnects wait a random part longer**, so the clients a deploy cuts off do not all
      come back in the same instant.
    - **Not done, and the owner's to decide:** what the Daytona account allows with a machine
      for each workspace; that every deploy cuts off everyone.
    - **Mine, not the owner's:** the minute, the twenty a minute, the 2,000.

43. **Agents are followed over sockets that hibernate** (2026-10-10;
    `packages/protocol/src/socket.ts`, `packages/agent/src/followers.ts`,
    `packages/client/src/follow.ts`, `apps/web/src/server/agent-socket.ts`). The owner, after
    item 42: "do a move for us to hibernating web sockets".
    - **Why.** An event stream keeps the agent's Durable Object in memory for as long as it is
      open, and memory is paid for by the second: about $4 a month for one object kept all
      month, and a page held two streams, the second of which kept the library's object too.
      A WebSocket the runtime holds does not: an idle object is put away with its sockets
      still connected.
    - **One socket for each agent a page follows** (`/api/agents/<id>/socket`), carrying what
      the agent's event stream said and every chat the page asks for (`follow`, `unfollow`),
      and one to the library of its workspace (`/api/agents/<id>/library/socket`), which says
      its revision. The gateway checks them as it checks presence. `client.agent(id).watch`
      and `watchChat` are as they were; the web app turns sockets on (`sockets: true`).
    - **What a socket follows is kept with the socket** (`ActorSocket.note`, a Durable
      Object's attachment), because the agent comes back with nothing in memory. Opening the
      agent attaches its sockets again, and each is told where things stand: `resumed`, with a
      fingerprint (`digest`) of every document and of every chat it follows. A client that
      holds something else asks again. Nothing changes while an agent is put away, so a
      client that heard everything holds what is there and nothing is sent twice; the
      fingerprints are for the agent that died without being put away.
    - **pi-durable kept every agent in memory for ten minutes after each answer.** It keeps a
      quiet chat's context by a timer, and means to keep none where timers cannot be
      unreferenced. With `nodejs_compat` a timer has an `unref`, which does nothing, so the
      timer was kept and a pending timer keeps a Durable Object from being put away. On
      Cloudflare the agent is now made with `contextRetentionMs: 0`. Since pi-durable 1.2.0
      a document that nothing watches is kept in memory the same way, by the same kind of
      timer, so the agent is made with `documentRetentionMs: 0` there too; the test below
      fails without it.
    - **Checked in the Workers runtime:** a test follows a chat over a socket, leaves the
      object alone for fourteen seconds, and asserts that it came back with `resumed` and
      sent the next answer as changes (`agent.workers.test.ts`); it fails if anything keeps
      the object in memory. In a browser against `DC_TARGET=cloudflare vite dev`: no event
      stream was asked for, the object was put away within fifteen seconds of the page going
      quiet, and reading the agent then took 34 ms against 20 ms from memory.
    - **Where there is no socket, the streams.** A socket that cannot be had while the server
      answers plainly is tried twice and then everything is followed by stream, for the
      life of the page. That is what `pnpm dev` on Node does, whose dev server now refuses
      the app's sockets at once where it used to leave them unanswered. The streams are
      still served, and are what the mobile app uses and what `scripts/smoke.sh` reads.
    - **`NodeActorNamespace.evict`** unloads an actor under its sockets, for testing what a
      Durable Object does when it hibernates.
    - **Not done:** the mobile app still follows by stream (its sockets would have to carry
      the session by hand, and it has never been run on a phone); a socket has no way to slow
      an agent that sends faster than a client reads.
    - **Not known:** what any of this costs on Cloudflare itself. Nothing here was run on a
      deployed Worker.
    - **Mine, not the owner's:** the fingerprints in place of sending everything again; the
      fall back to streams; sixteen chats to a socket; leaving the mobile app as it is.
44. **Agents work in one window, behind what the owner has in front** (2026-10-10;
    `packages/protocol/src/screen.ts`, `packages/agent/src/uses.ts`,
    `apps/desktop/src/screen.ts`, `screen-driver.ts`, `overlay.ts`). The owner asked whether
    Cua has "a mode that lets the agent control your computer without taking over your mouse
    and keyboard like codex computer use", and then for the app to be rewritten to use it. It
    has: Cua Driver sends what is done in a window to that window's program alone, and until
    now the app asked for everything on the whole screen, which is the one target the driver
    can only do with the real pointer.
    - **The `screen` tool** has two more actions and two more arguments. `windows` lists the
      windows there are (id, app, title, size, and whether it is showing); `open` starts an app
      by name without bringing it forward. With `window` set to an id, every other action is
      done in that window alone, the picture that comes back is of that window whether or not
      it can be seen, and places are in that picture. `in_front: true` has the window brought
      forward for the one action. Without `window` everything is as it was: the whole screen,
      with the computer's own mouse and keyboard. The agent is told to work in a window where
      it can.
    - **On the wire** the three new things are actions of their own (`windows`, `open`,
      `in_window`, which carries the window and what to do in it), not arguments to the old
      ones. An app from before does nothing with an action it does not know and answers with
      a picture of the screen; had `window` been one more argument to `click`, it would have
      clicked that place on the whole screen. The server knows an old app by its answer, which
      has no `window` or `windows` in it, and tells the agent so. The answer's picture is now
      optional (`windows` has none), and it can carry a `note`.
    - **In the app** `ScreenService` finds the window by its id each time, takes a picture of
      it before acting (the driver takes a place to be in the picture it last took, and a
      picture taken for someone watching is taken apart from those), moves the places where
      the window has changed size since the agent saw it, and answers with a picture taken
      afterwards. A window that is gone afterwards (the agent closed it) answers with the
      windows there are. Someone watching is shown the window the agent last worked in, with
      its name where "The screen" was.
    - **What the driver refuses** behind what is in front is told to the agent with what to ask
      for: on a Mac a drag, and keys to a program with more than one window. Where it sent a
      click or keys to the program without being able to tell whether they were taken, the
      answer says so. Nothing is ever brought forward without the agent asking.
    - **On the computer itself** the bar says "(agent) is working in the background", there is
      no glow round the screen, and Esc is left to its owner, who is at their own work. The
      agent's pointer is drawn only where the window is the one to be seen at that place.
      With the whole screen, or a window brought forward, all of that is as before.
    - **Two things found on a Mac that were broken before this.** The driver ends
      the name everything is asked under after five minutes without hearing it, and refuses
      everything under it from then on: an agent that came back to a screen later was refused
      until the app was started again. The app now starts the name again and asks once more
      (`sessionEnded`). And a program made of web pages (Electron, Chrome) tells the system
      what is in its window only once it has been asked, so the first click there pressed
      nothing: the first picture an agent is given of a program's window now asks.
    - **Checked on a MacBook Air** (macOS 27, a signed build of the branch run as a
      second copy against a server on another machine, while the Mac was in use): through the whole chain, chat to driver, an agent listed the windows, opened
      Calculator behind what was in front and worked a sum in it, with the pointer where it
      was and the app in front unchanged; typed, pressed keys and scrolled in a TextEdit
      window that was covered by others; filled in a form in an Electron window behind
      Calculator; was refused a drag and did it with `in_front`; closed a window. Sonnet 5.5
      was given "use the Calculator app to work out 127 × 49" with "do not take over my mouse
      or keyboard" and did it in a window, unprompted, in about half a minute. It is the first
      time an agent used a real screen on a Mac at all.
    - **Not run:** Windows and Linux, where the driver can do much less behind what is in
      front (on X11 little more than a left click; on Hyprland nothing), so that there an
      agent will mostly be told to ask for `in_front` or use the whole screen. Nobody has
      looked at the bar and the pointer by eye while an agent worked in a window. A window on
      another desktop, a minimized one, a second display. Chrome and Safari themselves.
    - **Mine, not the owner's:** that the whole screen stays as a way to work, for what is in
      no window; that bringing a window forward is the agent's to ask for and is never done
      for it; that the app's own windows are left out of the list; that the picture is of the
      window and nothing is read from the system's outline of it; no glow and no Esc while
      working behind; that a first picture wakes the program.
    - **Learned the hard way:** a signed Mac app with one file changed inside it is not run by
      macOS at all ("is damaged and can't be opened", a dialog on the screen), so new
      code cannot be tried in a copy of the installed app any more. What works: start the
      installed app a second time with `--inspect=9230` and its own data folder, bundle the
      code to try as one CommonJS file, and `require` it into that process over the
      inspector, where the driver has the app's permissions; and for the whole chain, a
      signed build of the branch from the Actions tab (`gh workflow run desktop.yml --ref
<branch>`), run as a second copy from a folder of its own.

45. **The creatures' own shader was what reset the Mac's graphics card** (2026-10-10;
    `packages/mascot/src/orb-core.js`). The owner: "I'm still getting gpu crashes on my mac. Is
    there anything out of the ordinary we are doing in this codebase that could cause it", and
    then "I think it happens without screen use". It was the body's vertex shader, and it is
    changed. Found on a MacBook Air (M2, macOS 27.0.1) with a copy of the installed
    app (Electron 44.7, Chromium 152) showing test pages, over CDP.
    - **What a fault is.** macOS's log (`eventMessage CONTAINS "Caused GPU"`) names a process
      whose work on the card hung or read a place that was not there, and the card is
      restarted under everyone. It named WindowServer and Apple's own programs far more often
      than the app. The app is the one that shows it: it is nearly always drawing, so it is
      caught by every restart, and after three Chromium draws without the card (item 41). The
      `gpuEvent-*.ips` files stopped being written on 2026-10-09 and are not the record.
    - **What sets one off** is another program starting to draw while creatures are being
      drawn: an app opening, the lock screen, the screen-use overlay. Opening Font Book did it
      nearly every time. Counted as faults in the log over twelve openings (six where marked):
      nothing of ours running, 0 in 21 openings of three apps; the app on a blank page, 0 in
      21; a plain WebGL canvas, 0 (6); the same scene copied into eleven 2D canvases as the
      creatures are, 0 (6); 2D canvases alone, 0 (6); eleven creatures, 7, 5 (6) and 11.
    - **Which part.** Creatures without their bodies, 0 (6). Bodies with a plain fragment
      shader and their own vertex shader, 9 (6); the other way about, 0 (6). In the vertex
      shader, with the noise taken out, 0; with the shape worked out once for a vertex and
      not three times, 0, and 0 with forty-one creatures. One creature alone, 0. It is not
      load: the page that faults uses a tenth of the card, and one that uses a fifth does
      not. It is not numbers that are no numbers: a page that sends vertices to infinity or
      to NaN on purpose faults nothing. Why this shader does it is not known; it is the
      driver's to answer.
    - **Now** the noise is taken once for a vertex, with its slope (`snoise` gives both), and
      the two neighbours the normal is found from are given the noise the slope says they
      have. Eight takings of the noise in the shader became four. The old file against the
      new, twelve openings each: 11 faults and 0. Forty-one creatures with the new, over
      twenty-one openings of three apps: 0.
    - **The look** is the same to the eye. Drawn side by side from the same moments on that
      Mac, seven creatures in three states: those shaded flat are the same in every pixel,
      and those shaded smooth differ in about one pixel in a hundred, dots of dither along
      the edges of their shading.
    - **Item 41 is wrong in one place:** macOS did record faults while the GPU process was
      made to die there by going back and forth (22:37:57 and 22:41:59 that evening, the
      app's GPU process named). Throwing the context away is one more way of setting off the
      same fault, and keeping it for ten seconds made that rarer.
    - **Not done:** the screen-use overlay and the pictures taken for someone watching
      (every 400 ms, a `screencapture` each) were suspected first and are not the cause; they
      are as they were. Nothing was reported to Apple or to Chromium.
    - **Checked here:** the browser tests of the creatures pass with it (`e2e/agents.spec.ts`,
      drawn in software). There is no test of the fault itself: it needs that Mac. How it was
      counted: a copy of the app with `--remote-debugging-port`, a page of creatures, Font
      Book opened with `open -a` and stopped with `pkill -x` twelve times, seven seconds
      apart, then the log.
    - **Not known:** whether other Macs or other versions of macOS do this; whether a
      creature wearing things, or the box, can still set it off (neither uses the noise);
      whether the owner's own app is quiet now, which it can only be once this is deployed,
      since the app draws what do.computer serves.
46. **A deployment names the models it offers, can be signed in to any provider, and the first
    run asks what to think with** (2026-10-10; `packages/agent/src/models.ts`,
    `model-access.ts`, `actor.ts`, `apps/web/src/server/models.ts`, `model-access.ts`,
    `apps/web/src/components/settings/models.tsx`, `components/welcome/thinking.tsx`). The
    owner asked that "any of the authentication methods can be ... set as ... the default
    server one", for "a server level" list in the config of "the only … models you're allowed
    to pick" (for do.computer: OpenRouter with Muse Spark 1.3 Contributor, Claude Haiku 5.5
    and GPT-6 Luna), with people still free to "bring their own keys, their own logins" and
    "pick anything they want", and for the first run to show the built-in models, "login with
    ChatGPT or with Claude", and "a little … more section for all the other" providers.
    - **`DC_MODELS`** is the list. Each name is a model's whole id or its OpenRouter id. The
      deployment offers those, in that order, and new agents start on the first unless
      `DC_DEFAULT_MODEL` names another of them. Nothing is checked against a catalog when the
      server starts: a name that matches nothing offers nothing, and a deployment left with
      nothing real offers the echo.
    - **It is kept at the call, not only in the picker.** `createAgentModels` makes two sets
      of models and puts one `Models` in front of them (`routed`): a model the deployment
      names is called with the workspace's own sign-in, then the deployment's sign-in, then
      its key; any other model is called with the workspace's sign-in or not at all. So an
      agent that was set to another model before, or a workspace that signs out of its own
      OpenRouter key, cannot spend the deployment's key on a model it does not name. Without
      `DC_MODELS` there is one set and nothing is routed.
    - **The server signed in** is the same actor a workspace has (`createModelAccessActor`),
      under the name `deployment`, which no workspace has. The gateway's rule for a workspace
      (`inWorkspace` in `server/model-access.ts`) lets someone named in `DC_ADMIN_EMAILS` in
      under that name and nobody else, and where sign-up is open the address must be one a
      social sign-in vouches for. So the routes, the client and the settings screen are the
      ones there were: **Server models** in workspace settings is the Models section with
      other words. An agent reads the deployment's credentials after its workspace's
      (`credentialChain`), and asks which providers the deployment has at most twice a minute
      (`cachedSignIns`), since that one actor is every agent's.
    - **What a deployment offers is now asked each time** (`AgentModels.offered`,
      `deploymentModels()` on the server, `deploymentModels` in the agent's options), since
      someone can sign the server in while it runs. Its models are offered as its own, with
      no word of who signed in.
    - **A model both have is the workspace's** (`offeredModels`): a workspace signed in to a
      provider runs that provider's models on its own account, the ones the deployment offers
      too, and the picker now lists them under the workspace's sign-in. Before, such a model
      was listed as the deployment's and still called with the workspace's credential.
    - **An agent on a model the deployment stopped offering moves** to the one new agents
      start on (`#keepRunnable`, looked at when the agent is first used and about once a
      minute after). Only where the deployment still has the model's provider: an agent whose
      workspace signed out of a provider nobody else has still says so in the chat, with the
      ways back, as before.
    - **The first run** has one more card, after the name: "What should I think with?". It
      is a few choices and not a list of models (since 2026-10-12, when the owner asked for
      "Included" with its model "under it small with the ability to change it as like a muted
      link", then ChatGPT, Claude, and "other providers at the bottom"): **Included**, with
      the model the deployment starts agents on small under it and "Change", a menu of the
      deployment's models (the suggested few where there are hundreds); **ChatGPT** and
      **Claude**, each a row that opens its sign-in; and "Other providers" under them for
      every provider and key (the settings' own list and sign-in window). What was signed in
      to becomes a choice in that provider's row, or a row of its own after them, under its
      own name, with its first model chosen and its own "Change", and the card sets the agent
      to what is chosen. The choices are `sources` in `apps/web/src/lib/welcome-models.ts`,
      with its test beside it. The titles, the lines under ChatGPT and Claude, and the menu
      were the builder's, not the owner's. Someone
      who already has an agent is not asked.
    - **The small models the server uses itself** (search, notes, judging, dictation) are
      still OpenRouter's on `OPENROUTER_API_KEY`, are not narrowed by `DC_MODELS`, and are
      not there on a deployment that is only signed in to something else.
    - **Checked here:** unit tests of the list, the routing, the move, and the server's
      sign-in and who may change it; browser tests of Server models and of the new card
      (`models.spec.ts`, `welcome.spec.ts`); by eye, the card with the three models, with a
      key added, and at phone width.
    - **Not run:** a real key or subscription, as the server's or in the first run; the
      Workers runtime; the desktop app's first run with the new card beyond its own test.
    - **Mine, not the owner's:** that the server's sign-ins are changed by people named in
      `DC_ADMIN_EMAILS`, from workspace settings; that only `OPENROUTER_API_KEY` is read from
      the environment and every other key is typed in there; the name `DC_MODELS` and that it
      takes OpenRouter ids; that a workspace's own sign-in wins for a model both have; the
      move to the default model; where the card is in the first run, its words, and that it
      lists a few models and not all; that the first run's choice is for that agent and does
      not become the person's default for new ones.

47. **On Cloudflare the built-in shell is Cloudflare Computer's** (2026-10-10;
    `packages/sandbox/src/worker-shell`, `apps/web/src/server/sandbox.cloudflare.ts`). The
    owner, of https://github.com/cloudflare/computer: "would it be possible to make this with
    the just bash backend one of the built in computer options? We can configure this to be the
    default on cloudflare runs. since it would be very cheap", and then "roll it out and
    replace our just bash version please".
    - **What it is.** The kind is still `just-bash`. On Cloudflare `cloudflareProviders` now
      answers for it: `workerShellSandbox` talks over Workers RPC to a `ShellObject`, one
      Durable Object per shell, named after the machine's key (the agent's id). The object
      holds a `Workspace` from `@cloudflare/computer` over its own SQLite storage, with the
      `WorkerShellBackend`: each command runs in just-bash in a Dynamic Worker (`LOADER`),
      which reaches the files through `WorkspaceServiceProxy` and nothing else of the server.
      Its requests leave through `ShellGateway`, which is `guardedFetch` as before, so the
      rule about private addresses is the same. On Node nothing changed: the shell inside the
      server, with `DurableFs`.
    - **Why an object of its own and not the agent's storage:** so that the shell could be a
      workspace's machine with no files to move.
    - **It is a workspace's machine there** (the same day, after the owner sent a picture of
      Add a computer offering only Daytona: "also this still shows daytona"). What is one
      agent's alone now depends on where the server runs: `unsharedKinds(target)` in
      `sandbox.ts` is `just-bash` on Node and nothing on Cloudflare, and a kind says so to the
      app as `perAgent`. So on Cloudflare a workspace is given one shell, open to its agents,
      each in a folder under `/workspace`; one can be added, opened, closed and removed like
      any machine. A shell from the few hours before, which was one agent's, is a row with
      that agent's id as its key and stays that agent's until someone opens it. Only a shell
      whose key is the asking agent's id has old files moved into it. Daytona is still
      offered beside it: taking a kind off offer cuts off the machines of that kind.
    - **Files from before.** `movedFromDatabase` copies what `dc_fs` holds in the agent's
      database into the object the first time the shell is used, then renames the tables to
      `dc_fs_moved` and `dc_fs_chunks_moved`. Nothing drops them. Modification times are not
      kept.
    - **What the package cannot do, found by trying.** `yq`, `sqlite3`, `python3` and `js-exec`
      do not run in a Worker, so they are not offered; `jq`, `xan`, `file`,
      `html-to-markdown`, `rg`, `gzip` and `tar` are. A command is answered only when it is
      over, so nothing is streamed. `killExec` does nothing (the shell's Worker keeps the
      running commands in an object that each call gets a new one of), so `abort` stops
      waiting and the command runs on until its time is out: ten minutes at most
      (`MAX_RUN_MS`, a number of mine). The object's log fills with "uncaught exception"
      lines for files that `rg` looks for and does not find; they are the package's.
      Appending to a file with `>>` sets its mode back to 644, which the shell inside the
      server did not do; writing it anew does in both.
    - **The `experimental` flag** the package's README asks for was not needed, in
      Cloudflare's Vitest plugin or in `vite dev`.
    - **Tested:** `packages/sandbox/test/workers` runs both conformance suites, the network
      rules, deletion and the move inside the Workers runtime; `scripts/smoke.sh` passes
      against `vite dev` on Cloudflare with it. The move was also made for real: an agent
      wrote a file, a link to it and a mode with the commit before this one, the same
      `.wrangler` state was started with this one, and the agent read all three back.
    - **Not known:** what it costs with real use; how it behaves with files of hundreds of
      megabytes; `git`, which the package has (isomorphic-git) and which was not turned on.

48. **A landing page** (2026-10-10; `apps/web/src/components/landing`,
    `apps/web/src/routes/index.tsx`, `prototypes/landing`). The owner: "Can you design a nice
    landing page for the site at do.computer that features our little guys! ... Ideally this
    can we an env variable that you can flip on (it should be on for our deployment). Also if
    open access isn't availible we should disable sign up and have coming soon with a small
    link for if you have access already". Four looks were drawn; they chose the character
    select, asked for it to say "your open source personal assistant" and not "little guy",
    for pictures of the app, eight to choose from, and a pixel face that is easier to read.
    - **`DC_LANDING=1`** makes `/` the landing page for whoever is not signed in. Without it
      `/` leads to the sign-in form, as it always did: someone hosting it for themselves has
      no use for a page that sells it. The workflow passes the variable through, and the
      deploy script writes it into the build.
    - **`/` is a route of its own**, no longer one of the pages behind sign-in. A visitor
      with no session cookie is a stranger: the server draws the page and sends it whole, so
      it is there before any script. For anyone with a session cookie, and for the desktop
      app, the server sends the app's frame and the browser decides, as before: someone
      signed in goes to their agent, and a session that has ended finds the landing page.
    - **Whether a stranger may sign up** is `open` in what `/api/auth-methods` answers: true
      where `DC_SIGNUP=open`, and where nobody has an account yet, since the first to arrive
      is the deployment's owner. While it is false the page has no way to make an account:
      "Coming soon", and "Already have access? Sign in". The sign-in form then drops "Create
      an account", unless a page sent the visitor there to come back to it, as an invitation
      does. `/welcome`, and `/signup` which leads to it, are still there for whoever knows
      them: the server refuses an account to anyone not invited, as it did.
    - **The page** was first a console's character select, at night, in a pixel face. On
      2026-10-11 the owner found it had "too many agent blobs" under the select, pointed at
      x.ai/bot and chatgpt.com/features/dots, asked for "a more professional version of this
      site in the style of the references", and chose it from a mock-up
      (`prototypes/landing-pro`): "i love it ... then build for real". What they kept from the
      old one, in their words: "that rotating choose your character selection if you can switch
      between the personas but it doesn't need to be a character select screen", and, of chips
      of words tried in its place, "don't like the pill treatment liked the grid of guys more".
    - **What it is now**: a light page in plain type, the same by day and by night. At the top,
      the headline and the way in beside a panel: one creature large, which is each of eight in
      turn (seven jobs and an egg) with what it was asked and what it is doing, and the eight
      small under it in two rows of four; choosing one, or a mouse over one, stops the turning,
      and the panel takes a tint of whoever is on it. Then the app in a window whose tabs change
      the picture (a phone where the window would be too small); what it does, as small pictures
      of the product drawn in HTML and played through their steps by a timer, three beside
      their words on panels of color and two side by side; where it is, with Slack's own mark;
      open source with the three lines that run it; the app's own box opening; questions; and
      the way in again. Ten creatures: nine at the top, one under a hat. They are `AgentAvatar`,
      as everywhere else, so where they cannot be drawn their still pictures stand in. Its
      styles are one file under `.lp`, which is also what scrolls. The pixel face
      (`@fontsource/jersey-25`) is gone from the app. "Download for Mac" leads to the
      repository's latest release.
    - **The page calls an agent a Dood** (2026-10-11). The owner, asked for another headline
      than "Your open source personal assistant.": "I'm thinking of calling the agents Doods is
      there anything with that for the headline", and to "Meet your Dood.", "Do it!". The name
      is in the headline, the copy under it, the questions (the first is "What is a Dood?") and
      the page's description. It was on this page only until item 70, which took it to the
      whole app.
    - **The pictures of the app** in `apps/web/public/landing` are real: taken from the built
      server with a real model (`prototypes/landing/README.md` says how), and are the light
      ones. They will go out of date as the app changes.
    - **Not done:** the repository is private, so the page's GitHub links lead nowhere until
      it is made public; nothing collects the addresses of people who want to be told when it
      opens; the page has no picture for a link's preview; and it has not been seen in Safari.

49. **The app's picture is a creature on its island, and in the desktop app its owner's own**
    (2026-10-10; `packages/mascot/src/portrait.js`, `scripts/icons.mjs`,
    `apps/web/src/lib/app-icon.ts`, `apps/desktop/src/page-bridge.ts` and `main.ts`). The
    owner asked for an icon that "screams windows 98 .exe logo", turned down three rounds
    that added a treatment to the creature (beige furniture, a spooky game, a glossy one),
    and settled it with "can it just be a render of a character on a background", "on the
    spawning island background", "do teal mochi sunrise for default. before you've made one
    show the egg. then build the dynamic one now!". The mock-ups are in `prototypes/app-icon`.
    - **The picture** is the island of the first run (`sky.js`) with a creature standing on
      it at rest, each drawn by its own code, one pixel of each to one pixel of the picture,
      and nothing done to either. `portrait.js` draws it: the scene is drawn 2.1 times as
      tall as the picture, so that there is sky over the creature, and the picture is the
      square of it with the ground four fifths of the way down. The creature's own shadow
      is left out and one is put on the grass.
    - **The app's own icons** (item 40) are now this picture of the teal mochi, seed
      `agt_ct5dka`, at sunrise, in place of the drop on a dark square: the phone's four, the
      desktop app's two. A phone's are drawn from further back, since it cuts their corners
      off. The tray, the tab and the mark are that creature alone.
    - **In the desktop app the picture follows its owner's agent.** `useAppIcon` is given the
      agent whose pages are open; `app-icon.ts` draws the same picture of it, in what it has
      on, and hands it to the app as a PNG's address through `setIcon` on the page bridge.
      The app shows it with `app.dock.setIcon` on a Mac and on its main window elsewhere.
      Until an agent hatches it is its egg; on `/welcome`, before there is an agent, it is
      the egg of the app's own creature; on the sign-in pages it is the usual picture again.
      Other pages leave it as it was.
    - **It lasts as long as the app runs.** Quit, and in Finder, Launchpad and Spotlight, the
      app has the picture it was built with. Its file is signed and is not changed.
    - **What the app accepts:** only from the top page of its main window while that is on
      the deployment, as with the rest of the bridge; only a PNG's address under two
      million characters, of a square of 64 to 1024 pixels. Anything else is left unanswered.
    - **The island is drawn once for a page**, when the page is idle, with a graphics context
      of its own that is given back at once (`WEBGL_lose_context`). Where it cannot be drawn
      the app keeps the picture it has. An app older than this has no `setIcon` and is not
      asked.
    - **Mine, not the owner's:** that it is the agent whose chat is open (as the tab's icon
      is); that an agent still in its egg is shown as its egg; the usual picture when signed
      out; that Windows and Linux get it too, on the window; the tray staying the app's own
      creature.
    - **Tested:** `apps/web/e2e/app-icon.spec.ts`, where the app is stood in for by what it
      gives a page, and `apps/desktop/test/page-bridge.test.ts`.
50. **Visuals in a chat, and pages of the library shared as websites** (2026-10-11;
    `packages/protocol/src/visual.ts` and `sites.ts`, `packages/agent/src/visuals.ts` and
    `sites.ts`, `apps/web/src/server/sites.ts` and `site-directory.ts`,
    `apps/web/src/components/chat/visual.tsx` and `site-card.tsx`,
    `apps/web/src/components/sites`). The owner asked for agents to be able to "create inline
    visualizations (look at t3 code for how they can render code in the chat)" and "to be able
    to share websites like claude artifacts. They are scoped so only people in the workspace
    can see them for now and you can set to make them public". `prototypes/visuals-and-sites`
    is the mock-up, which the owner was shown and had not answered when this was built.
    - **A visual** is what T3 Code calls an HTML render, done the way it does it. The agent has
      a `visual` tool that takes a title and one self-contained HTML page. The page is kept in
      the library as `visuals/<title>.html`, and the chat shows it in a frame where the tool
      call is: no border, on the chat's own background, as wide as the answer. It needs no
      computer. The tool's result tells the agent that the person sees the page and not to
      describe it.
    - **What is put in the page** (`prepareVisual`), at the start of its head: the app's colors
      as CSS variables, light and dark, and a short script. The script takes the theme from
      the address's fragment and drops the fragment, takes later changes by message, says how
      tall the page is whenever that changes, and has links to other sites opened by whoever
      shows the page. The messages are the MCP Apps ones (`ui/notifications/size-changed`,
      `ui/open-link`, `ui/notifications/host-context-changed`), as in T3 Code. A page shown
      by itself, in the library or as a site, has margins and a measure; in a chat it has
      neither. The frame is the library's `/d/<agent>/<key>/...` address (item 13), so it is
      sandboxed the same way and its script runs as nobody.
    - **A site** is a page of the library, or a folder with an `index.html` (and since item 51,
      anything in it), given an address:
      `/s/<id>`, sixteen random characters. It is a row in `dc_sites` in the app database, by
      workspace. It shows what is in the library there as it is now; nothing is copied. A
      page named by itself is shared alone, and nothing beside it is served; naming a
      folder's `index.html` shares the folder.
    - **Who may open one** is decided once, for the address itself: anyone if the site is
      public, otherwise someone signed in who is in its workspace. Someone signed out is
      shown a page that says so and sends them to sign in and back. The address answers
      with nothing but a frame the size of the window. What the frame loads is
      `/s/<id>/~<key>/<path>`, served by the workspace's library from the site's page or
      folder (`LibraryStore.site`), with `Content-Security-Policy: sandbox` and no
      `allow-same-origin`. A site's page is sent nobody's session, which is why its files
      need the key: it is signed with a secret of the site's own, is the same for six hours
      and works for up to twelve. Making a public site the workspace's again changes the
      secret, so the keys already given out stop working at once.
    - **The agent shares with a `share` tool**: `publish`, `public`, `private`, `stop`, `list`.
      Publishing is allowed without asking. `public` is an ability of its own that asks a
      person first (item 20's approvals), like adding a connector.
    - **In the app:** a site the agent shared is a card in the chat, with its address, who can
      open it now, Copy link, Open, and a menu to choose who can open it or stop. A visual
      has two buttons when pointed at: open beside the chat, and share. A page open in the
      library or beside a chat has a Share button, and the library's front page lists what
      is shared. In a personal workspace "the workspace" reads "Only you".
    - **Elsewhere:** the phone app shows a visual as a file to open and a site as a link.
      Slack is sent a visual as the file.
    - **Mine, not the owner's:** that a visual is a file in the library and not something
      kept with the chat; that a site follows the library and is not a copy; that the agent
      must ask before making one public, and can share with the workspace unasked; that any
      member of a workspace can change or stop any of its sites; the frame around a site
      with no bar of the app's on it; `noindex` on every site; 512 KB as the most a visual
      can be and 200 sites to a workspace.
    - **Tested:** `packages/protocol/test/visual.test.ts`, `packages/agent/test/sharing.test.ts`,
      `apps/web/src/server/sites.test.ts`, and in a browser `apps/web/e2e/visuals.spec.ts` and
      `sites.spec.ts`, which check that a site's script cannot read cookies, that its requests
      to the app go without the session, and that nothing outside the shared folder is served.
51. **Anything in the library can be shared** (2026-10-11; `apps/web/src/server/site-pages.tsx`,
    `LibraryStore.site`, `siteRoot` in `packages/protocol/src/sites.ts`). Item 50 shared only
    pages. The owner asked "Is there a reason people can't share anything from their library?
    That might unify things a bit", and there was none.
    - **What is shared** is a file of any kind, alone, or a folder, with or without an
      `index.html`. Naming a folder's `index.html` still shares the folder. The whole library
      is never one site.
    - **What its address shows** is decided where the file is asked for. A page is the page.
      For someone going to anything else (`Sec-Fetch-Dest` of `document` or `iframe`), the
      gateway makes a page of it in the app's colors: Markdown is rendered to read, text is
      shown as text, a picture, a film or a sound is shown by itself, a folder with no front
      page is a list of what is in it, and what cannot be shown, or is text over 1 MB, is its
      name with a Download button. For a page that loads a file, as its picture, its
      stylesheet or its data, the file is what it gets, and so it is for a browser that does
      not say what it is asking for. `?download` hands the file over under its own name.
    - **A site's page can read the files beside it.** A sandboxed page's origin is nobody's,
      so to it the files beside it are another site's: it can show a picture of one but not
      `fetch` it, load a module or use a font. A site's files now say
      `Access-Control-Allow-Origin: *`: they are all shared with whoever has the page, and no
      session goes with the request. A page in the library's own viewer (item 13) still
      cannot, since the address it is viewed at opens the whole library. So a page that reads
      a file beside it works as a site and not in the viewer.
    - **In the app** every file in the library has the Share button, not only a page; a file's
      card in a chat has one; a folder is shared from its row in the tree, and a shared file
      or folder carries a lock or a globe there. The words are "Shared with a link" where
      they were "Shared as a website".
    - **A document shared by itself brings its pictures.** A file shared alone serves nothing
      beside it, so at first a Markdown document's own pictures did not load, and the owner
      asked for them. The page made of the document asks for each picture beside it by its
      place in the library (`?picture=notes/chart.svg` on the document's own address), and
      the library serves it if the document refers to it and it is a picture
      (`markdownFiles` in `packages/protocol/src/library-links.ts`, read from the document
      as it is now). Nothing else rides along: not a picture the document does not name, and
      not a file it only links to. In a shared folder a picture is at its own address, as
      any file is.
    - **Mine, not the owner's:** how each kind is shown; that a PDF is a download, as it is in
      the library; 1 MB as the most text that is shown, and as the largest document read for
      its pictures; that a document's links to other files beside it lead nowhere when it is
      shared alone.
    - **Tested:** `apps/web/src/server/site-pages.test.ts`, and the last two tests of
      `apps/web/e2e/sites.spec.ts`. `scripts/smoke.sh` shares a document.
52. **The desktop app keeps itself up to date** (2026-10-11; `apps/desktop/src/update.ts`,
    `main.ts`, `electron-builder.yml`, `.github/workflows/desktop.yml`). The owner asked: "Can
    you support updating in all of the desktop apps now that it is a public repo?" Until then
    a newer app was installed by hand over the old one. They gave no design; the choices
    below are mine.
    - **A release reads the repository's newest release.** electron-updater does the work.
      A tag's run packs the app knowing one address, `<repository>/releases/latest/download`
      (flags to electron-builder in `Pack it`; nothing is in a tracked file, and a fork's
      releases read the fork's), and packing leaves a `latest*.yml` beside each system's
      file, which says the version, the file and its checksum. Those, and a `.zip` of the
      Mac's app, are published with the release. The app asks for its system's `.yml` when it
      starts and every four hours (`UPDATE_EVERY_MS`), and fetches what it names when that is
      newer. The repository had to be public for this: a private one's files need a token.
    - **Only a release does.** A copy packed by hand, or by a run that was not for a tag, has
      no `app-update.yml` beside it and looks nowhere (`notUpdating`); it would otherwise be
      replaced by the newest release within minutes of being tried. `DC_DESKTOP_UPDATES`
      names another address for one run, or none: the tests use both.
    - **When it becomes the newer one** (`restartToUpdate`, `mayRestart`): when it is quit;
      when its owner chooses **Restart to Update** in the tray menu or under This Computer,
      which shows the version and how far along it is; or by itself, once no window of it is
      showing, no agent is using the screen and the daemon has said nothing for five minutes
      (`QUIET_MS`). The app runs for weeks on machines nobody sits at, which is where it was
      being installed by hand. Restarted by itself it opens no window when it comes back
      (`restarted` in its settings). A command an agent left running for longer than five
      silent minutes is cut off by that restart, as it is by the daemon's own after fifteen.
    - **Each system's way.** macOS: Squirrel takes the `.zip`, and only from whoever signed
      the app it has, so an unsigned build cannot update. Windows: the newer NSIS installer
      is run unseen; it is unsigned, and what vouches for it is the release's checksum over
      HTTPS. Linux: the AppImage file is replaced by one named for the newer version, the
      file that opens the app at sign-in is pointed at it, and the app starts it itself, from
      a shell that waits for the old one to go, with what the old one was started with:
      electron-updater starts it with nothing, and Electron's own relaunch runs from the
      AppImage's mount, which is gone by then. That shell closes what it was handed open, or
      the old AppImage stays mounted for as long as the newer app runs.
    - **The AppImage starts itself with the newer runtime** (`toolsets.appimage` 1.0.3). The
      older one needs libfuse2, which the owner's Linux machine does not have: the app ran
      there unpacked, and an unpacked copy cannot replace itself. The newer one mounted there.
    - **Checked here, on Linux, with real AppImages:** a 0.9.0 started hidden against a feed
      with 0.9.1 fetched it, replaced its file, rewrote the sign-in entry and was running as
      0.9.1 with the same arguments a minute and a half later, the old mount gone; one with
      its window showing fetched 0.9.2 and stayed as it was until it was quit, when the file
      was replaced and nothing was left running; that 0.9.2, packed with the newer runtime,
      then started. `apps/desktop/e2e/update.spec.ts` gives the app a feed of its own: on
      every system it finds, fetches and offers the newer version, and on Linux restarting
      puts the file in place and starts it. `test/update.test.ts` has the rules.
      **Not checked:** an update on macOS or Windows from one real version to the next. What
      is fetched in the test is no app, so there the test ends at the offer (on a Mac, at
      macOS refusing it). The first release with this in it cannot be updated _to_ by the
      apps before it, which have to be installed by hand once more; the release after that is
      the first real trial on all three.

53. **Apps: people's own accounts on other services, through Composio** (2026-10-11;
    `packages/agent/src/connectors.ts`, `apps/web/src/components/settings/connectors.tsx`).
    The owner asked what a "1-click composio integration to connect all of your accounts for
    agent access" would be like, said "Composio handles gmail right which is a huge one", and
    then "please go forth and add the composio integration". In the same conversation they
    asked for the default model to be Claude Haiku 5.5 (`DEFAULT_OPENROUTER_MODEL`). That is
    what a deployment with only an OpenRouter key starts new agents on. One that names its
    models and no default still starts on the first it names, so do.computer is unchanged
    until `DC_DEFAULT_MODEL` is set for it.
    - **What it is.** Apps is an ordinary connector whose address is Composio's own MCP server,
      `https://connect.composio.dev/mcp` (`APPS_URL`). That server has people sign in with a
      Composio account of their own and lets an app register itself, so the sign-in is the one
      every connector has and the deployment holds no key. A connector at that
      address has `kind: "apps"`, whether it was added by the button or typed in by hand.
    - **Adding it** is `POST /connectors` with `{ "apps": true }`, which the Connect apps button
      sends and which fills in the name and the address, or the agent's `connectors` tool with
      `add_apps`, which asks leave like any change to connectors and puts a Sign in button
      beside the chat. There is one: asked for again, it is the one there is, tried again.
    - **Permissions.** When it is added, before anyone has signed in, its rule is set to Ask
      first (`appsAdded`). Three of Composio's tools are let through (`APPS_LOOKUPS`): the
      search, the schemas, and the one that makes a sign-in link for a service. Everything
      else it offers is asked about, by name or not.
    - **What any connector's call may bring back** is now cut at 60,000 characters, with a
      line saying so. A mailbox came back whole otherwise.
    - **`DC_APPS_URL`** moves Apps for the browser tests, as `DC_SLACK_API_URL` moves Slack.
    - **A first version was built and thrown away the same day.** It used a Composio project
      key held by the deployment (`COMPOSIO_API_KEY`), with accounts kept per workspace and
      listed in the app. The owner asked "I thought composio lets people oauth themselves",
      which it does, and then for the key to go: "add the per person button and replace the
      key mode if possible". What that version showed about Composio's REST API is not needed
      by anything here.
    - **Mine, not the owner's:** Ask first to begin with, and which tools are let through; the
      name Apps; that a hand-typed Composio address counts as Apps; the cut at 60,000
      characters; no mock-up was made first.
    - **Not done, or not known:** nobody has signed in to Composio through this, so which
      tools its server offers a signed-in person is taken from the keyed version (search,
      schemas, connections, run) and from Composio's documents. If their names differ, Apps
      still works and simply asks about all of them. Composio's sandbox tools cannot be
      switched off this way. A sign-in is per agent: a second agent signs in again. The
      agent's chat is not told when someone finishes signing in to a service, only to Composio.
    - **Tested:** `packages/agent/test/apps.test.ts` and `apps/web/e2e/connectors.spec.ts`,
      against a stand-in. By hand, on the Node server with no setting at all: Connect apps led
      to Composio's sign-in page, and the connector was left waiting with its rule on Ask
      first. Nothing was run on Workers.

54. **The app database is read less** (2026-10-11; `apps/daemon/src/pairing.ts`, `main.ts`,
    `apps/web/src/server/auth.ts`). The owner asked what is in D1, what its limits are with
    thousands of users, and whether to move to Postgres. The answer was to stay: it holds only
    who exists and who owns what, a few rows a person, read by key; chats, memory and the
    library are in each agent's and workspace's own storage. One database answers one query at
    a time, so what matters is how often it is asked. They then asked for the two things that
    asked most to be fixed. The numbers below are mine.
    - **A daemon waiting to be paired asks less often.** It asked every three seconds for as
      long as nobody confirmed its code, which an app left installed and never signed in to
      does for good: on do.computer that was four in five of a day's reads. It now asks every
      three seconds for its first five minutes and every thirty seconds after (`pollDelay`),
      about a tenth as often over a day. The price: a code confirmed more than five minutes
      after the daemon started is collected within thirty seconds, not three.
      `DC_DAEMON_POLL_MS` still sets the first pace, for tests.
    - **Who is signed in is kept in a cookie for five minutes** (Better Auth's `cookieCache`,
      `SESSION_CACHE_SECONDS`). Every signed-in request read the session and then its user. A
      request that brings the cookie is answered from it, and one whose cookie has run out
      reads the database and is given a new one, by the app's own routes as well as Better
      Auth's. The price: a session ended from elsewhere, or a changed name, is believed on
      other devices for up to five minutes. Signing out clears it on the device that did.
    - **Not done:** a daemon in an installed desktop app is replaced only by a newer app, so
      apps already installed and unpaired ask as before until a release. The mobile app keeps
      its own cookies and is not given the new one by the app's routes, so its requests read
      the database as before. Read replicas or smart placement, for people far from the
      database, were described to the owner and not built.
    - **Tested:** `apps/daemon/test/pairing.test.ts`. By hand on the Node server and on the
      Workers runtime: signed up, deleted the session's row, and a request with the cookie was
      still answered as signed in while one without it was refused; a request with no cookie
      of the kind was given one by `/api/me`; signing out cleared both.

55. **Doods in a post, and a waiting list** (2026-10-11; `apps/web/src/server/doods.ts`,
    `apps/web/src/server/waitlist.ts`, `apps/web/src/components/dood`,
    `packages/protocol/src/dood.ts`, `prototypes/dood-embed`). The owner linked a game that is
    played inside a post on X and asked "Can we make it so you can hatch a Dood and share it
    on twitter embedded?", with a button to sign up and claim it. To the mock-up: "I love
    this!", treats given to a claimed one should "actually get presents", "a loot box present
    with 3 choices in the flow", and "randomly reroll your guy if you don't like him". Then,
    for claiming while the deployment is shut: "a new release mode called waitlist where the
    admin and people they invite can use the app but everyone else is waitlisted".
    - **How a page gets into a post.** X's player card: the page's head says `twitter:card`
      `player`, its own address as `twitter:player`, 480 by 480, and a picture. X shows the
      picture and, played, the page in a frame. The game the owner linked does exactly this.
      X stopped playing such cards for some hours on 2026-10-08 and started again; whether it
      plays one from this deployment's address is only found out by posting one.
    - **A Dood** is a row of `dc_doods`: a name, a color, a seed, at most one thing on, and
      the hash of a key its hatcher's browser keeps (`localStorage`, `dc-dood`). `/hatch` and
      `/dood/<id>` are one component (`DoodCard`) over the first run's `Stage`. Making,
      stroking and feeding one need no account and are counted by address (`rate-limit.ts`;
      strokes apart from the rest, since they are told every four seconds). The three things
      in a present follow from the seed (`dealPresent`), so the server can tell that what was
      kept was in the box without keeping anything.
    - **Claiming** is `/welcome?dood=<id>&key=<key>`: the first run with the Dood out already,
      asking only who they are. Signed in, `POST /api/doods/:id/claim` makes it theirs and
      `POST /api/doods/:id/agent` makes it their agent (`wakeDood`: an agent in their own
      workspace, named and looking the same, with what it wore and the treats it was given
      while it waited). A treat for one that is an agent goes to the actor's `/gifts`, which
      only the gateway can call; the row keeps how far along the next present is, so that a
      page anyone can open never wakes an agent to be drawn. A change of the agent's name,
      look or outfit is copied to the row (`followAgent`, from the agents' proxy route).
    - **The waiting list** is `DC_SIGNUP=waitlist`. `getUser` answers nobody for someone who
      is waiting, which is what shuts the whole app, sockets included; `getSignedIn` is for
      the few things they may do (`/api/me`, their Dood, accepting an invitation). What is
      written down is who was let in (`dc_admitted`), never who waits, so that a failed write
      leaves someone out. Let in without a row: accounts from before the list began (its
      start is kept in `dc_meta` as the sign-in is first set up), the first account, the
      addresses the settings name where they are vouched for, and anyone in a team or asked
      into one by address. With any sign-up but `invite`, an address the settings name counts
      only if it is verified, or the account is from before, or it is the first
      (`vouchedFor`). Someone waiting is sent to `/welcome` from every page of the app, where
      their Dood is; with none yet, the scene hatches one for them and not an agent.
    - **Mine, not the owner's:** two taps to crack the egg; that the reroll keeps the name and
      color and comes after the hatch; the three choices being a common, an uncommon and a
      rare or epic thing; four treats a present (the app's own number); one treat a day from
      an address; that an unclaimed Dood only counts its treats; that a Dood's picture in a
      post is a stock one of its color; no list of refused words; that a waiting person who
      signs up from the landing page gets no present to choose from (their agent has the
      app's own first box); that being invited to a team lets someone in; the email on being
      let in; every line of copy.
    - **Not done:** nothing limits how many unclaimed Doods there can be beyond the rate
      limit, and none is ever removed. The mobile and desktop apps know nothing of the list:
      someone waiting who signs in to either is refused everywhere with a 403 the apps show
      as an error. The list shows the 200 who have waited longest and has no search.
    - **Tested:** `packages/protocol/test/dood.test.ts`, `packages/agent/test/creature.test.ts`
      (gifts), `apps/web/src/server/waitlist.test.ts`, `apps/web/e2e/dood.spec.ts` and
      `apps/web/e2e/waitlist.spec.ts`. By hand on the Node server, with the creature drawn:
      the whole path from the egg at 480 by 480 to claiming, waiting, being let in and the
      chat; the page in a frame of another origin. On the Workers runtime locally, over the
      API: the list, letting someone in, a Dood woken into an agent, a treat reaching its
      actor, and both pages' heads. Not run: a real post on X, a sign-in with GitHub or Google
      along the way, the email, a phone, the deployed Worker.
56. **Guides on the site, which an agent can be given** (2026-10-11; `docs/`,
    `apps/web/src/lib/docs.ts`, `apps/web/src/components/docs`, `prototypes/docs`). The owner
    asked for "a docs page on the website that has guides", the first being how to self host,
    and that "you should also be able to give the guide to an agent via a link to set it up".
    They chose the mock-up ("I love this can you build this for real"), said the README's
    sections could be replaced, and that the guides are served on every deployment. The rest
    is mine.
    - **A guide is one Markdown file in `docs/`**, served twice: `/docs/<name>` is a page, sent
      whole, and `/docs/<name>.md` is the file itself. So what a person reads and what their
      agent follows are the same text. `/docs` opens the first guide, and `/llms.txt` lists
      them. A file added to `docs/` is a guide; `ORDER` in `lib/docs.ts` says which come first.
    - **The page** has the landing page's top line and colors, the guides at the side with the
      open one's sections, and a card, "Have an agent set it up", whose prompt holds the
      address of the file at that deployment. Three things are drawn specially and each is
      plain Markdown in the file: `**Needs you:**` is the mark on a step that waits for the
      person, a paragraph that starts `Check:` gets a tick, and a quote is a note set apart.
    - **The guide, `docs/self-hosting.md`,** took over the README's "Run it on Node" and
      "Deploy to Cloudflare". It is written to be followed by an agent as well: a note to
      agents first, a check under each step, and keys only ever typed by the person. On Node a
      key goes in a settings file read with `node --env-file`, which the user service reads
      too, so no key passes through a chat.
    - **What was run.** The Node half, from a clean clone on this machine: install, build,
      start, the health check, the settings file, and the user service, which came back after
      being killed. **The Cloudflare half has not been run from nothing.** Its order differs
      from the old README's: it deploys before it sets the secrets, so that `wrangler secret
put` never has to ask whether to make a Worker. The first person to follow it on a new
      account is its test.

57. **A restyle of every page** (2026-10-11; `apps/web/src/styles.css`, `components/ui`,
    `components/shell`, `components/chat`, `prototypes/polish`). The owner showed T3 Code and
    asked whether anything could be taken from it "to make the app look a little more
    professional", naming "typeography, shadows, and layout". They saw the chat page restyled,
    asked for "a restyle of all of the pages", and then for it to be merged. They did not answer
    which typeface or whether their own messages should be pale, so both are mine.
    - **Three levels over a frame.** The app sits in a tinted frame (`bg-frame`) and the page is
      a rounded sheet on it. Above that are `shadow-raised` (what is chosen in a list, a card),
      `shadow-card` (the page) and `shadow-float` (the message box, menus, windows). Each is a
      hairline with a shadow under it, and in the dark theme each is a step lighter. They are
      set in `styles.css`; nothing else should draw a shadow of its own.
    - **Type.** Geist in place of Inter, which the landing page and the guides keep. What the
      agent says is the page's own text at 16px with no bubble; a person's own messages are a
      pale tint of the agent's color, and other people's stay grey. Labels are in sentence
      case. The chat's column is 45rem.
    - **The shell.** The sidebar has no line beside it and the strip none under it. The open
      agent, the open file in the library and the open section of a settings window are raised
      rows. The strip's tabs are one control. The agent's panel, a side chat and a document
      beside a chat are cards in the sheet, `BESIDE_GAP` in from its edge, and a document is
      still no wider than leaves the chat `DOC_PANEL_LEAVES`.
    - **Fields and cards.** Fields are white with a hairline where they were grey fills. Cards
      are white and raised where they were grey with a border: automations, computers, file
      cards, and the cards an agent asks through. Sign-in, pairing a computer, the desktop
      app's sign-in and an invitation are a card on the frame.
    - **A fault it fixed.** With a file open in the library, the Chat tab was marked as the
      open page as well as Library, because a link to the agent's own address is taken as open
      on every page under it. That link is now matched exactly.
    - **Left alone:** the landing page, the guides, the first run, the Dood pages, the creature
      and the inside of its wardrobe, and the native app in `apps/mobile`.
    - **What was looked at.** `prototypes/polish/tour.mjs` takes a picture of every page from a
      running server, and was run against the build before and the build after: the chat, an
      empty chat, a side chat, a document beside a chat, the library, automations, every
      section of both settings windows, the menus, the wardrobe and sign-in, some of them in
      the dark theme and at a phone's width. **Not seen:** an approval or a secret being asked
      for, an agent using a screen, sub-agent chips, Slack threads and a team with other people
      in it, which the echo model does not produce, and Safari. Three measurements in
      `e2e/layout.spec.ts` changed with the look.
58. **One settings window** (2026-10-12; `apps/web/src/lib/settings.ts`,
    `components/settings/settings.tsx`, `settings-dialog.tsx`, `lists.tsx`). The owner found
    "the IA between all of the settings, workspace / user / agent" confusing. There were two
    windows for four owners: the agent's, and the workspace's, which also held what is the
    user's own (the defaults for new agents, notifications) and the deployment's (server models,
    the waiting list), and opened from the menu on the user's name. They were shown one window
    grouped by owner, asked instead for "an Agents tab that lists the agents and you can click
    on them", the same for workspaces, with the agent's settings icon "just a short cut there",
    saw that mocked up, and said to build it.
    - **The top of it** is what is the user's own (General: the theme, and the model and
      computer a new agent starts with; Notifications), two lists (Agents, by workspace, each
      saying its model and computers; Workspaces, with invitations and New team), and for
      whoever looks after the deployment, Server (Models, Waiting list).
    - **Inside an agent or a workspace** the list of sections becomes its own, under a way back
      to the list it was chosen from. An agent has Profile, Memory, Model and computers,
      Skills, Connectors, Permissions and Usage; a workspace has People (a team only),
      Computers and Models. The sliders icon on an agent's strip, and Settings in the menu of
      its row, go straight inside that agent; Workspace settings, now in the workspace's menu
      at the top of the sidebar, goes straight inside that workspace; Settings in the menu on
      the user's name opens the top.
    - **The address** is one parameter: `?settings=general`, `?settings=agent.<id>.memory`,
      `?settings=workspace.<id>.computers`, and with no section (`agent.<id>`, or `all` for the
      top) the list itself. A wide screen shows the first section beside the list; a narrow one
      shows the list alone and then the section chosen from it, with a bar at its top that
      leads back. Addresses from before (`?settings=identity`, `?workspace=team`) still open
      where they led, on the agent or workspace on screen.
    - **What moved, which is mine and was in the mock-ups:** Identity is Profile, with moving
      and deleting the agent at its foot where they were a section of their own; "About you"
      (or "About the team") is under Memory; Slack is a card among the Connectors that opens
      its own page; the theme is a choice of three under General (System is new: it forgets
      what was kept and follows the device) where it was a row of the user's menu, which is now
      Settings, Invite people and Sign out.
    - **Also mine:** a workspace's Computers list only what is that workspace's or what one of
      its agents works on, where every workspace used to list every computer the user could
      see. A link from one level to another (an agent's model to its workspace's Models) goes
      inside that workspace, and the way back from there leads to Workspaces and not to the
      agent.
    - **Checked:** `e2e/settings.spec.ts` (the lists, the ways in, old addresses, the theme, a
      phone) and `src/lib/settings.test.ts`; every other browser test opens settings through
      the helpers in `e2e/helpers.ts`, which follow the new ways in. Looked at on a wide screen
      and at a phone's width, in the light theme. **Not seen:** a team with several people and
      agents in the lists, an invitation in the Workspaces list, the Server group as an admin
      by eye (its tests pass), and Safari. The native app in `apps/mobile` is as it was.
59. **One row at the top of an agent's pages on a phone** (2026-10-12;
    `components/shell/agent-strip.tsx`, `app-skeleton.tsx`, `lib/use-wide.ts`). The owner sent
    a picture of their phone and said "this two tier tabs and header is a bit strange on
    mobile". They were shown three drawings (the pages in the name's menu; the tabs in the row
    in place of the name; two rows made to look like one header) and chose the first.
    - Under `md` the strip is one 48px row and has no tabs in it. The menu on the agent's name
      starts with Chat, Library and Automations, with the open one ticked, and the other
      agents are under them as before. Off the chat the name is followed by the page
      ("Juniper · Library"); a long name is cut short before the page is.
    - Seeing that, the owner said "i don't like that we are now missing the back button" and
      "it looks hard to go back to main chat". So on Library and Automations the row starts
      with an arrow back to the chat, where the button for the agents is on the chat. The
      agents are still reached there by a swipe from the left and from the name's menu. That
      the arrow takes the place of that button, and is not beside it, is mine.
    - From `md` up nothing changed: the tabs are in the strip and the menu lists agents only.
      The pages are left out of the menu there by `useMedia`, not hidden with a class, so the
      arrow keys cannot land on one that is not shown.
    - The name's button is called "…: pages and other agents" on a narrow screen and
      "…: another agent" on a wide one.
    - **What was looked at:** the chat, the open menu, the library and automations at 393 and
      320 pixels wide and the menu at 1280, in Chromium, light theme. **Not seen:** a real
      phone, Safari, a team's chat with other people's faces in the row.

60. **A guide to Apps, with pictures, linked from the app** (2026-10-12; `docs/apps.md`,
    `docs/images`, `apps/web/src/lib/docs.ts`, `components/settings/connectors.tsx`,
    `prototypes/guide-pictures`). The owner asked to "add to the docs about composio and tell
    them what they get and how to set it up with screen shots and why they would and then link
    it from the app". The rest is mine.
    - **The guide** is for whoever uses Apps, not whoever runs the deployment: what they get,
      why, the steps, asking the agent instead, what is asked first, what Composio holds, a
      team, disconnecting. It is the second guide (`ORDER`).
    - **A guide can show pictures.** They are PNG files in `docs/images`, named in the guide
      as `images/<name>.png`, which is also what shows them on GitHub. The page shows each from
      the app's own files (`pictureOf`), and `/docs/images/<name>` sends whoever follows the
      file's own address on to it. A test fails a picture that is missing or has no words.
    - **The card beside this guide** has no address in it. It says "Connect my apps.", for the
      person's own agent, which adds Apps when asked (`agentPrompt`, `handOffOf`).
    - **In the app,** the Your apps card and the Apps connector's card each link to the guide,
      which opens beside the app and leaves the settings open.
    - **How the pictures were made.** `prototypes/guide-pictures/shoot.mjs` takes all five, and
      is what to run when the app's look has changed. It starts the built Node server with a
      real model, twice: once as
      it is, for the Connect apps card, the agent adding Apps when asked, and Composio's own
      sign-in page; once with `DC_APPS_URL` at a stand-in that offers Composio's tool names
      (from Composio's reference) and canned answers, for the Connected card and the agent
      asking before it sends an email. The window was 1280 by 860 at twice the size. Nobody
      has signed in to Composio through Apps yet (item 53), so what follows its sign-in page
      is written from how the connector is built, not from having seen it.
      Each run makes new agents, whose creatures are drawn at random, and the agent's words
      are its own: the pictures kept are from a run where the two looked alike.
    - **Not done:** nothing retakes the pictures by itself; the first paragraph of Connectors
      still says an agent uses connectors "without asking first", which is not so for Apps.

61. **A README for a public repository** (2026-10-12; `README.md`, `docs/reference`,
    `docs/screenshots`). The owner said the README was sloppy, that the project is called Do
    Computer and should be called that everywhere, and asked for pictures of the app and for
    it to be tidied into what a public repository shows. The rest is mine.
    - **The README** is now short: the name and icon, a picture of a chat (the dark one for
      whoever reads GitHub in the dark), what an agent can do in a line each, four more
      pictures, a quick start, where it can be hosted, where it is used, links to the guides
      and the reference, and development.
    - **Nothing was thrown away.** What the README said at length is in `docs/reference`, a
      file to a subject, in the words it had: configuration, computers, models, security and
      trust, what an agent can do, teams, Slack, Apps, Doods and the waiting list,
      notifications, the desktop app and the mobile app. They are not guides: only a file
      directly in `docs/` is served under `/docs`. The self-hosting guide's link to the full
      list of settings goes there now.
    - **The pictures** are in `docs/screenshots`, not `docs/images`, since every picture in
      `docs/images` is built into the web app. They are six of `prototypes/polish/tour.mjs`'s,
      made 1600 wide (its README says how).
    - **The name.** `PLAN.md`'s title and the old mock-ups that said "durable computer" say Do
      Computer. Still named durable-computer, and not changed then: the packages (renamed in
      item 66), the Worker, database and bucket, and `~/.durable-computer` on a paired
      computer. Renaming those last changes running deployments and paired machines.
62. **The sidebar lists every workspace's agents** (2026-10-12;
    `apps/web/src/components/shell/agent-list.tsx`, `workspace-menu.tsx`, `sidebar.tsx`,
    `lib/atoms.ts`). The owner sent a picture of another app's list of agents (headings that
    fold, and under each its agents, every row with the agent's latest line, a time and a dot)
    and asked for a mock-up "where we keep the workspaces in the sidebar separated". Of the
    mock-up they asked whether "the selection state should be flush with the workspace
    header", were shown it both ways, and said: "can you build this also don't show any
    sections unless you have a workspace". The mock-ups were pages shown in the thread and are
    not in `prototypes/`.
    - **The list.** Someone in a team has every workspace of theirs in the sidebar at once,
      their own first, each under its mark and name. The name folds its agents away, which is
      kept in the browser (`dc-folded-workspaces`); folded, the heading shows a few of the
      creatures. Someone in no team has their agents under "Agents" and no workspace's name,
      as before. A heading has no padding of its own, so its two ends are where the chosen
      row's are, and so are the ends of the row at the top, which is now the app's name and
      the button that hides the sidebar. A row is as it was: the creature, the name and the
      agent's tagline, in the order the agents were made.
    - **A heading's name is level with its mark by its letters, not by its line.** The owner
      sent a picture in which the name sat a pixel and a half above the middle of the mark.
      It did not here: a line of text is as tall as its font says, and that is read
      differently from one system to the next. So the name, "Agents" and the app's name at
      the top are trimmed to the height of a capital (`text-box`, the `LEVEL` class in
      `agent-list.tsx`), and what is centred is the letters. A browser without `text-box`
      (Firefox, at the time) lays them out as before. Checked here by giving the name a font
      whose line is laid out higher, which moved it 1.25px without the trim and not at all
      with it; not seen on the owner's machine.
    - **What moved.** There is no workspace menu: nothing is switched between. A heading has
      the workspace's own menu (its settings, and inviting people to a team) and a + that
      makes an agent in that workspace. New team and the invitations waiting for the user are
      at the foot of the list. The panel that said who is where in a team is gone: the people
      in the team now are faces on its heading (which opens People), and whoever is with an
      agent is a face on its row, as before. That is known only for the team on screen, so a
      row with nobody at it has the agent's tagline, where a team's rows used to say "Quiet":
      of another team's agents that would not be known to be so.
    - **What was built and taken out again: the latest line.** The first version of this had
      what the mock-up's rows had: the latest thing said to an agent or by it with a time, a
      spinner on the creature while it worked and a "?" while it waited on someone, and a dot
      for what its reader had not seen. The agent kept its latest line in a document of its
      own and reported it with `working` and `asking`; the gateway kept when each person last
      looked at an agent. Rows of agents that were not open were kept fresh by asking for the
      list again every 30 seconds, which asks every agent, and the owner asked "is there a
      way to do that in a more efficient way than polling". There is (the agent tells the
      gateway when its row changes, and one hibernating socket for each person carries that
      to their open tabs), and it is not built. They then said: "what if we build this without
      the latest line? just the new sections". That first version is the first commit of the
      pull request this was merged from. Item 63 is that socket.
    - **Mine, not the owner's:** New team and invitations at the foot of the list, where the
      mock-up had them; the menu and the + on each heading; that the who-is-where panel went.
    - **Checked:** `e2e/sidebar.spec.ts` (no headings without a team, the headings, a new
      agent from a heading, folding, the heading's menu) and `e2e/teams.spec.ts` (faces on the
      heading and the row); the other browser tests reach a workspace's settings through
      `workspaceMenu` in `e2e/helpers.ts`. Looked at with pretend agents in three workspaces
      on the built Node server: light and dark, folded, and at a phone's width. **Not seen:**
      a team with other people in it by eye (the tests cover it), Safari, a real phone, the
      desktop app, and Workers. The native app in `apps/mobile` is as it was.

63. **A row in the sidebar says the latest from its agent, pushed and not polled**
    (2026-10-12; `packages/agent/src/actor.ts`, `apps/web/src/server/feed.ts`,
    `presence-actor.ts`, `agent-seen.ts`, `apps/web/src/lib/latest.ts`,
    `components/shell/agent-list.tsx`). This is what item 62 took out, put back the way the
    owner asked for when it went: "do a follow up change to show the last response / if the
    agent is working efficiently like we talked about".
    - **A row** is the creature, the name with a time beside it, and under it the latest thing
      said to the agent or by it, on one line: "You: …" or a teammate's first name for what a
      person wrote, the agent's answer as it is, a scheduled task's title before what it came
      to, "From Scout: …" for another agent's message, and what it is asking for when it has
      stopped to ask. The creature has a spinner on it while the agent is at work and a "?"
      while it waits for someone. A row with something its reader has not seen has a bold
      name, a dot and its time in the accent color. Agents are in the order they were last
      heard from, and one that never was counts from when it was made. A folded workspace's
      heading has a dot when one of its agents has something new or is waiting.
    - **The agent keeps its latest line** in a document of its own (`LatestDoc`), written when
      a person writes to it, when a run ends with an answer in a chat of theirs, when a
      scheduled run reports, when another agent writes to it, when it answers in Slack and
      when it asks for an OK or for something to be typed in. No transcript is read for it.
      What it asked for stays its line until someone answers. Its summary has `latest`,
      `working` (a run going or waiting its turn, or a sub-agent still to report; a command
      left running in the background is not) and `asking` (a request nobody has answered).
      An agent from before this has no line until something is next said.
    - **How a row stays current.** Each time one of the three changes, the agent says so
      (`onActivity`), once for each change. The server looks up who the agent works for, its
      owner or everyone in its team, and tells each of them on a feed of their own
      (`feed.ts`), which their open tabs hold one WebSocket to. The page puts what it is told
      into the list of agents, which every row is drawn from. Nothing is asked for on a
      timer: the list is asked for when the page loads and each time the socket comes back
      up, since what is said while it is down is said to nobody.
    - **A person's feed is the presence actor of their personal workspace.** A team's presence
      actor says who is where; a personal workspace has nobody to be present for, so its
      address (`/api/presence/personal:<user>`) is its owner's feed, and only they are let
      in. It is the same Durable Object class and the same namespace, chosen by the actor's
      name (`createLiveActor`), so nothing was added to the Worker's bindings or migrations.
      The actor keeps nothing and its sockets hibernate. Telling someone with no tab open
      costs one request to an actor that has nobody to pass it to.
    - **What is new to whom** is the gateway's: `dc_agent_seen` holds, for each person apart,
      when they last looked at an agent (`PUT /api/agents/<id>/seen`, by the server's clock),
      and the list carries it as `seenAt`. The page says so when an agent is opened and
      whenever something comes from it while the page is the one being looked at, and the
      person's other tabs and devices are told on the same feed. What a person wrote
      themselves is not new to them. An agent they have never opened since this was kept is
      not marked at all: there is nothing to measure against.
    - **Mine, not the owner's.** The order (latest first; they were asked and did not say),
      the times (now, 9:20 AM, Yesterday, Fri, Oct 2), that an agent never looked at is not
      marked, that a row's menu comes out over its time under a pointer and is not there on
      a touch screen, where the agent's strip has the same pages, and that the feed shares
      the presence actor's class.
    - **Where a row can be behind.** If new work arrives in the moment an agent is found to
      have come to rest, that it stopped is said at its next request or wake-up, up to twenty
      seconds on. An answer that finishes after the agent's process was restarted is not kept
      as its line: the row says it is no longer working and keeps what was said to it. When a
      request is answered or withdrawn and nothing more is said, the "?" goes and the line
      still has what was asked. An update that arrives while the list itself is being fetched
      can be overwritten by the fetch, until the next update.
    - **In the browser tests** `page.getByText` leaves the rows' lines out (the `page` fixture
      in `e2e/fixtures.ts`, by the `data-latest` on a row's line): a row repeats the start of
      what was just said a moment after it is said, so the same words would be one thing or
      two by how fast the row caught up. A test about a row asks the row. A page a test opens
      for itself is not covered by that.
    - **Checked:** `e2e/sidebar.spec.ts` (a row of an agent that is not open changes with no
      request for the list; the marks; unread and what takes it away, on a second tab too;
      nobody else's feed can be joined), `src/server/feed.test.ts`, `agent-seen.test.ts`,
      `src/lib/latest.test.ts` and the agent's own tests. Looked at with pretend agents on the
      built Node server. **Not seen:** a real model's answers in the rows, Slack and another
      agent's message in a row by eye, a team with other people in it by eye, Safari, a real
      phone, the desktop app, and Workers, where the feed's sockets have only run in the
      tests' local runtime if at all. Under `pnpm dev` on Node there is no WebSocket server,
      so rows there change only when the list is next asked for. The native app in
      `apps/mobile` is as it was.

64. **What a new agent offers to do first shows what it can do** (2026-10-12;
    `apps/web/src/lib/starters.ts`, `components/chat/chat-view.tsx`,
    `apps/desktop/src/page-bridge.ts`, `main.ts`). The owner asked for "a few different pills
    of things you can have it do" at the end of the first run, to "show off the power of do
    computer", and named one: "draw a picture with a painting app on my computer", so that
    "it can pop it up and you can watch it like doodle on it". They chose from a list.
    - **The buttons** under the agent's hello, by what it was given in the first run. On a
      computer it may work on: Draw me a picture, Make me a little game, What's filling up
      this computer?, Check in with me every morning. With no computer, or one it may only
      read: Make me a little game, Research three things at once, Check in with me every
      morning. A button says a whole sentence for whoever pressed it, which the chat shows as
      theirs (`say` in `starters.ts`): the game is asked for in the chat itself, the disk as a
      chart, the research with sub-agents, the check-in for nine each morning.
    - **Drawing takes the screen, which is off until its owner says otherwise** (item 31). So
      the button asks the desktop app first (`askForScreen` on the page's bridge), and the app
      asks its owner itself, in a message box of its own: "Let agents use this computer's
      screen?". A page cannot draw that question or answer it. Allow switches the screen on,
      starts the daemon again and waits for it to be connected, and only then is the agent
      asked. Not Now leaves everything as it was and nothing is said. With the screen on
      already, nobody is asked. On a Mac that has still to allow Accessibility or Screen
      Recording, the app opens its window about this computer, which has a button for each,
      and the page says to allow them and ask again. Where the screen cannot be asked for
      (no driver, not shared, read-only) the page says why. An app from before this has
      nothing to ask: the sentence is sent and the agent says whose it is to switch on.
    - **Mine, not the owner's.** The wording of each sentence, that the agent draws itself,
      nine in the morning, which three are offered with no computer, that a read-only
      computer gets those three, and that a page of the deployment may now make the app put
      the screen question at any time, not only in a first run. No stroke was added to the
      screen tool: a drag is still one straight line a call, and the owner said drawing
      "works ok" as it is.
    - **Checked:** `apps/desktop/e2e/desktop.spec.ts` (Not Now, then Allow, with the message
      box answered from the test; the daemon says it has the screen before the agent is
      asked), `apps/web/e2e/welcome.spec.ts`, `src/lib/starters.test.ts`,
      `apps/desktop/test/page-bridge.test.ts`; the buttons looked at on the built Node server
      at window and phone width. **Not seen:** any of the five done by a real model, the
      message box by eye, anything on macOS or Windows, and the two macOS permissions being
      asked for from here. The desktop half reaches people in the next desktop release.

65. **The native app does what the web app does on a phone, and is laid out as an iOS app**
    (2026-10-12; `apps/mobile`, `packages/client/src/index.ts`, `apps/web/e2e/mobile.spec.ts`,
    `scripts/island.mjs`, `scripts/icons.mjs`, `prototypes/ios-app`). The owner asked for "a
    full pass on the mobile app to make sure it has all of the features of the mobile web and
    … make it feel like a native ios app", chose from a mock-up (`prototypes/ios-app`), and
    then asked for it to be built and tried on their MacBook Air. The app was five tabs for
    one agent. It was written again from its data layer up; only the creature's drawing, the
    Markdown parser and the dictation and push helpers were kept.
    - **Layout.** No tab bar. The app opens on the agents under their workspaces
      (`app/(app)/index.tsx`), as the web's sidebar has them, with the latest line pushed
      over the person's feed. An agent's row opens its main chat. The agent's name in a chat
      opens a page of its own (`a/[agentId]/info.tsx`) that holds what the web splits between
      the agent's panel and its settings, so a phone has the running work, the files shared in
      a chat, the steps behind an answer and Start fresh. Settings are a sheet from the
      person's face. `app/(app)/_layout.tsx` names the routes that arrive as sheets.
    - **The kit** is `apps/mobile/src/ui`: text in iOS's styles, grouped rows, buttons, SF
      Symbols on iOS and drawings elsewhere (`icons.ts`), Liquid Glass where there is any
      (`expo-glass-effect`), the bar's own buttons and pull-down menus (`Stack.Toolbar`),
      swipe actions, haptics, and a confirmation before anything that cannot be taken back. A
      file that has an iOS version beside it (`menu.ios.tsx`) must not import its own base
      name: on iOS that is itself.
    - **What it shares with the web.** `packages/client` opens its feed and presence sockets
      with the constructor it is given, so the phone passes one that sends its session
      cookie, and follows agents over sockets as the web does. Nothing else outside
      `apps/mobile` changed but the browser tests and the icon script.
    - **Four things that had never worked on a device**, found by running it: the session
      cookie was read as if it were at hand when the auth library hands it over later, so no
      signed-in request could succeed; three.js could not start in a GL view, which has no
      canvas of its own, so no creature was ever drawn; a phone's JavaScript has no `crypto`,
      which the shared code makes ids with, so nothing could be sent; and two GL views
      started at the same moment do not always both reach the screen, so each now waits its
      turn (`src/ui/gl-turn.ts`).
    - **Checked.** Built on the owner's MacBook Air (Xcode 27, an iPhone 17 simulator on iOS 27) and driven there with Maestro against the built Node server: signing in and out,
      the agents list with the feed changing a row, a chat with a streamed reply and the
      keyboard up, the side chats sheet, the agent's page and each of its settings pages,
      the wardrobe, opening a box and wearing what was in it, the library with a folder, a
      Markdown document and a table, the share sheet, automations and one automation,
      settings and General, new team, pairing, and the first run as far as the naming card.
      `apps/web/e2e/mobile.spec.ts` was written again for the new app (13 tests through the
      browser build), and the app's unit tests grew from 1 file to 8.
    - **Not seen:** a physical phone; Android; dark mode on the simulator; a real model;
      dictation, the camera, the photo picker and attaching files; a visual, a screen in use,
      sub-agents and background commands in a native chat (their code is the web's rules,
      drawn natively, and only type-checked and run in the browser build); a team with other
      people; a paired computer; signing a workspace in to a model provider; GitHub and
      Google sign-in; an invitation; push notifications; the rest of the first run after the
      name (the browser tests do go through it). Signing up in the simulator stopped at the
      system's strong-password offer, which the test tool could not answer. Creatures start
      one after another, about half a second each in the simulator, with their still
      picture until then. A hold on a row brings up the system's sheet of actions and not a
      context menu with a preview: the menu views either hid the row from VoiceOver or let
      it be only as wide as its words.
    - **Chosen without the owner being asked:** no tab bar and the agent's page (both were in
      the mock-up they approved), turn-taking for creatures, do.computer as the server a
      phone starts on, sockets for following agents, and leaving the mock-up's "Outside the
      app" extras unbuilt.

66. **The packages are `@do-computer/*`, and the phone app has names of its own**
    (2026-10-12; every `package.json`, every import, `.github/workflows`,
    `apps/mobile/app.config.ts`, `apps/web/src/server/auth.ts`). The owner asked how much work
    it would be to call everything do-computer and whether it would break the live site, and
    then for the parts that would not.
    - **Renamed:** the package scope (`@durable-computer/*` to `@do-computer/*`) and the
      root package; the name the server gives itself to GitHub, to connectors and in a few
      labels (`user-agent`, the MCP client name, the label on a Daytona machine, the default
      address notifications are signed with); and the phone app's Expo slug, its address
      scheme (`docomputer://`, which the server trusts sign-ins from and must match), and its
      ids: `computer.do.app` on iOS, beside the desktop app's `computer.do.desktop`, and
      `com.docomputer.app` on Android, where a part of a package name may not be `do`.
    - **Not renamed, on purpose:** the Worker, the D1 database and the R2 bucket
      (`durable-computer` in `wrangler.jsonc`): a Worker's Durable Objects belong to it by
      name, so a renamed one would start without any agent's chats or memory, and the
      database and bucket cannot be renamed at all. `~/.durable-computer` on a paired
      computer, the daemon's service names and its command: a daemon that looked elsewhere
      would lose its pairing. The default Modal app, which is where existing machines are
      found. None of these is seen by anyone using the app.
    - **For whoever runs commands by hand:** `pnpm --filter @do-computer/web …` where it was
      `@durable-computer/web`. A script outside the repository that names a package has to
      be changed with it.
    - **Checked:** `pnpm check`, every package's tests, the web and desktop builds, and the
      browser tests. **Not seen:** a deploy from the renamed tree, and a phone app built
      under the new ids, which nobody had installed under the old ones.

67. **The phone app has an Expo project, so a build of it can be notified** (2026-10-12;
    `apps/mobile/app.config.ts`, `apps/mobile/eas.json`, `docs/reference/mobile.md`). The owner
    asked whether ordinary notifications worked on the phone. They did not: the app asks Expo
    for the token the server sends to, and Expo gives one only to a build that belongs to a
    project.
    - **What there is now:** the project's id in `app.config.ts`, which `EAS_PROJECT_ID`
      replaces for somebody else's build, and `eas.json` with three profiles (`development`,
      `preview` for registered phones, `production` for TestFlight and the store), which pin
      the Node and pnpm the workspace uses.
    - **Nothing changed on the server.** It already sent to Expo's push service
      (`server/push.ts`) and needs no key for it, as long as the project's "enhanced security"
      is left off.
    - **The first build in Expo's cloud failed, and why:** `babel.config.js` names
      `babel-preset-expo`, which the app did not depend on. Run through pnpm (`pnpm mobile`,
      `expo export`) it is found anyway, because pnpm's wrapper for a command adds its hidden
      folder of every package to `NODE_PATH`. Xcode's release build runs the bundler with
      `node` and no wrapper, and the preset was not found
      (`Cannot read properties of undefined (reading 'transformFile')` is what is left of that
      by the end of the log). It is a dependency of `apps/mobile` now. To run that step as
      Xcode does, without a Mac, from `apps/mobile`:

      ```sh
      env -u NODE_PATH node <@expo/cli>/build/bin/cli export:embed --platform ios --dev false \
        --entry-file node_modules/expo-router/entry.js \
        --bundle-output <file> --assets-dest <folder>
      ```

    - **Checked:** the Expo tools read the id, and the app bundles for iOS as a release build
      does. **Not checked:** a build in Expo's cloud, which needs the owner's Apple sign-in,
      and so a notification arriving on a phone, or a tap on one opening its chat.

68. **First things found on a real phone: dictation, and the agents list** (2026-10-12;
    `apps/mobile/src/lib/device-fetch.ts`, `apps/mobile/app/(app)/index.tsx`). The first build
    installed on the owner's iPhone.
    - **Dictation said `Audio of type "null" cannot be transcribed.`** Expo's fetch, which the
      app uses on a device because it can stream a reply, sends a blob under the blob's own
      type and drops the Content-Type the request names. A file read from the phone's disk is
      a blob with no type. `keepingType` wraps that fetch and hands over the blob's bytes, so
      the named type stands. The same path carries a picked attachment and a file put in the
      library, which would have arrived with no type too.
    - **The agents list looked off beside the web app's.** It had been laid out as a list of
      its own (large bold workspace names, arrows on the left, two lines under a name, lines
      between rows) and not after the web app's. It now follows `agent-list.tsx`: a workspace's
      line is small and grey and starts at the margin with whose it is (the person's face, or
      the team's tile), then its name and the arrow that folds it; a row is a creature, a name,
      the time, and one line under it with the unread dot at its end; "New team" is a grey line
      under a rule. Creatures are 44 points in a row, near the web app's 40.
    - **The message box while listening is one line.** It said "Listening" under the bars,
      which the owner did not want; the bars and the buttons say it, and the words are kept
      for a screen reader.
    - **Checked:** a test of `keepingType`, the app's other tests, and the browser tests. The
      list and the one-line box were looked at in an iOS simulator. **Not checked:** dictation
      in the simulator, which gets no microphone from a Mac reached over SSH, so the listening
      state was forced for its picture; and the upload fix on a phone since it was written.
      The owner asked for no more cloud builds for now: they are paid for.

69. **The message box has a button for the model and how hard it thinks** (2026-10-13;
    `apps/web/src/components/chat/thinks-with.tsx`, `model-picker.tsx`, `composer.tsx`). The
    owner asked for a mock-up of the model and effort pickers inside the message box
    (`prototypes/model-in-composer`), then asked whether so advanced a thing should be hidden
    a little, and chose the arrangement with one quiet button: "I love this lets ship it".
    - **One button beside the paperclip** opens a menu: a search and the models, under where
      each comes from, and under them the thinking levels of the one chosen. Each choice is
      saved as it is made and the menu stays open, so a model and then its level are one
      visit. Pointing at the button says what is chosen. Shut with Escape, it gives the cursor
      back to the message.
    - **It is the agent's own setting**, the one under Model and computers, which is still
      there: it holds for every chat with the agent, for whoever else talks to it, and for
      sub-agents started afterwards. A choice for one chat alone would be server work and was
      not asked for.
    - **Nothing is drawn where there is nothing to choose**: one model that thinks one way,
      which is a server with no key and no sign-in.
    - **The list is the settings' list.** `ModelList` is `ModelPicker` with nothing to open,
      over the same rows (`inline` on Base UI's combobox); in the menu a row leaves the model's
      id out, which there is not the room across for beside its price.
    - **A menu a button of the box opens is drawn elsewhere on the page, and what is pressed in
      it still reaches the box's own handlers**, which keep the cursor in the message: they now
      leave alone what is not inside the box. Without that the search could not be typed in.
    - **Mine, not the owner's:** the button is a brain where the mock-up had sliders, because
      sliders already open the agent's settings from the bar above the chat; and the word is
      "Thinking", as in settings, where they said "effort".
    - **Checked:** a browser test (`models.spec.ts`) that changes both from the box and finds
      them in settings and after a reload, one that the button is absent with a single model,
      and the menu looked at in both themes and at a phone's width. **Not checked:** the side
      chat's box, which gets the same button and was only type-checked; a team, with another
      person's page open on the same agent; a real model. The phone app has no such button.
 in it was dropped by the shell, a fragment such as `} agents.` at the end
      of a template string was taken for an id, and the head of `` `agent.${id}.slack` `` is an
      address and not a word. Words handed to a plural helper (`count(n, "agent", "agents")`)
      are ids to such a script and were changed by hand.
    - **Pictures.** Five of the README's six (`docs/screenshots`) and two of the Apps guide's
      five (`docs/images/apps-connect.png`, `apps-connected.png`) showed "Agents" or "Your
      agent" and were taken again, as items 61 and 60 say how; the others never showed the
      word. `prototypes/polish/tour.mjs` now also puts the swapped answer's first words under
      the name in the sidebar, where the echo model's own line was showing.
    - **Checked:** the type checks, every package's tests, the browser tests of the web app
      and of the phone app's web build and the desktop app's tests under Xvfb, with the labels
      in them changed to match. A few pages were looked at in a browser. A real model
      (`claude-haiku-5.5` through OpenRouter, on the built Node server) asked "what are you?"
      said "a persistent personal agent (a Dood)", and asked "Do I have any other Doods?"
      looked with its `agents` tool and answered in the same word. **Not checked:** the phone
      app in a simulator and the desktop app's windows by eye. **Not done:** the landing
      page's picture of Automations, at a desk's width and a phone's
      (`apps/web/public/landing/automations.jpg`, `phone-automations.jpg`), still reads
      "Things your agent does on its own". Those six pictures are of the app before its
      restyle and want taking again together, with a real model.
71. **Something from the library can be pinned under an agent's face** (2026-10-13;
    `packages/protocol/src/pins.ts`, `packages/agent/src/pins.ts`,
    `apps/web/src/components/pins/shelf.tsx`, `chat/pin-card.tsx`, `lib/pins.ts`). The owner
    asked for a way for "the agent or myself" to pin shared library files, such as "a dashboard
    to keep on track of things that you and the agent always updates", so that it is "right
    under his face on the sidebar, and you can kind of pop it out to see what hes doing
    constantly". The mock-up (`prototypes/pinned`) drew three places for pins and two ways of
    popping one out; they chose: "Lets do A with it to the side".
    - **A pin is of a file of the library, kept by the agent** in a document of its own
      (`dc.pins`), by the file's id and the place it was at: it follows a file that is renamed
      or moved, and a file deleted and made again at the same place is what it is then of.
      Nothing is copied. At most eight (`MAX_PINS`). The agent tells everyone following it when
      they change (`changed: "pins"`), so nothing is asked for on a timer.
    - **Under the face** (`PinnedShelf`, in `AgentPanel`): a Pinned section between the
      creature and the rest. The first pin, when it is a page, a Markdown document or a
      picture, is drawn at half size as what it is: a page in a frame that is loaded again when
      the page or anything in its top folder changes, as the document panel does. The rest are
      rows. One that has just changed says so for a few seconds. With nothing pinned there is
      no section. A sub-agent's panel has none.
    - **To the side** is the document panel that was there: a press on a pin opens the file
      beside the chat. Beside the Library and Automations pages, where there is no chat, a pin
      opens in the Library.
    - **A person pins** with a pin on a file's card in the chat and on the bar of any open
      document (`Viewer`, so the Library has it too); pressed in, it takes the pin off. Under
      the face a pin has its own way off, shown when pointed at.
    - **The agent pins** with a `pin` tool (`pin`, `unpin`, `list`; a path as it is in the
      library, with or without `~/library/`, and a short title). The chat shows the pinning as
      a card with Open and Unpin, which says how the pin stands now; taken off, it offers to
      put it back under the same title. It is not asked about (`tool:pin` under Permissions).
    - **Mine, not the owner's:** that pins are the agent's and so the same for everyone who
      shares it; that the agent need not ask; eight at most; that only the first is drawn; the
      title; that a pin whose file is deleted stays, saying so, until it is taken off.
    - **Not built, though the mock-up drew them:** a window of its own over other windows; the
      chips under an agent's name on a phone (the web app on a narrow screen has no panel, so
      pins are not shown there, and the card's Open leads to the Library); a mark for "changed
      since you last looked"; ticking a step on a page (a page still cannot write to its file).
      The native phone app shows pins and the tool's card since item 95.
    - **Checked:** `packages/agent/test/pins.test.ts` and three browser tests
      (`pins.spec.ts`): the agent pinning and the tile following a rewrite of the file, a
      person pinning from a card and from the Library, a deleted file. Looked at in both
      themes with the echo model. **Not checked:** a real model deciding to pin, a team with
      two people looking at one agent, Workers, Safari.

72. **A person's own Chrome asks them once** (2026-10-13;
    `packages/computers/src/browser/relay.ts`, `index.ts`). The owner, of the browser tool on
    their own Chromium, switched on at `chrome://inspect/#remote-debugging`: "every time the
    agent uses the tool I get another permission prompt to allow it to control the browser. I
    got three in one session."
    - **Why.** A Chrome allowed that way asks about every DevTools socket that is opened to
      it, even while one it allowed is still open. The daemon opened two, one by dev-browser
      and one for the live view, and the live view closed its own after fifteen seconds with
      nobody watching and opened another at the next script. A socket that is given up while
      the question is up leaves the question on the screen.
    - **Now there is one socket**, opened by the daemon and kept until Chrome closes, the
      daemon stops or the browser is let go of (`close`). After fifteen idle minutes only
      dev-browser is stopped. Through it dev-browser and the live view each get a session on
      the browser itself (`Target.attachToBrowserTarget`), which to them is a socket of their
      own: dev-browser over a Unix socket in a folder that only the user can open
      (`--connect unix:…`, one message to a line), the live view inside the process. Calls are
      numbered again on the way, a session belongs to whoever attached it, and leaving detaches
      what was attached. A script waits thirty seconds for the answer. After that it fails,
      saying that the question is still up, and the next one finds it answered. A no fails the
      script, and the next one asks again. On Windows, and where Node has no WebSocket, the
      daemon does as it did before.
    - **Mine, not the owner's:** keeping the socket through idle time instead of asking again
      after a while; thirty seconds; failing on a no instead of using the browser kept for
      Doods; that whoever can open the socket's file, which is the user, is let into the
      browser unasked.
    - **Checked:** on Linux with Chrome for Testing 149 on a virtual display, remote debugging
      switched on in its preferences, and a helper counting the questions. Three uses twenty
      seconds apart were asked three times before and once after. Also: nobody answering and
      then answering, a script out of time, a no, Chrome closed under it, and two users of the
      socket kept out of each other's sessions. `test/browser.test.ts` has the relay against a
      pretended Chrome, and the live suite (`DC_BROWSER_LIVE=1`) goes through it for the Chrome
      with a port. **Not checked:** Google Chrome itself, macOS, the desktop app, a real model,
      and fifteen idle minutes waited out.
73. **Every page of the library is in the app's look, from one table of its colors**
    (2026-10-13; `packages/protocol/src/theme.ts` and `visual.ts`,
    `packages/agent/src/library-store.ts` and `visuals.ts`, `apps/web/src/theme-tokens.css`,
    `apps/web/src/lib/visual-theme.ts`, `apps/web/src/server/theme-fonts.ts`,
    `docs/examples/themed-dashboard.html`). The owner asked whether the theme's tokens and a
    style guide could be put in, "so agents can make attractive HTML documents by default that
    match the Do Computer app theme", and for the tokens to "actually reach rendered HTML at
    runtime across iframe/sandbox boundaries". Item 50 had done this for a visual only, by
    copying the colors into the page when it was drawn, and the copy had already come to
    differ from the app's stylesheet (another canvas, another typeface).
    - **One table** (`THEME_TOKENS`) says every color, shadow, corner and typeface, in light
      and in dark. The app's own stylesheet is written out from it (`theme-tokens.css`, by
      `pnpm --filter @do-computer/web theme`; a test fails if the file is not what the table
      says), every page is given it, and what an agent is told names only what is in it.
    - **Put in when a page is served,** not when it is written (`themePageBytes`, in
      `LibraryStore`'s `#page`): any HTML file, at `/d/` and `/s/`, has one block put at the
      start of its head. The file is kept as it was written. A visual is still kept with the
      block, so the file is whole by itself, and is given the block as it is now each time.
      A page's `ETag` has the block's version in it. Only the first 64 KB are read as text.
    - **The block** is the variables in `:where()`, so they do nothing to a page that does
      not use them and lose to anything a page says itself, and a short script that hears
      the client's light or dark and the agent's color: from the address's fragment at first,
      by message after, so a page follows a change without loading again. With nothing said
      it follows the device. The library's viewer, the panel beside a chat and a pin all tell
      it now (`useThemedFrame`); before, only a visual was told, and it was loaded again.
    - **A page asks for more with `data-dc-page` on its root:** the app's background, text,
      typeface, and the way it sets a table, a field and a focus ring, all beaten by the
      page's own styles. A visual is `data-dc-page="visual"`, which adds what item 50 gave it:
      margins and a measure by itself, none in a chat. A page that does not ask is left as it
      was written, which a browser test checks.
    - **The typefaces** are served at `/theme/geist.woff2` and `/theme/geist-mono.woff2` with
      `Access-Control-Allow-Origin: *`, since a page's origin is nobody's and a font is only
      given across origins by name. They are the files the app's stylesheet loads.
    - **Isolation is as it was:** the same `sandbox` policy, no `allow-same-origin`. What is
      put in is the same for everyone and has nothing of the session, the agent or the
      address in it; the script reads nothing of the page and sends only a height and a link
      the reader clicked, and only in a page that asked for the app's look.
    - **What an agent is told:** one `pages` section (`PAGE_STYLE_GUIDE`, `DOCUMENT_GUIDE`) for
      a visual and for a file: the variables by what they are for, type, space, contrast,
      charts, widths from 320px, and nothing from a CDN. The `visual` tool keeps only what is
      about being part of a reply. It no longer suggests loading a library from a CDN.
    - **Chart colors** are six fixed hues from the app's teal, the same for every agent. They
      were first made to go round from the agent's color; measured, that left pairs a person
      who does not see red from green could not tell apart, for most agents' colors. The six
      kept were searched for and pass, in a browser, on both surfaces: lightness, chroma, side
      by side at 14 or more, and 3:1 against the page.
    - **A download takes the look with it** (`?look` on a file's address, from the viewer's
      menu), so the copy is the same page out of the app. Only the bare file, as on a machine
      or sent to Slack, has no variables: it is plain black on white, and the agent is told to
      give a chart's marks a fallback for that.
    - **The owner's, from the request:** one source for the tokens and the instructions;
      tokens that reach the page at run time and not only in a prompt; light, dark and a
      change while a page is open; a visual told from a page kept by itself, which stays
      readable out of the app; isolation kept; nothing from a CDN by default. **Mine:** how:
      putting the block in when a page is served; the attribute and its name; that a page
      which does not ask gets the variables and nothing else; fixed chart colors; serving the
      fonts; the download taking the look; the app gaining `--success`, `--warning` and
      `--chart-1` to `-6`, which nothing in it uses yet.
    - **Checked:** `packages/protocol/test/theme.test.ts` (the table, the block, the script
      run against a stand-in page, old visuals), `packages/agent/test/sharing.test.ts` (served,
      downloaded, the `ETag`, what the model is sent), `apps/web/src/server/theme.test.ts`,
      and `e2e/themed-pages.spec.ts`: every color variable in the frame equal to the app's,
      in dark and after Light is chosen in Settings without the page loading again, the font
      loaded, the page unable to read cookies, storage, the app or the session, a tab of its
      own, 390 and 320 pixels wide. **Not checked:** Workers, Safari, the phone app (a
      document there follows the device and has the teal accent, not the agent's), a real
      model writing a page from the guide.

74. **On a phone a copied picture is pasted into the message box, and the microphone stays
    while a Dood works** (2026-10-13; `apps/mobile/src/chat/paste.tsx`, `composer.tsx`,
    `attachments.tsx`). The owner asked for both: "I should be able to paste images into the
    text box", and "When a thread is working, I can no longer use speech-to-text. I should
    still be able to. Maybe if I focus the text box, I can see the record button."
    - **Pasting.** React Native's box pastes words only: with a picture copied, iOS did not
      offer Paste in it at all. `expo-paste-input` goes around the box (`PasteTarget`), so the
      box's own Paste is offered, and what it pastes is handed over as files the phone wrote.
      They are attached as a chosen picture is: saved to the library as `pasted-<the moment>`,
      shown small above the words, and sent for the model to look at. In the browser build
      the page's paste event does the same for any copied file, as the web app does. Words
      are pasted as they were.
    - **A picture is drawn smaller on the phone** (`scaledOnDevice`, with
      `expo-image-manipulator`), to the sizes the web app tries. Before, a picture went as it
      was or not at all: one over about a megabyte reached the Dood only as a file's name,
      and nothing said so. That was true of a photograph from the phone's photos as well, so
      this is for those too. One that already leaves room for the other three a message may
      hold still goes untouched.
    - **The microphone.** Stop took its place while the Dood worked and the box was empty;
      dictating was still under "+", which nobody would look for. Now the microphone is beside
      Stop, as it is in the web app.
    - **Mine:** the microphone always beside Stop, and not only once the box is focused, which
      is what the owner supposed; the two packages; drawing pictures smaller for every way of
      attaching one, and not for a pasted one alone.
    - **Checked:** two browser tests of the web build (a pasted picture is attached and goes
      with the message; dictating starts while a command runs, with the browser's fake
      microphone), and in an iOS 27 simulator on a Mac: Paste is offered with a picture
      copied; a screenshot and a 12.7 MB photograph 6016 pixels wide were attached, saved and
      sent, the photograph as a JPEG of 276,000 characters; words still paste; the microphone
      stands beside Stop while a command sleeps. The app bundles as a release build does.
      **Not checked:** a phone, which needs a new build for the two packages (builds are paid
      for, and none was started); Android, where the package has a half of its own that was
      never run; whether a phone asks "Allow Paste" for a picture copied in another app (the
      simulator did not); recording in the simulator, which gets no microphone over SSH.
      There, a tap on the microphone also holds up everything the app asks of Expo after it,
      a later message included, with or without this change.
    - **Later the same day the box itself was laid out again,** at the owner's ask, after T3
      Code's phone app (`apps/mobile/src/features/threads/ThreadComposer.tsx` there, read and
      not copied): "I would like the plus button to be sort of like inside of the text area
      ... when you start typing, it wraps under, so you have more horizontal room on a small
      screen", and "when you expand it, this gives us room to show the button to change the
      model and the thinking like you can on the web app". Left alone and empty it is one
      line: "+", the words, the microphone. Focused, or with anything written or attached, the
      words have its whole width and one row under them has "+" and the model button on the
      left and the microphone, Stop or the send button on the right. It is one box and one row
      of buttons in both shapes (shut, the row lies over the line), so the box being written
      in is never made again and keeps the keyboard.
    - **The model button** (`thinks-with.tsx`) is the web app's one quiet brain. It opens the
      system's menu: the chosen model's levels of thinking, and one line with the model's
      name, behind which are the models suggested first and "All models", which goes to the
      list with a search on the Dood's page. All of it in one menu was too tall to be seen
      above the keyboard. It is the Dood's own setting, as on the web. Nothing is drawn where
      there is one model with one way of thinking.
    - **Mine:** that the box opens on focus and not at the first letter (T3's does, and the
      box would otherwise change shape under a finger that is typing); that it stays open
      while anything is written or attached; the shape changing at once and not over a
      moment, which the keyboard's own slide covers; the models behind one line of the menu.
    - **Checked for these:** a third browser test (one line with "+" inside it, the words at
      full width once written, the buttons under them, a level chosen from the button and
      kept by the server), and in the simulator with a real list of 393 models: both shapes,
      with and without Stop, a level and a model chosen and kept, and a recording of the box
      opening and shutting read frame by frame. **Not checked:** a phone, Android, and the
      listening bars in the new box anywhere but the browser build.
75. **A side chat always carries the main chat, and the provider's cache is kept for an hour**
    (2026-10-13; `packages/agent/src/branch.ts`, `#branchChat` in `actor.ts`;
    `PLAN-forked-chats.md` is the plan, and this is its first step). The owner found a Dood
    "often is lost" away from its main chat. A side chat was a fork of the main chat only while
    that was under 60,000 tokens, and empty past it with nothing to say so. Compaction keeps a
    main chat between about 20,000 tokens and nearly the model's whole window, so on a model
    with a 200,000-token window that was about three quarters of the time (by those numbers;
    no real chat was measured).
    - **How much it carries turns on the provider's cache.** A fork's first request repeats its
      parent's prompt byte for byte up to the fork point, so a provider that has the main chat
      cached reads it for a fraction of the price. `isWarm` asks the main chat's latest answers:
      the last is under an hour old and by the model the side chat will run on, and one of the
      last three read or wrote the cache. Then the side chat is the whole main chat, at any size
      (the owner: "warm forks should be whole at any size"). Three answers and not one, because
      not every provider says when it writes, so the answer that filled a cold cache can show
      nothing.
    - **Cold, it is cut down** (`cutDown`), since every carried token is then paid for in full.
      Up to 60,000 tokens it is still whole. Past that, tool output and pictures older than the
      last 20,000 tokens become a line each ("105,000 characters of output left behind in the
      main chat"), and what was said is kept. If that is not enough, the oldest turns are left
      out up to one of the user's messages, so no tool call is parted from its result; the
      summary a chat begins with and the entries that hold its prompt stay. No model is called
      for any of it.
    - **It is done with edits, in the side chat.** pi-durable lets an entry carry `edits` that
      omit or replace what earlier entries show the model. They are on the `dc.branch` entry,
      which also holds `carried` (`whole`, `trimmed`, `recent`) for the marker's wording and the
      note that tells the Dood what it is missing and where it is. The main chat is not touched.
    - **A fork keeps its parent's session.** pi-durable gives a fork a new provider session id,
      and OpenAI and Muse keep their cache by it: with a new one a fork read 0% from cache, with
      its parent's about 100%. The fork's `init` puts the parent's in (`ProviderDoc`). A chat
      and its fork under one id, answering in turns and at the same moment, each went on
      reading the whole of its own prompt from cache on all three models do.computer offers.
    - **The cache is asked to last** (`settings.stream.cacheRetention: "long"` where the harness
      is opened). On Claude that is an hour where five minutes is usual: writing costs twice the
      input price and not 1.25 times, reading the same tenth. The owner chose it: a reply ten
      minutes after the last then reads the cache, where it paid to write all of it again. It
      is for every chat, not only forks. On other providers pi-ai asks for 24 hours, and through
      OpenRouter it sends the cache key only with this setting, which is why Muse hardly cached
      before it and did after.
    - **The marker** in the side chat is the server's words now, which the web and phone apps
      show: "Continues from the main chat", "..., with older tool output left behind", or
      "Continues from the most recent part of the main chat".
    - **Mine:** the 60,000 and the 20,000; cutting a cold fork with no model call and not
      summarizing it; the hour and the three answers; that pictures go with tool output; the
      wording of the marker, the lines and the note.
    - **Checked:** unit tests of both functions; four tests through the actor with a scripted
      model (whole and under the main chat's session while warm; the oldest turn gone two hours
      on, and the main chat still whole; real `bash` output replaced and every word kept; empty
      only with nothing answered); the Workers test of a side chat. Against real models through
      OpenRouter, one run each: `test/branch.live.test.ts`, which runs the actor itself on the
      three models do.computer offers and has a side chat's first answer cost a tenth of its
      uncached price or less (11%, 11% and 3%); and with scripts outside the repo, the three
      models' cache with and without the session id, the hour on Claude (a fork after five and
      a half idle minutes read 100%, and 0% without the setting), a chat and its fork going on
      together.
    - **Not checked:** the app in a browser with a real model, or a deployed Worker; a real
      provider's answer to a cut-down fork; an entry with thousands of edits; how long the
      cache lasts on GPT and Muse, and what writing it costs there; whether an hour pays, which
      turns on how real chats pause.
    - **Not done, and in the plan:** sub-agents and conversations with another Dood forking
      (step 2), a side chat's work written back into the main chat (step 3), and a background
      memory, which the owner put off.

76. **A reply's Markdown is drawn richly: tables, code in its colors, diagrams, notes**
    (2026-10-13; `apps/web/src/components/markdown/`, `components/chat/markdown.tsx`,
    `components/picture-viewer.tsx`, `packages/agent/src/visuals.ts`; the plan is
    `PLAN-rich-embeds.md`, of which this is phase 1). The owner asked for what T3 Code's chat
    has: "make tables inline, make interactive HTML widgets that are styled correctly, embed
    videos, all that stuff". Asked what "tables inline" meant, they said Markdown. T3 Code was
    read for what it does and nothing was copied from it.
    - **One renderer** (`RichMarkdown`) for a reply, a document of the library and a pinned
      one, with one list of plugins (`pipeline.ts`) that a document shared with a link is read
      with too, on the server. Before, a reply was `react-markdown` with nothing added.
    - **A table** is as wide as what is in it and scrolls sideways past the reply's width,
      with hairlines between rows. Pointed at, it has two buttons over its corner: keep each
      row on one line, and copy it as Markdown or as CSV.
    - **The agent is told** (`REPLY_GUIDE`, in the `visuals` section) that a table, code, a
      simple diagram, a note and folded detail go in the reply as Markdown, and the `visual`
      tool no longer lists a table. Before, it was told to draw "a table of figures" as a page.
    - **Code** has a head with its language, a button to wrap long lines and one to copy, and
      its colors from Shiki. The colors are seven variables in `THEME_TOKENS` (`--syntax-*`),
      so a block follows light and dark without being read again and a library page has them
      too. The highlighter, each of 44 grammars, and Mermaid are each asked for only when a
      block needs them, and are left out of the server's build (`import.meta.env.SSR`): the
      Worker is no larger for them.
    - **A `mermaid` block** is drawn as its diagram in the app's colors once the reply has
      closed it, with a switch to the code. One that cannot be drawn stays code. A box is as
      wide as its words (`minNodeWidth: 0`), and a diagram wider than the reply is made
      smaller only to four fifths, then scrolls.
    - **While a reply is arriving,** the block of code it is still writing is plain
      (`endsInOpenFence`, and a mark on the last block), since half a block reads wrongly.
    - **Raw HTML** is read and then cleaned with GitHub's own list (`rehype-sanitize`'s
      default, plus `mark`): folding sections, `kbd`, `sub`, `sup`, a picture with a size. No
      script, style, frame, form, handler or inline style gets through, which
      `pipeline.test.tsx` and a browser test check. A document's ids are prefixed.
    - **Also drawn:** `> [!NOTE]` and its four kin as notes, task lists, and headings that a
      `[link](#heading)` in the same text goes to.
    - **A picture** may be named by its place in the library (`![Chart](charts/q3.png)`), as
      a link may (`[the notes](notes.md)`, which opens beside the chat). A picture alone on
      its line holds a box while it loads and opens large when clicked, with the reply's
      other pictures a step away; one that cannot be had is its words.
    - **The owner's:** that a table is Markdown in the reply. **Mine:** everything about
      how: GitHub's allow list rather than the shorter one the plan named; the buttons over a
      table's corner and not under it; no header that stays while a long table scrolls (a
      table in a reply scrolls with the page, so there is nothing for it to stay against);
      which 44 languages; the syntax colors (each measured at 4.5:1 or better on a block's
      fill, in light and dark); the viewer having a download and no copy. The plan put a
      mock-up first and none was made: the owner had said "It all looks good" and "Just start
      building", which I took to cover it, and the screens were shown as built instead.
    - **Checked:** `pipeline.test.tsx` (what is kept and dropped, alerts, ids, the open
      fence, a table as CSV and Markdown), `site-pages.test.ts`, and in a browser
      `e2e/markdown.spec.ts`: a table copied both ways from the clipboard, code in its colors
      and copied line for line, a diagram in the reply's own ink, a script, a handler and a
      `javascript:` link that do nothing, a library picture in the viewer, a library link
      opening beside the chat. Looked at in light and dark, at 1280 and 390 wide. **Not
      checked:** Safari, Workers, a real model writing any of it, the phone app (which has
      its own Markdown and none of this), a very long reply while it streams.

77. **A film, a sound, a table and a PDF are shown as what they are** (2026-10-13;
    `packages/protocol/src/embed.ts`, `packages/runtime` (`BlobStore.get` with a range),
    `packages/agent/src/library-store.ts`, `apps/web/src/components/embed/`,
    `components/file-card.tsx`, `components/library/viewer.tsx`, `lib/shown-hosts.ts`; phase 2
    of `PLAN-rich-embeds.md`). Before, nothing in the app played a film or a sound but a
    shared link, an `.mp4` in the library was "cannot be shown here yet", and every file was
    sent whole.
    - **One table says what a file is** (`embedKind`, `contentTypeOf`): image, video, audio,
      page, table, pdf, markdown, text or other, by its extension, and by its content type
      where the extension says nothing. The library's types, the web app's kinds and the
      types served in place are all read from it; they were three tables that disagreed.
      `.ts` is source code and never `video/mp2t`.
    - **A part of a file** can be read from where it is kept (`BlobStore.get(key, { range })`,
      on R2 and on disk, held to the same by the host conformance tests), and both addresses
      a file is served at answer `Range` with `206`, `416` for a part that is not there, and
      the whole file for several parts at once or an `If-Range` that is not its etag. A page
      is always whole. The gateway had been dropping `Range` on its way to the library, in
      three places (`agents.ts`, `sites.ts`).
    - **What is played is sent a piece at a time:** Chromium's player asks for "from here to
      the end" every time the reader moves in a film, so at the address a file is viewed at,
      a film or a sound is answered with at most 2 MB (`MAX_PLAYED_PART`) and the player asks
      for the next. A download, and anything that is not played, is sent to its end.
    - **In a chat,** a file the agent sends is the thing itself over its card: a player for a
      film or a sound, the first hundred rows for a CSV or TSV (only the first 256 KB of the
      file is asked for). The same where a reply names a library file as a picture is named,
      `![The demo](recordings/demo.mp4)`, which the agent is told in `REPLY_GUIDE` and in
      `send_file`'s description. A player loads nothing until it is near the screen, stops
      when the tab is put away, and asks the library for a fresh address when its own has
      grown old (they last 6 to 12 hours), carrying on from where it was.
    - **In the library,** a film and a sound play, a table has Table and Source, and a PDF is
      given to the browser's own reader. For that one kind the view address sends no
      `sandbox` policy, since the reader will not run in a frame that is kept apart; it is
      served as `application/pdf` with `nosniff` whatever its bytes are. A shared link shows
      a CSV as a table too.
    - **What is at another site is not asked for until the reader says so** (`Remote` in
      `chat/markdown.tsx`): a reply that names a picture, a film or a sound at a web address
      shows where it is from, with Show and "Always from <host>". Before, any picture a reply
      named was loaded at once, which tells that site who is reading and whatever the address
      was written to carry. The app's own address is always shown. Yes to a host is kept in
      this browser (`dc-shown-hosts`).
    - **The owner's:** films in a reply; that remote media waits for a click ("click the
      load is fine"); no players for YouTube and the like; the 25 MB limit stays. **Mine:**
      the 2 MB piece; that a host's yes is kept in the browser and not for the workspace,
      which the plan said (the workspace has nowhere to keep it yet); a PDF beside the chat
      and in the library but never in a reply; a hundred rows; that a page named as a picture
      is not shown as its frame (the plan left that for the owner to say).
    - **Checked:** `embed.test.ts`, the host conformance tests on both hosts,
      `library-ranges.test.ts` (each form of range, 416, `If-Range`, that only the part is
      read, the 2 MB piece, a PDF's headers and that a page under a PDF's name is still not
      a page), `delimited.test.ts`, and in a browser `e2e/embeds.spec.ts`: a film that knows
      its length unplayed and is moved in, every request for it answered `206`; a sound; a
      CSV in a reply, from `send_file`, and in the library; a PDF's frame and headers; a
      remote picture not asked for until Show, and a host said yes to for good. By hand
      against the built server and local Workers, with curl on all three addresses.
      **Not checked:** Safari, which is where ranges matter most; an MP4 (the browser here
      plays only WebM); real R2; a PDF drawn by a browser's reader (headless Chromium has
      none); the phone app, which shows none of this. **Not built:** a film or a sound the
      person attaches is still only named in their message, since a message carries its
      attachments as names in its text.

78. **A page in a chat has the app's controls, and can speak to the chat** (2026-10-13;
    `packages/protocol/src/theme.ts` and `visual.ts`, `packages/agent/src/visuals.ts`,
    `apps/web/src/components/chat/visual.tsx`, `lib/visual-heights.ts`; phase 3 of
    `PLAN-rich-embeds.md`). The owner asked for "interactive HTML widgets that are styled
    correctly". A visual was already a page in the app's colors; what it lacked was the
    app's controls, any way back to the chat, and anyone noticing when it broke.
    - **Controls** (`CONTROLS` in `theme.ts`): a page that asked for the app's look has its
      button, field, select, checkbox, radio, slider, progress bar, `details`, `dialog`,
      `fieldset` and `kbd` drawn as the app draws its own, written bare. A button is quiet;
      `data-variant="primary"` is the one main action, `data-variant="ghost"` has no fill,
      `aria-pressed="true"` is one that is on. All in `:where()`, so a page's own styles
      win. They are put in when a page is served, so every page already in a library has
      them: one that left its buttons bare looks different now.
    - **`window.dc`**, in a page that is in a chat: `dc.say(text)` puts words in the message
      box for the person to send, `dc.expand()` shows the page large and `dc.expand(false)`
      puts it back, `dc.save(name, text, type)` hands the person a file. They are MCP Apps
      requests (`ui/message`, `ui/request-display-mode`, `ui/download-file`), as the height
      and the link were. The chat does each only when the reader has just pressed something
      in the page, and refuses otherwise. Out of a chat `dc` is there and does nothing.
    - **Large** is the same frame over the page, not another copy: what the reader did in
      it is still done. The page is told, and is laid out as a page by itself while it is.
    - **A script that fails** is told to the chat (`notifications/message`, three at most):
      under the page it says "Something in this page did not work", with a button that puts
      what it said in the message box for the agent.
    - **Before a page is shown** `visual` reads it (`visualProblems`). One that uses
      `localStorage`, `sessionStorage`, `indexedDB` or `document.cookie` in a script, or takes
      its height from the window, is not shown: the agent is told why and draws it again.
      Colors written out, a background on the body, something loaded from another site and
      a fixed width are told to the agent with the page shown, for next time.
    - **Height:** a browser keeps how tall each page was at about each width
      (`dc-visual-heights`) and gives it that room at once next time. The frame is not
      loaded until it is scrolled near, and is no longer white for a moment in the dark.
    - **The owner's:** widgets that look like the app. **Mine:** all of it: which controls
      and that a button is quiet by default; the three things `dc` does and their names;
      that `say` fills the box and does not send (the plan asked the owner; not answered);
      large being the same frame; what stops a page and what is only noted.
    - **Not built, and why:** a page reading a file of the library beside it. The plan said
      it already could; it cannot, on purpose (the address a page is viewed at opens the
      whole library, so the library does not let a page read with it), and the plan is
      corrected. Nor a box held while the agent is still writing a page.
    - **Checked:** `theme.test.ts` (the script run against a stand-in page: what `dc` sends,
      nothing out of a chat, errors three times and no more, large and back; what a client
      reads of each request; `visualProblems`), and in a browser `e2e/widgets.spec.ts`: each
      control's colors equal to the app's own, words from a press in the message box and
      not sent, none from a page that was not pressed, large and back with the page's count
      kept, a file downloaded under its name, a broken page's notice, a page with storage
      sent back and one with a color written out shown, the height kept across a reload.
      **Not checked:** Safari, Workers, the phone app (its web view has no chat to speak
      to: `dc` does nothing there), a real model writing a widget.

79. **The agent looks at a page in a browser before it shows it** (2026-10-13;
    `packages/runtime/src/preview.ts`, `cloudflare/preview.ts`, `node/preview.ts`,
    `packages/protocol/src/visual.ts` (`visualPreviewDocument`), `packages/agent/src/visuals.ts`
    (`visual_preview`), `apps/web/wrangler.jsonc`; phase 4 of `PLAN-rich-embeds.md`). T3 Code
    has this as `html_preview`. Its server is on the person's own machine and starts Chrome
    there; ours is a Worker on do.computer, which has nothing to draw with. The owner asked
    for Cloudflare's headless browser to be looked into for it ("If we had that figured out
    it would probably solve things for us"), and said the Cloudflare account could be changed
    if need be.
    - **The tool.** `visual_preview({ html, width?, appearance? })` (since item 88 it is
      `look`, and this is its `html`) answers a picture of the
      page as the chat will draw it, how tall it is on a computer and on a phone, what it
      wrote to its console and what failed in it, and what `visualProblems` notes. Nothing
      is shown or kept. The agent is told to look before it draws. A model that takes no
      pictures is given the words alone.
    - **One interface, two browsers** (`PagePreviewer`). On Cloudflare it is Browser Run,
      through the Worker's `browser` binding and `@cloudflare/puppeteer`
      (`browserRunPreviewer`). Under Node it is a Chrome on the machine, through
      `puppeteer-core` (`chromePreviewer`; `DC_CHROME_PATH`, or the usual places, or `none`).
      Where the server has neither, the tool is not offered. What is done with a page
      (`previewIn`) is written once against Puppeteer's `Page`.
    - **What the browser is given** is one document: the page as it would be kept, in a
      frame with the chat's own `sandbox`, on the chat's background, fitted to the height the
      page reports. So the page's origin is nobody's, as in a chat, and the browser need not
      reach the deployment. The app's address is named for the typefaces.
    - **On Cloudflare** a look uses a browser that is already running and that nobody is
      driving, or starts one, has a context of its own in it, and disconnects; a browser
      left alone stops in a minute. Browsers are counted at once and paid for by the hour,
      so nothing is kept running. Workers Paid includes ten hours a month, then $0.09 an
      hour; Workers Free has ten minutes a day.
    - **The heights** measured when a page was looked at go with it when it is drawn as it
      was looked at (`details.heights`, six widths from 320 to 760), and the chat gives it
      that room before it has loaded. A page drawn without being looked at is not measured:
      that would be a browser's seconds before every page is shown.
    - **Bounds:** 8 seconds for a page to load, 20 for a look, a picture at most 2000px
      tall, thirty console lines, sixty looks an hour for an agent.
    - **The owner's:** that there be such a thing, and Cloudflare's browser for it.
      **Mine:** the frame in place of a draft at an address, which the plan had; sharing a
      browser by its sessions and not through an object of its own; that only a page that
      was looked at is measured; the bounds; `none`; that the tests' other servers are told
      to have no browser, so that what an agent is told does not depend on the machine.
    - **Checked:** `visual.test.ts` (the document, the heights), `sharing.test.ts` (the
      tool through an agent with a stand-in browser: what it answers, heights carried to a
      page drawn as looked at, a page that would not work not sent to the browser, a
      browser that cannot be had, no tool without one), and in a browser
      `e2e/preview.spec.ts` against the built server with a real Chromium. Under the local
      Workers runtime (`DC_TARGET=cloudflare vite dev`) the tool was called through the
      app, first with the browser the Vite plugin downloads and then, with `"remote": true`
      on the binding, with Browser Run on the owner's account: the page's own request
      came from an address that was not this machine's, its console and its error came
      back, and a look took about two seconds. The Worker's upload with the library in it
      is 4,513 KiB gzipped of 10 MB (`wrangler deploy --dry-run`).
      **Not checked:** a deployed Worker; whether the token Actions deploys with needs
      another permission for this binding, which the first deploy will say; that two looks
      at once share a browser on the real service; the pictures a page loads from the
      library, which are not loaded in a look; a real model using what it is told.

80. **On the phone a reply's pictures, sounds and tables are shown, and a page can speak to
    the chat** (2026-10-13; `apps/mobile/src/chat/parts/named.tsx`, `sound.tsx`, `rows.tsx`,
    `shown-hosts.ts`, `logic.ts`, `visual-frame.native.tsx` and `visual-frame.tsx`,
    `apps/mobile/src/ui/markdown.tsx`, `packages/protocol/src/delimited.ts`; phase 6 of
    `PLAN-rich-embeds.md`, the parts that need no new native module). Most of it was written
    by a second session given the brief, and read over and run by the first.
    - **A picture at another site waits for a tap**, as on the web: a box naming the host,
      with Show and "Always from <host>". Before, the phone asked for any picture a reply
      named at once. A yes for a host is kept on the device (`dc.shown-hosts`), and the
      deployment's own address is always shown. The address asked for is the one the host
      was read from, written out plainly. The same in a sub-agent's report and in another
      agent's message, which are agent-written too.
    - **A library file written as a picture** (`![The chart](charts/q3.png)`) is shown as
      what it is: a picture from the library's view address, a sound with a player, a CSV or
      TSV as its first rows (25 rows, 12 columns; the first 256 KB of the file), and anything
      else, a film among them, as a chip that opens it in the library. The Markdown drawing
      in `ui/markdown.tsx` is given the chat's way of drawing a picture as a prop (`image`),
      and knows nothing of chats itself.
    - **A sound player** made with `expo-audio`: play and pause, how far in and how long, and
      a bar that is pressed to move. Also over the card of a sound the agent sends, as a
      table's rows are over a table's.
    - **`dc.say` in a visual** puts words in the chat's draft and does not send them. In the
      browser build it is read from the frame, only on the reader's own press. On a phone
      the page is the whole of a web view, where the page's own `dc` does nothing, so the
      script the app puts in gives it a `say` that posts to the app, honoured within two
      seconds of a touch. `dc.expand` and `dc.save` do nothing on the phone.
    - **`parseDelimited`** is in the protocol package now, for both apps.
    - **A small picture is no longer set in a tall grey box** on a phone: its width and
      height are both said once they are known. This was there before this work (a phone
      works the height out from all the room there is, before the picture's own width is
      applied) and was seen in the simulator.
    - **Not built here:** a film player, a fresh address for a sound whose own has grown
      old, and an audio mode for the ringer switch. All three are in entry 83.
    - **Mine:** that this was built at all without the owner saying so again (the plan they
      approved has it); 25 rows; the storage key; that the message box is not given the
      caret after `dc.say`; that a sub-agent's report and an agent's message are gated too.
    - **Checked:** `apps/mobile` unit tests (the host rule, what a reply names, the script
      for the web view run against a stand-in window); `e2e/mobile.spec.ts` on the phone
      app's browser build (a remote picture not asked for until Show, and a yes kept across
      a reload; a library picture, a sound whose bar moves it, a table; a sent table; words
      from a press in the message box and none from a page that was not pressed). And in an
      iOS 27 simulator on the owner's MacBook Air, with this branch built there: the box and
      Show for a remote picture, which then loaded; a library picture; the sound played to
      its end; the table; the chip for a film; and a press on a visual's button putting its
      words in the message box through the real web view. **Not checked:** a real phone;
      Android; the ringer switch; a host's yes surviving the app being closed (it is kept
      through the app's own store, which was not looked at there).

81. **A Dood signs in to a website with a saved login, and never sees the password**
    (2026-10-13; `packages/agent/src/vault.ts`, `sign-in.ts`, `approvals.ts`,
    `packages/computers/src/browser/sign-in.ts`, `apps/web/src/server/passwords.ts`,
    `apps/web/src/components/settings/passwords.tsx`). The owner asked for "a way for agents to
    use 1Password for both browser use and ... other things they need to fill out", to see what
    OpenClaw and Hermes Agent do, and how to keep secrets out of "the session logs and things
    like that". `PLAN-agent-secrets.md` is the research and the whole plan; having read it the
    owner chose to build our own store first, as one pull request, with 1Password later and
    cards next, and said that it "should be a feature that only admin can use ... so that we
    don't have leaks". `docs/reference/passwords.md` says what it does and does not protect.
    - **The store.** A workspace's logins (a name, a username, a password, the sites it is for)
      are kept by the actor that keeps its sign-ins to model providers, in a table of their own.
      A password is sealed before it is written (AES-GCM, a key made for the workspace with HKDF
      from `DC_SECRETS_KEY`, or `DC_AUTH_SECRET` where there is none) and opened in one place:
      `POST /passwords/<id>/use`, which only an agent of the workspace can reach, through its
      host. No route a person can reach returns one. A row sealed with a key the deployment no
      longer has says so, and wants its password given again.
    - **Who has it** (`DC_SECRETS`, `passwords-directory.ts`). Unset or `admins`: the accounts
      `DC_ADMIN_EMAILS` names, in a workspace where everyone is one. `on`: everyone. `off`:
      nobody, with no page, no form, no tool and nothing said of it to the model. Any other value
      stops the server starting. It is asked of the database at each use, so a team loses its
      logins the moment someone who is not an admin joins, and has them again if that person
      leaves.
    - **`sign_in`.** The Dood opens the page with `browser` and calls `sign_in`, naming a login
      or letting the page say which. The server asks the computer which page is in front, and
      only then asks the person: "Sign in to github.com as ...", with the site as the browser
      has it. A yes is for that login on that site, once (`binding` in `approvals.ts`), and is
      given back where the attempt typed no password. The page is looked at once to ask and
      again to type: where it is no longer the page that was asked about, nothing is typed.
      Where no login is saved for the site, the
      same tool raises the form `request_secret` raises, asking for a login, and whoever types
      it is not then asked a second time.
    - **The typing** is done by the daemon itself, over a DevTools socket of its own. It stops
      dev-browser first, loads the page afresh, finds the boxes in a world page scripts cannot
      reach, types the password only where the caret is in a box that is a password box at
      that moment, sends it, and empties what it typed where the page still asks. A daemon from
      before this says nothing of `signIn` when it connects, and is never sent a password.
    - **Why dev-browser is stopped.** Tried with dev-browser 1.0.0-rc.3: a script a Dood ran
      earlier can leave a script for every new document that outlives a reload and reads every
      key, and a loop inside dev-browser's own process that reaches new tabs too. Stopping
      dev-browser drops both. A window of the same site that the page opened keeps a hold on
      it that nothing ends, so a page with such a window is refused.
    - **What is written down** is the login's name, the site, the username, and which Dood
      used it and when. The script a Dood runs in a browser is now handed to dev-browser on its
      input and no longer on its command line, and the screen tool's line for typing no longer
      repeats what was typed.
    - **Mine:** nearly all of it. The `sign_in` tool being apart from the browser's scripts; the
      store living in the workspace's existing actor and not in one of its own; the session
      secret as the key where none is set; an unset `DC_SECRETS` meaning admins only
      everywhere (the owner asked for that on do.computer), its name and its values; a team
      with anyone else in it having none; Ask first by default, a yes bound to one login and
      site, and the pass for whoever just typed the login; a scheduled run may use a login the
      Dood need not ask about, and Slack never; a login called after its site until someone
      names it; https only, but for a page on the computer itself; the name "Passwords".
    - **Checked:** unit tests of the store (among them that nothing of a password is in any
      file it writes, and the same store inside workerd), of which pages a login may be typed
      on, of who has it, and of the tool with a stand-in browser; the daemon's typing against a
      real Chromium driven by the real dev-browser, with the two things a script can leave
      behind planted first, on the browser kept for Doods and through the relay an owner's
      Chrome is reached by; and one browser test of the whole of it (`e2e/sign-in.spec.ts`:
      the app, the daemon, dev-browser, Chromium and a page that asks for a password), which
      looks for the password in the page, the chat as the server keeps it, and everything the
      daemon wrote. That one needs a dev-browser and does not run in CI.
      **Not checked:** a real site (the page was a form of our own); macOS and Windows; an
      owner's own Chrome with its real Allow prompt; the desktop app, which needs a release
      before its daemon can do this at all; Cloudflare beyond the store's tests in workerd;
      the phone's form for a login on a phone: since item 95 it has its sites as the web's
      has, and has been run in the phone app's browser build, not in a simulator or on a phone.
82. **A connector's own page for a tool is shown in the chat (MCP Apps)** (2026-10-13;
    `packages/protocol/src/mcp-app.ts`, `packages/agent/src/connectors.ts` and `actor.ts`,
    `apps/web/src/lib/mcp-app-host.ts`, `components/chat/mcp-app.tsx`; phase 5 of
    `PLAN-rich-embeds.md`). MCP Apps is a standard (SEP-1865) by which a tool of an MCP
    server can name a page of the server's, and a client shows that page as a live view of
    what the tool answered. T3 Code has it. The owner said to "work on 5" once the first
    four phases were merged.
    - **The server is told** that pages are taken here (the `io.modelcontextprotocol/ui`
      extension, when a connector is connected), or it would not offer them.
    - **When the agent uses a tool that names a page** (`_meta.ui.resourceUri`, a `ui://`
      address) and the tool does not fail, the page is read from the server, kept among the
      agent's blobs under a name made from what is in it, and the tool's details carry where
      it is, whose it is, and what the tool was asked and answered (`McpAppDetails`). A page
      read a minute ago is not read again. One over 2 MB, or that is not HTML, is not kept,
      and the tool is then only its answer, as before.
    - **The chat shows the page** where the tool call is, under "From <connector>", with a
      line round it unless the page asks for none. It is somebody else's page, so it is kept
      further apart than a page the agent drew: the frame's origin is nobody's, and it is
      served (`GET /apps/<id>` on the agent) under a policy that lets it load only the
      origins its server named, and nothing from the app's own address. Only whole origins
      are kept of what a page names: a keyword or a path would widen the policy.
    - **The talk** is the standard's JSON-RPC through the frame (`createAppHost`): the page
      says it is there and is told where it is shown (light or dark, the app's colors under
      the standard's names, inline or large); once ready it is told what the tool was asked
      and what it answered; after that it may ask for its server's tools, read its server's
      resources, have a link opened, put words in the message box, and be shown large. A
      link, words and large are only on the reader's own press. `ui/update-model-context`
      and a file to download are answered as not done here.
    - **A page may use only its own server's tools** (`POST /connectors/<id>/app-call`), and
      only those the server lets a page use. One the server says only reads runs at once.
      Any other is not run until the person has said yes in a dialog, and so is every tool of
      a connector the agent itself asks before using. A tool a server keeps for its pages
      alone (`visibility: ["app"]`) is not given to the agent.
    - **On the phone** such a tool call is a line saying the connector has a page for it,
      shown in a browser: the page is served to a signed-in browser, which a phone's web
      view is not.
    - **The owner's:** that it be built. **Mine:** everything about how: keeping the page
      with the agent and serving it by the session, where the plan had not said; 2 MB; that
      a page's words fill the box and do not send; asking for every tool not marked as only
      reading, which a server may mark wrongly; the line and "From"; what is left undone.
    - **Checked:** `mcp-app.test.ts` (what is kept of a page's origins, the policy, who a
      tool is for), `connectors.test.ts` against a stand-in server (the extension said, the
      page kept and served with its policy, not read twice, no page for a failed tool or a
      thing that is no page, a page's tool not given to the agent, a reading tool run and
      another not until agreed, a connector switched off), `mcp-app-host.test.ts` (the talk,
      turn by turn), and in a browser `e2e/mcp-apps.spec.ts` with a page written by hand to
      the standard: told the tool's question and answer, in the app's ink, without cookies
      and unable to reach the app, a reading tool at once, a dialog and a no and a yes for
      another, words in the message box, large and back. **Not checked:** a real MCP server
      that has pages, or a page built with the standard's own SDK; Composio's Apps, which
      may have none; Workers; Safari.
83. **The phone plays a film where it is** (2026-10-13; `apps/mobile/src/chat/parts/film.tsx`
    and `played.tsx`, `sound.tsx`, `named.tsx`, `file.tsx`, `logic.ts`,
    `apps/mobile/src/library/model.ts`, `apps/mobile/app/(app)/a/[agentId]/library/[fileId].tsx`;
    the last of phase 6 of `PLAN-rich-embeds.md`).
    - **A film has a player** made with `expo-video`: the phone's own controls, in a 16:9 box
      the film is fitted inside, so nothing moves when it loads. It is there for a film named
      in a reply (`![The walkthrough](recordings/demo.mp4)`), over the card of one the agent
      sends, and on the library's screen for the file, which plays a sound too; before, a
      film was a chip and the library only offered a download. A film stops when its screen
      is left.
    - **An address grown old is asked for again.** A film and a sound keep the address they
      were first given, since a new one would start them over. When the player says it
      cannot go on, the library is asked once where its files are now, and what is played
      goes back to where it was (`usePlayed`). Only when that fails too does a line say it
      could not be played, with a way to it: the library from a chat, "Open in…" (or
      Download in a browser) from the library.
    - **A sound is heard with the ringer off** on an iPhone. The audio mode is said when a
      sound is played and not when the app starts, since saying it ends a recording;
      dictation says its own each time it starts.
    - **`expo-video` is a native module**, so none of this reaches a phone until the app is
      built again. No build was started. Playing in place needs no config plugin entry, and
      none was added; picture-in-picture and playing in the background would need one.
    - **Mine:** that a film a phone cannot play (a WebM on an iPhone) is a line and a way to
      it, where it could have been tried in a web view; the phone's own controls and no
      drawn ones; one asking for a fresh address before giving up; no poster picture, so a
      film is its first frame once that has loaded and black before.
    - **Checked:** `apps/mobile` unit tests; `e2e/mobile.spec.ts` on the phone app's browser
      build (a film named in a reply plays and can be moved about in; one that cannot be
      played says so after the library was asked once; a film and a sound started from an
      address that no longer works are asked for again and play; a sent film has its player
      over the card, and the library plays it). And in an iOS 27 simulator on the owner's
      MacBook Air, with this branch built there: an MP4 named in a reply showed its first
      frame in the box and played on a tap; the sound played; a WebM gave the line, and its
      way opened the library's screen for it, which said the same. **Not checked:** a real
      phone; Android; a film on the library's screen and a sent film in the simulator (the
      browser build only); an address growing old on a phone; the ringer switch, which a
      simulator has not got; a long film, or one over a slow connection.
84. **Someone who has a Dood signs in to the desktop app and is in the app at once; this
    computer goes to a workspace** (2026-10-13; `apps/web/src/components/shell/this-computer.tsx`,
    `scene.tsx`). The owner: "if you are logging into the desktop app again you should be able
    to skip the cutscene and be dropped right into the app. Also maybe you shouldn't pair your
    computer with a random agent but you can pick the workspace". Before this, an account
    with Doods that signed in to an app on its first run had the Dood it last used (or its
    first) hatch from the egg, ask "may I work on this computer?", and be the only one
    connected.
    - **The scene is for someone new.** `arrived` sends whoever has a Dood on to `/`, in the
      app as in a browser, and nothing hatches. Signed in already, they see no egg on the way
      (`placed` waits for the answer). A quiet "I already have an account" at the top right,
      while the egg falls and says hello, puts it down and goes straight to the sign-in card.
    - **This computer is asked about in the app**, by `ThisComputer`, a dialog over any page
      behind sign-in while the app says its first run is not over (`welcomed` false) and the
      scene is not showing. It asks what the card asked: yes, only read files, or not now, and
      whether to open at sign-in. Any answer ends the first run (`finish`), so it is asked
      once; quitting the app before answering brings it back. Escape and a click outside do
      not put it away.
    - **A workspace is given the computer.** With Doods in more than one workspace it asks
      which, starting on the one last used. The computer is paired as that workspace's (their
      own, or the team's) and connected to every Dood in it at that moment, through the
      `agentIds` the pairing already took: nothing on the server changed. A Dood hatched later
      is not connected, and asks for it as for any paired computer.
    - **Mine:** that it is a dialog over the app and not a card or a banner; that it cannot be
      dismissed; that only workspaces with a Dood are offered; that later Doods are not given
      it by themselves (a paired computer is still `chosen`, never `open`); the button in the
      scene and its words; that someone new is still asked by the egg, and paired with the
      one Dood they have.
    - **Checked:** `e2e/this-computer.spec.ts` with the app stood in for (team chosen, own
      workspace read-only, not now, the button in the scene); the desktop tests, where the
      real app and its daemon pair from the dialog and the question is not put again.
    - **Not checked:** a Mac or Windows; a real GitHub sign-in through the browser; a
      deployed Worker. No desktop release holds it: the change is all in the deployment's
      pages, so an installed app gets it when the deployment does.
85. **The desktop app runs Do Computer itself, and Tailscale serves it to its owner's other
    devices** (2026-10-13; `apps/desktop/src/local-server.ts`, `tailscale.ts`, `cookies.ts`,
    `pages/devices.*`, `apps/web/src/server/local-owner.ts`, `routes/local.sign-in.tsx`,
    `scripts/build-packed.mjs`). The owner asked what it would take "to let you run the desktop
    app in fully self contained mode where the whole server is bundled with it", then whether
    there could be "a built in tailscale integration" that detects Tailscale "to serve it
    there", said "I like having a tailscale mode if you self host", and then: "build this".
    - **The server is packed into the app.** `pnpm --filter @do-computer/web build:packed` is
      the Node build with every import inside it (`ssr.noExternal`, into `dist/packed`; the
      Daytona and Modal SDKs are still left out, and such a server never asks for them). The
      desktop build copies it to `dist/server/dist/node` and bundles `server.node.mjs` beside
      it as `server.mjs`: 23 MB, no `node_modules`. Packed, it is in `Resources/server`, as
      files, like the screen driver, because it is run as a program. The app runs it as a
      child process with itself as Node (`LocalServer`), on `127.0.0.1` at a port chosen once
      and kept in the settings (4310 where free), with its data in `<the app's folder>/server`,
      starts it again when it dies, and stops it by closing its input, which is also how it
      ends if the app is killed (`DC_STOP_WITH_INPUT` in `server.node.mjs`).
    - **Its owner has no account to make.** The app makes a key (`owner-key` beside the data)
      and gives it to the server as `DC_OWNER_KEY`. `POST /api/auth/local/session` with the key
      signs in as the owner, an account at `you@localhost` that is made the first time, with
      the name the first run asked for; `POST /api/auth/local/token` gives a token that signs
      one other device in, exchanged at the same `/desktop/session` the browser hand-off uses.
      The app asks from its main process and gives the window the cookies that came back, so
      no page is shown the key. With the key set: the owner is an admin for Server models, the
      first account is not open to whoever arrives, nobody can make an account by that
      address with a password, and a new Dood is connected to the computers its maker paired
      (`giveOwnComputers`).
    - **The first run is the same scene.** The app's bridge says `local` and has
      `signInHere(name)`, and the "who are you" card then asks only for a name. The rest,
      including "may I work on this computer?", is as it was.
    - **The first screen asks where Do Computer runs:** "On this computer" or "Somewhere
      else", with the address under the second. A build made for a deployment still opens it
      without asking, so there it is under File → Change Server…. Choosing a server later
      stops the app's own and keeps its data; nothing moves between the two.
    - **Tailscale.** The app looks for the installed command (`findTailscale`), reads
      `tailscale status --json` (`readStatus`: missing, not connected, no certificates,
      ready), and when asked runs `tailscale serve --bg --yes --https=<port>
      http://127.0.0.1:<port>`, and `… off` to stop. It only ever names its own port. The
      server is then started again with `DC_BASE_URL` as the Tailscale address and the new
      `DC_ALSO_AT` as the local one: `alsoAt` origins are trusted by Better Auth and by the
      socket checks (`fromApp` in `auth.ts`), which a self-hoster can use by hand as well.
      The session cookies change name with the address (`__Secure-`), so the app signs its
      window in again, as it does whenever the window lands on `/login`. Where Tailscale is
      not up when the app starts, it looks again every minute.
    - **The window stays at this computer's address.** Served that way, the server sends
      whoever it answers to its Tailscale address: after a connector's sign-in, for one. The
      app's windows are signed in at `127.0.0.1`, and a window that never leaves the deployment
      (PR #114) took the other address for somewhere else and opened its small sign-in window
      on it. `atServer` (`apps/desktop/src/server.ts`) says a page by either address is the
      deployment's and gives it at the first: a window sent there is shown the same page here,
      a service's answer in the small window is taken here, and a link opened from a page
      gets a window of the app.
    - **Other Devices** (File menu and tray, only in this mode) says how the computer stands
      with Tailscale, has the switch, the address, and a QR code and a link that sign a device
      in once within ten minutes (`/local/sign-in#<token>`; the token is after the `#`).
    - **Mine, not the owner's:** keeping the creature's question about this computer, where I
      had proposed handing it over silently; asking for a name; `you@localhost`; port 4310;
      the wording of both windows; that a failed switch-on goes back to off with the reason;
      that the app will not restart itself to update while a Dood is working; no Funnel.
    - **Not built:** the native phone app signing in (it has only email and password); moving
      data between a server and this mode; anything on the web app that offers this mode.
    - **Checked:** `apps/desktop/e2e/local.spec.ts` runs the app with no server: the first
      run with only a name, a Dood running a command on this machine, a second Dood getting
      the computer, the switch with a stand-in for Tailscale (the window stays signed in
      under the other address, the link signs a device in once), a restart, and choosing
      another server. Unit tests for the key, the token, the sign-up rules, the settings,
      Tailscale's answers and the cookies. **Not checked:** a real `tailscale serve`, so the
      headers its proxy sends, the wording of its refusals and a phone scanning the code are
      unseen; macOS and Windows, which only CI will have run; a packed app; a real model; an
      update of the app while its server holds data.

86. **A Dood pays on a website with a saved card, whose number it never sees and whose
    security code is not kept** (2026-10-13; `packages/agent/src/vault-cards.ts`, `pay.ts`,
    `approvals.ts`, `packages/computers/src/browser/pay.ts`,
    `apps/web/src/components/settings/cards.tsx`). The second part of `PLAN-agent-secrets.md`,
    after saved logins (item 81). The owner asked "what would it take to support credit cards
    next?" and what the card industry's rules are, and then chose three things from what was
    proposed: the security code is not stored, and is typed with each yes; it is the owner's
    own card only, while it is for admins; and before cards are opened to anyone else they move
    onto the person's own computer, or someone who knows PCI DSS says what it asks.
    `docs/reference/passwords.md` says what it does and does not protect.
    - **The store.** A card's number is sealed as a password is, in a table beside the logins.
      What is shown of it is its kind, its last four digits and when it runs out. There is
      nowhere to put a security code. `DC_SECRET_KINDS` names the kinds a deployment keeps:
      `passwords` unless it says `passwords,cards`, and the same workspaces have both.
    - **`pay`.** The Dood gets the page ready and calls `pay` with the words on the button that
      pays, what it says the payment is for, and whatever else the page needs filled in. A
      person is asked every time (the ability is one no rule can be set for), and never in a
      scheduled run, a sub-agent or Slack. The request says the site as the browser has it, the
      card, the button, and the Dood's own words, and has a box for the card's security code:
      a yes without one is refused. The code is held in the agent's memory for the one payment
      (`Pays.hold`) and is in no document.
    - **The typing** is the daemon's, as for a login: dev-browser stopped, the page loaded
      afresh, a page with a same-site opener or popup refused. Since loading afresh empties the
      page, the other boxes the Dood named are filled in by the daemon too. The card's boxes
      are looked for in every frame of the page, the frames of other sites among them, which is
      where a payment company puts them. Then the button is pressed with the mouse, waited for
      where it cannot be pressed until the card is in, and what was typed is taken out again
      if the form is still there.
    - **Mine:** that the daemon presses the button itself, so that the number is never left in
      a page the Dood can look at; that there is no "Never" for paying, only not saving a
      card; that the number is in the server's store for now; `DC_SECRET_KINDS` and its
      default; no mock-up of its own, the screens being a second part of the page that was
      mocked up for logins. The phone first had the code box and nothing else; item 95 gave it
      the Passwords section, where a card is added, listed and removed.
    - **Checked:** unit tests of the store, the tool and who has cards; the daemon's typing
      against a real Chromium with pages of our own (boxes in the page, in one frame of another
      site, in a frame each, lists for the month and year, a button that waits for the card,
      a shop that says no, and the things an earlier script can leave behind planted first);
      by hand against Stripe's test page with its test cards, where a payment went through and
      a declined one left the boxes empty; and `e2e/sign-in.spec.ts`, the whole of it with the
      app, which CI skips for want of a dev-browser. **Not checked:** a real shop or a real
      card; a bank's own check after the button (3-D Secure); Braintree, Adyen, Shopify and
      PayPal pages; a checkout that keeps its boxes inside shadow DOM, which are not found;
      macOS, Windows, an owner's own Chrome with its real prompt; the desktop app, which needs
      a release for its daemon to pay; the phone's code box on a phone (item 95 ran it in the
      phone app's browser build only).

87. **The sections of a Dood's panel fold, and the panel scrolls as one** (2026-10-13;
    `apps/web/src/components/chat/panel-section.tsx`, `agent-panel.tsx`). The owner, of a
    panel with a pin, a thread from another Dood and four from Slack in it: "this panel is a
    little crammed when you have lots of stuff ... i wonder if these sections could be
    collapsable". Before this each section had a share of the panel's height and a scroll
    area of its own, and the last, What it did here, had what was left: in a window 800px
    tall the face and a pin took most of it and the sections after them were cut off, with
    nothing that scrolled to them. `prototypes/panel-sections` drew that and three ways out
    (folding sections, tabs, short lists); the owner chose folding: "Yeah build A please".
    - **Every section is a `PanelSection`**: a heading that is a button, with a caret, the
      section's name and how many are in it. Pinned, the screen it is on, Running in the
      background, Sub-agents at work, From other Doods, From Slack, Here now, Shared here and
      What it did here all fold. What is folded is not drawn.
    - **Folded, a heading still says how things stand** (`said`): how many threads are
      waiting for an OK, that one is being answered, or that all were answered; a spinner
      where something is running. Nothing opens a section but a press.
    - **How a section was left is kept** in the browser (`dc-panel-folds`, `panelFoldsAtom`),
      by section and for every Dood alike. One never touched is as it starts: From other
      Doods, From Slack and Shared here start folded, the rest open.
    - **The panel scrolls as one**, the face with it. Once the Dood's name has gone under the
      top, a bar there has its face small, its name and what it is doing; a press on the bar
      scrolls back to the face. Start fresh stays in the corner over it.
    - **What it did here lists its latest five**, with "Show 2 more" for the rest of the
      thirty it keeps.
    - **Mine:** what starts folded; that a folded section with something new does not open
      by itself; that folds are kept for every Dood and not for each; the bar, and that it
      scrolls back when pressed; five and a "Show more"; that the screen and Here now fold
      too, so every heading is alike. The owner was told each of these with the mock-up and
      with the recommendation, and answered with the direction only.
    - **Checked:** `e2e/layout.spec.ts` (folding, what is kept over a reload, the count, show
      more, the bar in a short window and back), `e2e/slack.spec.ts` (a folded heading saying
      "Answered"), and by eye, dark and light, in a panel with two pins, two files and seven
      pieces of work.
    - **Not checked:** the headings of a thread waiting for an OK or being answered, a
      command running, sub-agents and Here now by eye; Safari; a deployed Worker.

88. **A Dood looks at a file of its library, with the tool it looks at a page with** (2026-10-14;
    `packages/agent/src/visuals.ts` (`look`), `packages/runtime/src/preview.ts`,
    `apps/web/src/server/agents.ts` (`viewLibraryFile`), `LibraryBackend.viewToken`). The owner
    asked: "Can we give the agent the ability to look at its own files visually that are in the
    library?" Before this a Dood could look at a page only before it drew it into a chat
    (item 79), from the HTML it was about to send. A page it had written into the library,
    with a stylesheet or a picture beside it, it could not see at all, and a Dood with no
    computer could not see a picture someone gave it.
    - **One tool, `look`.** `look({ html | file, width?, top?, appearance? })` answers a
      picture and what is to be said of it. With `html` it is item 79's `visual_preview`, which
      is gone under that name: a page about to be drawn, as the chat will draw it, with all
      that item says. With `file` it is a file of the library: a path there (as it is there,
      or as it is on a machine under `~/library`), a name or an id; a folder is its
      `index.html`. One of the two, and one sent empty is taken as not sent. Nothing is shown
      to the person and nothing is changed. It is offered where the server has a browser, and
      both ways count against the same sixty looks an hour. It was first built as a tool
      beside `visual_preview`; the owner asked "why not make this a mode of visual preview",
      was told what spoke for each, and wrote "yeah do this please! name it look".
    - **A page is gone to where the app serves it.** The browser is sent to
      `/d/<agent>/<view>/<path>`, the address a person's own browser is given (item 13), so it
      gets the same bytes under the same headers: the app's look put in, the sandbox, the
      files beside it. It is told its colors on the address's fragment, as the app tells a
      page it frames, with the Dood's own color, and the browser is told the device is dark or
      light for a page that follows that. The agent is told how tall the page is, how much of
      it is in the picture, and its console. This is unlike item 79, where the browser need
      not reach the deployment: here it must, at `DC_BASE_URL`.
    - **What is not a page is asked for as one.** `?page` on that address
      (`LIBRARY_PAGE_PARAM`) has the gateway make the page a shared link shows for the file
      (`shownAs`, item 51): a Markdown document laid out to read, a CSV as its table, text as
      text. That is not the app's own viewer: a `mermaid` block stays code and code is not
      colored there, and the tool says so.
    - **A picture is drawn by itself**, on the app's background, no wider than the window and
      never larger than it is, and the agent is told how large it is. An SVG is drawn the
      same way.
    - **A PDF, a film, a sound, and text over 1 MB** are refused with the reason, before a
      browser is asked.
    - **How much is pictured.** A file is 1120px wide unless said (240 to 1600; 360 is a
      phone), in a window 800px tall, so a short page is 800px. A picture holds about 1.5
      million pixels, which is 1339px down at 1120 wide and the 2000px most at 360: past that
      a model is given the picture smaller and cannot read it. `top` starts the picture
      further down, and the agent is told where to look next. Both hold for `html` too, where
      the width is still 680 unless said; there the only change is that a page looked at
      wider than 750px is pictured less than 2000px down.
    - **The address is never said to the agent.** Whoever has it can read the library for
      some hours, so it is taken out of console lines and of what the browser says when it
      fails, and `previewIn` leaves it out of its own errors.
    - **What the agent is told:** to look at a page or a document it wrote or changed in the
      library before it sends it, as a phone shows it too, and that this is how it sees a
      picture it was given. The person sees "Looking at q3.html" for a file and "Looking over
      a page before showing it" for a page, as before; a chat from before this still names
      its `visual_preview` calls.
    - **The owner's:** the wish, one tool for both, and its name. **Mine:** that the browser
      goes to the app's own address and is not handed the files; the shared page for what is
      not a page; what is refused; the widths, the pixels and `top`; dark unless said; that
      a file's look counts with a page's.
    - **Checked:** `sharing.test.ts` (the tool through an agent with a stand-in browser: the
      address and that the library answers at it, the colors, `?page` for a document, a
      table and text, a picture and one that would not draw, a tall page a part at a time, a
      folder, what is refused, the address left unsaid, both or neither of `html` and `file`,
      no tool without a browser), `activity.test.ts`, and `e2e/preview.spec.ts` against the
      built server with a real Chromium: a page that is only tall once the stylesheet beside
      it loads, at a computer's width in the dark and a phone's in the light, a Markdown
      document, a PNG, and item 79's tests under the new name. The pictures themselves were
      looked at for the example dashboard, a document with a table, a note, code and a
      picture beside it, a CSV and a PNG. Under the local Workers runtime
      (`DC_TARGET=cloudflare vite dev`, the browser the Vite plugin downloads) the tool
      answered the same heights as under Node for a page, a document and a picture.
    - **Not checked:** a deployed Worker, where Browser Run has to reach the deployment at its
      public address, which nothing here has asked of it before; a real model using the tool
      or being given the picture; the desktop app serving itself (item 85), where the address
      the Chrome is sent to is the one Tailscale serves; a server whose own address is not one
      its Chrome can reach, such as one behind a port mapping, where the tool will say the
      browser could not open the file.

89. **A Dood is told which computer a message was written on** (2026-10-14;
    `packages/protocol/src/origin.ts`, `packages/agent/src/caller.ts`, `actor.ts`,
    `computers.ts`, `apps/desktop/src/page-bridge.ts`, `apps/web/src/lib/desktop.ts`,
    `apps/mobile/src/lib/origin.ts`). The owner: "can we make it so that we tell the agent
    which computer a user message was sent from so that it can use that info". Before this a
    Dood with two paired computers had no way to know which one "my screen" meant.
    - **A message says where it was written** (`SendMessageRequest.from`): the app (a
      browser, the desktop app, the phone app), the kind of device, and from the desktop app
      the id of the computer it is on.
    - **Only the desktop app knows a computer.** Its daemon says what the server knows the
      computer by when it pairs and connects; the app keeps that (`Sharing.computerId`) and a
      page asks for it as each message is sent (`pairedAs` on the bridge), since a computer
      can be shared, or not, long after the page loaded. It is null while Doods cannot use
      the computer. A browser cannot tell which computer it is on and says only what it
      calls itself (`deviceOf`).
    - **The Dood reads it in the note each message already carries**, beside when it was
      sent: `<meta sent_at="…" via="desktop app" device="Mac" computer="sawyers-air"/>`. In
      the note and not the system prompt, so that the prompt cache holds. The computer is
      named as the Dood knows it, and only where it is a paired computer the Dood has. Where
      a Dood has paired computers, what it is told about them now ends by saying that a
      named computer is the one the person is at, and that a note naming none does not say.
    - **It is the sender's word.** Nothing is granted on it, the gateway does not check it,
      and only words from a list reach the model: an app or a device the server does not
      know is dropped, and so is a computer the Dood does not have.
    - **Mine:** all of how. That the app and the kind of device are said too, which was not
      asked for; that nothing guesses which computer a browser is on (the same network
      address, or asking in each browser, were the other ways); that a computer the Dood is
      not connected to is not named; that the Dood still works on a machine of its workspace
      unless the task is about the person's own; that the app shows nothing of where a
      message was written.
    - **Checked:** unit tests of the device, the note and the app's side; the actor with two
      paired computers and a machine (`paired.test.ts`); `e2e/this-computer.spec.ts`, a page
      in the app and one in a browser; the real app on Linux and on Windows, whose message
      names the computer it paired as (`apps/desktop/e2e/desktop.spec.ts`); and by hand a
      built Node server, from sign-up to the notes it kept.
    - **Not checked:** a real model making use of it; the app on macOS, which a pull
      request's run leaves out; the phone app on a phone or in a simulator, which was
      type-checked only; a deployed Worker.
      An installed desktop app says which computer only from the release after this one, and
      the phone says it is a phone only from its next build. Until then the note has less in
      it and is not wrong.

90. **A Dood is dragged to another place in the sidebar, and they stay as they were put**
    (2026-10-14; `apps/web/src/components/shell/agent-list.tsx`, `workspace-menu.tsx`,
    `apps/web/src/lib/atoms.ts`, `latest.ts`). The owner: "I would love to be able to reorder
    my agents in the sidebar".
    - **What it does.** A row is dragged up or down among its workspace's rows. A workspace's
      Doods are the one last heard from first, as before, until one of them is moved; from
      then on they keep the order they were put in, whoever speaks, and the marks on a row
      still say who has something new. One made since, or moved in from another workspace,
      is above the rest. "Sort by latest" in the workspace's menu gives the order up, and is
      only there while there is one.
    - **The order was kept in the browser** (`dc-agent-order` in its storage: for each
      workspace, its Doods' ids from the top down), as which workspaces are folded is. The
      owner: "Could these just be local storage sorts like on the client? Do they have to be
      on the server or not? ... we can kind of do that and then figure that out as we go". So
      it was each person's own, and also each browser's own. An id that is no longer a Dood
      of the workspace is passed over. Item 95 moved it to the server, in the same shape, and
      a browser's own is carried up there once.
    - **How.** dnd-kit, one sortable list for each workspace, held to moving up and down
      within its own rows. A mouse takes a row up once it has moved six pixels, so a press
      that does not move is still a click; a finger takes it up after a quarter of a second
      held still, so one that moves at once still scrolls; Space takes up the row that has
      the focus, the arrows move it, and Space or Enter puts it down. A row is taken up by
      its link and stays a link to a screen reader, which is told how it is moved and where
      it has got to, by name.
    - **What a screen reader is told is the list's own** (`tell`, one region for the whole
      list). dnd-kit puts a `role="status"` of its own beside every list, there whether or
      not anything is moving, and the page keeps that role for what it has to say itself,
      one at a time: `getByRole("status")` in eight tests found two. dnd-kit's is given a
      place that is not in the page (`NOWHERE`).
    - **The click after a drag** (`swallowClick`). A row let go under the pointer has been
      clicked, as far as the browser knows. dnd-kit keeps that click from the page's own
      handlers and no more, and a row is a link, so the browser then followed it and loaded
      the whole page again at that Dood. The click that ends a drag is now taken at the
      window, before anything else has it.
    - **The lockfile.** `pnpm add` resolved everything again and gave Better Auth's
      `better-call` another `zod`, which is nothing to do with this. Only dnd-kit's own
      entries were put into `pnpm-lock.yaml`, by hand, and `pnpm install --frozen-lockfile`
      takes it.
    - **The owner's:** that the order is each person's own, that a Dood is not dragged into
      another workspace, and that it is kept in the browser for now.
    - **Mine:** that nothing changes until a row is first moved, that a new Dood is on top,
      "Sort by latest" and where it is, that the whole row is what is dragged and there is
      no handle, the keys, dnd-kit, and that there was no mock-up first.
    - **Checked:** `inOrder` in `latest.test.ts`; `e2e/sidebar.spec.ts`, which drags with a
      mouse (the page stays where it was and is not loaded again), tries to drag into another
      workspace, loads the page again, hears from the last Dood, makes a new one, clicks a
      row, moves one with the keys and gives the order up; the whole of the web app's browser
      tests; and by hand in the built app, with
      a finger stood in for over the DevTools protocol (moved at once, held and moved, held
      and let go) and with the click guard taken away, which loaded the page again.
    - **Not checked:** a real touch screen, Safari, the desktop app, and anything on macOS.
    - **Not built here:** the order on the server, and moving a row from the phone app. Both
      are item 95.

91. **A Dood can be called out loud** (2026-10-14; `packages/protocol/src/calls.ts`,
    `packages/agent/src/calls.ts`, `actor.ts`, `project.ts`,
    `apps/web/src/server/calls-directory.ts`, `apps/web/src/lib/call.ts`, `call-events.ts`,
    `call-said.ts`,
    `apps/web/src/components/call/call.tsx`; the plan is `PLAN-voice-calls.md`, the mock-up
    `prototypes/voice-calls/`, the reference page `docs/reference/calls.md`). The owner asked
    for what OpenAI's Dots has, "this feature that lets you call your dot and it starts like a
    real-time voice conversation with them", had it researched, planned and mocked up first,
    and then: "Yeah, layout A seems right", "I think Codex is fine for now", "lets let it rip".
    - **Two models, and the Dood is not replaced.** A small fast model talks (OpenAI's
      `gpt-live-1`), and hands on whatever it cannot answer from what it was given. The Dood
      keeps its own model, tools, computers, approvals and memory, whatever it thinks with.
    - **The sound never passes through the server.** The browser holds a WebRTC call with
      OpenAI. The server starts it (`POST /calls` on the agent, with the browser's offer),
      giving the voice the Dood's name, character and notes and the end of the chat, and
      hands back the answer. The sign-in stays on the server.
    - **The browser carries the call** (`lib/call.ts`). The voice's events come over a data
      channel, and the browser answers a hand-off over it too, so the server holds no line of
      its own onto the call. Tried first: a server's line works, and is sent the sound of both
      sides, which it has no use for.
    - **Two ways to pay, read as one** (`lib/call-events.ts`). A ChatGPT subscription signed in
      as OpenAI Codex goes the way OpenAI's open-source Codex client makes its voice calls
      (`chatgpt.com/backend-api/codex/realtime/calls`); an OpenAI API key goes the public way
      (`api.openai.com/v1/live/sessions`). They carry the same things under different names,
      and have different voices. The nearest sign-in pays, the workspace's before the
      server's, a subscription before a key (`calls-directory.ts`). The newer Sign in with
      ChatGPT keeps a token under `openai` too, and it cannot place a call: both routes answer
      it 401.
    - **A hand-off is a message, in the call's side chat.** The voice can only talk; what it
      hands on (`POST /calls/:id/work`) arrives as said by the person, marked "Said on a
      call", with a note beside it for the Dood: that it was spoken, to answer for the ear,
      and what was said on the call since it last heard. The Dood does it as it would a typed
      message, with every tool it has. The browser follows that chat for the answer, known by
      the id the hand-off was sent under (`ChatMessage.spoken`), and gives it to the voice,
      with a step now and then while the Dood works.
      **Which chat:** a call held in the main chat is given a side chat of its own at the
      first hand-off (`#callWork`), branched off the main chat as any side chat is and named
      "Call: …"; a call held in a side chat works in that one. The owner asked for this the
      same day, after asking what a call leaves behind: "it should for sure get a way to call
      tools. Maybe each call has a sidechat that the call can dispatch things to and it can
      do them". So the main chat is neither held up by a call nor filled with it. Only the
      call's own way in marks a message as spoken: `SendMessageRequest.call` is gone.
    - **The chat keeps one record** (`dc.call`): how long, what came of it in up to three
      lines by the small model that writes the chats' notes, what was said, and the side chat
      its work was done in. The entry carries a note for the Dood, so that it remembers: all
      that was said where the work was done in another chat, else what it was not shown. The
      call's side chat is told that the call is over (`dc.call-over`, which shows nothing).
      A call nobody ends is written up at its time, by the agent's wake-up.
    - **What is said out loud is remembered as what is typed is** (the owner: "Yeah do that
      small change"). When the record is written the chat is reviewed (`journal.ts`): the
      small model reads the call's lines as said in the chat, by the caller's name, rewrites
      the chat's note for the Dood's other chats, and adds lasting things to what the Dood
      remembers: up to three of a kind from a call, where a typed stretch gives one, since a
      call is all new at once (and is read up to 30,000 characters of, against 9,000). The
      voice is told to hand on anything it is asked to remember, save, schedule or send. The
      `history` tool prints a call's summary and words where it printed only its length.
    - **Where it shows.** In the Dood's panel, where its face is: the creature's mouth
      follows how loud its voice is (`feedMascot` now takes an amount), rings say who is
      talking, the words are under it. Wherever the panel is not, a card in the corner of the
      window. The chat has a live card while it lasts, which names the step the Dood is on
      and opens the call's side chat; the record opens it afterwards. A Call button under the
      name and a phone in the strip. The voice is chosen beside the Dood's look. The card
      keeps clear of a side chat or a document that is beside the chat (`use-beside.ts`): it
      sat over the top of one before.
    - **Who can call.** `DC_CALLS` (`admins` unless told otherwise, as the owner asked),
      `DC_CALL_MINUTES` (30), `DC_CALL_MONTHLY_MINUTES` (60, counted in `dc_call_usage` only
      where the server's own sign-in pays). `DC_CALLS_SCRIPT=1` has no voice and plays a
      script, for the browser tests.
    - **The owner's:** that it be built at all; layout A; that the nearest sign-in pays
      ("user, then workspaces, then server"); the Codex subscription first where it works,
      then a key; limits from the environment; admins only for now; a side chat for each
      call's work; that what is said be remembered.
    - **Mine:** that the browser carries the call and the server holds no line; that a
      hand-off is an ordinary message and not a turn of its own kind; that only a call held
      in the main chat gets a new side chat, and one held in a side chat works there; that
      the side chat is made at the first hand-off and not at the start, is listed with the
      others and is not put away when the call ends; three lasting things from a call;
      what the voice is told
      and how much of the chat it is given (forty messages); the record's form and that a
      small model writes its lines; the names and defaults of the limits; a voice picked by
      the Dood's id; that the app names itself to OpenAI as `do-computer` and not as Codex;
      that what is typed during a call is not told to the voice.
    - **Checked:** the actor with a stand-in for the provider (`calls.test.ts`); who may call
      and which sign-in pays (`calls-directory.test.ts`); both kinds of call's events as real
      calls sent them (`call-events.test.ts`); a whole call in a browser against the built
      server with the scripted voice (`e2e/calls.spec.ts`). **And for real, twice through the
      built server on this Linux machine**, with a recorded voice as the microphone and Claude
      Haiku as the Dood: once on an OpenAI key and once on the Codex client's own sign-in.
      Each heard a sentence and answered aloud, answered from the chat held before the call,
      handed a request on that the Dood ran real commands for, said the Dood's answer, and
      left a record with its summary; the second counted its 53 seconds against the month.
      The call's routes were also run under the Workers runtime on this machine, with the
      scripted voice: a call started, was told its lines, handed a message on, ended, and
      left its record.
      The first real call on a subscription kept some lines twice: that route says when a
      turn ends, about two seconds after its last word, and a pause had already counted the
      line. What is said is now kept by `lib/call-said.ts`, which is tested against those
      calls' own timings, and both routes were called again with every line kept once.
      With the side chat, one more real call, on the OpenAI key and held in the main chat:
      "please remember that my dog is called Biscuit" was handed on, the call was given its
      side chat, the Dood used its `memory` tool there and the voice said it was saved; a
      question about the library went to the same side chat. The main chat got the record
      alone, its note was rewritten from the call's words by the real small model, and the
      Dood there, asked afterwards, said what had been asked and in which side chat. Not run
      again on a subscription: how the words are kept did not change.
    - **Not checked:** a deployed Worker; a workspace's own Codex sign-in as the app makes
      one (the test used the Codex client's, put in as the server's); Safari, Firefox, a
      phone's browser; the desktop app; how it sounds, which nothing here could hear; a real
      person talking over it; a long call; two people in a team.
    - **Not built:** calling from the phone app, which came after as its own change (item 95);
      a person's own sign-in, a level the app does not have (the owner agreed it comes
      after, as its own change); the voice being told how work is going that it did not hand
      on, or what is typed during a call; the server cutting a call off itself (the browser
      hangs up at the limit and the server's count stops there); the whole-window layout; the
      desktop companion carrying a call; a Dood calling its owner. The call's side chat
      branches off the main chat where the Dood last came to rest, so work in the middle of
      which the main chat is when the call asks about it is not in front of the Dood there.
      Every call that hands something on leaves a side chat in the list until it is put away.
      The route a subscription's call takes is Codex's own and documented for nobody else. It
      stopped for everyone for two days in August 2026. See section 10 of the plan.

92. **A deployment adds models that are not yet in pi's list** (2026-10-14;
    `packages/agent/src/extra-models.ts`, `model-providers.ts`, `model-access.ts`, `models.ts`,
    `apps/web/src/server/passwords-directory.ts`). The owner asked whether a model pi does not
    list could be run on a Claude sign-in, named in the environment and not in the code.
    - **What it does.** `DC_EXTRA_MODELS` names models to add to their provider's list, each
      `provider/model`, comma-separated. `[1m]` after one asks for its long context, the way
      Claude Code writes it: the model is taken to hold a million tokens, and a request to
      Anthropic for it names `context-1m-2025-08-07` beside the features it names anyway.
      `=model` after that names the model of the same provider it is treated as, for all that
      pi knows of a model and cannot know of this one: how it thinks, what a request to it may
      ask for, what it is priced at. Without one that is the model suggested first for the
      provider. An entry that cannot be placed is passed over. See `docs/reference/models.md`.
    - **How.** A provider is wrapped (`withExtraModels`): its list has the added models after
      its own, each a copy of the model it is treated as under its own id, without the models
      that may answer in that one's place. pi sends a model's id as it is given, so nothing
      else is needed to call one. The long context is asked for by the request's `fetch`, which
      adds to the header it finds: naming a feature in pi's own headers replaces the ones pi
      works out, and a subscription's request needs those.
    - **Who is offered one.** A workspace signed in to the model's provider with an account of
      its own, where everyone in the workspace is named in `DC_ADMIN_EMAILS`
      (`everyoneIsAdmin`, the rule saved logins have, asked each time). Nobody else is, and
      neither the deployment's key nor what it is signed in to for everyone offers one,
      whatever `DC_MODELS` says. A Dood cannot be set to one it is not offered.
    - **On Cloudflare** the setting is a Worker secret (`wrangler secret put`): it is not
      among the settings a deploy carries.
    - **Mine:** the setting's name and its form, `=model` and what stands in without it, that
      the price is the copied model's, who is offered one, and that a deploy does not carry
      the setting.
    - **Checked:** `test/extra-models.test.ts` in the agent package (what a request carries is
      read from the request itself, with a key and with a subscription's token) and
      `extra-models.test.ts` in the web app (an admin's workspace, a team of admins, someone
      else's, a team with someone else in it, the deployment's own sign-in); and the built
      Node server with Anthropic stood in for: an admin was offered the model, set a Dood to it
      and was answered, and someone else signed in the same way was not offered it and could
      not set it.
    - **Not checked:** a real sign-in, and a model that is in no list. Whether a provider
      takes a request made as for the model one is treated as is only found by trying it: if
      it turns one down, name an older model after `=`.

93. **A Dood searches for a connector's tools, and neither connectors nor their tools are
    counted** (2026-10-16; `packages/agent/src/connectors.ts`, `actor.ts`, `models.ts`,
    `packages/protocol/src/activity.ts`, `apps/web/src/components/settings/connectors.tsx`).
    The owner asked whether tool search was on, and on hearing it was not: "remove the caps for
    the number of connectors and tools and enable tool search".
    - **What it does.** pi-durable's `tool_search` (`@earendil-works/pi-durable/tool-search`,
      there since 1.2.0) is installed for every Dood. A connector's tools are registered
      `deferred`: none is in a request until the Dood has searched for it, and one it found
      stays offered in that conversation, also after a compaction. The limits of 20 connectors
      and 60 tools a connector are gone, since a tool that is not used no longer costs prompt
      space each turn. The `connectors` section of the prompt says to look with `tool_search`,
      where there is a connected connector to look in.
    - **Apps is left as it was.** Its handful of tools are offered outright: it is itself a
      search over the tools of the services behind it, and a search to find its search would
      be one step more for nothing.
    - **Each conversation finds its own.** A sub-agent, an automation's run and a thread in
      Slack start with none of a connector's tools and search for what they need. A
      conversation that was using a connector's tools before this has them taken away once,
      and searches.
    - **The echo model** looks for a tool it is asked to use and is not offered, then uses it,
      so `/tool <connector>__<tool> {…}` works as before.
    - **In the app** a connector's card names its first twelve tools and counts the rest, and
      a search reads "Looking for a tool: …".
    - **Mine:** that Apps is not deferred, that every other connector's tools are however few
      it has, and the twelve names on the card.
    - **Checked:** the agent package's tests (a server of 303 tools is taken whole, a search
      loads its eight best matches and they stay offered in the next turn, 25 connectors are
      added; approvals ask about the call and not the search), the same in a Durable Object
      under workerd, and browser tests against the built Node server, one of them new: a
      server of 202 tools is added and one of its tools is found and used.
    - **Not checked:** a real model deciding to search, and how well BM25 over names and
      descriptions finds the right tool on a real server with hundreds.

94. **The desktop app's picture is a creature on its own color, and the tray is its owner's
    too** (2026-10-16; `packages/mascot/src/portrait.js`, `scripts/icons.mjs`,
    `apps/web/src/lib/app-icon.ts`, `apps/desktop/src/page-bridge.ts` and `main.ts`). The
    owner found the island of item 49 "a little too maximalist" in the Dock ("I really think
    the bg is too intense"), picked the deep tint out of eight mock-ups
    (`prototypes/app-icon-minimal`), and asked that the tray follow the agent as well.
    - **The desktop's picture** is the creature, or its egg, on a plain square of its own
      color taken 68% of the way to a near black (`portrait.backdrop`), with the same shadow
      under it. The app's two built-in desktop icons are that of the teal mochi. The browser's
      icons are still the island. The phone app's icon became this picture too on 2026-10-17
      (the owner: "use the same thing so it was less noisy background"), full-bleed and
      without corners since iOS cuts its own.
    - **The tray follows the agent.** `app-icon.ts` draws the agent alone at 36 pixels with
      `portrait.sprite`, which is the code `scripts/icons.mjs` drew the usual tray with,
      moved into `portrait.js`: awake in its color for a computer that is shared, grey and
      asleep for one that is not. The pair goes to the app through `setTray` on the page
      bridge; the app shows it at 18 and 36 pixels (the large one alone on Linux). Null is
      the usual pair. It accepts only a pair of PNGs' addresses of exactly 36 pixels a side.
    - **No sky is loaded for it any more**, so the page no longer makes a graphics context
      for the island. An app older than this has no `setTray` and keeps its usual tray.
    - **Checked:** `scripts/icons.mjs` writes the same tray, tab and phone pictures as
      before, byte for byte; `apps/web/e2e/app-icon.spec.ts`. **Not checked:** the tray in a
      running app on a Mac, which is where its owner will see it.

95. **The phone app's replies catch up with the web app's: code in its colors, notes, folding
    sections, diagrams, a connector's page, and the word that a message was delivered**
    (2026-10-16; `apps/mobile/src/ui/markdown.tsx`, `syntax.ts`, `chat/parts/diagram.tsx`,
    `app.tsx`, `visual.tsx`, `chat/transcript.tsx`, `library/page-view.tsx`,
    `apps/web/src/routes/embed.diagram.tsx`, `packages/protocol/src/diagram.ts`,
    `packages/client/src/app-host.ts`). The owner asked which of the changes since item 65 the
    phone app had not been given, and then to "port all of these". Pins, calls, saved logins
    and cards and the order of Doods were built apart from this and have entries of their own.
    - **Code is in its colors** on the phone, the same seven as the web app's. Shiki's
      grammars need a regular-expression engine a phone's JavaScript has not got, so the phone
      reads code with a small reader of its own (`syntax.ts`): comments, strings, numbers, a
      language's own words, what is called, and punctuation, for the languages the web app
      has grammars for, with JSON, YAML, TOML, HTML, CSS and a diff read their own way. It is
      less exact than a grammar. Code a reply is still writing is plain, as on the web, and a
      block has a button that wraps its long lines.
    - **A `mermaid` block is its diagram.** A phone cannot draw one, so the deployment does:
      `/embed/diagram` is a page of the web app that draws one diagram with the web app's own
      drawing and says how large it is, shown in a web view (a frame in the browser build).
      The diagram is handed over by a call to `window.dcDraw`, which only a page of the same
      origin or the app around the web view can make; it is never in the address, so a link
      to the page draws nothing and nothing of a diagram reaches the server. One that cannot
      be drawn, or a deployment from before the page (nothing heard in fifteen seconds), is
      shown as its code.
    - **A note** (`> [!NOTE]` and its kin) has its name and color; **a section that folds**
      (`<details>`) opens when its heading is pressed, and is the one piece of HTML the phone
      reads; **a table** is copied as Markdown or as CSV from a menu under it
      (`tableMarkdown` and `tableCsv` are in the protocol package now, for both apps).
    - **A connector's own page for a tool** (item 82) is shown in the chat on the phone. The
      talk with the page (`createAppHost`) moved to `packages/client` for both apps. In the
      browser build it is the same frame as the web app's. On a phone it is a web view that
      asks for the page with the session once, gives the page no cookie, and stands in for
      the window a page speaks to (`APP_SCRIPT` in `app-frame.native.tsx`). A tool that may
      change something is asked about in the phone's own sheet. There is no large.
    - **`dc.save` and `dc.expand`** in a page the Dood drew now do something on the phone: a
      file is handed to the share sheet (downloaded, in the browser build), and large is the
      library's own screen for the page, where the page starts again.
    - **A page of the library** is opened in the app's light or dark with its Dood's color,
      as the web app shows it, and follows them when they change.
    - **Under a sent message** it says "Sending" and then "Delivered", only for a message
      seen on its way, and the word leaves after three seconds; it takes no room of its own.
    - **A connector's tools** are named up to twelve, then counted, as on the web app's card.
    - **Mine:** a reader of our own for code in place of Shiki; the deployment's page for
      diagrams, and how it is handed one; `<details>` as the only HTML read; the menu under a
      table; large as the library's screen; that a connector's page is asked for with the
      session in a web view.
    - **Checked:** `apps/mobile` unit tests (the reader of code, the new blocks, the script a
      page is given); `packages/protocol/test/diagram.test.ts`; and `e2e/mobile.spec.ts` on
      the phone app's browser build: the words under a sent message, code in three colors,
      wrapping, a table copied both ways from the clipboard, a note and a folded section, a
      diagram drawn and one that cannot be, a file saved from a page and the page opened
      large in the app's colors, and a connector's page told its tool's answer, running a
      reading tool at once and another only after a yes. **Not checked:** any of it in a
      simulator or on a phone. The web views for a diagram and for a connector's page, the
      share sheet for a saved file and the colors handed to a library page have only been
      type-checked there; the standing-in for a page's window in particular is untried
      against WebKit. A deployment older than this, which has no `/embed/diagram`.
    - **Not built:** inline HTML other than `<details>` (`kbd`, `sub`, `sup`), a link to a
      heading in the same reply, a connector's page shown large, and a Markdown document of
      the library in its Dood's color (its links are still the app's teal).
96. **The phone app shows a Dood's pins, and pins and unpins as the web does** (2026-10-16;
    `apps/mobile/src/pins`, `apps/mobile/src/chat/parts/pin.tsx`, the library's list and
    viewer in `apps/mobile/app/(app)/a/[agentId]/library`, `packages/protocol/src/pins.ts`).
    Until now the native app had nothing of item 71: no pins, and nothing in a chat where the
    Dood pinned something.
    - **In a chat** the Dood's pinning is the web's card, drawn natively (`PinCard`): "Pip
      pinned Launch board", the file's place, Open (the library's viewer) and Unpin. It says how
      the pin stands now; taken off, it offers "Pin it again" under the Dood's title.
    - **Under the face, on the Dood's page** (`info.tsx`, `PinnedSection`): a Pinned group
      between the three buttons and At work now, where the web has its Pinned section under
      the face in the panel. The first pin, when it is a page, a document or a picture, is
      drawn at the page's width over its row (a web view, the Markdown, the picture), and a
      page is loaded again when anything in its top folder changes. Every pin is a row that
      opens the file, says when it last changed or "Just changed" for a few seconds, and is
      taken off with a swipe, or from its menu (a hold on iOS, three dots elsewhere). A pin
      whose file was deleted stays, saying "No longer in the library", with Unpin beside it.
      With nothing pinned there is no group.
    - **From the chat**, the main chat's More has a Pinned menu listing them, so a pin opens
      in two taps, which is the nearest a phone comes to the web's "beside the chat".
    - **A person pins** from a file's menu in the library ("Pin to Pip", also a swipe), and
      with a pin on the bar of the open file, filled while it is pinned ("Unpin from Pip").
      A pinned file's row has a pin mark. The library is the workspace's, so a file is pinned
      to the Dood the library was opened from, as on the web.
    - **The web's rules hold** because they are the server's: eight at most (the phone says so
      before asking, in the server's words), anyone who can open the Dood may pin, and the
      Dood's `changed: "pins"` now asks for the pins again (`CHANGED` in `lib/queries.ts`), so
      a pin the Dood makes appears at once on every screen of it.
    - **Shared, not copied:** `pinnedEntries`, `pinsFull` and `pinStanding` in
      `packages/protocol/src/pins.ts`, and `pageShownAt` in `library-links.ts`. The web's
      shelf and card use them too. The phone's own choices (the words of a menu item, the
      menu of pins) are pure functions in `apps/mobile/src/pins/model.ts`.
    - **Mine, not the owner's:** the Dood's page and the chat's More as the places for pins
      (the phone's chat has no panel, and its header has no room for chips); drawing the
      first pin at full width rather than at half size; the pin in the viewer's bar rather
      than in its menu, so that it shows how the file stands; orange for the swipe, as
      Messages pins; refusing a ninth pin on the phone before the server does.
    - **Not built:** reordering, which the web does not have either; the pin on a file's card
      in a chat, which the web has (the card has a download and a share already, and the file
      is a tap from its viewer's pin); a mark for "changed since you last looked".
    - **Checked:** unit tests for the shared functions (`packages/protocol/test/pins.test.ts`,
      `library-links.test.ts`) and the phone's (`apps/mobile/test/pins.test.ts`); two browser
      tests through the phone's web build (`mobile.spec.ts`): the Dood pinning, the card's
      Unpin and Pin it again, Open, the chat's Pinned menu, the group on the Dood's page with
      the first pin drawn, a pin made elsewhere appearing without a reload, unpinning from a
      pin's menu; pinning from the library's menu and the viewer's bar, the ninth refused, a
      deleted file's pin saying so and taken off. Looked at at phone width in the browser
      build. **Not checked:** anything on iOS itself (no Mac was at hand, so no simulator):
      the system's menus, the swipe, the web view drawing the first pin, SF Symbols `pin`,
      `pin.fill` and `pin.slash`; Android; a real model deciding to pin.
97. **The phone keeps a workspace's saved logins and cards, and a card is added there**
    (2026-10-16; `apps/mobile/app/(app)/settings/w/[workspaceId]/passwords.tsx` and
    `passwords/`, `apps/mobile/src/passwords`, `apps/mobile/src/chat/asks.tsx`,
    `packages/protocol/src/passwords-typed.ts`). The owner asked for the web's management of
    saved logins and cards to be on the phone, and for a new card to be entered there.
    - **Where.** A workspace's settings on the phone have a Passwords row under Computers and
      Models, under the web's condition and no other: the workspace keeps logins or cards and
      this person may see them (`keepsSecrets`, which the web's `workspaceSections` now uses
      too). It opens one grouped list with a section for each kind the workspace keeps.
    - **Logins.** A row each, with its first letter, its username and sites, and when and by
      which Dood it was last used, or in red that its password can no longer be read. A tap
      opens it to change its name, username and sites, with Replace the password and Remove
      under them; one whose password cannot be read opens on giving it again. A swipe gives
      the password and Remove too. Adding asks for the name, the username, the password and the
      sites, a row each, with a row to type the next site in. The words and the checks are the
      web's: everything a person types is checked by the same functions, which moved from the
      web app into `packages/protocol` (`loginToSend`, `withSite`, `cardToSend`, `usedWords`
      and the rest) and are tested there.
    - **Cards.** A row each, with its kind, the end of its number, when it runs out and the
      name on it, and Remove, which the web has and nothing more. Adding asks for the number
      (grouped in fours as it is typed), the month and year (the slash put in by
      `groupedExpiry`, since a number pad has none), the postal code, the name on the card and
      a name. There is no box for a security code.
    - **The phone's own autofill.** The boxes are named to the system for what they are
      (`textContentType` and `autoComplete`: username, password, card number, expiry, the name
      on a card, postal code), with the number pad for digits, so that iOS can offer the
      passwords and cards the phone keeps. The web turns its browser's offers off, so that a
      browser does not take a website's password for this app's; the app has no associated
      domain, so iOS has nowhere to offer to save one. The security code's box is named
      nothing, as on the web: it is typed fresh for each payment.
    - **In a chat.** The form for a login a Dood asks for now has the web's "Used only on",
      the site that asked fixed among the sites and others added, and is sent through
      `loginAnswer` as on the web; it shows only where the workspace keeps logins for this
      person, as on the web. The box for a card's security code has the number pad and takes
      four digits at most. There is no form for a new card in a chat, on the web or the phone:
      `pay` names a saved card and asks only for its code, and with none saved it tells the
      Dood to have someone add one under Passwords. A card is entered under Passwords.
    - **Nothing secret is kept.** What is typed lives in the screen's state and goes with it;
      it is sent from the screen with the client and not through a React Query mutation, whose
      cache keeps what it was given for minutes. The lists are cached as the web caches them,
      and have no password or number in them.
    - **Mine:** one screen for adding, changing and replacing a login's password, a tap on a
      login opening the change and not a menu, a swipe for the password and for removing, the
      Remove word on a card's row, the separate add screens pushed in the settings sheet and
      not sheets of their own, the autofill names, the green key, and the slash in the expiry.
      `Field` in the kit no longer lets its label be squeezed, which a phone never did but the
      browser build did.
    - **Checked:** `pnpm check`; the protocol's tests (`passwords-typed.test.ts`, with the
      web's tests of the moved functions and new ones for the expiry, a card's trouble,
      Passwords being shown and `usedWords` without `Intl.RelativeTimeFormat`); the web's and
      the mobile app's unit tests; and three new tests in `e2e/mobile.spec.ts` through the
      browser build, run with the rest of that file and `passwords.spec.ts`: a login added,
      refused for a site that is not one, changed, given a new password and removed, with the
      password in neither the page nor what the server answers; a card refused for a number
      that does not add up, added, listed by its last four digits and removed, with no box for
      a code; and in a chat, a payment's code typed with the yes and a login given with its
      sites, the server's answers stood in for, since asking needs a computer with a browser.
      Pictures of the screens were taken at a phone's width.
    - **Not checked:** an iOS simulator or a phone, since this was built where there is no
      Mac; so not the system's own bars and menus, the swipes, the number pad, or what iOS's
      AutoFill actually offers for each box. Android. A real `sign_in` or `pay` reaching the
      phone.
    - **Not built:** a form for a new card in a chat, which the web does not have either;
      changing a card, which the web does not allow.
98. **The order a person put their Doods in is kept on the server, and a Dood is moved on the
    phone too** (2026-10-16; `apps/web/src/server/agent-order.ts`, `schema.ts`,
    `apps/web/src/lib/agent-order.ts`, `packages/protocol/src/order.ts`,
    `apps/mobile/src/ui/sortable.tsx`, `apps/mobile/src/lib/order.ts`,
    `apps/mobile/app/(app)/index.tsx`). Item 90 kept the order in each browser and left the
    server and the phone for later; the owner had said "we can kind of do that and then figure
    that out as we go". This is the later.
    - **What it does.** The order is the person's own and the same everywhere they are signed
      in: every browser, the desktop app and the phone. A move in one is made in the others
      while they are open, with nothing asked for again. The rules are item 90's, now in one
      place for both apps (`inOrder` in `packages/protocol`): a workspace's Doods are the one
      last heard from first until one is moved; an id that is no longer one of its Doods is
      passed over; one made since, or moved in from another workspace, is above the rest. It
      is still each person's own in a team: one member's order leaves the others' as it was.
    - **Where it is kept.** `dc_agent_order`, one row for each person and workspace with the
      Doods' ids from the top down as JSON, in the app database, made by the schema's next
      migration on Node and on D1 alike. No row is a workspace never put in order. Only the
      workspace's own Doods are kept of what is sent, each once and at most 500. A workspace
      the person has left is not given back to them.
    - **The API.** `GET /api/agent-order` is the person's whole order, by workspace (`{ order
      }`). `PUT /api/workspaces/<id>/agent-order` with `{ ids }` keeps a workspace's, and
      `DELETE` gives it up (Sort by latest); both answer with what is kept now, and someone not
      in the workspace is answered 404. In `packages/client`: `agentOrder()` and
      `workspace(id).putAgentOrder(ids | null)`.
    - **How the others hear.** On the person's own feed (item 63), the socket that already
      carries a row's latest: a new event, `{ type: "order", workspaceId, ids }`, with `ids`
      null where it was given up. Only that person's tabs and devices are told. When the feed
      comes back after a break the order is asked for again with the list, since what was said
      while it was down was said to nobody. An app older than this passes the new event over.
    - **Moving at once.** The web app and the phone change the list first and tell the server
      after, one write after another for each workspace, so the last one made is the one kept.
      While a write of theirs is on its way, what the feed says of that workspace is their own
      word coming back, perhaps an older one, so it is passed over and the answer to the last
      write is taken. A write that fails puts the list back to what the server has.
    - **What a browser kept is carried up once.** On its first load since this, a browser
      that has `dc-agent-order` sends each workspace's as `carried`, which stands only where the
      person has no order there yet, so that a second browser carrying its own does not undo
      the first; the answer is what is kept, and the key is let go once every workspace was
      taken or refused. A failure for another reason leaves it to be tried on the next load.
    - **On the phone** the list has Edit in its bar, as Mail's and Reminders' lists do, which
      is its edit mode: each row has a handle at its end (`line.3.horizontal`), a finger on
      the handle takes the row up at once, lighter and a little larger, the rows it passes
      make room as it goes, with a tap of haptics for each, and letting go puts it there. In
      edit mode a row is not opened and has no menu, the page does not scroll while a row is
      in the hand, and a workspace that was put in order has Sort by latest in place of its
      heading's buttons (over the rows, for someone in no team). Done, where Edit was, leaves
      it. VoiceOver has Move up and Move down on each handle. It is the kit's `Sortable`, on
      the gesture handler and Reanimated the app already has: no new native code, so no new
      build is needed for it beyond the next one. In edit mode the rows are placed by hand
      from their measured heights, so a move does not lay the list out again until it is let
      go, and going into edit mode and out of it does not draw the creatures again.
    - **Mine, not the owner's:** the server's table and API; the feed event; that a carried
      order does not undo one already kept; that the phone has an edit mode with handles and
      not a long press and drag (a hold on a row is already its sheet of actions, item 65);
      Sort by latest's place on the phone; and that what is sent is trimmed to the
      workspace's own Doods.
    - **Checked:** `src/server/agent-order.test.ts` (each person's own, told to their own
      feed only, trimmed, refused outside the workspace, given up, a left team, carried and
      not undoing), `packages/protocol/test/order.test.ts`, `apps/mobile/test/sortable.test.ts`
      (where a held row goes), and the browser tests: `e2e/sidebar.spec.ts` (item 90's, as
      before; an order made in one browser is there in a second, fresh one, and a move there
      is made in the first with nothing asked for again; an order kept in a browser's storage
      is carried up, let go there, and is every browser's) and `e2e/mobile.spec.ts` (the phone
      build follows an order put in elsewhere, as it is said; a row dragged by its handle with
      a mouse; the server has it; Done; the order kept when the app is opened again; Sort by
      latest). Looked at in pictures of the web sidebar after a move and the phone build at
      390 by 844 before, during and after one.
    - **Not checked:** anything on an iPhone or in a simulator, so not a finger on the handle,
      the haptics, VoiceOver's actions, or whether the page's own scrolling ever takes a drag
      that starts on a handle before the page is told to stop (the browser build is driven
      with a mouse); Android; the desktop app; Safari; Workers and D1, where the migration
      and the API have not been run (the table is plain SQLite, as the others are, and the
      tests run on Node's). The browser loads the order with the list and not before it, so a
      page shows its Doods latest-first for as long as the order takes to come, which is one
      read of the database and is usually there before the list.
99. **A Dood can be called from the phone app** (2026-10-16; `packages/client/src/call.ts`,
    `call-events.ts`, `call-said.ts`, `call-script.ts`, `apps/web/src/lib/call.ts`,
    `apps/mobile/src/call/`, `apps/mobile/app/(app)/a/[agentId]/call.tsx`,
    `apps/mobile/src/chat/screen.tsx`, `apps/web/e2e/mobile.spec.ts`). The owner asked for the
    calls of item 91 in the phone app, laid out as an iOS screen and not as a copy of the web
    panel.
    - **What it does.** A phone in a chat's bar calls the Dood wherever the web app has its
      call button: a chat that is the reader's to write in, a Dood that has hatched, and the
      server's `GET /calls` saying this person may call it. The call is a sheet over
      everything, in the Dood's color: its creature talking and listening, the clock, what is
      being said, each thing handed on with the step the Dood is on, and Mute, End and Chat.
      Swiped down or left with Chat, the call goes on, and a bar over every chat says so and
      leads back. When it ends, the chat says it is being written up until its record arrives,
      and the record is the one the phone already showed. The screen is kept on while a call
      is (`expo-keep-awake`, which every build already has through `expo`).
    - **One call, two devices.** What a call does (the voice's events, what was said, handing
      on, following the call's chat for the answer, the limits, ending) moved out of the web
      app into `@do-computer/client` as `createCaller`, with the event readers and what-was-said
      beside it and their tests. The web app hands it the browser's WebRTC, its own chat
      streams and its desktop origin, and keeps its atoms and screens as they were; the phone
      hands it a line of its own, its client's chat streams and `messageOrigin`.
    - **How the sound is carried on a phone.** React Native has no WebRTC, and the system's
      web view does. The phone runs one small page (`line-page.ts`) in a `react-native-webview`
      no one sees (`line-host.tsx`), which takes the microphone, makes the offer, opens the
      `oai-events` channel and plays the voice; the app places the call with the offer through
      its own signed-in client, so the page never sees the server or the session. The page's
      address is the deployment's, which is what makes it a secure one that may have a
      microphone. The browser build runs the same page in a frame (`line-host.web.tsx`). This
      was chosen over `react-native-webrtc` because the web view is already in every build:
      no new native module, no config plugin, no new build. The microphone's words in
      `app.config.ts` now name calls as well, which shows from the next build; until then the
      old words are asked with.
    - **Mine:** the web view over a native WebRTC module; the sheet and its three buttons
      (Chat where the web has "Hide words"); a bar over chats in place of the web's corner
      card and live card in the transcript; that a call's problem is said on its sheet and in
      that bar; keeping the screen on; moving the call into `@do-computer/client`.
    - **Checked:** `pnpm check`; the client's tests, eight of them new (`test/call.test.ts`: a
      call with a stand-in server and voice through connecting, listening, words kept once,
      handing on, a step, the answer given to the voice, mute, a refused microphone, a lost
      line, one call at a time, a script, a device that goes away); the phone app's tests, five
      new (`test/call-line.test.ts`: the app's side of the page); `calls.spec.ts` against the
      moved code; and three new tests in `mobile.spec.ts` through the phone app's browser build
      against the built Node server: a scripted call from the chat's bar through calling,
      handed on, answered, muted, back to the chat and back, ended, and its record; no button
      where the server offers no call; and the page that carries the sound run in Chromium in
      a frame, with a second connection in the test as the voice, making an offer with sound
      and the channel, passing events both ways, and being muted and closed.
    - **Not checked:** anything on an iPhone or in iOS's web view: there was no Mac. Whether
      WKWebView gives the hidden page the microphone without asking again
      (`mediaCapturePermissionGrantType`), plays the voice out loud and not at the earpiece,
      measures loudness, and gets along with dictation's audio settings were never run. A real
      voice on a phone; Android; WebKit at all (the test machine's WebKit would not start).
    - **Not built:** a call that goes on with the phone locked or the app in the background
      (a web view is stopped there, and nothing asks iOS for background audio); a speaker
      button; the call in the Dynamic Island or on the lock screen (CallKit); hiding the words;
      a way back to a call from outside a chat (the Doods list, settings); a link from the
      record to the call's side chat. If WKWebView's page turns out not to do, the fallback is
      `react-native-webrtc` with its config plugin behind the same `OpenVoiceLine`, which needs
      a new build.

100. **A request to the model is kept small enough to send, and one that keeps being cut off
     ends its chat's run** (2026-10-17; `packages/agent/src/limits.ts`, `project.ts`,
     `packages/protocol/src/chat-error.ts`, `apps/web/e2e/request-limits.spec.ts`). A request
     is built in the agent's actor, which on Cloudflare is one Durable Object, in an isolate of
     128 MB, for every chat and sub-agent of the agent. A conversation on the same harness that
     had read 42 screenshots (some 31 MB as base64) was seen to take its isolate down each time
     it built a request; the keep-alive wake-up took the run up from its checkpoint, which built
     the same request again, for hours, and nothing noticed. Here that would take down every
     chat of the agent with it.
     - **The oldest pictures are left out, in steps.** A `beforeRequest` hook, installed after
       every other extension so that what they add is counted, replaces the oldest pictures of
       a request with a line saying one was there, once the pictures pass 8 MB of base64 or 80
       of them, until they are under 3 MB and 40. What is left out depends only on the order
       the pictures came in and only grows, so a request starts as the one before it did until
       the next time the mark is crossed, and the prompt cache is spent only then. The newest
       picture is never left out. The chat and its stored entries keep them all. Why those
       numbers is in `IMAGE_LIMITS`: lower than for an actor that holds one conversation, since
       several chats can be building a request at once.
     - **A request started three times with no answer is not started a fourth.** Each start is
       counted in the agent's own database (`dc_request_starts`), a row per generation task;
       the row is cleared by any answer, a provider's error included, and dropped once its task
       is no longer live. Past three, the hook writes an entry of kind `dc.cut-off` into that
       chat, stops that chat's conversation, and throws: pi-durable only reports a hook that
       throws and makes the request anyway, unless the run was stopped by then. The stop is
       started and not waited for, since it waits for the request, which is waiting in the
       hook; the hook waits for its own signal instead, ten seconds at most. Other chats go on.
     - **The chat says why.** The entry is shown as a failed reply (`CUT_OFF_TEXT`, which
       `describeChatError` knows as `cutOff`): "This run was ended: its request to the model
       was cut off several times before it could be sent", that this happens when what the
       chat holds is too large for the server, and Try again. The web and phone apps draw it
       with the error row they already have. Whatever reads a chat's last reply, such as a
       sub-agent's report, reads it as a failed one.
     - **Checked:** `pnpm check`; `pnpm test`, with `packages/agent/test/limits.test.ts`: the
       rule (steps, only growing, the newest kept, counts as well as sizes, 42 screenshots),
       the messages it gives back, a count kept per task and pruned, and against the actor with
       the faux provider: no try at all ends the run with the entry and never asks the model,
       one try answers a tool call and three more messages, and small limits leave the oldest
       pictures of a chat out of what the model is sent. `request-limits.spec.ts` runs the
       built Node server with `DC_REQUEST_TRIES=0`, a setting for tests only, and checks the
       row in the web app. The phone app's row was looked at in its browser build.
     - **Not done:** `dropOldPictures` in `uses.ts` still keeps only the last four pictures of
       the screen and browser tools. It runs before the new hook and moves its window with
       every screenshot, which changes the start of the request and spends the prompt cache
       each time. Doing that in steps too (keep up to eight, then come down to four) would keep
       the cache; it changes what the model sees, so it was left for a change of its own. The
       whole conversation is still read into memory before the hook runs, pictures and all:
       the hook keeps the request's copies small, not that one. Nothing watches for a run that
       makes no progress for other reasons.

101. **A quiet main chat is compacted while its prompt is still in the provider's cache, and
     pi-durable's own compactions are summarized from the cache too** (2026-10-18;
     `packages/agent/src/idle-compaction.ts`, `PLAN-main-bus.md` section 6, phase 1 of that
     plan). pi-durable compacts a chat only when a request would come near the model's window,
     which is when the chat is wanted, and its summarizer sends the conversation as a new prompt
     with no cache. A long main chat that goes quiet for over an hour then pays to write its
     whole prompt into the cache again on the next message.
     - **When.** An answer a main chat's run rests on (`stop`, not a round of tool calls) whose
       request filled 70% of the window, on a model with a long cache, records a time ten
       minutes on in the agent's own database (`dc_idle_compaction`, a row per chat that each
       answer moves later or clears), and the actor's one wake-up covers the soonest; other
       answers wake nothing. Then, cheapest first: the chat must be at rest (no task in it,
       nothing waiting) and nobody typing in it; only then is its context read, and its last
       request must have filled 70%, on the same model, less than the cache's lifetime less
       ten minutes ago. Someone typing (a team's presence, `typingIn` in `feed.ts`; a personal
       workspace says nothing) puts it off by two minutes, for ten minutes at most, since
       presence counts a draft left in the box as typing.
     - **Long caches** (`cacheLifetimeMs`) are by provider, not by interface: Anthropic (by
       provider or address) and Claude through OpenRouter an hour; OpenAI's GPT-5 and GPT-4.1,
       the families OpenAI keeps its extended cache for, a day, directly or through OpenRouter,
       except a model with an explicit cache mode, which pi-ai asks for 30 minutes; anything
       else only where the model's own `promptCache` says an hour or more. OpenAI's other models
       keep it in memory, an hour at most. Azure gets nothing: pi-ai never asks it for a long
       cache. pi-ai asks MiniMax, Vercel's gateway, xAI and the like for one, and nothing says
       they keep it.
     - **The summary is asked for as the chat's own request.** The idle compaction calls
       `conversation.compact()` with its own instructions, and a `beforeCompact` hook answers:
       it sends the chat's messages shaped as every request is (`shapeRequest` in `limits.ts`,
       now the one `beforeRequest` change, which the summary repeats), the same provider
       session, cache retention and thinking level, the model's whole output allowance, and one
       more message asking for a summary of everything before the part pi-durable keeps (how
       many messages that is, and how the first begins). A test checks that what it repeats is
       exactly what the chat's last request was sent. The answer is a memo of the task, so one
       taken up again after a restart does not ask twice, and the record is kept once a task.
     - **Where asking fails** (the provider's error, a cut-off answer, a tool call, no text, or
       text not in the form asked for, such as an answer to the conversation), an idle
       compaction is declined and the failure reported: the chat stays as it is until its next
       turn, and pi-durable's summarizer, which would send the whole chat uncached at a moment
       the provider is struggling, is not asked. A summary must begin with its goal and have its
       critical context (`isSummary`). After a failure in a chat, no cached summary is asked for
       there for an hour (`failedLately`, from the records).
     - **pi-durable's own threshold compactions**, of any chat, are answered by the same hook
       where the model keeps a long cache, the chat's last request was recent enough for it to
       hold, and the window has room past the whole chat for a summary (16,384 tokens, after
       pi-ai's own 4,096): in practice pi-durable's background compactions, which start about
       151,000 tokens into a 200,000 window, and not its blocking ones, which come within
       16,384 of the end. Those are read from the cache too. A model without a long cache is
       known from the agent before anything else is read, and anything that goes wrong (a cold
       cache, no room, a failed or ill-formed summary, a lately failed one, a throw) leaves the
       compaction to pi-durable's summarizer, since the chat needs the room: such chats compact
       exactly as before. This was chosen over moving pi-durable's background threshold: its
       settings are the harness's, not a model's.
     - **What it keeps** is written for a long main chat: what was asked for and not done,
       promises, sub-agents at work and what each is for, automations and when they run,
       decisions and preferences, marked where lasting. Every other chat (sub-agents,
       automations, Slack threads, side chats) is asked in pi-durable's own form, copied from its
       `compaction.js`, which does not export it. Saving those to memory is not done by
       this request, which can call no tool; the journal's review, which runs before every
       compaction, already may add one lasting fact to each store of notes.
     - **Recorded** in the session document `dc.idle-compactions`, the last 50, and given on
       `GET /usage` as `compactions` (`IdleCompactionRecord`): why, tokens before, an estimate
       of after, the summary request's input, cache read and write, its cache-read share, cost,
       why it failed, and the chat's next request after it (how long after, and what it read
       and wrote), so that the ten minutes can be tuned as well as the 70%. The cost is added
       to the chat's `pi.usage`. Nothing in the apps shows the records.
     - **Checked:** `pnpm check`; `packages/agent/test/idle-compaction.test.ts`: the rules and
       the cache lifetimes, with Azure, MiniMax, Vercel, xAI, OpenAI's older models and an
       explicit-cache OpenAI model left out, the two forms, the shape of a summary and the
       back-off, and through the actor with the faux provider: compacting when all holds, the
       request repeating the last one exactly (with a picture tool's results left out under
       small picture limits) and 99% of it read from the cache, and the next message noted;
       declining on a provider's error (and not asking again for an hour), on a tool call and
       on an answer that is not a summary, without asking uncached; a background threshold
       compaction summarized from the cache, a blocking one and an ill-formed one left to
       pi-durable; none under 70%, on a
       five-minute cache, or with the cache about to run out; waiting out a run; waiting while
       someone types, for ten minutes at most; and after a restart, compacting from the stored
       time, once. `feed.test.ts` checks `typingIn`.
     - **Not checked:** a real provider (whether Claude through OpenRouter reads the request
       from the cache, which is what this is for), a deployed Worker, a restart between the
       record and the memo (reasoned, not tested), and the thinking budget near the top of the
       window: pi-ai fits a thinking budget to the room left, so on Claude models without
       adaptive thinking a summary request there can get a different budget from the last turn
       and not be read from the cache, as ordinary turns there can too. The faux provider counts
       what it newly caches twice in a request's input, which the tests work around.

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
them and not confirmed: the odds, that a box
never repeats a thing, that the next box is six hours from the opening of the last, that every creature starts with a box, that ears flop or lie flat under a
hat, and that a team shares one creature with one outfit.

Cost: they found Claude Haiku too expensive for the summaries a small model used to write of
each run, and on 2026-10-07 asked for those to go: the agent writes the list itself, and only
for big things. Web search still uses Haiku; they were told and have not asked to change it.

## 7. Open questions and unfinished work

### Waiting on the owner

- **The console-mascot UI.** `prototypes/console-ui` is a click-through exploration of the whole
  UI in that style, with a ranked list of ideas in its README. The owner has looked at it and has
  not said which to build. Ask before building any of it.
- **`www.do.computer`** times out. It needs a redirect rule to the apex in the Cloudflare
  dashboard.

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
  and no invite link that anyone can ask to join by. A side chat's spinner in
  the strip's menu knows about sub-agents everywhere but about the agent itself only in a chat
  on screen. Who is where does not work under `pnpm dev` on Node, which has no WebSocket server;
  it does on the built server and on Workers. Invitation email has never been sent for real.

- **Main and side chats:** a side chat cannot
  be renamed or brought back from the app once archived (the API can do both). Someone typing
  in a side chat that is beside the main chat is not shown as typing, and is counted as being
  in the main chat.

- **Agents writing to each other:** nothing limits an exchange, by the owner's choice; one is
  ended by stopping the conversation from its chat. Sub-agents and scheduled runs cannot send.

- **Calls:** a person's own sign-in does not exist as a level: the owner wants every key and
  subscription to be the nearest of "user, then workspaces, then server", and today a sign-in
  is a workspace's or the server's. A limit on a call's length is kept by the browser; the
  server stops counting at it and does not cut the sound off. See item 91 for the rest.
  Nothing on the sender's side shows that it is waiting to hear back.
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
  before 2026-10-08 lacks; the agent is told so when it tries. Threads are listed in the agent's panel, which a narrow screen
  does not have: there a thread is reached from a notification or its address. The native app
  lists them on the agent's page.
- **Machines:** agents on one machine are not walled off from each other, by the owner's
  choice of sharing; a Unix user per agent would be the wall and was not built. The built-in
  shell cannot be shared. A machine cannot be renamed. Nothing shows what a machine costs or
  when it last ran. When an agent is moved to another workspace, the cards in its old chats
  point at files in the library it left, and open only if they are also in the new one. The
  move of an agent's own library into its workspace's runs once, when the agent is next
  opened, and cannot be undone.
- **What the agent can do in the app:** the form for secrets, the Sign in card and the notes
  about them are in the web app and the native app (item 65). A secret the agent asked for is in a file on a computer it
  works on, so it is kept out of the conversation and not out of the agent's reach. In a thread
  from Slack the agent can do none of this, since the cards that go with it are in the app. Left for
  later from the audit: putting back a deleted library file or an older version, opening a
  machine to chosen agents, renaming a chat, and a list of who is in the team.
- **Mobile** was rebuilt on 2026-10-12 to do what the web app does on a phone (item 65, which
  says what of it was seen running and what was not). Not built there: answering an ask from
  the lock screen, a Live Activity, and sending to an agent from another app's share sheet,
  which were in the mock-up as extras; and anything for Android beyond what the shared code
  gives it.
- **Never run for real:** two agents sharing a machine on Modal or Cloudflare Containers,
  the mobile app on a physical phone (it has run in an iOS simulator), Modal, Cloudflare
  Containers, sign-in with
  Google, and a connector that needs a sign-in against a real service. Sign-in with GitHub is
  configured on the live site; nobody has reported how it went.
- **Not built:** a reason and retry for provider errors.
- **The creature** was only ever seen through software rendering and screenshots by whoever
  built it. Its author's own list of rough edges: at 24 px the command and file variants are
  hard to tell apart; flat-shaded bodies can show a large white highlight; the error state greys
  the eye whites; the alternative "glass" look is less finished and unused by the app.
- **The library:** on the web, PDFs and other
  formats have no viewer; there are no empty folders, since a folder is only the paths of the
  files in it; a file's history shows who and when but not what changed; and a document changes
  on screen when the agent's tool call ends, not as it types, which the mock-up pretended.
- **Sites and visuals have rough edges:** a site is not told to the other people looking at a
  workspace when it changes, so their lists catch up when they next ask; a site whose files
  were moved or deleted stays listed and shows nothing; a visual keeps the agent's color it
  was first shown in until it is loaded again; there is no check of how a visual looks before
  it is shown, which T3 Code has (`html_preview`, a headless browser on the host); nothing was
  run on a deployed Worker, in Safari, or with a real model writing the page.
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

- **`date +%s%3N` is not to be trusted where `date` is not GNU's.** The machine this was built on has
  uutils coreutils, whose `date` now and then prints seconds and milliseconds that do not belong
  together, so a time taken with it went backwards about once in a hundred. CI and Daytona
  have GNU's and never showed it. The job runner measures with bash's `EPOCHREALTIME` instead.

- **A blob key is a path on Node and only a name on R2.** A key that is another key plus
  `/more` needs the first to be a directory, which a file cannot be. A file's later revisions
  are therefore stored beside its first one (`library/<id>.r3`), not under it.
- **A page in a sandboxed frame may not even read `document.cookie`:** it throws. A script
  that does so stops there, which looks like the script not loading.
- **A Durable Object's SQLite row has a size limit** (about 2 MB) that Node's does not. A message
  is one row. That is why pictures are scaled down in the browser to fit a message, and why
  anything large belongs in blob storage, not in a document.
- **Closing the harness closes the database it was opened over**, which on Node cannot be
  opened again. A change that seems to need a reopen (such as switching an agent's computer)
  swaps extensions in the registry while it stays open. Installing an extension under a name
  that is taken replaces it where it stands, which keeps hook order. Since pi-durable 1.2.0
  a harness also closes itself, for good, on the first storage error. So the agent hands it a
  database whose `close` does nothing and closes the real one itself: after such an error it
  lets go of the harness, sets a wake-up a second on, and opens another over the same
  database (`actor.test.ts`, "opens again after its store failed under it").
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
- **A pending timer keeps a Durable Object in memory**, and so does an open stream or a
  request still being answered. `unref` exists on a timer there and does nothing. An object
  that should be put away while people have it open must hold none of these when idle; the
  test in item 43 is how to find out, and wrapping `setTimeout` in a test is how to find which.
- **A fresh deployment belongs to whoever signs up first.** The first account needs no
  invitation, so on a public address, sign up at once.

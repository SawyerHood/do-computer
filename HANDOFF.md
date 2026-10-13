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
node scripts/icons.mjs          # draws the app's icons again: its creature on the first run's island
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
      shown as "Continues from the main chat". Past 60,000 tokens of main chat, estimated, or
      with nothing answered there yet, a side chat starts empty as it did before.
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
      Esc. The screen with a real model. The owner's own Chrome through Chrome 144's switch,
      where Chrome may ask twice, once for dev-browser and once for the picture. The browser on
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
      Someone who has an agent is sent on, except in a desktop app that has not been
      through its first run: there their own agent comes out of the egg and asks about the
      computer.
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
      the page's description. It is on this page only: the app itself still says "agent".
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

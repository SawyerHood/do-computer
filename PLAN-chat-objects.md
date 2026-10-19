# A Durable Object for each conversation: plan

> **Partly superseded (2026-10-19).** Written before the main chat became a message bus
> (`PLAN-main-bus.md`). Since then side chats are gone and sub-agents start fresh, so what this
> plan says about a shared "talk object" holding side chats and sub-agents, side chats as forks
> (3.2, phase 9), sub-agents staying with their parent (3.1, 4.7, question 7) and moving the
> chats with people (phase 7) no longer applies: every sub-agent, automation, Slack thread and
> conversation with another agent gets an object of its own, and the main chat stays in
> `AgentObject`. Existing conversations are not moved either: new work starts in the new
> objects and work in flight finishes where it is, so section 5 (moving) and phases 3, 6 and 8
> are not planned. What still holds and is relied on: the inventory (section 2), the mirror
> (4.5), how the agent's tools are reached from another object (4.6), Node (4.9), costs and
> risks (7), and phase 0. The work as it is now planned is `PLAN-main-bus.md` section 8.5.

**Status:** a plan, written 2026-10-17. Nothing in it is built, and nothing in it is urgent:
section 8 says what would make it worth starting, and phase 0 (section 6) is the one part worth
doing before then, because it is how those triggers would be seen. Section 9 lists the choices
the owner has not made, and section 10 what was not checked.

Today an agent (a Dood) is one Durable Object, `AgentObject`, and everything it does happens in
one pi-durable harness inside it: every chat, side chat, sub-agent, scheduled run, Slack thread
and conversation with another agent, and also its memory, settings, schedules, connectors,
approvals and the rest. This plan says what moving its conversations into objects of their own
would take, in what order, and how to do it without losing a conversation or breaking a client.

The short answer:

- **Keep `AgentObject` as the agent's home** and add a `ChatObject` class whose objects hold
  conversations. The agent's object keeps everything that is the agent's (identity, memory,
  settings, schedules, skills, connectors, approvals, the list of chats, routing for Slack and
  other agents) and stops running models.
- **The unit is a tree of conversations, not one conversation.** Side chats are pi-durable forks
  of the main chat, and a fork only exists inside one store (`#branchChat` in
  `packages/agent/src/actor.ts:2814`). So the agent's chats with people, their side chats and
  their sub-agents live together in one object, which this plan calls the agent's _talk
  object_. Each schedule, each Slack thread and each conversation with another agent gets an
  object of its own: they start empty, never fork, and are the work nobody is watching.
- **Side chats get objects of their own only if pi-durable learns to fork into another store**
  while keeping the provider's prompt cache (section 3.2). That is the last, optional phase.
- **Existing conversations are copied, never moved in place**: exported from the agent's store
  through pi-durable's own storage interface, with their ids, and imported into the new object,
  checked, then switched over. The agent's copy is kept until the new home has run for weeks,
  and the same tool copies a conversation back.
- **Clients keep working throughout.** Every route stays where it is. The agent's socket goes on
  carrying chats for clients that have not been updated; updated clients follow a chat on a
  socket of its own.

## 1. Why, and what was measured

What one object for everything costs, in principle:

- **Memory.** A Durable Object's isolate has 128 MB. A request to the model is built in the
  agent's object for every chat and sub-agent of the agent. A conversation on the same harness
  that had read 42 screenshots took its isolate down each time it built a request, and the
  keep-alive wake-up took the run up again, for hours (HANDOFF.md, item 100). Here that would
  take every chat of the agent down with it.
- **CPU.** An object runs one thing at a time. Chats interleave while they wait on a model, but
  anything that holds the thread (building a request, reading a long transcript, projecting a
  chat, parsing JSON) holds every other chat and every request to the agent, the page that lists
  its chats included.
- **Storage.** All conversations share one SQLite database, which can hold 10 GB.

What has already been done: PRs #166 (a request is kept small enough to send, and a run whose
request keeps being cut off is ended) and #167 (pictures are made small where they come in)
remove the crash loop that was seen. Neither isolates one chat from another.

What was measured on do.computer, from Cloudflare's analytics over the last three to seven days:

| What                                  | Seen                                                                  |
| ------------------------------------- | --------------------------------------------------------------------- |
| Agents                                | 5, all one owner's                                                    |
| Chats that got messages from the app  | Exactly one per agent; never two chats of one agent within 30 minutes |
| Storage of all agent objects together | 74 MB                                                                 |
| The busiest agent                     | Active 148 of 168 hours; 2,527 s of CPU in the week                   |
| Memory reported                       | Peaks of 149 MB and 130 MB on two agents, with no resets              |

The busiest agent's activity is probably schedules, Slack and sub-agents, which do not show as
messages from the app. Nothing here is close to a limit that hurts today. Section 8 says what
would change that.

## 2. What the agent's object holds and does today

Everything below is in `packages/agent/src` unless another path is given. The object is built in
`apps/web/src/server.cloudflare.ts:56` and declared in `apps/web/wrangler.jsonc` (bindings at
lines 8 to 17, migrations at 26 to 34); the Node server builds the same actor in
`apps/web/src/server/platform.node.ts:103`, one SQLite file per agent.

Classified as:

- **Agent:** there is one of it for the agent, whatever the conversation.
- **Chat:** it belongs to one conversation, and only that conversation hears of it.
- **Shared:** it is used by several conversations at once, or by several agents, and has to have
  one owner wherever the conversations are.

### 2.1 What pi-durable stores

One store per agent: `SqliteStorage` over the object's database, opened in `#open`
(`actor.ts:1269`). Its tables (`pi-durable/dist/storage/sqlite/migrations.js`):

| Table                             | Holds                                                                            | Class           |
| --------------------------------- | -------------------------------------------------------------------------------- | --------------- |
| `conversations`                   | One row a conversation: its fork parent (`parent`) and its owning task (`owner`) | Chat            |
| `entries`                         | The transcript: one row an entry, with the commit it came in                     | Chat            |
| `tasks`                           | Generations, tool calls, compactions: the task graph                             | Chat, see below |
| `submissions`                     | Inputs and writes, with their request ids, which is what makes resending safe    | Chat            |
| `documents`, `document_revisions` | Every document, of any scope                                                     | By scope        |
| `record_ids`, `durable_metadata`  | **One id counter for everything in the store**, and the commit sequence          | Store           |

The task graph (`harness.inspect`, `harness.taskGraph`) is the whole store's, but each task
belongs to one conversation (`tasks.conversation_id`). The app uses no task-owned conversations:
every conversation it makes is `ownership: { kind: "ownerless" }`.

Documents pi-durable keeps for each conversation, all scoped to it: `pi.agent` (model, thinking,
extensions), `pi.usage` (tokens and cost by model and tool), `pi.provider` (the session id
providers cache by), `pi.inbox` (submissions waiting for a boundary), `pi.live` (the generation
and tool calls in flight, compactions) and `pi.codemode.store`. Per task: `pi.tool.nested-call`
and the codemode run's journal. None of pi-durable's own documents is session-wide.

**Ids.** A conversation, entry, task, submission and document all take their id from one counter
per store, and the counter only grows. The app uses a conversation's id as the chat's id
everywhere (`Number(chatId) as ConversationId`, for example `actor.ts:1021`, `subagents.ts`,
`peers.ts`, `schedules.ts`, `journal.ts`, `history.ts`), and entry ids as message ids in clients
and in the `before` of `/history`.

### 2.2 The app's documents

Every document the app defines is session-scoped: the agent's, not a conversation's.

| Document                           | Defined in                   | What it holds                                                                                         | Class                                |
| ---------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `dc.identity`                      | `docs.ts:69`                 | Name, soul, what it knows of its user, memory, model, thinking, timezone, voice, team, computer kinds | Agent                                |
| `dc.creature`                      | `docs.ts:92`                 | Treats, boxes, outfit                                                                                 | Agent                                |
| `dc.chats`                         | `docs.ts:213`                | Every chat's record (`ChatRecord`, `docs.ts:177`) and which is main                                   | Agent index, with chat parts (below) |
| `dc.latest`                        | `docs.ts:232`                | The latest line said to or by the agent                                                               | Agent                                |
| `dc.schedules`                     | `docs.ts:275`                | Schedules, each with its one pending run and its last                                                 | Agent                                |
| `dc.skills`, `dc.skill`            | `skills.ts:51`, `:59`        | Installed skills and their files                                                                      | Agent                                |
| `dc.connectors`                    | `connectors.ts:197`          | Connectors and their tools                                                                            | Agent                                |
| `dc.approvals`                     | `approvals.ts:65`            | Rules, pending requests (each with its chat), one-use grants                                          | Agent, requests name a chat          |
| `dc.secrets`                       | `secrets.ts:65`              | Requests for something to be typed in, each with its chat                                             | Agent, requests name a chat          |
| `dc.calls`                         | `calls.ts:89`                | Calls in progress and their side chat                                                                 | Agent                                |
| `dc.pins`                          | `pins.ts:27`                 | What is pinned under the agent's face                                                                 | Agent                                |
| `dc.computers`                     | `computers.ts:198`           | The machines the agent can use, as its host said                                                      | Agent                                |
| `dc.library`, `dc.library.private` | `library-store.ts:63`, `:80` | The library the agent kept for itself before workspaces kept one                                      | Agent (legacy)                       |
| `dc.journal`                       | `journal.ts:53`              | A note per chat on where it stands, and the list of finished work                                     | Agent, written per chat              |
| `dc.jobs`                          | `jobs.ts:93`                 | Commands left running in the background, each with its chat                                           | Chat, listed per agent               |
| `dc.activity` (a family)           | `keep-going.ts:37`           | What the small models cost, per chat                                                                  | Chat, summed per agent               |

The parts of a `ChatRecord` that are a conversation's own, and would move with it: `subagent`
(task, status, what was reported), the delivery fields of `peer` (status, replied, replies,
woken, failures) and of `slack` (status, replied, seen, told, files, failures), and `fork`. The
parts that are the agent's: title, kind, times, archived, who made it and last wrote, the
request it was made under, and the keys it is found by (`peer.agentId` and `peer.chatId`,
`slack.channel` and `slack.thread`).

### 2.3 The app's own tables in the agent's database

| Table                           | In                                   | Class                                                                       |
| ------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| `dc_history`, `dc_history_read` | `history.ts:99`                      | Agent: the search index over every chat                                     |
| `dc_request_starts`             | `limits.ts:187`                      | Chat: a row per live generation task                                        |
| `dc_connector_secrets`          | `connectors.ts:363`                  | Agent                                                                       |
| just-bash's files, **on Node**  | `apps/web/src/server/sandbox.ts:139` | Agent: the built-in shell keeps its files in the agent's own database there |

Blobs are under `agents/<id>/` in R2 (`server.cloudflare.ts:132`): screenshots the screen and
browser tools kept (`uses.ts`), connector pages, and the legacy own library. Agent.

### 2.4 What it holds in memory

- The harness, the registry and every extension, built once in `#open` (`actor.ts:1160`).
- Connector sessions (MCP clients), opened after the harness (`actor.ts:1323`). Agent.
- **A queue per computer for the screen and the browser** (`#turns`, `uses.ts:283` and `:311`),
  so that two calls never drive one screen at once. Shared: today it only keeps one agent's
  chats apart, and two agents sharing a paired computer are not kept apart by it at all.
- Sandboxes for the machines it works on, made as they are needed (`computers.ts`). Each object
  can make its own; they keep nothing that matters in memory.
- How many clients follow each chat (`#watchers`, `#followers`), which is what decides whether
  an answer needs a push notification (`#notifyWhenUnseen`, `actor.ts:3108`). Chat.
- What `onActivity` was last told (`#told`, `#tell`, `actor.ts:3187`). Agent.

### 2.5 What it does

| What                                                                                         | Where                                                                                           | Class                                                                             |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Keep-alive wake-up every 20 s while anything is live; reopen a second after the store failed | `KEEPALIVE_MS` and `REOPEN_MS` (`actor.ts:165`), `#rearm` (`:1391`), `harness.closed` (`:1297`) | Chat for the keep-alive, agent for schedules and calls                            |
| `alarm()`: model check, schedules, calls, then the sub-agent, job, peer and Slack loops      | `actor.ts:1496`                                                                                 | Each loop belongs to the conversation it drives; schedules and calls to the agent |
| Agent state, settings, creature, gifts, team, init, destroy                                  | `#route`, `actor.ts:1633`                                                                       | Agent                                                                             |
| Chats: list, make, main, read, history, events, send, abort, reset, rename                   | `actor.ts:2113`                                                                                 | Index agent, the rest chat                                                        |
| Side chats branch the main chat                                                              | `#branchChat`, `actor.ts:2814`                                                                  | Chat, needs the main chat's store                                                 |
| Search across chats                                                                          | `/search`, `actor.ts:1987`; `history.ts:113`                                                    | Agent, reads every chat                                                           |
| Usage, summed over every conversation's `pi.usage` and the small models' costs               | `#usage`, `actor.ts:2327`                                                                       | Agent, reads every chat                                                           |
| Whether the agent is working or asking                                                       | `#working`, `#asking`, `actor.ts:2437`                                                          | Agent, reads every chat                                                           |
| The latest line, push notifications, `onActivity`                                            | `#record`, `#notify`, `#tell` (`actor.ts:3156` to `3227`)                                       | Agent, fed by chats                                                               |
| Model change applied to every conversation                                                   | `#setModel`, `actor.ts:2297`                                                                    | Agent, writes every chat                                                          |
| Approvals: rules checked before every tool call; an answer gives the chat a turn             | `approvals.ts:477`, `:534`, `:778`                                                              | Rules agent, the turn chat                                                        |
| Memory and identity tools; the persona sections of every request                             | `persona.ts`                                                                                    | Agent, read by every request                                                      |
| The `recent` section: where the other chats stand                                            | `journal.ts:348`                                                                                | Agent, read by every request                                                      |
| Sub-agents: start, message, stop, report into the parent chat                                | `subagents.ts:156`, `:298`, `:403`                                                              | Chat (the parent's)                                                               |
| Another agent's message and our reply                                                        | `peers.ts:228`; `actor.ts:1719`                                                                 | Routing agent, the thread chat                                                    |
| A Slack message, and posting the answer                                                      | `slack.ts:453`, `:693`; `actor.ts:1745`                                                         | Routing agent, the thread chat                                                    |
| A schedule fires, its run, its report into the chat it was made in                           | `schedules.ts:504`, `:653`, `:723`                                                              | Schedule agent, the run chat                                                      |
| Background commands and word of their end                                                    | `jobs.ts:388`, `:524`                                                                           | Chat                                                                              |
| Calls: start, hand work to a side chat, record into the chat                                 | `actor.ts:2066`, `:2939`, `:2592`                                                               | Agent, writes into a chat                                                         |
| One socket per follower carrying the agent's documents and up to 16 chats                    | `followers.ts`, `packages/protocol/src/socket.ts:16` to `45`                                    | Both                                                                              |
| Server-sent events for the agent and for one chat                                            | `#agentEvents`, `#chatEvents`, `actor.ts:3229`                                                  | Both                                                                              |

## 3. What the code says about the shape

The shape suggested before this plan was written: the agent's object as its home; an object per
chat holding that chat's harness and history; sub-agents inside their parent chat's object,
because pi-durable's ownership, abort cascades and task graph assume one store. Most of that
holds. Five things in the code change it.

### 3.1 Sub-agents are not owned by pi-durable

`Subagents.start` (`subagents.ts:156`) makes an **ownerless** conversation and records the
parent in the agent's `dc.chats` (`subagent.parentId`). The app drives it from its own loop
(`#settle`, `subagents.ts:298`), reports into the parent with a keyed `write` and a keyed
`input` (`#deliver`, `:403`), and stops it with `conversation.abort` on its own. Stopping the
parent chat does not stop its sub-agents (`actor.ts`, the `abort` route under `/chats`). So
pi-durable's ownership, abort cascade and task graph do not tie a sub-agent to its parent's
store; the app could put a sub-agent anywhere, as it already does with another agent's thread.

**They still belong with their parent**, for other reasons:

- `PLAN-forked-chats.md` step 2 has a sub-agent start as a fork of its parent at the answer
  that made the call. A fork needs the parent's store (3.2).
- Starting, messaging, stopping and reporting all touch the parent and the sub-agent together,
  and the cap of six working sub-agents (`MAX_WORKING_SUBAGENTS`, `subagents.ts:18`) is checked
  in the commit that makes one. In one store all of it stays local and atomic.
- Only a chat with people can start sub-agents (`subagents.ts`, the tool's check), so they are
  only ever in the talk object.

What that gives up: a sub-agent that blows the memory takes its parent and the other chats of
the talk object with it. Section 9 asks whether that is acceptable.

### 3.2 Side chats are forks of the main chat

A side chat is `main.fork(at, …)` (`actor.ts:2846`), and a pi-durable fork does not copy the
parent's entries: it reads them through `conversations.parent`. That only works inside one
store. And it is what makes a side chat cheap: `PLAN-forked-chats.md` section 3 found that a
fork's first request repeats its parent's prompt byte for byte, because a section that differs
in the fork is added at the end as a patch. The owner decided that a warm fork is carried whole
at any size because of it.

A side chat in another object would have to be made by copying the main chat's context into a
fresh conversation there. pi-durable can be given the same messages (one `write` entry can
carry many model messages), but the fresh conversation's system prompt is built anew, and the
`recent` section, which names the chats other than the one asking (`journal.ts:348`), differs
from the main chat's at the top of the prompt. That would most likely make every side chat's
first request a cache miss. Not tried: section 10.

So **side chats stay in the talk object** unless pi-durable can fork into another store and keep
the fork's prompt (section 9, question 1). The same goes for a call's side chat
(`#callWork`, `actor.ts:2939`), which branches the same way.

### 3.3 Every request and every tool call reads the agent's documents

The persona sections (`persona.ts`), the `recent` section (`journal.ts:348`), the skills
section, the computers and connectors extensions and the approvals hook (`approvals.ts:534`)
read session documents through `input.read` or `harness.snapshot`, synchronously in the middle
of building a request or before a tool call. A conversation in another object cannot read them
in place. It needs a copy that it keeps and the agent's object refreshes (4.5), not a call to
the agent's object for each read.

### 3.4 A chat's id is a conversation's id, and ids come from one counter per store

New objects would each start their own counter at 2, so a conversation made in one would get
the same id as an existing chat in another. Two answers were weighed:

- Keep a map from chat id to the object's own conversation id. Every place that does
  `Number(chatId) as ConversationId` would go through it, and copying a chat back to the agent's
  store would need every id renumbered.
- **Give each object a range of ids of its own**, far above anything the agent's store will
  reach, so that every id stays unique across the agent and a chat's id is still its
  conversation's id. This plan takes it (4.1).

### 3.5 What else the code asks for

- On Node, the built-in shell (`just-bash`) keeps its files in the agent's own database
  (`apps/web/src/server/sandbox.ts:139`). A conversation in another object must reach those
  files through the agent's object, or the shell must move to a store of its own first, as it
  already has on Cloudflare (`sandbox.cloudflare.ts:60`, `ShellObject`).
- The screen and browser queue (`uses.ts:283`) is in the agent's memory. With conversations in
  several objects it has to be the computer's: in its `ComputerObject`
  (`packages/computers/src/link-actor.ts`) or the daemon. That also fixes two agents sharing a
  screen, which nothing keeps apart today.
- Background conversations (schedule runs, Slack threads, another agent's threads) start empty
  and never fork (`schedules.ts:504`, `slack.ts:453`, `peers.ts:228`). They are the easiest to
  move and probably most of the busiest agent's work.
- `PLAN-forked-chats.md` 5.4, not built, would have another agent's message fork the receiver's
  main chat. If that is built, those threads join the talk object too (section 9, question 2).

## 4. Where things go

### 4.1 Classes, names and ids

| Class             | One for                                  | Name (`idFromName`)    | Holds                                                                         |
| ----------------- | ---------------------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| `AgentObject`     | Each agent, as now                       | The agent's id, as now | Everything the agent has one of (4.2); no conversations once the move is done |
| `ChatObject`, new | The agent's talk                         | `<agentId>/1`          | Its chats with people, their side chats, sub-agents and call side chats       |
|                   | Each schedule                            | `<agentId>/<n>`        | That schedule's runs, one at a time, as now                                   |
|                   | Each Slack thread                        | `<agentId>/<n>`        | That thread's conversation                                                    |
|                   | Each conversation with another agent     | `<agentId>/<n>`        | That thread's conversation                                                    |
|                   | Each side chat, only after 3.2 is solved | `<agentId>/<n>`        | That side chat and its sub-agents                                             |

- **`n` is minted by the agent's object**, from a counter in a new agent document, and the
  agent's index says what each number holds. A number never names anything else, so a name
  never has to be checked against what it was for.
- **Ids.** Object `n` takes its ids from `[2^45 + n·2^32, 2^45 + (n+1)·2^32)`: each object has
  four billion ids, the agent's own store would have to mint 35 trillion to reach the first
  range, and the last id stays under 2^53, which JavaScript and JSON hold exactly, for up to two
  million objects an agent. A chat made in any object keeps its conversation's id as its chat
  id. The floor is set before the object makes anything, by committing one record at the bottom
  of its range through pi-durable's storage (`SqliteStorage.commit` moves its counter past any id
  it is given). Asking pi-durable for a way to set the floor is cleaner (section 9).
- **Blobs** under `chats/<name>/` in R2, a folder of their own on Node.
- **wrangler.jsonc:** one binding, `CHAT`, and one migration, tag `v8`, with `ChatObject` in
  `new_sqlite_classes`. A class is never taken away again: that migration deletes its data.
- `ChatObject` is `createDurableActorClass` (`packages/runtime/src/cloudflare/index.ts:77`) over
  a new `createChatActor`, so the runtime layer needs nothing new except what 4.9 says.

A `ChatObject` opens its own harness with the same extensions as today, minus the ones that are
the agent's alone, and the same settings (`cacheRetention: "long"`, the retentions at 0 on
Cloudflare, `server.cloudflare.ts:86`).

### 4.2 What lives where

The rule: **a record of something the agent has one of stays with the agent; the work of a
conversation, and whatever only that conversation hears back about, goes with it; and what the
agent's pages show of that work is reported back to the agent's object as a summary.**

| Stays in `AgentObject`                                                                                     | Goes to the `ChatObject`                                                                         | Elsewhere                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `dc.identity`, `dc.creature`, `dc.latest`, `dc.pins`                                                       | The conversations: entries, tasks, submissions, pi-durable's conversation and task documents     | The screen and browser queue: `ComputerObject`                                             |
| `dc.chats` as the index: title, kind, times, archived, who, request id, routing keys, **and which object** | A chat's own part of its record: sub-agent, peer and Slack delivery state, `fork`                | The library: `LibraryObject`, as now                                                       |
| `dc.schedules` and the alarm that fires them, and a schedule's check                                       | The schedule's runs, and its report until it is handed to the agent                              | Presence: `PresenceObject`, as now                                                         |
| `dc.skills`, `dc.skill`                                                                                    | `dc.jobs` for its own commands; the agent's jobs list is a summary                               | Machines: their own objects or providers, as now                                           |
| `dc.connectors`, `dc_connector_secrets`, MCP sessions                                                      | `dc.activity` for its own chats; `dc_request_starts`                                             | The legacy own library is moved to the workspace's first (`#moveLibrary`, `actor.ts:1132`) |
| `dc.approvals` (rules, requests, grants), `dc.secrets`                                                     | Keep-going, request limits, the journal's reading of its chats (it writes the note to the agent) |                                                                                            |
| `dc.calls`                                                                                                 | Followers and event streams of its chats                                                         |                                                                                            |
| `dc.computers`, and on Node the shell's files until they move (3.5)                                        | Its keep-alive wake-up                                                                           |                                                                                            |
| `dc.journal` (notes and finished work)                                                                     |                                                                                                  |                                                                                            |
| `dc_history` (the search index)                                                                            |                                                                                                  |                                                                                            |
| New: what each object last reported of usage, of being at work and of asking                               |                                                                                                  |                                                                                            |
| The agent's socket and event stream, for its documents                                                     |                                                                                                  |                                                                                            |

### 4.3 How requests go

**Every request still goes to the agent's object first**, which answers what is its own and hands
the rest to the object that holds the chat. The agent's object has something to do for most
chat requests anyway: a message moves its latest line, its chat's time and title, and maybe the
agent's timezone (`#say`, `actor.ts:2981`). Its index is the one place that knows where a chat
is, so nothing else needs a table of homes. The two exceptions are long-lived, because a stream
passing through the agent's object would keep it in memory for as long as it is open (HANDOFF.md
section 9):

| Request                                                                                                        | Path                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Agent state, settings, schedules, skills, connectors, approvals, secrets, pins, creature, usage, search, calls | Agent's object, as now                                                                                           |
| `POST /chats`, `POST /chats/main`, `PATCH /chats/:id`                                                          | Agent's object: it mints the chat and asks the right object to make the conversation                             |
| `GET /chats/:id`, `/history`, `POST /messages`, `/abort`, `/reset`                                             | Agent's object, which forwards to the chat's object and does its own part (latest line, times, title)            |
| `GET /chats/:id/events`                                                                                        | The gateway asks the agent's object where the chat is (an internal route), then connects straight to that object |
| `/api/agents/:id/chats/:chatId/socket`, new                                                                    | Likewise, straight to the chat's object, after `admitToAgent` (`apps/web/src/server/agent-socket.ts`)            |
| `/api/agents/:id/socket`                                                                                       | Agent's object, as now (4.4)                                                                                     |

The internal routes between objects are added to the gateway's `INTERNAL` list
(`apps/web/src/server/agents.ts:102`) so no client can reach them. A chat's object trusts its
caller as the agent's does, and the caller header is passed on unchanged.

Between objects, calls are plain `fetch` through `ActorNamespace`, as agents already reach each
other (`apps/web/src/server/agent-directory.ts`), so the same code runs on Node in-process.
Every call that changes something carries a key, and the receiving side writes it with that key
as a pi-durable `requestId` or checks it in the same commit, so a call sent twice does one thing.
That is already how sub-agent reports, peer messages and Slack messages are written.

### 4.4 Following, presence and the clients

- **The agent's socket stays as it is for the agent's documents.** Clients that have not been
  updated also follow chats over it (`{ type: "follow", chat }`). For them the agent's object
  follows the chat's object over that object's event stream and passes each event on. An open
  stream keeps the agent's object in memory for as long as an old client follows such a chat,
  idle or not, where today's socket lets it hibernate. So the relay is only for old clients, and
  section 9 asks how long to keep it.
- **Updated clients follow a chat on a socket of its own**, to the chat's object, which hibernates
  with it. `packages/client/src/follow.ts` opens one per followed chat (up to the 16 of
  `MAX_FOLLOWED_CHATS`) and falls back to the chat's event stream as it does now. The server
  says in its agent `ready` event whether it offers this, so a new client on an old server keeps
  using the one socket.
- A chat's object reuses `Followers` (`followers.ts`) with no documents of its own.
- **Presence** (who is looking at or typing in which chat) is the workspace's `PresenceObject`
  and does not change.

### 4.5 What the agent knows across its chats

| Need                                                                                                                                                                                     | How                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Memory, identity, model, thinking, timezone, skills, computers, connector tools, approval rules, the `recent` notes and chat titles, read while building a request or before a tool call | **A mirror**: a document in the chat's object holding what the agent's object last sent, with a version. The chat's object asks for it when a run starts if its version is older than the agent's, and the agent's object pushes a new version to objects with live work when one of those documents changes. Sections and hooks read the mirror as they read the real documents now |
| Writing memory or identity (`memory`, `set_identity` in `persona.ts`), schedules, skills, settings, pins, approvals asked for, secrets asked for                                         | A call to the agent's object from the tool. The tool's result waits for it, so the model is told what really happened. The chat's mirror is refreshed in the answer                                                                                                                                                                                                                  |
| A model change for every chat (`#setModel`)                                                                                                                                              | Nothing is sent to every object: a chat's object compares its conversation's model with the mirror when a run starts and configures it then, as `#say` already does for thinking                                                                                                                                                                                                     |
| Usage (`#usage`)                                                                                                                                                                         | Each object reports its conversations' totals to the agent's object when a run comes to rest, as a total and not an increment, so a report sent twice changes nothing. The agent's object sums what it last heard                                                                                                                                                                    |
| Working and asking (`#working`, `onActivity`)                                                                                                                                            | Each object tells the agent's object when it starts work and when it rests, with a lease of two minutes that its keep-alive renews every minute. A lease that runs out counts as rested, so a lost object cannot leave the agent "working" forever                                                                                                                                   |
| Latest line, unread marks (`dc.latest`, `dc_agent_seen` in D1)                                                                                                                           | The chat's object sends the line (`#record`) to the agent's object as it is said. Unread works as now, from the agent's line                                                                                                                                                                                                                                                         |
| Push notifications (`#notifyWhenUnseen`)                                                                                                                                                 | Decided in the chat's object, which knows who follows the chat: its own sockets and streams, and the agent's object relaying to an old client. It sends the notification through the agent's object, which knows the agent's name                                                                                                                                                    |
| Search (`/search`, `history.ts`)                                                                                                                                                         | The index stays in the agent's object. Filling it reads entries from the chat's object, page by page, as it reads them from the harness now (`#fill`, `history.ts:113`)                                                                                                                                                                                                              |
| Reading one chat's history (`readHistory`)                                                                                                                                               | The chat's object                                                                                                                                                                                                                                                                                                                                                                    |
| The `recent` notes (`journal.ts`)                                                                                                                                                        | The chat's object reads its own entries and calls the small model; the note is written into `dc.journal` in the agent's object, keyed by how far it read                                                                                                                                                                                                                             |

### 4.6 Tools whose state is the agent's

- **Approvals.** The hook stays in the chat's object and reads the rules from the mirror, so a
  default agent, which has no rules, makes no call. A call that a rule governs asks the agent's
  object, which records the request as now. An answer is given in the agent's object, which
  sends the chat its turn (`approval:<id>`, already keyed).
- **Secrets, saved logins and cards.** The request is the agent's; the turn after it is the
  chat's. Same shape as approvals.
- **Connectors.** Their sessions and tokens stay in the agent's object. A chat's object installs
  their tools from the mirror, and a call is sent to the agent's object to make. The alternative,
  giving each object the tokens, puts the secrets in more places and opens more sessions to each
  server; section 9 asks.
- **Computers.** Each object makes its own sandboxes, as each agent does now. The list of machines
  comes from the mirror. On Node the built-in shell's files are in the agent's database (3.5):
  the shell moves to a file of its own first, or a chat's object reaches it through the agent's
  object.
- **Screen and browser.** The queue moves to the computer (3.5) before any chat leaves the
  agent's object.
- **Background commands.** A command belongs to the chat that started it, and so does word of its
  end. The agent's list of jobs, and stopping one from it, go through the summary each object
  reports.
- **The library, sites, visuals, pins, page previews.** Already the workspace's or the
  agent's; a chat's object calls the workspace's library as the agent's does now.

### 4.7 Background conversations, sub-agents, calls

- **Schedules.** The schedule, its check and the alarm that fires it stay in the agent's object.
  Firing asks the schedule's object to start a run, keyed `schedule:<id>:<firedAt>` as now
  (`schedules.ts:653`). When the run rests, the schedule's object hands the report to the agent's
  object, which records the outcome, notes it in the journal, notifies, and writes the report
  into the chat the schedule was made in: a call to that chat's object, keyed. One object a
  schedule and not a run, because a schedule has one run at a time anyway, and one bad schedule
  then cannot touch another.
- **Slack.** The message arrives at the agent's object (`/slack/message`), which finds or makes the
  thread's chat by channel and thread, as now, and hands the message on, keyed by Slack's id.
  The thread's object takes in its files, runs, and posts the answer itself through the Slack
  directory, keeping the delivery state that is on the record today.
- **Another agent.** On the receiving agent, its object finds or makes the thread by sender and
  sender's chat, as now, and hands the message on. The thread's object answers through the agent
  directory. On the sending agent, the reply arrives at its object, which finds the sending chat
  and hands the reply on. Each step is keyed already (`peer-message:<id>`, the reply's id).
- **Sub-agents** stay with the chat that started them (3.1).
- **Calls.** The call is the agent's (`dc.calls`). Its work goes to a side chat, so it is in the
  talk object. The record of the call is written into its chat by a keyed call.

### 4.8 Deleting and moving

- **Deleting an agent** (`#destroy`, `actor.ts:1556`, called by
  `apps/web/src/server/agent-delete.ts`): stop every job, then destroy each chat object the index
  names, then the agent's own. It is marked as being deleted first and carried on by its alarm
  if it is cut short, so a failure leaves something to retry, as the gateway's order already
  does. The row in `dc_agents` still goes last.
- **Archiving** a chat changes the index only, as now. There is no deleting one chat.
- **Moving an agent** to another workspace (`apps/web/src/server/agent-move.ts`) moves nothing:
  objects are named for the agent, not the workspace.

### 4.9 Node and the desktop app

- `platform.node.ts` gets a third namespace beside the agents', `chats/` in the data folder, one
  SQLite file per chat object. `server.node.ts` gets the chat socket next to `acceptFollower`.
- **Node keeps every actor it has loaded** (`NodeActorNamespace` unloads only through `evict`,
  `packages/runtime/src/node/index.ts:172`, which only tests call). With an object per schedule
  and per thread, a long-running server or the desktop app would hold more and more harnesses.
  It needs to put away a chat actor that has been idle for some minutes with no socket and no
  alarm due.
- **Memory does not get better on Node**: it is one process. What Node gains is only that the
  code is the same, which is worth more than the split: one path, tested once. Section 9 asks
  whether Node should keep everything in the agent's object instead.
- **The desktop app** bundles the Node server and its data folder. Moving its conversations is the
  same lazy move as on Cloudflare (section 5). An older desktop build cannot read a moved chat,
  and the agent's copy is not deleted until much later, so going back to an older build loses
  only what was said after the move.

### 4.10 What it does for memory and CPU

- **The agent's object becomes small.** It holds documents and routes; it builds no requests, so
  nothing a conversation reads can take it down. Settings, schedules, Slack routing and the list
  of chats keep working while a chat's object is in trouble.
- **Background work stops holding up the talk.** A schedule run, a Slack thread or another agent's
  thread builds its requests in its own object.
- **Memory is likely kept apart, not certainly.** Cloudflare may run several objects of one class
  in one isolate, and the 128 MB is the isolate's. Two chat objects of an agent can share one,
  and then one of them taking it down takes the other too. Separate objects make that less
  likely; they do not rule it out. The request limits of #166 stay, and `IMAGE_LIMITS`
  (`limits.ts:53`) should stay as it is for that reason, though the talk object holds fewer
  conversations than the agent's object did.
- **The talk object is still shared** by every chat with people and their sub-agents. Measured
  use is one chat at a time, so that matters less than the background work does.
- **Each object has 10 GB** of storage.

## 5. Moving existing conversations

### 5.1 What moves together

A move takes a whole object's worth at once: for the talk object, every conversation of kind
`chat`, the call side chats and every sub-agent; for a schedule, all its run chats; for a thread,
its one conversation. Side chats and their main chat go together, so a fork's parent is always
there.

### 5.2 Exporting and importing

pi-durable has no export or import, but its `Storage` interface has everything needed: scans of
conversations, entries, tasks, submissions and documents on the agent's store, and `commit` of
those same records into the new one, which keeps their ids and moves its counter past them
(`SqliteStorage.commit`). Nothing reaches into pi-durable's tables directly.

For each conversation moved, in this order: the conversation records, parents before children
(a side chat's parent is the main chat, which is moved with it); the conversation's documents,
each as its current content (`document.create` with a base); entries in id order; tasks and
their documents; submissions, which must come because they are what makes a resent request
(`subagent-report:…`, `approval:…`, `peer-message:…`) do nothing the second time.

Documents come before entries because of forks. A fork reads its parent's `pi.agent` and
`pi.codemode.store` as they were at the fork's entry (both are rewindable, with `fork: "asOf"`),
and finds that point by the commit the entry came in. Every imported entry comes in a commit
after its documents, so a side chat branched later at an entry from before the move finds
them. What it finds is their state at the move, not at that entry: earlier revisions are not
carried, and the commit numbers are the new store's. In practice a branch is made at the main
chat's latest answer, and a model or tool change made between that answer and the move is what
would differ.

Then the app's parts: the chat's own part of its record (5.1 and 2.2), its jobs, its
`dc.activity`, and nothing of `dc_request_starts`, which only holds live tasks (5.4).

Batches stay well under a Durable Object row's 2 MB and a request's size. The importing object
writes each batch before its harness is opened, and skips a record it already has, so a batch
sent twice changes nothing. After the last batch it sets its id floor (4.1), and only then opens.

### 5.3 The steps, for one object's worth

Kept as a state on each chat's index record, so a move cut short at any point is carried on by
the next wake-up of the agent's object:

1. **At rest.** Nothing is live in any conversation that moves: no task, no queued submission,
   no running background command, no sub-agent working. A pending approval or secret does not
   stop it: the answer is routed to wherever the chat is when it comes.
2. **Held.** The index marks the chats as moving. A request for one waits in the agent's object
   until the move is switched or put back, and is then handed on; a move that takes longer than
   20 seconds answers it 503 with `Retry-After`. Today's clients do not resend a message that
   failed: the web app says "That was not sent… Try again" (`apps/web/src/lib/use-chat.ts`), so
   the wait is what keeps a move out of sight, and phase 5's client change also resends a 503
   with its same `requestId`. A message from a loop (a sub-agent's report, a peer's reply, an
   approval's turn) is not sent and the loop tries again on its next tick, as it does after any
   failure.
3. **Copied** (5.2).
4. **Checked** (5.5). A mismatch puts the chats back where they were, in the agent's object, and
   reports it.
5. **Switched.** The index records the new object, and the hold is lifted. From here the agent's
   copy is never written: everything that reaches a conversation goes through one function that
   looks the chat up in the index, and that function refuses to give the agent's harness a
   conversation that has moved.
6. **Cleared**, weeks later (phase 8): the agent's copy is deleted, or left (section 9).

### 5.4 Work in flight

Nothing moves while it runs (step 1). A chat that never comes to rest, such as one whose run
keeps going for hours, is skipped and tried again later; a list of chats that would not come to
rest after a day is logged. `dc_request_starts` is empty for a chat at rest, since rows are
dropped once their task is not live. Background commands are waited for, not moved: they end in
at most their life (`lifeMs`).

### 5.5 Checking a copy

Both sides compute, and the agent's object compares:

- the number of records of each kind, and a hash of each record's JSON in id order;
- each chat as a client sees it: `projectChat` of its view (`packages/agent/src/project.ts`),
  compared as JSON;
- each conversation's model context at its head (`conversation.context`), compared as JSON,
  which is what its next request will be built from;
- its usage document.

The same check runs as a **dry run** on the live site before anything is switched: copy into a
throwaway object, compare, destroy it, report. That is how the move is first tried on real
conversations, which tests cannot provide.

### 5.6 When it happens: lazily, then a sweep

- **Lazily.** With the flag on for an agent, the first request for a chat that has not moved
  moves its object's worth, if it is at rest, before answering. A main chat with a long history
  takes some seconds; the hold covers it.
- **A sweep.** The agent's alarm moves a few idle objects' worth a wake-up, oldest first, until
  nothing is left in the agent's store.
- **Reading both meanwhile.** Until the sweep is done, a chat is read from wherever the index says
  it is. Usage, search and the journal read both. Background conversations made after the flag
  is on are made in their new objects from the start.

### 5.7 Going back

The same export and import run the other way: a chat's object back into the agent's store. The
id ranges make this need no renumbering: everything made in a chat object has ids no other
store has. The agent's copy of a moved chat is still there until step 6, so going back only needs
what was added since the move, but copying everything back is simpler and the check is the same.

### 5.8 Clients during all of this

No route changes and no response changes, so web, the phone app and old builds of either keep
working. A request for a chat being moved waits a moment (5.3); only a move that takes longer
than 20 seconds shows as a failed request, which an old client shows as not sent. Message ids
and history cursors are entry ids, which the move keeps.

## 6. Order of work

Each phase is one pull request or a few, leaves `main` deployable, and is off until switched on.
A rule over all of them: **nothing is written to a chat object on the live site before there is a
tested way back** (phase 3 comes before phase 4).

**The switch** is a setting `DC_CHAT_OBJECTS` (`off`, `background`, `all`) for the deployment's
default, and a per-agent override kept in the agent's object, set through an internal route, so
that one agent can go first. It only ever moves forward on an agent unless someone moves it back
with the tool of 5.7.

### Phase 0: measure (do this now)

What triggers the work (section 8) cannot be seen today. The actor logs only errors
(`onReport`), and Cloudflare's analytics show memory and CPU per object but not what was running.

- Each time `#rearm` inspects the harness, count the conversations with live work, by kind, and
  record it when the count changes: how often two or more are live at once, and of which kinds.
- The time from the gateway sending a request to the actor starting on it (a header stamped by
  `proxyToAgent`), recorded when it is over 250 ms: that is how long requests wait behind work.
- The size of each request built, by chat kind, from the limits hook (`limits.ts`), which
  already measures its pictures.
- The database's size: `ActorHost` gains `size()` (the object's `sql.databaseSize`, the file on
  Node), recorded once a day.
- Isolate resets and CPU limits: Workers Logs already records an invocation's outcome
  (`exceededMemory`, `exceededCpu`). A saved query or a daily check of them.
- Where: a Workers Analytics Engine dataset on Cloudflare (kept three months, read with SQL) and a
  JSON line on Node.

Test: unit tests for the counting; nothing else changes. Rollback: revert. Effort: 1 to 2 days.

### Phase 1: seams inside the agent's object

No behavior changes. Everything that reaches a conversation goes through one interface: "the
conversation with this chat id", with submit, abort, reset, watch, view, entries, context and
usage. Its only implementation wraps the agent's own harness. Likewise one interface for "the
agent's documents as a chat reads them". The loops (`subagents.ts`, `peers.ts`, `slack.ts`,
`schedules.ts`, `jobs.ts`, `journal.ts`, `history.ts`, `keep-going.ts`, `approvals.ts`,
`calls.ts`) and `actor.ts` are changed to use them. The screen and browser queue moves to the
computer (3.5). On Node the built-in shell moves its files out of the agent's database.

Test: the whole suite unchanged: `pnpm check`, `pnpm test` (Node and Workers), `pnpm test:e2e`.
Plus a test that two agents sharing one paired computer take turns on its screen. Rollback:
revert. Effort: 4 to 6 days.

### Phase 2: the chat object, switched off

`createChatActor`, the `ChatObject` class and its migration in `wrangler.jsonc`, the namespace on
Node with idle unloading (4.9), the internal routes, the mirror (4.5), the reports of usage,
activity and the latest line, id ranges, and a second implementation of the phase 1 interface
that talks to a chat's object. Nothing creates a chat object yet, except tests.

Test: new unit tests on Node for the mirror (a change reaches a running chat's next request),
the leases (a chat object that stops renewing stops counting as working), every keyed call sent
twice. Workers tests in `packages/agent/test/workers` for two objects calling each other,
alarms in both, hibernation of the chat socket, and the id floor. `registerHostConformance`
(`packages/runtime/src/testing.ts`) for `size()`. Rollback: nothing uses it; a class that is
declared and never used costs nothing and stays. Effort: 6 to 9 days.

### Phase 3: moving, both ways, without switching

Export, import, check and the way back (section 5), the move's states, and a dry-run route for
the gateway alone.

Test: a set of agents made by the tests with the scripted model, covering compactions, a reset,
side chats branched whole and cut down, sub-agents that reported, failed and were stopped, a
pending approval, a pending secret, a finished background command, pictures, a call's record,
a Slack thread, a peer thread and schedule runs. Each is moved, checked, used (a new message,
a sub-agent report, an approval answered, a search, usage), moved back, checked again. Every step
is cut short in turn (an exception injected at each, and `evict` on Node) and the move carried on.
Then dry runs on the live site for each of the five agents, compared and thrown away.

Observe: the dry runs' results and how long each step took. Rollback: nothing on the live site
has moved. Effort: 5 to 8 days.

### Phase 4: new background conversations in their own objects

With `background` on for an agent, a new schedule run, Slack thread or thread with another
agent is made in a chat object. Old ones stay where they are and are read there.

Test: the unit tests for schedules, Slack and peers run against both implementations;
`automations.spec.ts`, `slack.spec.ts` and `notifications.spec.ts` in the browser with the switch
on and off (CI runs the e2e files once each way). On the live site, one agent
first, then the rest after a week.

Observe: requests waiting behind work in the talk (phase 0's number) should fall; calls between
objects and their time; leases that ran out; mirror refreshes; errors by object kind. Rollback:
switch the agent back to `off`, and move its background objects back with phase 3's tool.
Effort: 4 to 6 days.

### Phase 5: following a chat directly

The chat socket and the direct event stream (4.3, 4.4), the relay for old clients, and the client
change in `packages/client` for web and the phone app, which also sends a message again, under
its same `requestId`, when it is answered 503.

Test: `sockets.test.ts` for the relay and for the chat socket coming back after hibernation;
`chat.spec.ts`, `two-clients.spec.ts`, `mobile.spec.ts` and `calls.spec.ts` in the browser; an old
client (the client package as it is today, pinned in a test) against the new server, and a new
client against today's server. Rollback: the server stops offering the socket in `ready`, and
clients go back to the one socket. Effort: 3 to 5 days.

### Phase 6: moving existing background conversations

The sweep on, for background objects only, one agent first.

Observe: moves done, skipped (not at rest) and failed; the check's mismatches, which should be
none. Rollback: phase 3's tool, per object. Effort: 2 to 3 days, mostly watching.

### Phase 7: the talk object

`all` on for an agent: its chats with people move to the talk object (lazily, then by the
sweep), and new ones are made there. The agent's object then runs no model at all.

Test: everything above with `all`, and `actor.test.ts`, `subagents.test.ts`, `branch.test.ts`,
`journal.test.ts`, `history.test.ts`, `approvals.test.ts`, `jobs.test.ts`, `limits.test.ts`,
`pictures.test.ts` against the chat object, and the whole browser suite with `all`.
`request-limits.spec.ts` shows a cut-off run in the talk object leaving the agent's pages
working. Rollback: switch back and move the talk object back. Effort: 4 to 6 days.

### Phase 8: clearing up, after a few weeks

Once every agent has been on `all` for some weeks with nothing moved back: delete the agent's
copies of moved conversations (section 9, question 5), take out the code that runs
conversations in the agent's object and the old-client relay when the owner says (question 3),
and update `README.md`, `docs/reference/computers.md` (which says pictures are held "in the
memory of the Dood's own Durable Object") and `HANDOFF.md`. Effort: 2 to 3 days.

### Phase 9, only if pi-durable allows it: side chats on their own

If pi-durable can fork a conversation into another store and keep the fork's prompt (3.2), a
side chat can get an object of its own when it is made, carrying its sub-agents. Test with
`branch.live.test.ts` against a real model that the first request of a side chat in its own
object reads from cache as one in the talk object does. Effort: 4 to 6 days, after pi-durable.

## 7. Costs and risks

- **Latency between objects.** A chat object is first reached from its agent's object, so
  Cloudflare places it near it, and a call between them is usually a few milliseconds. What it
  adds to: sending a message (one hop), starting a run (a mirror check), a tool call a rule
  governs, a memory or schedule tool call, a report at rest. None is on the path of streaming an
  answer.
- **Lost atomicity.** Things that are one commit today become two steps across objects:
  - making a chat (the index entry and the conversation were one commit, with the check that a
    request makes one chat, `refuseSecond`, `actor.ts:523`): now the agent's object records the
    chat as being made under its request id, the chat's object makes the conversation under the
    chat id, and a chat left half-made is finished or dropped by the next wake-up;
  - a schedule's run and the schedule's record; a run's report, the journal and the chat it is
    written into;
  - a Slack or peer thread's index entry and its conversation;
  - usage, activity and the latest line become reports, true a moment after the fact.

  Each is made safe by keys and by a state the wake-up finishes, as the loops already are. What
  stays atomic: sub-agents and their parent, side chats and the main chat, a conversation and
  its own documents.

- **More wake-ups.** Each object with live work keeps itself awake every 20 seconds, as the
  agent's object does now; leases add one call a minute per object at work. The agent's object
  wakes for schedules, calls, moves and the sweep, and otherwise sleeps through a run.
- **Billing.** Durable Objects are billed by request, by the time an object is in memory (128 MB
  counted whatever is used), by rows read and written, and by storage. The risk is duration: two
  objects in memory for one run where there was one. The design keeps the agent's object out of
  a run (no streams through it for updated clients, leases at a minute, reports at rest), so the
  total should be close to today's. Relaying to old clients is the exception: it keeps the
  agent's object in memory for as long as one follows a chat, idle or not (4.4). Phase 0 and
  phase 4 measure it. Storage grows by the copies kept until phase 8.
- **Complexity.** `actor.ts` is 3,278 lines and becomes two actors and a protocol between them,
  with mirrors, leases and a move with six states. Every loop gains a second implementation to
  test. It is the largest change to how the app runs since it was built, for a problem that
  measures small today.
- **A move that goes wrong** loses nothing while the agent's copy is kept, and the check is
  against what a client and the model would see. The risk left is a conversation that checks
  equal and still behaves differently, such as a document pi-durable reads that the move left
  out. The scripted-model tests of phase 3 use every feature for that reason.
- **pi-durable versions.** The export and import read records through the storage interface, but
  their shapes are pi-durable's. A new version that changes them needs the move tested again.
  Asking for export and import upstream would put that burden where the format is.
- **Isolates are shared** (4.10): the benefit for memory is likely, not certain.

## 8. When to start, and how long it takes

**Start when one of these is seen** (phase 0 is what shows them):

- An agent's isolate is reset for memory or CPU (`exceededMemory`, `exceededCpu`, or the object
  reset message in the logs) even once, now that #166 and #167 are in.
- An agent's reported memory over 100 MB on most days of a week.
- Two or more conversations of one agent live at once in more than 5% of its active minutes, or
  requests to an agent waiting over a second behind its own work more than a few times a day.
- An agent's database over 1 GB, or growing toward that within months.
- People other than the owner using it, or a team agent that several people talk to at once: the
  blast radius of one bad chat grows with them.
- A feature that multiplies background work: busy Slack channels, many schedules an agent,
  agents writing to each other at length.

None of these is seen today.

**Rough effort**, for one person working with tests:

| Phase                                         | Days                           |
| --------------------------------------------- | ------------------------------ |
| 0. Measure                                    | 1 to 2                         |
| 1. Seams                                      | 4 to 6                         |
| 2. The chat object, off                       | 6 to 9                         |
| 3. Moving, both ways                          | 5 to 8                         |
| 4. New background conversations               | 4 to 6                         |
| 5. Following a chat directly                  | 3 to 5                         |
| 6. Moving existing background conversations   | 2 to 3                         |
| 7. The talk object                            | 4 to 6                         |
| 8. Clearing up, after weeks of soak           | 2 to 3                         |
| **0 to 8**                                    | **31 to 48**, six to ten weeks |
| 9. Side chats on their own, if pi-durable can | 4 to 6, after pi-durable       |

Phases 0 to 6 already isolate the background work, which is likely most of the gain, in about
25 to 39 days. Stopping there is a reasonable place to stop.

## 9. Choices for the owner

1. **Ask pi-durable for help?** Four things would make this smaller and safer: forking into
   another store with the fork's prompt kept (needed for phase 9), export and import of a
   conversation tree, a floor for a store's ids, and deleting a conversation (phase 8). Without
   them, this plan uses the storage interface and a placeholder record for the floor.
2. **Should another agent's thread fork the receiver's main chat** (`PLAN-forked-chats.md` 5.4)?
   If yes, those threads go in the talk object and lose their isolation. The same question for
   scheduled runs forking (5.6 there).
3. **How long to keep the relay for clients that follow chats over the agent's socket.** Old
   phone builds stay installed. Until a forced update, or for good?
4. **Should Node keep everything in the agent's object?** This plan says no: one code path, and
   Node gains nothing in memory either way. Keeping it would halve the testing of the move and
   double the code that runs conversations.
5. **The agent's copies after a move:** delete them (needs pi-durable's help or direct SQL on its
   tables) or leave them (74 MB today, and they stop growing)?
6. **Connector calls through the agent's object, or tokens in each chat object?** This plan says
   through the agent's object, keeping secrets in one place.
7. **Sub-agents with their parent.** Accept that a sub-agent can take its parent chat down, for
   forks and simplicity? The other way is an object per sub-agent, with reports and stops across
   objects.

Mine, open to change:

- The tree as the unit, and the talk object holding every chat with people.
- An object per schedule rather than per run; per Slack thread; per peer thread.
- Every request through the agent's object except the two streams; no table of chat homes in D1.
- The id ranges and their sizes (2^45, 2^32 an object).
- Mirrors pulled at the start of a run and pushed to objects at work, rather than a call per read.
- A lease of two minutes renewed every minute.
- The thresholds in section 8: 100 MB, 5%, one second, 1 GB.
- Phase 0 now, the rest when a trigger is seen.

## 10. Not checked

- Whether a side chat made by copying the main chat's context into a fresh conversation reads
  its first request from cache (3.2). The reasoning says no, because the system prompt is built
  anew; it was not tried.
- Whether Cloudflare places a chat object near its agent's object, and the time of a call between
  them on the live site.
- How often Cloudflare puts two objects of one agent in one isolate.
- Exporting and importing with pi-durable's storage interface: read from its types and its SQLite
  storage (`commit` moves the id counter past what it is given), not run. In particular, whether
  a conversation whose `parent` is imported in the same batch, and documents created with a base
  under their old ids, read back as they were; and whether a fork made after the move, at an
  entry from before it, finds `pi.agent` as 5.2 expects.
- What the busiest agent's 2,527 seconds of CPU were spent on. Phase 0 would say.
- How many chats, schedule runs and threads the live agents have, which decides how many objects
  the sweep makes and how long it runs.
- Whether the daemon or `ComputerObject` already serializes use of a screen (3.5): only the
  agent's own queue was read.
- Duration billing before and after, on the live site.
- What Cloudflare's memory figure counts: two agents were reported above the isolate's 128 MB
  with no reset.

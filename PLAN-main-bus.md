# The main chat as a message bus: plan

**Status:** a plan, written 2026-10-18. Nothing in it is built. Sawyer made the choices in
section 2; section 9 lists what is still open.

This is the shape described in Lee Robinson's Stanford CS146S lecture on always-on agents
(how Grok's bot is built), adapted to Do Computer. The ideas taken from it:

- **One long main conversation**, compacted many times over, that everything flows into: what
  you say, what helpers report, what automations find, what a background command printed.
- **One way out**: the model reaches a person only by calling a `send` tool. What it writes
  otherwise is its own working, so saying nothing is just not calling `send`.
- **The main agent coordinates.** Work that would fill its context (browsing, screenshots, long
  output, long tasks) goes to helpers that start empty and only send back a result.
- **Compact while the cache is warm.** A long conversation that has gone quiet is summarized
  while reading it is still cheap, so the next message starts from a small context.

Sections 3 to 7 cover the five pieces; section 8 says in what order to do them.

## 1. What is there today

| Piece | Today | Where |
| --- | --- | --- |
| Chats with people | A main chat (`ChatsState.main`) and any number of side chats, which are pi-durable forks of it | `actor.ts` `#branchChat` (:2814), `main.fork` (:2846) |
| What the user sees | Whatever the model writes in a turn is the reply | `project.ts` |
| Sub-agents | An empty, ownerless conversation given only the task and a preamble; its last answer is written into the parent chat with a turn (`NUDGE`) | `subagents.ts` `start` (:156), `#deliver` (:403) |
| Automations | Each run is a chat of kind `schedule`; its final text is delivered into the chat the schedule was made in (`originChatId`), unless it is exactly `[SILENT]` | `schedules.ts` (:49, `#deliver` :723) |
| Slack | Each thread is a chat of kind `slack`; when it comes to rest its last answer is posted to the thread | `slack.ts` `tick` / `#post` (:839) |
| Where it all runs | One Durable Object per Dood (`AgentObject`): every chat, sub-agent, run and Slack thread shares one 128 MB isolate | `apps/web/wrangler.jsonc` |
| Compaction | Only pi-durable's own: when a request would pass `contextWindow - reserveTokens` (16k), or on overflow. `conversation.compact()` is never called | pi-durable `DEFAULT_COMPACTION_POLICY` |
| Messages while busy | Everything steers (`whenBusy: "steer"`): the user, Slack, sub-agent reports, approvals | `actor.ts` :3044, `slack.ts` :559, `subagents.ts` :228 |

`PLAN-chat-objects.md` (branch `plan-chat-objects`) is the groundwork for objects of their own
and is relied on in section 4. It kept sub-agents and side chats in one "talk object" because
side chats are forks and `PLAN-forked-chats.md` proposed forking sub-agents too. This plan
removes both reasons.

## 2. Decisions

| Question | Decision |
| --- | --- |
| Sub-agents | Fresh slate: no fork of the main chat. Step 2 of `PLAN-forked-chats.md` is dropped |
| Where sub-agents run | Each in a Durable Object of its own |
| Side chats | **Deleted.** The main chat is the one conversation a person has with a Dood |
| `send` | Required in the main chat **and in Slack threads**. The model's own text is never shown or posted |
| Browser and screen tools in the main chat | Kept, but the prompt steers the main chat to hand that work to a sub-agent |
| Compaction while idle | At **70% of the model's context window**, and **only on models with a long cache** (1 h or more). Never on 5-minute caches |
| What sub-agents can do | **Everything the Dood can**: connectors, connected apps, Slack, secrets, saved logins, cards, computers, web search, the library. Where tokens are stored is an implementation detail that the model never sees and that limits nothing |

## 3. The main chat is a message bus

### 3.1 The `send` tool

- `send({ text, files? })`. `files` are library paths or paths on a computer, as `send_file` takes
  now, which it replaces. Later kinds (a reaction, a draft to approve, a sign-in) are new
  fields on the same tool, each drawn by every client in its own way.
- Where it goes depends on the conversation: in the main chat to the people in it, in a Slack
  thread to that thread. Same tool, same name, so the prompt is the same everywhere.
- It returns at once, with an id. A crash after the call but before the result is stored must
  not send twice: the message is written with the tool call's id as its key, as sub-agent reports
  already are.
- **Streaming.** A reply should appear as it is written, as it does now. pi-ai streams a tool
  call's arguments as they come (`toolcall_delta` events, with `parseStreamingJson` for the
  partial JSON, in the Anthropic, OpenAI, Google, Bedrock and Mistral providers), so the live
  projection can show `send`'s `text` growing. If a provider turns out not to, `send` appears
  whole there.

### 3.2 Everything else is private

- In the main chat and in Slack threads the model's text is kept, for the model, and **not shown**.
  `project.ts` shows a person's messages and each `send` as the Dood's messages, and folds
  everything between them (text, tool calls, events) into one "worked on it" row that can be
  opened, like tool calls today.
- Push notifications (`#notifyWhenUnseen`) fire on a `send`, and only then. Today they fire
  when a run ends unseen.
- The `latest` line beside a Dood's name is its last `send`, or the person's last message.
- Voice calls speak `send` text, not the model's text.
- Chats from before the switch are drawn as they were: the rule applies from a marker entry on.

### 3.3 Safety net

A turn a person started that comes to rest with no `send` is the one failure that looks broken
from outside. So:

1. The model gets one nudge: `<meta kind="unsent">You have not sent anything to … since their
   message. If there is nothing to say, end without sending; otherwise use send.</meta>`.
2. If that turn still sends nothing, nothing is shown. Saying nothing to a person's message is
   then a choice it made twice. (Alternative: show its last text. Section 9 asks.)

Turns started by events never get the nudge: quiet is the normal answer to most of them.

### 3.4 Events

Everything that is not a person speaking arrives as an input in the main chat with
`whenBusy: "queue"` and a body like:

```
<event kind="subagent-report" id="…" title="…">…</event>
<event kind="automation" schedule="…" title="…">…</event>
<event kind="command-ended" job="…">…</event>
<event kind="approval-answered" …/>
<event kind="peer-message" from="…">…</event>
```

- A person's message still steers: it joins the running turn at once.
- Several events that arrive while it is busy are taken together: pi-durable's
  `followUpMode: "all"` places every queued input at the next boundary, so they make one turn.
  To confirm in a test that this is the mode the harness is opened with.
- Each event carries a key (`subagent:<id>:<n>`, `schedule:<id>:<firedAt>`, …) as its
  `requestId`, so delivering one twice does nothing.
- Text inside an event is information and not instructions; the main chat's prompt says so once,
  and events from outside (Slack, email, webhooks, other people's messages) are marked as such.

### 3.5 Automations

- A run still happens in a conversation of its own (in its own object, section 4), started empty
  with the schedule's prompt. It does not reach a person by itself.
- When the run rests, its last text goes to the main chat as an `automation` event. The main
  chat decides whether anything in it is worth a `send`. `originChatId` and automatic delivery
  go away, and so do `[SILENT]` and its line in the prompt (`schedules.ts:49`).
- A schedule's `check` is unchanged: a check that prints nothing still starts no model.
- `lastRun.outcome` becomes `reported` / `failed` / `skipped` / `check-failed`. Whether the
  main chat sent anything is recorded on the event's turn instead.

### 3.6 Slack threads

- Each thread stays a conversation of its own (its own object, section 4), with `send` posting to
  the thread at once, keyed by the tool call's id and retried as `#post` does now.
- Posting the last answer when the thread rests (`tick` / `#post`) goes away.
- The thread is still told what it needs from the Dood's notes and memory. If something there
  should reach the owner, the thread's conversation sends an event to the main chat (a new
  `tell_main` tool, or the `agents`-style note it gets now; section 9).
- The safety net (3.3) applies to a message that mentioned the Dood.

### 3.7 Deleting side chats

| Goes | Notes |
| --- | --- |
| `POST /chats` for new chats with people, `#branchChat`, `branch.ts` | `POST /chats/main` stays. Existing side chats stay readable, archived |
| Web: `side-chat.tsx`, `shell/side-chats.tsx`, side-chat columns in `chat-view.tsx`, `lib/columns.ts`, the strip's side-chat tabs | The sub-agent and Slack thread views stay: they become read-only views of other objects |
| Mobile: `a/[agentId]/side-chats.tsx` and its links | |
| The `recent` section (`journal.ts:348`) listing other chats | Becomes the list of sub-agents at work, automations and Slack threads with something open |
| Calls: a call held in the main chat gets a side chat for its work (`calls.ts`) | The call's work goes to a sub-agent instead, and the call's notes are an event in the main chat |
| `PLAN-forked-chats.md` | Marked as replaced by this plan |
| e2e specs that make side chats (`layout`, `calls`, `mobile`, `automations`, `library`, `account`, `loading`) | Rewritten around the main chat and sub-agents |

Keeping a side chat's job (a quick separate thread of work you can read) is what a sub-agent
whose conversation you can open already gives.

## 4. Sub-agents in objects of their own

The object model is `PLAN-chat-objects.md`'s, with two changes: there is no talk object holding
side chats, and sub-agents are background objects like schedules and Slack threads.

| Class | One for | Name | Holds |
| --- | --- | --- | --- |
| `AgentObject` | Each Dood, as now | agent id | Identity, memory, skills, schedules and their alarm, connectors and their stored tokens, secrets, approvals, the index of chats and objects, and the main chat |
| `ChatObject`, new | Each sub-agent | `<agentId>/<n>` | That sub-agent's conversation |
| | Each schedule | `<agentId>/<n>` | That schedule's runs, one at a time |
| | Each Slack thread | `<agentId>/<n>` | That thread's conversation |
| | Each conversation with another agent | `<agentId>/<n>` | That conversation |

The main chat stays in `AgentObject`. It is the one conversation that is meant to stay small,
and keeping it there leaves the Dood's documents next to the conversation that writes most of
them. If it ever needs isolating too, it can move to `<agentId>/main` later.

### 4.1 Starting, messaging, stopping

- **Start.** The `subagent` tool runs in the main chat, in `AgentObject`. In one commit it mints
  `n`, checks the cap against its index and writes the record (`status: "starting"`); then it
  calls the new object's internal `/start` with the task, keyed `subagent:<id>`. A start that
  fails is retried from the record; one that keeps failing is marked failed and reported as an
  event.
- **Message, stop.** Forwarded to the object, keyed. Stopping the main chat's turn still does not
  stop sub-agents.
- **Report.** When the object's conversation rests, it calls `AgentObject` with its last text
  (`report:<id>:<n>`), which writes the `subagent-report` event into the main chat (3.4).
- **Status.** The object reports `working` / `waiting` / `rested` with a lease, renewed by its
  keep-alive, so a lost object cannot stay "working" in the index forever.
- **Cap.** Today 6 at once in one isolate. With an isolate each, it can go up (say 12), limited by
  cost rather than memory.

### 4.2 What a sub-agent object knows

A sub-agent has the same tools as the Dood, with the same rules, wherever it runs: every
connector and connected app, the `slack` tool, secrets for commands, saved logins and cards,
computers, web search, the library, memory and skills. Moving it to an object of its own must
not take any of that away, and the tests for phase 6 check each one from a sub-agent. (What it
cannot do today, start sub-agents of its own or change schedules, is unchanged.)

**Asking a person, from a sub-agent.** Today a sub-agent cannot ask anyone for anything: asking
for a secret (`secrets.ts:496`), a login (`sign-in.ts:287`), a computer (`computers.ts:947`) or an
"Ask first" approval (`approvals.ts:572`) fails with "there has to be someone to type it". With
the bus there is always somewhere to ask: the request is shown in the main chat, under the
sub-agent's name, and the answer goes back to the sub-agent, which waits as a chat waits now.
The main chat is told of it as an event and does not have to relay it. This is part of phase 3,
before any object work, since it only needs the request to be drawn in a chat other than the one
that asked.

How that is wired is an implementation detail:

- **A mirror** of what it reads while building a request: identity, memory (read-only), skills,
  model and thinking, computers, connector tool definitions, approval rules. Sent with `/start` and
  refreshed when its version is older than the agent's, as in `PLAN-chat-objects.md` 4.5.
- **Connectors.** The likely first version: tokens and MCP sessions stay where they are stored
  today, in `AgentObject`, and a sub-agent's connector tool calls are made through it
  (`{ connector, tool, args }` in, the result out). That keeps one OAuth refresh and one MCP
  session per server. The alternative is to give each object what it needs to call the server
  itself. Either way the sub-agent sees the same tools with the same results as the main chat;
  pick whichever is simpler and faster to build.
- **Secrets, saved logins and cards.** Used from a sub-agent as from the main chat. Where the
  values are read from is the same choice as for connectors.
- **Model credentials.** The deployment's key is in the Worker's environment already. A model
  signed in with a person's subscription is reached as `AgentObject` reaches it now
  (`ModelAccessObject`), through `AgentObject` so there is one path for credentials.
- **Writes that are the Dood's** (memory, skills, schedules, approvals asked for): a call to
  `AgentObject`, whose answer is the tool's result.
- **Computers.** Commands go to the same machines as now. The screen and browser queue moves to
  the computer first (`PLAN-chat-objects.md` 3.5).

### 4.3 What it buys

A sub-agent that reads 40 screenshots, or builds a huge request, can only take down its own
isolate: the main chat, other sub-agents, automations and Slack keep running. Sub-agents also stop
holding up the main chat's single thread while their requests are built and their replies stored.

## 5. Delegating more

- The main chat's prompt gets a section on its role: it coordinates. A task that needs more than
  a few quick calls, any browsing or screen use, anything that produces long output, or anything
  that will take more than a minute or two goes to a sub-agent with a brief that stands on its own.
- The browser and screen tools stay in the main chat (decision), with that guidance in their
  descriptions too.
- `subagent start` takes `files` and `links` beside `task`, so a brief can point at material
  rather than paste it.
- Long tool output in the main chat is cut short and saved to a file, as `bash` already does.
- **Measured** on do.computer before and after: the share of tool calls made in the main chat,
  pictures read in it, its context size at each turn, and how often it is compacted.

## 6. Compacting while the cache is warm

pi-durable has `conversation.compact(instructions, context)`.

**When.** A conversation (the main chat first; sub-agents and Slack threads too, at the same
rule) comes to rest. `AgentObject` sets an alarm for 10 minutes later. When it fires, it compacts
if all of these hold:

- it is still at rest, nothing is queued, and nobody is typing in it (presence);
- its last request's input was **at least 70% of the model's `contextWindow`**;
- the model has a **long cache**: pi-ai's compat says `supportsLongCacheRetention` (Claude's 1 h
  through Anthropic or OpenRouter's Anthropic format, OpenAI's 24 h), and Do Computer already asks
  for it (`cacheRetention: "long"`). Models with only a 5-minute cache are skipped;
- its last request was less than the cache's lifetime ago, less a margin (under 50 minutes for a
  1 h cache). After that, it waits for its next turn, where pi-durable's own threshold handles it.

**What it keeps.** Instructions for a bus: what the person has asked for and not got, promises
made, sub-agents at work and what each is for, automations and when they next run, decisions and
preferences learned in the conversation (and a reminder to save lasting ones to memory first).

**Checked by** the usage of the compaction request: its cache-read share should be high. It is
recorded per compaction, with the tokens before and after, so the 70% can be tuned.

## 7. Messages while busy

| Input | `whenBusy` |
| --- | --- |
| A person in the main chat | `steer` |
| A person in a Slack thread (in that thread's own conversation) | `steer` |
| Sub-agent reports, automation results, commands ended, approvals answered, another agent's messages | `queue` |

## 8. Order of work

Each phase is a PR (or a few), checked with the package tests and the e2e specs it touches. On
do-computer that means watching `gh pr checks --watch` before merging, since nothing is required.

1. **Compaction while idle** (section 6). On its own; pays off at once. Lands with its numbers.
   About 1–2 days.
2. **`send` and the bus in the main chat** (3.1–3.4, 7) behind a per-Dood switch: the tool,
   showing only `send`, the folded rows, notifications, the safety net, voice. Events for
   sub-agent reports, approvals and commands. About a week.
3. **Automations onto the bus** (3.5) and **the delegation prompt** (5). About 2–3 days.
4. **Delete side chats** (3.7), calls moved to sub-agents. Turn the switch on for everyone.
   About 3–4 days.
5. **Groundwork for objects of their own**: `PLAN-chat-objects.md` phases 1–2 (seams, the mirror,
   connectors and secrets usable from any object, `ChatObject` switched off, the screen
   queue moved). About 1–2 weeks.
6. **New sub-agents in their own objects** (4), then raise the cap. Sub-agents at work when it
   ships finish where they are. About a week.
7. **Slack threads in their own objects, with `send`** (3.6), then schedules. About a week.

Phases 1–4 need none of the object work and change how a Dood feels the most; 5–7 are about
isolation and can follow.

## 9. Still open

- **Unanswered message.** After the nudge, does a turn that still sends nothing stay silent, or
  show the model's last text? This plan says silent.
- **Team Doods.** The main chat is one per Dood today, shared by its people. Does a shared
  Dood's bus send to everyone, or does `send` take a person?
- **Slack to the owner.** How a Slack thread tells the main chat something: a `tell_main` tool, or
  an event written whenever the thread sends.
- **Old side chats.** Kept archived and readable (this plan), or merged into the main chat's
  history as notes.
- **Sub-agent cap** once each has an isolate.

## 10. Not checked

- That `toolcall_delta` reaches Do Computer's live projection through pi-durable while a call is
  still being generated (pi-ai has it; pi-durable passing it on is not checked).
- Whether a `compact()` request reads the conversation from the cache in practice, on Claude
  through OpenRouter. Phase 1 measures it.
- Whether pi-durable's own threshold compaction should be moved up as well, so the idle one
  does most of the work.

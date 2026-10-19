# The main chat as a message bus: plan

**Status:** a plan, written 2026-10-18. Phases 1 to 4 are built: phase 1 (section 6), phases 2
and 3 first behind a switch (8.1 and 8.2), and phase 4 (8.3), which took the switch away, so that
every Dood's main chat and threads in Slack are a bus, and took side chats away. Phases 5 to 7 are
not built. Sawyer made the choices in section 2; section 9 lists what is still open.

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
| Messages while busy | The user, Slack and answered approvals steer (`whenBusy: "steer"`). Sub-agent reports and ended commands were already follow-ups: a write, then a separate nudge input with `whenBusy: "followUp"` (`subagents.ts` `#deliver`, `jobs.ts` `#deliver`) | `actor.ts` :3044, `slack.ts` :559, `approvals.ts` :863 |

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
  opened, like tool calls today. (Since dropped: see "No rows of working" in 8.1.)
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

Turns started by events get no nudge of their own: quiet is the normal answer to most of them.
The nudge is about the person, though, and not about what started the turn. Where the person's
turn ends just as an event arrives, pi-durable drops the nudge of that turn (a continuation is
only taken where the boundary placed no queued input), and the run the event starts is the one
that gets it, because the person has still had nothing back. A turn events start after the
person was answered is never nudged.

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
  It was not: pi-durable's default is `"one-at-a-time"`, and phase 2 opens the harness with
  `followUpMode: "all"`. The setting is the harness's, not a chat's, so it applies to every chat:
  follow-ups that pile up in a side chat or a sub-agent are now taken together too. Nothing there
  relied on one at a time. pi-durable's word for "queue" is `followUp`.
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

**Built (phase 1), and where it differs.** `packages/agent/src/idle-compaction.ts`; HANDOFF item
101 has the detail.

- **`compact()` alone reads nothing from the cache.** pi-durable's summarizer sends the
  conversation as a new prompt (its own system prompt, the transcript as text) with
  `cacheRetention: "none"`, so its cache-read share would be about 0%. The idle compaction still
  calls `compact()`, and a `beforeCompact` hook answers for it with a summary asked for as the
  chat's own next request: the same messages (`shapeRequest`), provider session and cache
  retention, with one more message asking for the summary.
- **Where that fails, nothing is compacted.** Falling back to pi-durable's summarizer would send
  the whole chat uncached, often while the provider is overloaded. The chat waits for its next
  turn and pi-durable's own threshold, and is not asked again from the cache for an hour. Text
  not in the form asked for counts as a failure.
- **pi-durable's own threshold compactions are summarized from the cache too**, by the same hook,
  where the model keeps a long cache, it is still warm and the window has room for the summary
  past the whole chat: in practice its background compactions, not its blocking ones. Otherwise,
  and whenever that fails, pi-durable's summarizer, which those need. Chats other than the main
  one are asked in pi-durable's own form. On a 200k window pi-durable starts at about 151k, so the idle compaction's
  own band is 140k to 151k; above that, its work is still done from the cache. This was chosen
  over setting `backgroundTokens` to 0 for long-cache models, which the harness's settings,
  being one for every chat, cannot do for a model.
- **Long caches are by provider**, not by interface: Anthropic and Claude through OpenRouter an
  hour; OpenAI's GPT-5 and GPT-4.1, directly or through OpenRouter, a day (not a model with an
  explicit cache mode, which gets 30 minutes); otherwise only what the model's own `promptCache`
  says. Azure gets nothing, since pi-ai never asks it for a long cache.
- **The alarm is the actor's one wake-up**, as for schedules: a row per chat in the agent's
  database, set only by an answer that could qualify, which each answer moves ten minutes on.
- **Main chats only** for the idle compaction. Sub-agents end once they report; Slack threads can
  follow at the same rule by widening one check.
- **Presence** says who is typing only in a team, so a personal Dood is never held off by it; it
  holds a compaction off for ten minutes at most, since a draft left in the box counts.
- **Memory.** The summary request can call no tool, so it does not save to memory itself; the
  journal's review, which already runs before every compaction, may add lasting facts there.
- **Numbers to tune.** Each compaction records the chat's next request after it: how long after,
  and what it wrote to the cache. Compacting at ten minutes only pays for chats that then stay
  quiet past the cache's lifetime (or for the quality of the answers); this is what will show it.
- **70% of a large window is a lot.** pi-ai's catalog lists Claude Sonnet 4.5 on OpenRouter at
  a 1,000,000-token window, where 70% is 700,000 tokens: such a chat is rarely compacted this
  way. Left at 70% for now.

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
3. **Automations onto the bus** (3.5), **the delegation prompt** (5), and **sub-agents asking a
   person through the main chat** (4.2). About 3–4 days.
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

## 8.1 Phase 2 as built

Notes from building it, where it differs from or adds to the sections above.

- **The switch** is `bus` on the identity document, set in the Dood's settings (Model and
  computers, "Main chat", saved as it is switched). The main chat is set up for it when the
  switch changes, when the main chat is settled on, and before a person's message is given to it.
  A `dc.bus` entry marks where it was switched, for drawing; a `dc.bus-note` entry beside it
  tells the model what changed, both ways; and the chat selects the bus's extension (`bus.ts`),
  which holds `send`, the prompt section and the reminder. No other chat selects it: the
  harness's default selection is every installed extension but that one, a side chat forked from
  the main chat clears what it inherited, and a chat that stops being the main one has the bus
  switched off in it. The chat record keeps where each mark is, so a page of earlier messages is
  drawn as it was at the time.
- **`send` replaces `send_file`** in a chat with the bus on: the bus wraps `send_file` so that
  only tools may call it, and `send` calls it for each of its files. Every file is looked at
  first (that it is there, is a file and is small enough), so a send goes whole or not at all.
  The bus's section says that wherever instructions or a skill say `send_file`, use `send`'s
  `files`. Sends are not made sequential (that would make every tool of their round wait in
  turn); they are told of in the order they were written all the same.
- **Streaming.** pi-durable does commit the partial message with a tool call's partial arguments
  in `pi.live` (it copies pi-ai's `partial`, whose `arguments` providers fill with
  `parseStreamingJson`), so `send`'s text grows in the chat as it is written. Checked in a unit
  test of the projection; not with a real provider.
- **What is shown** besides people's messages and each `send`: a `progress` call (a word on the
  way, which tells nobody), and a page drawn with `visual`. A send that failed stays in view,
  marked as not sent with the reason, since its words may have been on screen as they streamed.
  A reply that failed or was stopped says so, as before.
- **No rows of working** (changed after phase 3). The folded "Worked on it" row is gone: for a
  plain answer it held only the model's thinking, or a few words of its own, and drew a row
  above every reply. A chat with the bus on now draws what any chat draws, in order, minus the
  model's own words: people's messages, each send (and a failed one, marked), a progress word, a
  file or page shown, a sub-agent it started, the events it was told of (a sub-agent's report,
  an automation's result with "View run", a sub-agent asking, word from Slack, a call, answers),
  and a reply that failed or was stopped. That is meant to include everything else a chat draws
  of a step: a command left running, a site shared, a pin, a screen or browser in use, a
  connector's page, a picture. Ordinary steps stay in their message, which a client does not
  draw, as in any chat. The model's text outside `send` is kept in the state as a `thinking`
  part marked `written`, which no client draws, so that what it is doing can still be said. An
  answer is cut where it says something: what comes before the first thing said is named
  `before:<that>`, what follows each thing said `after:<that>` (`after:send:<call>`), so a piece
  keeps its id from live to stored and watchers are sent a change, not the whole chat. Only an
  answer with nothing said in it keeps its own id, as in any chat. Nothing outside the
  transcripts read the old `work` flag but the voice (both of its readers are changed) and the
  diff.
- **Ending a turn with a send.** `send` takes `done: true` for the last word for now: it returns
  pi-durable's `control: { terminate: true }`, so the run ends with that round and no model
  request is made just to stop, and its result's details say `done: true`. Without it, a send
  is an update and the run goes on, as before. pi-durable ends the run only where every call of
  the round asks it, so a send beside other work goes on to its results; a send that failed
  never asks. Inputs queued meanwhile are placed by the final boundary as usual and start the
  next run. What follows a run reads whether a round ended it from the stored results
  (`roundEnded`), as pi-durable decided it from their controls, so a flag a model wrote as
  `"true"` or `1` (which pi-ai takes for true) is read the same everywhere. Slack threads take
  the same flag.
- **What a run that a send ended misses.** Such a run never reaches `onYield`, which three
  extensions listen on: the bus's reminder (not due: something was sent), keep going (a send
  marked done is a decision to stop) and the journal, whose review keeps the main chat's note for
  the other chats and adds lasting facts to memory. The journal therefore also reviews from the
  round's `afterTools` when the round ended the run (a round looked at again after a crash
  reviews again, which costs one more small-model call). Both `afterTools` hooks first check, from
  the live slots and without a transaction, that every call of the round is a send, and idle
  compaction that the chat is the main one, so other rounds read nothing stored. Idle compaction, which arms on the answer a
  run rests on (`afterResponse`, before any tool runs), arms from `afterTools` for such a round,
  and a side chat could branch from it (`branchPoint`, gone with side chats in phase 4).
- **"Thinking" after a send.** After a send marked done (its result in, or its closing words
  being written after it in the same answer), the chat says nothing more of what the Dood is
  doing while it only finishes up (thinking, or no more than 200 characters of its own words),
  and its creature is at rest: the person has its last word, and the run ends at once anyway. A
  step, an event, a person's message or more words bring the line back (`quietSinceSend`). After
  an update, a send without `done`, it is at work and is said to be, as usual. The send message
  carries `sent` (`sending` until its result is in) and `done` for this. `done` is set only
  where the whole round can end the run, as pi-durable decides it: every call in the answer is a
  send saying done (its arguments while live, its stored result once that is in). A send marked
  done beside other work (`[bash, send(done)]`, `[send, send(done)]`) is no last word: the run
  goes on, and so does "Thinking".
- **Known gap.** Sends stored while the first version of `done` was live kept the flag only in
  their arguments, not in their result's details. For those rounds `branchPoint` and the
  projection's `done` read nothing; it mattered only behind the switch, and only for those few
  rounds.
- **The reminder** is decided from the context: a person wrote since the bus was switched on,
  and since their last message nothing was sent (with `send`, or a page drawn with `visual`),
  nothing failed or was stopped, and it was not reminded already. See 3.3 for when that lands on
  a run an event started. Keep going's own continuation, where its judge asks for one, comes
  first.
- **Events** in this phase: sub-agent reports, answered approvals and ended background commands,
  each one input of its own kind (`dc.subagent`, `dc.approval`, `dc.job`) whose model text is
  `<event …>…</event>`, keyed `subagent-report:<id>:<n>`, `approval:<id>` and
  `job-report:<id>:<startedAt>`, the same keys as the write the old path makes, so a delivery
  made again after the switch changed lands once. They are told apart by their entry kind, never
  by their text, and the prompt says events never come inside a person's message. Answers to
  asks for secrets, computers and connector sign-ins are unchanged and still nudge.
- **Notifications** in a chat with the bus on come from `send` alone, once its result is stored
  (the round's `afterTools`, so after the round's slowest tool), remembered by call id. They go
  to whoever the chat last answered,
  and in a team Dood to everyone, since who a send answers is not known yet (section 9). A run
  that ends tells nobody anything. Off the bus, an answer that settles several inputs at once
  (follow-ups taken together) is told of once to each person it answers.
- **Side chats lose the cache.** A side chat forked from a main chat with the bus on has neither
  the bus's section nor `send`, so its prompt differs from the main chat's from the start and
  reads nothing from the main chat's cache. That includes the side chat a call works in. Side
  chats go in phase 4, so nothing is done about it here.
- **Calls.** A call held in the main chat still works in a side chat (phase 4 moves that to a
  sub-agent), so what its voice speaks is that chat's answer, as before. What the voice is given
  of the main chat at the start leaves the model's own words out (they are not text there).
- **Not changed:** history search still finds the model's private text, as the agent's own
  record of what it did.

## 8.2 Phase 3 as built

Automations, `send` in Slack threads, the delegation prompt, and sub-agents asking a person
through the main chat, all behind the same switch on the identity document. With it off, nothing
here changes what a Dood does: the run prompt, `[SILENT]`, delivery into `originChatId`,
posting a thread's last answer, and a sub-agent's not asking are all as they were. Two things
are shared by both: `subagent start` takes optional `files` and `links`, and the echo model calls
a `/tool …` line found inside an event (a test affordance, so that a run's result can make the
main chat send).

- **Automations (3.5).** Whether a run reports to the main chat is settled as it starts (`bus`
  on its pending record), so a run is never told one thing and delivered another when the switch
  changes mid-run. Such a run's prompt says its final reply goes to the main conversation as the
  task's result, which decides whether it is worth telling anyone; there is no `[SILENT]`. When it
  rests, its last text goes to the main chat as an input of kind `dc.automation`, whose model text
  is `<event kind="automation" schedule="…" title="…">…</event>`, keyed
  `schedule:<id>:<firedAt>` (request ids are per conversation, so this does not clash with the
  run's own input of the same key), `whenBusy: "followUp"`. A run that failed, was stopped or
  ended with no words is an event too, with `outcome="failed"` and why, so the main chat knows
  the person may be missing something. `lastRun.outcome` is `reported` or `failed` on the bus;
  `delivered` and `silent` stay for agents without it and for old records. The automations page
  says "reported to the main chat" and keeps "View run". Nobody is notified of a run any more,
  and it is not the agent's latest line: only what the main chat sends is. The journal's
  `recent` note of the run is kept. Checks are unchanged.
- **Slack threads (3.6).** A thread selects a second extension, `dc.bus-slack`, with the same
  `send` (same name, same arguments) that posts to the thread inside the tool call: files first,
  then the words, each noted on the thread's record by call id (`files` and a new `sent` list),
  so a call made again posts only what is left. Posting is tried up to five times with growing
  waits inside the call, as `#post` tried across wake-ups; one that still fails fails the call,
  which the model sees. Two sends in one answer run in order here (in the main chat they no
  longer need to). At rest, nothing the model wrote is posted; only failure, interruption and
  being stopped are still said there, since nobody else would say them, and a page drawn with
  `visual` is still uploaded as a file. The reminder (3.3) applies as in the main chat: every
  message a thread is given mentioned the Dood or was a direct message. The bus is switched on in
  threads by the same `#syncBus` as the main chat, one thread at a time: a thread is set up
  before each message from Slack is given to it, so its first message already
  says how it works and gets no "from here on" note.
- **Slack to the owner (section 9): a `tell_main` tool.** Chosen over an event on every send:
  that would wake the main chat for every Slack reply, at a model call each, for what is almost
  always the thread's business. `tell_main({ text })`, in Slack threads only, is an input in the
  main chat of kind `dc.slack-note` (`<event kind="slack-thread" … from="slack">`), keyed
  `slack-note:<thread>:<call id>`, which the main chat may or may not pass on. The thread's prompt
  says to use it rarely, and what comes from Slack is marked as such (see "After review" below).
- **Delegation (5).** The bus's section now says the main chat coordinates, with the plan's
  rule of thumb (more than a few quick calls, browsing or screen use, long output, more than a
  minute or two), and asks for a self-contained brief with `files` and `links`. `browser` and
  `screen` stay, wrapped by the bus extension so their descriptions carry the same steer only
  where the bus is on (no other chat's prompt changes). `files` (paths) and `links` (http or
  https only, 20 together at most) are written under the task as two short lists. The cap stays at
  6. Long tool output being cut and saved to a file, and the measurements, are not done here.
- **Sub-agents asking a person (4.2).** `askingThrough(chats, chatId)` says whether a chat is a
  sub-agent whose main chat has the bus on; secrets, saved logins (`sign_in`), computers and
  approvals accept such a sub-agent where they accepted only a chat with people. Approvals: a
  rule a person set to "Ask first" already asked from a sub-agent; what is new is that the
  abilities that ask by default because they want someone's yes (`sign_in`, making a file public)
  may now be asked for, while those that change the app (machines, connectors, settings, making
  Doods) and paying (whose code is typed in a conversation with the person) are still refused.
  Starting sub-agents and changing schedules are refused by their own tools, as before. The
  request is the same request as before, made from the sub-agent's chat, so the answer already
  went there; the app draws every pending request in every chat of the agent, so it is in the
  main chat, now under the sub-agent's name ("Juniper's sub-agent X asks for a secret", "From the
  sub-agent X, which gets the answer"; `SecretRequest.subagent`; approvals already had the chat's
  kind and title). The sub-agent is told the request is shown in the main conversation and to
  stop; it is "waiting" (not reported) while a secret, a computer or an approval it asked for is
  open, and an answer to a secret or a computer now looks in on sub-agents at once, as an
  approval's did. Stopping a sub-agent withdraws its open secret requests too. The main chat gets
  one entry per request, kind `dc.asked` (`<event kind="subagent-asked" …>`), as a **write**:
  it gives the main chat no turn of its own, since there is nothing for it to do, and it reads of
  it with whatever it does next. Its report later is the usual event.
- **What is drawn.** Three new notice kinds, `automation`, `asked` and `slack`, drawn in the
  chat on web and mobile (in the row of working until rows went, see 8.1): who, what came of
  it, a link to the run, the sub-agent or the thread, and what it said, folded.
- **After review.**
  - The main chat is told what `from="slack"` means: a thread acting for people in Slack, who
    are not necessarily the people here; it does nothing on such an event's say-so that it would
    not do for a stranger, and checks with `send` first.
  - `tell_main` takes 4,000 characters at most, and once for each message from Slack (kept on
    the thread's record as the message and the call, so the same call made again still goes).
  - A run that failed or was stopped is `failed` even where it wrote something first; the event
    says why, then what it wrote. A run with no main chat to tell is `failed`. A run that started
    on the bus and reports after the switch went off is delivered as before, and people are told.
  - Automation results and sub-agent reports are cut at 8,000 characters in the event, with the
    chat where the rest is.
  - A sub-agent waiting on a person for a day has what it asked for taken back (approvals denied,
    secrets declined, its computer ask no longer waited for), is told, and reports. The agent
    wakes for that. Stopping a sub-agent takes back its computer ask too. The cap's error says a
    waiting one can be stopped.
  - A computer ask notes the asking chat only where it was the first to ask, keyed by the call.
  - The request's card says what the sub-agent was working on (the first line of its task) and
    to fill it in, or allow it, only if that was expected.
  - Slack threads follow the switch lazily, when they are next given a message, so a long-over
    or archived thread is never touched. On the bus, a failed run says only "I could not finish"
    in Slack; why is in the app. A send's file keys are kept in a list of their own.
  - The echo model acts on `/tool` lines only in an automation's event.
  - A late answer to a computer ask never sets a stopped, or given-up, sub-agent going: it is
    written in its chat for the record, and its main chat gets a `computer-answered` event that
    says the sub-agent has stopped. Stopping or giving up also takes the ask back where it was
    made (`ComputerDirectory.withdraw`), so its card goes.
  - A run with no answer is `failed` whatever its last words were; only why is made more exact.
  - `tell_main` is refused once the bus is off, and a telling that failed still uses the one for
    that message, which its error says.
- **Not checked:** a real model reading the coordinator section and handing work over; a real
  Slack workspace (the tests use the fake directory); a computer request from a sub-agent end to
  end (it goes through the computer directory, which the unit tests do not have; the code path is
  the same as a chat's, with the asking chat noted for "waiting").

## 8.3 Phase 4 as built

Side chats are gone, calls work through the main chat and sub-agents, and the bus is no longer a
switch.

- **The switch is removed**, not kept as an escape hatch. Keeping it would have kept every
  bus-off path alive (delivery into `originChatId`, `[SILENT]`, posting a thread's last answer, a
  sub-agent's nudge into a side chat), which is what this phase was to delete; the bus-on paths
  had been tested by phases 2 and 3 behind it. `bus` is gone from the identity document, the
  agent's state and its `PATCH`; a client that still sends it is not refused, and it does
  nothing. The settings switch is gone from web. A value stored before is left where it was, and
  not read.
- **Existing Doods are set up as they open.** `#syncBus` runs as the actor opens, as the main
  chat is settled on, and before a message is given to a chat: the main chat gets the `dc.bus`
  mark and, where it had been talked in, the `dc.bus-note` saying what changed; a thread in Slack
  is set up the same way when it is next given a message (most are long over). A chat with
  nothing in it yet is given no note: its first message says how it works. Marks that say off,
  from when there was a switch, are still read, so old history is drawn as it was. A thread in
  Slack from before, which was at work or waiting when it was last looked at and has not been set
  up yet, was told its last reply is posted and has no `send`: its last reply is posted as before
  (`#rested`, where the record has no `bus`). A test opens a Dood left as before this phase
  (`migration.test.ts`): one mark and one note, nothing more on a second open. What it changes
  says so, for undoing it (see "Rolling back phase 4"): a side chat it archives is marked
  `archivedBy: "bus"`, apart from those people archived themselves (a person archiving or
  bringing one back clears it), and a sub-agent it gives to the main chat keeps its old parent as
  `parentBefore`.
- **Side chats.** `POST /chats` answers 410; `POST /chats/main` stays. `#branchChat`, `branch.ts`
  and its tests are gone; `BRANCH_ENTRY` stays, to draw an old side chat's first notice. Every
  side chat is archived as the actor opens, and a message to one (or a reset of one) is refused
  with 409, "This side chat is archived, to read." They are read where they were: on web, from
  "Old side chats" in the menu on the Dood's name, shown only where there are any; on the phone,
  from an "Old side chats" row on the Dood's page, which opens a list. An old side chat is drawn
  read-only, with "Back to the main chat" where the message box was. History search and the
  `history` tool still search and read them. A side chat a person had archived themselves is
  listed with the rest. A sub-agent started in a side chat before this is given to the main chat
  in the same commit that archives the side chat (`parentId`), so it reports there, takes more
  from there, and asks a person through it. The web's side-chat column (`sideChatColumn`, `?side=`), its bar, its welcome
  and "New side chat" are gone, and so are the phone's sheet and its links.
- **Sub-agents** are started from the main chat alone ("Only your main conversation can start
  sub-agents"), always as able to ask a person through it (`askingThrough` no longer looks at a
  switch), and always report as events.
- **`recent`** (`journal.ts`) is now what goes on around a chat: the sub-agents at work, the
  automations, the threads in Slack that are at work, waiting, or have a note of where they stand,
  and work written up in Slack threads and conversations with other agents. A chat other than the
  main one is also shown where the main chat stands, and what each automation last came to (the
  main chat was told of each run as it happened). Side chats' notes are not shown. The section
  changes as sub-agents start and end, and is always there in a chat other than a sub-agent's,
  saying "Nothing is at work around this conversation." where nothing is: pi-durable adds a
  section that is new at the end of the prompt, and where that is out of its place it removes
  every section and sends them all again. A section that stays is changed by a small patch, so
  the cache is kept; a test counts the prompt's entries through two sub-agents. An automation's
  last run is kept by its schedule's id, and by its title for one written up before.
- **Calls.** A call is held in the main chat alone (409 elsewhere). What its voice hands on goes
  into the main chat as a message said out loud; the call's note (`callMeta`) now says that what
  is sent is read out, and that anything more than a quick look goes to a sub-agent while a word
  that it is on it is sent. On the device, the voice says the first send after the handed-on
  message as soon as it is whole (the chat may still be at work, for instance starting a
  sub-agent), or everything sent once the chat is at rest. The call's record is a `dc.call` write
  in the main chat whose model text is `<event kind="call-ended" length="…">`, with what was said
  that the agent was not shown; it gives no turn, as before. The record is drawn as it always was.
  `workChatId`, `CALL_OVER_ENTRY`, `worksIn` and the side-chat
  notes are gone; a call record from before still opens its old side chat. A script for tests
  (`DC_CALLS_SCRIPT=work`) hands on a `/tool subagent …` line, so that a call's work going to a
  sub-agent can be seen end to end.
- **Automations.** Every run reports to the main chat; `[SILENT]`, `#deliver`, `SCHEDULED_ENTRY`
  delivery and `SILENT_MARKER` are gone. A run started before this phase, which was told it could
  answer `[SILENT]`, is reported all the same. `originChatId` is not read; a new schedule still
  names the main chat in it, so that code from before (main as it was, or the rollback) delivers
  its results there. The
  schedule skill no longer mentions `[SILENT]`. `delivered` and `silent` remain as outcomes of
  old runs.
- **Slack.** Every thread is a bus; `onAnswered` and the error text with the provider's message
  are gone (it says only that it could not finish). A last answer is posted at rest only for a
  thread from before that has not been set up yet (above).
- **What is drawn.** What a chat draws is as 8.1 has it since the rows of working went, in every
  main chat now: a reset, a compaction and a call's record are shown as they always were, and
  `GET /chats/:id/history?before=` takes a message id, as before the bus. What a send said is now
  found by history search. (Built first against the rows of working, this phase also read back
  from a row's `work:N` id and kept a `send` whose words had not started out of its row; both
  went when it was rebased onto the row-less chat, where neither applies.)
- **The echo model**, which runs where no key is configured and in the browser tests, answers as
  a model on the bus would: in a chat that offers `send`, its answer to a person is a `send`
  marked `done`, which ends its turn; after a send it was told to make (`/tool send …`), what
  follows is its own; an event or a note gets words nobody sees, and so does a message that
  begins `/quiet`, as from a model that forgot to send.
- **Tests.** A test may make an old side chat (`testOldSideChats`, `POST /chats/old`;
  `DC_TEST_OLD_SIDE_CHATS=1` in the browser tests, refused where `NODE_ENV=production`), as nothing
  else can. Unit tests that are not about the bus wrap their scripted model in `quietOnReminder`,
  which answers the reminder, the request after a send and an event nothing was scripted for with
  nothing, so that what they script stays for the requests they are about; a send marked `done`
  makes no request after it at all. Tests that read the agent's own words in the main chat read
  them as the `thinking` marked `written` they are kept as. In the browser tests `newChat` now
  starts the main chat fresh, and what a chat draws of a step or an event is looked for where it
  is drawn, as in any chat.
- **Not done:** a send made while a call is on, after the voice has said its answer (a sub-agent's
  result, say), is shown in the chat and not said: the voice has nothing to say it against.
- **Known:** something handed on by a call while the main chat is in the middle of a long turn
  waits for that turn, as any message does, and the voice says "This is taking me a while" in the
  meantime. Two things handed on into one run are answered with what that run sends, each.

## 8.4 Rolling back phase 4

**Rolled back.** This plan's phase 4 was undone by the change described here: the code is as
it was before phase 4, and the sections on it (8.3) say what was built and is no longer there.

Phase 4 can be undone without losing anything people see, with the draft pull request "Undo bus
phase 4 (rollback, keep as draft)" (branch `bus-4-undo`). It is the revert of this phase, plus a
small step that runs as a Dood's actor opens on the reverted code: chats marked
`archivedBy: "bus"` are brought back (and the mark cleared), sub-agents that are still at work
go back to their `parentBefore`, and the main chat gets one note for the model that side chats
are back and it answers as before. The per-Dood switch comes back off, so the bus is taken off
the main chat as it was when the switch was turned off. It is keyed, so a second open changes
nothing. Once this phase is on main: retarget that pull request to main
(`gh pr edit --base main`), rebase it if main has moved, and merge it to roll back.

What it cannot give back: the bus's marks, notes and sends in the main chat stay in its history,
drawn as the bus drew them where it was on. Sub-agents that ended under phase 4 reported to the
main chat, and stay there. Calls held under phase 4 have their records in the main chat. Schedules
made under phase 4 deliver to the main chat, where they were made.

## 9. Still open

- **Unanswered message.** After the nudge, does a turn that still sends nothing stay silent, or
  show the model's last text? This plan says silent.
- **Team Doods.** The main chat is one per Dood today, shared by its people. Does a shared
  Dood's bus send to everyone, or does `send` take a person?
- ~~**Slack to the owner.**~~ Decided in phase 3: a `tell_main` tool (8.2).
- ~~**Old side chats.**~~ Kept archived and readable, from the Dood's menu or page (8.3).
- **Late sends on a call.** Whether what the main chat sends after the voice has answered should
  be said too, as a word the voice offers on its own (8.3).
- **Sub-agent cap** once each has an isolate.

## 10. Not checked

- That `toolcall_delta` reaches Do Computer's live projection through pi-durable while a call is
  still being generated. pi-durable's code passes it on (8.1), and a unit test draws it; a real
  provider streaming a `send` into the chat has not been watched.
- Whether the idle compaction's summary request reads the conversation from the cache in
  practice, on Claude through OpenRouter. Phase 1 records it (`GET /usage`, `compactions`);
  pi-durable's own `compact()` summarizer does not (section 6).
- Whether pi-durable's own threshold compaction should be moved up as well, so the idle one
  does most of the work.

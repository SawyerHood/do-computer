# Forked chats, and joining them back: plan

> **Replaced by `PLAN-main-bus.md`.** A Dood is now talked to in its main chat alone: side chats
> are no longer made (those from before are kept, archived, to read), and sub-agents start fresh
> rather than as forks. Step one below was built and has since been taken out again (phase 4 of
> `PLAN-main-bus.md`, section 8.3); steps two to four will not be built. What follows is kept as
> the record of what was planned and why.

**Status:** a plan, written 2026-10-13 and changed the same day after the owner's answers.
**Step one is built** (section 8): side chats, the session id and the one-hour cache. HANDOFF.md
section 5 item 75 says how, and where the build departed from this plan. Steps two to four are
not built. A background memory is written up as a follow-up and is not part of this work (5.8).
Section 9 lists the choices in here that the owner has not made, and section 10 what has not
been checked.

A Dood is often lost when it works anywhere but its main chat: in a side chat, as a sub-agent,
or when another Dood writes to it. The owner asked whether all of these could start as a fork of
the main chat, and whether what happens in them could come back to the main chat. This plan says
what happens today, what OpenClaw, Hermes Agent and T3 Code do, what pi-durable allows (checked
by running it), what the research says, and what to build.

The short answer: yes to both. pi-durable's fork does everything needed for the first half. It
has no merge, so the second half is built from a write into the parent chat, which is how a
sub-agent's report already arrives.

## 1. What happens today

| Started by             | What the new conversation begins with                                                                                                                          | What reaches the main chat afterwards                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Side chat              | A fork of the main chat, **only if** the main chat's active context is under 60,000 tokens and the Dood has answered there. Otherwise empty.                   | A note of at most 60 words in the `recent` section of the prompt, written by a small model, and anything written up with the `log` tool. |
| Sub-agent              | Empty. The task text (8,000 characters at most) and a preamble. The prompt has the Dood's notes and skills, and no `recent` section.                           | Its last answer, written into the chat that started it as a `dc.subagent` entry, and a turn.                                             |
| Another Dood's message | On the receiver: an empty chat of kind `agent`, one for each chat of the sender's. The message (20,000 characters at most). The prompt has notes and `recent`. | To the sender's chat: each answer as a `dc.agent` entry, and a turn. To the receiver's own main chat: the 60-word note only.             |
| Slack thread           | Empty, one chat a thread.                                                                                                                                      | The 60-word note.                                                                                                                        |
| Scheduled run          | Empty, one chat a run.                                                                                                                                         | Its report, in the chat the schedule was made in.                                                                                        |

(`#branchChat` in `packages/agent/src/actor.ts`, `subagents.ts`, `peers.ts`, `slack.ts`,
`schedules.ts`, `journal.ts`.)

### Why a side chat is lost even though it "forks"

The 60,000-token limit is the likely cause. The app leaves pi-durable's compaction settings at
their defaults: a chat is summarized when it comes within 16,384 tokens of the model's window,
and 20,000 tokens of recent messages are kept. So a main chat in long use holds a summary and
about 20,000 tokens just after a compaction, and grows from there to nearly the whole window
before the next one.

- On a model with a 200,000-token window, the main chat is under 60,000 tokens for about a
  quarter of each cycle.
- On a model with a 1,000,000-token window, for about 4% of it.

The rest of the time a new side chat starts empty, and nothing on the screen says so. This is
arithmetic from the constants, not a measurement: the chats of real Doods are in their Durable
Objects and were not read.

## 2. What others do

|                  | A sub-agent starts with                                                                                                                                                                                                                                                                                                                             | What comes back                                                                                                                                                                    | Fork                                                                                                                                  | Merge back                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenClaw**     | `sessions_spawn` takes `context: "isolated" \| "fork"`. Isolated is the default, fork for spawns bound to a thread. A fork "branches the requester's current transcript into the child session, including the in-progress user turn". The task is a user message after the inherited history, which is marked as background and not the assignment. | The child's whole last answer, a status the runtime works out, and the path of its transcript. The parent gets a turn. If the parent is busy it is steered, else the result waits. | Also "Fork conversation" and "Fork from here" in the UI, and `/btw` for one question on a snapshot that writes nothing back.          | None.                                                                                                                                               |
| **Hermes Agent** | Nothing: the docs have a heading "Subagents Know Nothing", and the child is given a `goal` and a `context` string. A fork mode is an open proposal (PR #123687, issue #130829).                                                                                                                                                                     | A summary of at most 24,000 characters, as a new message between turns.                                                                                                            | `/branch` copies the whole history into a new session and reuses the parent's exact system prompt so the provider's cache stays warm. | None.                                                                                                                                               |
| **Claude Code**  | Either: a fresh sub-agent with a brief, or a fork with "the entire conversation so far". Its docs say to fork when a sub-agent "would need too much background". A fork cannot start forks.                                                                                                                                                         | "Only its final result comes back."                                                                                                                                                | The fork's first request reuses the parent's prompt cache.                                                                            | None.                                                                                                                                               |
| **T3 Code**      | A relationship to its parent and a source point.                                                                                                                                                                                                                                                                                                    | A "subagent result" transfer.                                                                                                                                                      | A fork is recorded at once and its context is worked out at the first message.                                                        | **Yes:** the difference between the fork point and the fork's latest stable point is put into the source thread with the user's next message there. |

Three things worth taking:

- **OpenClaw falls back the way we do, and it is the same weakness.** A fork over 100,000 tokens
  silently starts isolated. Its issue tracker has both complaints: sub-agents lacking context
  (#24852, #39157) and context too heavy (#68767).
- **Nobody merges transcripts.** Where anything comes back it is a result and a pointer to the
  transcript. T3 Code's merge-back is the same idea made general: only what was added since the
  fork point.
- **Both keep a fork's prompt identical to its parent's** where they can, for the cache.

For several chats of one Dood, OpenClaw shares workspace files and, since recently, a retrieval
pass over the Dood's other conversations before a reply. Hermes shares two small note files and
a search over past sessions. Neither shows a chat where the Dood's other chats stand, as this
app's `recent` section has since PR #35.

(OpenClaw at commit `58995cb` and Hermes Agent at `8f81791`, both read on 2026-10-13. T3 Code
from `docs/orchestration-v2/thread-lineage-and-context-transfer.md`. Claude Code from
code.claude.com/docs/en/sub-agents.)

## 3. What pi-durable allows

Read from the package (1.1.0) and checked with two scripts against it, with a scripted model.

| Question                                                                             | Answer                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can a chat be forked from inside a tool call, at the answer that is making the call? | Yes. The fork is given a placeholder result for each open call ("Tool result unavailable: history ends before this…"), so it reads as a whole conversation. This is what a sub-agent needs.                                                                                                                                                                                 |
| Does a fork's first request repeat its parent's prompt exactly?                      | Yes, up to the fork point, byte for byte. A section of the prompt that differs in the fork is added at the end as a patch, not rewritten at the top. So a provider that caches by content reads the carried part from its cache.                                                                                                                                            |
| Can a fork be made smaller without a model call?                                     | Yes. An entry written in the fork can carry `edits` that omit or replace entries it inherited. Replacing one tool result took a fork from 41,209 characters to 1,260. The parent was unchanged.                                                                                                                                                                             |
| Can a fork be summarized without touching its parent?                                | Yes: `compact()` on the fork. The parent's context was unchanged.                                                                                                                                                                                                                                                                                                           |
| Can a fork be forked?                                                                | Yes, and it keeps the edits made in it.                                                                                                                                                                                                                                                                                                                                     |
| Is there a merge, or any way to graft one conversation's entries onto another?       | No. A conversation is one line of entries with a fork point behind it.                                                                                                                                                                                                                                                                                                      |
| What can be written into another conversation?                                       | A `write` submission: one entry, with data for the app and messages for the model. It makes no model call and gives no turn. Sent while the conversation is working, it waits in the inbox and is placed at a boundary: after the answer, in the one-step run that was tried. Sent twice with the same request id, it is written once. A fork made earlier does not see it. |
| Can one Dood fork another Dood's chat?                                               | No. Each Dood has its own storage. A fork is always of the same Dood's chat.                                                                                                                                                                                                                                                                                                |

### Is a fork read from the provider's cache? Tried for real

A chat of about 35,000 to 44,000 tokens was forked on each of the three models do.computer
offers, through OpenRouter, and each answer's own count of tokens read from cache was looked at.
One run a model, two for Muse.

| Model                             | The parent's own second request | A fork                                       | A fork given its parent's session id | Two forks at once                        |
| --------------------------------- | ------------------------------- | -------------------------------------------- | ------------------------------------ | ---------------------------------------- |
| `anthropic/claude-haiku-5.5`      | 100% from cache                 | 100%                                         | 100%                                 | 100% each                                |
| `openai/gpt-6-luna`               | 100%                            | **0%**, and it paid to write the cache again | 100%                                 | 0% each                                  |
| `meta/muse-spark-1.3-contributor` | 0%                              | 0%                                           | 0%                                   | 99% and 100% in one run, 0% in the other |

- **Claude:** a fork is cached, with nothing to do. A fork made after five and a half minutes
  of nothing read 0% from cache and paid to write all 46,000 tokens again: the five-minute
  lifetime is real.
- **OpenAI:** a fork is cached only if it keeps its parent's session id. pi-durable gives a fork
  a new one, and the fork's `init` can put the parent's back (`ProviderDoc`). `gpt-4.1-mini`
  behaved the same way.
- **Muse:** hardly cached at all, the parent included. That is not about forks: on Muse through
  OpenRouter a main chat seems to pay full price for its whole context on most requests. With
  the long cache setting of 6.1 it did cache, and 6.1 says why.

**A chat and its fork under one session id do not push each other out.** The owner asked for
this to be confirmed before the build. A chat and a fork of it, sharing the session id, each
sent three messages in turns and then three at the same moment, each message adding about 3,000
tokens of its own, with the long cache of 6.1 on. On all three models, every one of the twelve
requests left only its own new message unread from the cache: about 3,000 tokens, whether the
prompt was 9,000 tokens or 31,000. Each went on reading the whole of its own history, the part
the other does not share included. One run a model.

**So it can be known before forking.** The parent's last answer says how much of its prompt came
from cache, and when it was. If that answer read from cache and is younger than the cache's
lifetime, a whole fork will be read from cache too. The fork's first answer then confirms it.

## 4. What the research says

The evidence is for forking where the work carries on from the main chat, and against carrying
everything everywhere. Most numbers on memory systems come from vendors grading themselves, and
are marked.

**Sharing context or not.**

- For: Cognition, "Don't Build Multi-Agents" (2025): "Share context, and share full agent
  traces, not just individual messages", because "actions carry implicit decisions, and
  conflicting decisions carry bad results".
- Against: Anthropic's research system (2025) gives each sub-agent a clean context and takes
  back a condensed result, 1,000 to 2,000 tokens in its later write-up. It reports 90% better
  than one agent on its own test at about fifteen times the tokens, and says this suits work
  that does not need a shared context.
- Google's ADK (2025) has both, and warns of a "context explosion".

**Long context makes answers worse.**

- Chroma, "Context Rot" (2025, 18 models): a focused prompt of about 300 tokens beat the full
  113,000 tokens for every model, and one distracting passage lowered accuracy.
- LongMemEval (Wu et al., ICLR 2025, arXiv 2410.10813): reading the whole history of about
  115,000 tokens in place of the relevant sessions cost GPT-4o a drop from 0.870 to 0.606.
- "LLMs Get Lost in Multi-Turn Conversation" (Laban et al., 2025, arXiv 2505.06120): 39% worse
  on average, and a model that goes wrong does not recover.

**Long-term memory.**

- The whole conversation beats a memory system when it fits. In Mem0's own table on LoCoMo
  (arXiv 2504.19413) full context scores 72.9 and Mem0 66.9. Letta reached 74.0 with plain files
  and grep. When it does not fit, focused memory wins (Mastra reports 84.2 against 60.2 at
  115,000 tokens, its own numbers).
- What helps, by LongMemEval: facts pulled out when written and used to find things, and
  searches that know about time. Replacing what was said with summaries generally hurts, so the
  words must stay findable. ChatGPT's memory "tended to overwrite crucial information".
- Letta and the sleep-time compute paper (arXiv 2504.13171) tidy memory in the background, not
  during a reply.
- The benchmarks are weak. An audit found 6.4% of LoCoMo's answer key wrong, and its
  conversations fit in a context window anyway.

**Branching and returning.**

- Context-Folding (arXiv 2510.11967): branch for a sub-task, fold it to a short summary on
  return. 62.0% on BrowseComp-Plus against 52.7% for an agent that summarizes.
- Git Context Controller (arXiv 2508.00031): branch and merge with a written merge record. 77.8
  to 80.2 on SWE-Bench Verified.
- ContextBranch (arXiv 2512.13914): the person picks which messages return. A small gain, on
  thirty made-up cases.
- Amp dropped compaction for a hand-off because summaries of summaries lose too much.

**What goes wrong.**

- ACE (arXiv 2510.04618): one rewrite by a model took a context from 18,282 tokens to 122, and
  accuracy below doing nothing. Its cure is listed changes that are added, never a rewrite.
- "Delivery, Not Storage" (Saha, 2026, arXiv 2607.20972): facts that lived only in the
  conversation were gone after 106 of 108 compactions, and agents hardly ever chose to use
  memory. Facts the harness put in front of the model survived every time.
- MINJA (arXiv 2503.03704): anyone who can talk to an agent can plant records in its memory.
- Anthropic's caching docs: a hit needs an identical prefix, a read costs a tenth, and an entry
  is usable only once the first response has begun.

**What this means here.**

1. Fork side chats: the same Dood and person carrying on related work.
2. Keep the carried context modest and offer a clean start for narrow jobs.
3. Return a bounded account with a pointer to the words, added and never rewritten.
4. Have the app deliver it. Do not rely on the Dood looking it up.
5. Mark where it came from.

The app's 60-word note is rewritten from itself each time a chat rests, which is the pattern ACE
measured collapsing. The join in 5.5 is added to, not rewritten.

Two things the research favours that are outside this plan: lasting notes as dated facts that
can be replaced when they go stale (ours are only ever added to), and a `history` search that
knows about time.

## 5. What to build

### 5.1 One way to begin a conversation

A single `branch` in `actor.ts`, used by everything that starts a conversation for the Dood. It
replaces "fork if under 60,000 tokens, else empty". A branch is never empty, and none of this
needs a model call.

**Whole, when the cache is warm.** This is the owner's decision of 2026-10-13: a cached whole
fork is the ideal, and "warm forks should be whole at any size". `branch` reads the parent's
last answer. If it read its
prompt from cache and is younger than an hour, the fork is plain and whole, whatever its size,
with the parent's session id put back so that OpenAI's and Muse's caches are hit too. The hour
is the cache's lifetime on Claude once 6.1 is on. A
fork that grows to the window is summarized like any chat.

**Cut down, when it is cold or the model does not cache.** Then every carried token is paid for
at full price, so fewer is cheaper. Over 60,000 tokens:

1. **Trimmed.** One entry whose edits replace the tool output and pictures older than the last
   20,000 tokens with a line each ("14,200 characters of output left in the main chat"). What
   the person and the Dood said is kept whole. In most agent transcripts tool output is the
   bulk.
2. **Windowed.** Still over: the same entry also omits the oldest turns, keeping the parent's
   own summary at the top and the newest turns up to 60,000 tokens, with one line where the gap is
   ("38 earlier turns are not here: read chat 12 with `history`").

Section 6 has the sums, and the one case where a warm whole fork is still the dearer choice.

**As built** (`packages/agent/src/branch.ts`), three things differ from the above:

- Warm is: the last answer is under an hour old and by the model the branch will run on, and
  one of the last three answers read or wrote the cache. Not every provider says when it writes.
- There is no line where the gap is. The note at the branch point says that only the most
  recent part is above and which chat has the rest.
- A line that stands for tool output says to use the tool again, not to read it with
  `history`, which does not show tool output.

What the branch is told at the branch point, once, depends on what it is for. All three say
that everything above is background and where the user is.

### 5.2 Side chats

Use `branch`. A side chat is then never empty unless the main chat is. The marker says what it
got: "Continues from the main chat", or "…with older tool output left behind", or "…from its
most recent part".

### 5.3 Sub-agents

`subagent start` forks the chat that started it, at the answer making the call. The task follows
as a message, with the preamble changed to say: the conversation above is where this task came
from; it is background; do this task only; the user is not here.

The tool gains `context: "fork" | "fresh"`, fork being the default. Fresh is for bulk work that
needs none of the conversation, such as reading six files and summarizing each.

Reports come back as they do now.

### 5.4 One Dood writing to another

The receiver's conversation forks **the receiver's own main chat**, so it answers knowing what
it has been doing for its people. It cannot carry the sender's chat (section 3), so the `agents`
tool's description says plainly that the other Dood has seen none of this conversation.

A conversation with another Dood can go on for days, and its fork point goes stale. See 5.6.

### 5.5 Joining back

A **join** is an entry of kind `dc.join` written into the parent chat: data for the app (which
chat, its title, how far it had got) and a message for the model. It is keyed by the chat and
how far it had got, so it is never written twice. Joins are only ever added: an earlier one is
not rewritten or removed, which would also throw away the main chat's cached prompt from that
point on. The main chat's own compaction folds old ones in time.

A join goes one level up, to the chat the branch came from. A sub-agent started in a side chat
reports to the side chat, and the side chat joins the main chat.

**What it says.** Only what was added since the fork point or the last join, the way T3 Code
does it:

- Where the branch's own words since then are short (under about 1,500 tokens, counting what the
  person and the Dood said and not tool output), they are carried as they are. Nothing is lost
  and no model is called.
- Otherwise a digest, written by the small model that already writes the 60-word note, in the
  same call: a list of what was asked, what was decided, what was done (files, library pages,
  schedules, messages sent), what was learned, what is still open. 300 words at most. It is
  written from the branch's own entries, never from an earlier digest. It ends with the chat's
  id, so the Dood can read the words with `history`.

It is worded as the `recent` section is: notes of what happened, not instructions. It says
where it came from, and one from a conversation with another Dood says so.

**When.**

| Branch                                            | Join                                                                                                                                                                                       | Turn in the parent                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Side chat                                         | When it has come to rest and been quiet for two minutes, or when the main chat next takes a message, whichever is first. Also at once, from a "Send to main chat" button in the side chat. | No. The person is in the side chat and is not waiting on the main one. |
| Sub-agent                                         | As now: its report when it comes to rest.                                                                                                                                                  | Yes, as now.                                                           |
| A conversation with another Dood, on the receiver | When it comes to rest.                                                                                                                                                                     | No.                                                                    |
| Slack thread, scheduled run                       | Not in this plan.                                                                                                                                                                          |                                                                        |

In the main chat, a branch that joins is left out of the `recent` section, so it is not said
twice. Every other chat still sees the notes.

### 5.6 Later, and only if wanted

- **Catching up.** The same thing the other way: a long-lived branch is given what the main chat
  added since its fork point, at its next message.
- **Scheduled runs** forking the main chat. Each run would then pay for the carried context
  with a cold cache.
- **A brief from the sender** when one Dood writes to another: the last few messages of the
  sender's chat, attached without the model having to restate them.

### 5.7 Slack threads stay as they are

A Slack thread can have people in it who are not the Dood's own. Forking the main chat there
would put what the owner said in private in front of a model that is answering them.

### 5.8 A background memory that does more: a follow-up, not part of this work

The owner asked on 2026-10-13 whether a more aggressive memory, kept up in the background by a
cheap model, would help, and then said it "should be a follow-up sort of thing. Maybe we don't
do it yet." It is written down here so that it is not lost. It is the other half of this plan
and not a rival to it.
A fork carries the recent main chat. It cannot carry last month, a Slack thread, a scheduled
run, or what a compaction summarized away. Memory is what covers those.

**What there is.** A small model already runs each time a chat comes to rest
(`journal.ts`). It rewrites one note of 60 words a chat, and may add one fact to each of the
Dood's two stores of lasting notes. It never changes or removes a fact. So the notes fill (6,000
and 4,000 characters) and go stale, and the 60-word note is rewritten from itself, which loses
things (ACE, section 4).

**What to change, in three parts.**

1. **A log of dated observations, only ever added to.** Each time a chat rests, the small model
   writes down what was added since it last looked: what was asked, decided, done, learned, left
   open. Each line has its date and its chat. Every kind of chat feeds it. The newest lines are
   in every chat's prompt in place of the 60-word notes, and all of it is searched by `history`.
   Mastra's design is this, and LongMemEval found facts pulled out at writing time help. The
   join of 5.5 is the same writing put into the main chat, so they are one piece of work.
2. **Tidying while the Dood is idle.** Once a day, or after so many observations, the small
   model proposes changes to the lasting notes as a list: add this line, replace that line with
   this, drop that line as out of date. Code applies them, with limits. The model never rewrites
   the notes whole. This is Letta's sleep-time idea, and it is what lets a note be corrected.
3. **Nothing lost at a compaction.** The observations for a stretch are written before it is
   summarized, and waited for. Today the review is started and not waited for.

**What it would cost.** The call is already made at every rest. It reads at most 9,000
characters of what was said, on a small model. The daily tidying is one more call a Dood a day.

**What to be careful of.**

- A cheap model gets things wrong, and a wrong line in memory misleads every chat after it.
  Lines stay dated and marked with their chat, are worded as notes and not instructions, and the
  words themselves stay searchable.
- Something planted by a web page or another Dood can end up in memory. Lines from a
  conversation with another Dood, or from Slack, say so, and tidying does not promote them to
  the lasting notes without the Dood's people having said the same.
- Memory is not a replacement for carrying context. Where the conversation fits, the
  conversation beats every memory system measured (section 4).

Nobody has looked at what the small model writes today for real chats. That comes first: a
handful of real transcripts, read against their notes.

## 6. What it costs

Carrying context costs input tokens on every request in the branch. These are sums, not a price
list: a model at $3 a million input tokens, cached input at a tenth of that, and writing to the
cache at 1.25 times the input price, which are Anthropic's rates for a five-minute cache.

For a main chat of 150,000 tokens, what the carried context costs a branch:

|                           | First request | Each later one | 5 requests | 30 requests |
| ------------------------- | ------------- | -------------- | ---------- | ----------- |
| Whole, cache warm         | $0.05         | $0.05          | $0.23      | $1.35       |
| Cut down to 60,000 tokens | $0.23         | $0.02          | $0.30      | $0.75       |
| Whole, cache cold         | $0.56         | $0.05          | $0.74      | $1.87       |

- **The owner is right for a side chat.** Warm and whole is the cheapest for the first seven
  requests or so at this size, and for the first seventeen from a main chat of 100,000 tokens.
  It also loses nothing.
- **A long sub-agent is the exception.** At thirty steps the cut-down fork is cheaper even with
  a warm cache, because the carried context is read again at every step. That, and work that
  needs none of the conversation, is what `context: "fresh"` is for.
- **Cold and whole is the dearest** at any length, which is why a cold branch is cut down.
- **A pause costs the whole context again.** Anthropic's cache lasts five minutes by default.
  A person who answers after six pays to write it all back: $0.56 for 150,000 tokens, $0.23 for
  60,000. The main chat pays this today. See 6.1 for the one-hour cache.
- **OpenAI's models cost more to read from cache** than these sums assume: a quarter or a half
  of the input price through OpenRouter, by its docs, not a tenth. A whole fork there stops
  being the cheaper choice sooner.

Sub-agents started together in one answer all read the cache their parent's last request left,
so they do not wait on each other. Seen on Claude (section 3).

The join costs nothing new: the small model is already called each time a chat comes to rest.

### 6.1 The one-hour cache on Claude

The owner asked on 2026-10-13 whether it can be set and whether it makes a difference. Both
yes, and the owner then decided: "let's do the one hour cache as part of step one".

**It is one setting.** pi-durable takes `settings.stream.cacheRetention`, and the app passes
none (`actor.ts`, where the harness is opened). Set to `"long"`, pi-ai asks Claude for a
one-hour lifetime. It is for the whole harness, so it also reaches the other models, where
pi-ai asks for 24-hour retention in its place. What that did is at the end of this section.

**Tried on `anthropic/claude-haiku-5.5` through OpenRouter.** The same test as in section 3,
with five and a half minutes of nothing before one last fork:

|                          | Fork after 330 seconds of nothing              |
| ------------------------ | ---------------------------------------------- |
| Default cache            | 0% from cache, all 46,000 tokens written again |
| `cacheRetention: "long"` | 100% from cache                                |

**What it costs.** Reading is the same, a tenth of the input price. Writing is twice the input
price in place of 1.25 times. Each read renews the hour at no charge. For a chat of 150,000
tokens on the sums above:

|                                           | Five-minute cache | One-hour cache |
| ----------------------------------------- | ----------------- | -------------- |
| A reply within five minutes               | $0.05             | $0.05          |
| A reply after ten minutes                 | $0.56             | $0.05          |
| A reply after two hours                   | $0.56             | $0.90          |
| Every 10,000 new tokens the chat grows by | $0.04             | $0.06          |

It pays when pauses of five minutes to an hour are common next to pauses of over an hour: each
of the first saves $0.52 here and each of the second costs $0.34 more. A person talking to a
Dood pauses for ten minutes all the time, so it very likely pays. That is a judgment: how real
chats pause was not measured. It could be, since every answer already records how much it read
from cache and when.

**For forks** it widens "warm" from five minutes to an hour. A side chat opened twenty minutes
after the main chat was last used is then whole and cached, where today it would be cold.

**The other two models, with the setting on.** It is for the whole harness, so the test of
section 3 was run again on them with `"long"`, once each, to see that nothing breaks:

| Model                             | The parent's own second request | A fork | A fork given its parent's session id |
| --------------------------------- | ------------------------------- | ------ | ------------------------------------ |
| `openai/gpt-6-luna`               | 100% from cache                 | 0%     | 100%                                 |
| `meta/muse-spark-1.3-contributor` | **99%**                         | 0%     | **100%**                             |

- **Nothing broke.** GPT behaves as it did.
- **Muse now caches.** Without the setting it read from cache on 2 requests of 12. The reason is
  in pi-ai: through OpenRouter it sends the cache key (the session id) only when retention is
  `"long"`. So the setting may cut what a main chat on Muse costs, forks or no forks. Seen
  once.
- **On both, a fork still needs its parent's session id.**
- How long the cache then lasts on these two was not tried. pi-ai asks for 24 hours.

### 6.2 Subscriptions

The owner asked whether signing in with a subscription changes the sums.

**Who pays depends on where the model comes from.**

- **The deployment's key** (what "Included" is on do.computer): the owner pays by the token.
  Every sum above applies as written. On Muse, which is the first model named and hardly
  caches, a fork is always cold and so always cut down.
- **A workspace's own key:** the same sums, on their bill.
- **A workspace's subscription** (ChatGPT, Claude Pro or Max, Copilot): nothing is paid by the
  token. What a fork spends is the plan's allowance, and what it costs is reaching the limit
  sooner.

**The shape stays the same.** Both providers count cached input for less against a plan, as
they do in money:

- OpenAI's rate card for Codex counts cached input at a tenth of the credits of fresh input
  (from a search's summary of OpenAI's help page, which would not open here).
- Anthropic publishes no formula. Its help page is reported to say cached content counts less
  (the page would not open here either).

So nothing in 5.1 changes. A warm whole fork is still the cheap one, and a cold one still the
dear one. Two differences: a long sub-agent costs allowance and not money, and no premium for
writing the cache is known on a plan.

None of this was run with a real subscription. Whether a fork is read from cache on a ChatGPT
sign-in, with its parent's session id kept, is unseen.

## 7. What can go wrong

- **A branch carries on the parent's work** in place of its own task. The note at the branch
  point is the guard, and OpenClaw's wording is the model for it. To be tried against a real
  model before it is trusted.
- **Too much context makes answers worse**, not only dearer (section 4). A whole fork is no
  longer than the main chat's own next turn would be, so a side chat is no worse off than the
  main chat is. A sub-agent on a narrow job is, and `fresh` is for that.
- **A digest drifts from what was said.** Each join is written from the branch's own entries,
  never from an earlier digest, and short branches are carried in their own words.
- **The main chat fills with joins.** Each is 300 words at most, and a busy side chat joins
  once each time it goes quiet, not after every answer.
- **Something untrusted reaches the main chat through a join**: a web page read in a side chat,
  or what another Dood wrote. The join is the Dood's account of it, marked as notes and not
  instructions, as `recent` is. The small model still does not add to the Dood's lasting notes
  from a conversation with another Dood.
- **A join lands in the middle of something.** A write sent while a chat is working waits and
  is placed at a boundary. Where exactly in a run of many steps was not tried (section 10).

## 8. Order of work

1. **Whole forks for side chats.** `branch`: whole when the cache is warm, cut down when it is
   not, the parent's session id kept, the marker's wording. No new screens. This alone may fix
   most of what the owner is seeing in side chats. The one-hour cache (6.1) is part of it, by
   the owner's decision: one setting, for every chat and not only forks.
2. **Sub-agents and Dood-to-Dood conversations fork.** The `context` parameter, the three
   notes, the tool descriptions. Tried with a real model for the first risk in section 7.
3. **Joins** (5.5). The digest in the journal's existing call, the `dc.join` entry, its marker
   in the web app and on the phone, the button. A mock-up first: the marker in the main chat
   and the button are the only new things a person sees.
4. **Whatever of 5.6 is wanted.**

Not in this work: the background memory of 5.8.

Each step is its own pull request, with tests against the scripted model the package's tests
already use.

## 9. Choices in here that the owner has not made

The owner's, said on 2026-10-13: fork the main chat for all of these; a cached whole fork is the
ideal, and a warm fork is whole at any size; the one-hour cache is part of step one; what
happens in a branch should come back; a more aggressive memory kept up in the background by a
cheap model is a follow-up, not yet.

Mine:

- Every number: the 60,000 tokens a cold branch is cut down to (kept from PR #35, where it was
  also mine), the 20,000 tokens left untrimmed, the 1,500-token line between a branch's own
  words and a digest, its 300 words, the two quiet minutes.
- That a cold branch is trimmed and windowed without a model call, and not summarized.
  Summarizing the fork works (section 3) and reads better, at the price of a model call over
  the whole context before the first message.
- The shape of the background memory in 5.8, for when it is taken up: a log that is only added
  to, changes to the lasting notes as a list that code applies, once a day.
- That sub-agents fork by default, with `fresh` as the exception. OpenClaw has it the other way
  round.
- That another Dood's message forks the receiver's main chat.
- That a side chat joins by itself, with no switch to keep one out of the main chat.
- That a join from a side chat gives the main chat no turn.
- That Slack threads and scheduled runs are left alone.

## 10. Not checked

- The cache on more than one run a model, on a chat with tools in it, or on a provider reached
  directly and not through OpenRouter. Why Muse so rarely reads from cache.
- Anything with a real subscription. How long the cache lasts on GPT and Muse with the long
  setting, and what writing it costs there. How real chats pause, which decides how much the
  one-hour cache saves.
- What the small model writes today for real chats, and anything of 5.8.
- How real main chats are sized. The quarter and the 4% in section 1 are worked out, not seen.
- An entry carrying edits for hundreds or thousands of entries at once.
- Where a write sent in the middle of a run of many steps is placed: between steps, or after
  the answer.
- Whether a branch stays on its task with the main chat above it. Only a scripted model was
  used.
- Forking on a deployed Worker, which the side chats of PR #35 were never run on either.

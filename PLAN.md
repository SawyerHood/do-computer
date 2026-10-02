# durable-computer: build plan

**Status:** milestone 1 is built, as of 2026-10-02, on the `build/skeleton` branch. Section 0
says what exists, where the build departed from this plan, and what has not been checked against
a real service. The rest of the document is the plan as it was agreed, kept as the record of why.
**Working name:** durable-computer. **License:** MIT.

An open-source, self-hostable, always-on personal agent in the style of Meta Muse. Each agent has a
name, an avatar, a personality, memory and its own computer. It keeps working when the client is
closed, runs schedules, learns skills, and can reach the user's own machines. One codebase deploys
to Cloudflare Workers and to plain Node. Models are called through OpenRouter.

Foundation: [`@earendil-works/pi-durable`](https://earendil.com/posts/pi-durable/) for the durable
agent loop and `@earendil-works/pi-ai` for the model layer.

---

## 0. Where the build stands

### Built and tested on both runtimes

Everything below runs on Node and inside the Workers runtime, with the shared conformance suites
for actor hosts, the app database and sandboxes passing on both.

| Area                | What exists                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime             | One actor host (SQLite, one alarm, blobs, sockets, destroy) over a Durable Object and over a Node process; one app database over D1 and node:sqlite            |
| Agent               | pi-durable harness per agent; many chats; streaming over resumable SSE; steer and follow-up; stop; recovery of an interrupted run by alarm                     |
| Identity and memory | Conversational onboarding; name, tagline, avatar, personality, user profile and memory in documents with caps, mirrored as files in the workspace both ways    |
| History             | Search across every chat, for the agent (a tool) and the user (web); earlier messages behind a summary or a fresh start; starting a chat fresh                 |
| Computer            | just-bash with a durable virtual filesystem; Daytona; Modal; Cloudflare Containers; one interface, one conformance suite                                       |
| Schedules           | Once, interval and cron with time zones; isolated runs; delivery to the chat they were made in; `[SILENT]`; at-most-once firing; survive a restart             |
| Skills              | Bundled, agent-written, installed from GitHub or a URL; stored outside the computer and copied in when loaded; a browsing skill with a headless-browser script |
| Connectors          | Remote MCP servers with a fixed token or OAuth (PKCE, dynamic registration); credentials in a table no tool reads                                              |
| Own computers       | macOS and Linux daemon over an outbound WebSocket; pairing by a code a signed-in user confirms; read-only mode; audit log; revocation                          |
| Approvals           | Opt-in rules per tool, connector or paired computer: allow, ask, never                                                                                         |
| Library             | Files the agent sends and the user uploads, in blob storage, served with headers that keep a browser from running them                                         |
| Web search          | A tool that searches and answers with sources through OpenRouter's web plugin, on the deployment's one key (resolves risk 7)                                   |
| Usage               | Tokens and cost per agent, by model, with scheduled runs called out                                                                                            |
| Accounts            | Better Auth with email and password, Google, GitHub; invite-only sign-up by default; several agents per account; deleting an agent with everything it has      |
| Web                 | Chat, chat list and search, library, automations, skills, connectors, computers, permissions, identity and memory, usage                                       |
| Mobile              | Expo app: sign-in, streaming chat, dictation, library, automations, skills, push registration, approval requests                                               |
| Dictation and push  | Transcription through OpenRouter with the deployment key; notifications through Expo's push service                                                            |

### Where the build departed from the plan

| Plan                                                               | Built instead, and why                                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An in-box CLI calling back to the server with a scoped token (4.5) | Model tools (`schedule`, `skill`, `memory`, `history`, `send_file`). It works on just-bash, which cannot run a CLI, and no token has to live on the computer.                                     |
| Pairing through Better Auth device authorization (4.9)             | A pairing code the daemon prints and a signed-in user confirms, then a token stored only as a hash. Same flow for the user, less machinery, and revocation is one row.                            |
| An "ask" that pauses the task (4.10)                               | The call is refused with an explanation and the answer is sent to the chat, where approval lets the next attempt through. Nothing is held open while the user is away, on either runtime.         |
| Cloudflare Containers saving the workspace directory to R2 (4.4)   | Container snapshots of the whole disk, restored on start and refreshed before they expire. The platform's API changed on 2026-09-30 and now offers this directly; installed packages persist too. |
| Modal restoring a filesystem snapshot (4.4)                        | A Modal volume mounted as the workspace. Simpler, and the workspace survives any way the machine can end.                                                                                         |
| A provider per agent, overriding the deployment's (4.4)            | One provider per deployment (`DC_SANDBOX`).                                                                                                                                                       |
| Drizzle for the app database (section 2)                           | Plain SQL behind a six-method interface. There are five tables besides Better Auth's.                                                                                                             |
| A history index (section 7)                                        | Search reads the transcripts as stored, with a bound on how much one search reads. No index to keep in step on two runtimes.                                                                      |
| The message stream as a TanStack DB collection (4.11)              | Agents and chats are collections; a chat's messages are reduced from its event stream into a jotai atom, which is what a token stream needs.                                                      |

### Security review

An independent read of the server surface found five problems, all fixed with tests:

1. A URL segment such as `__proto__`, used as an id, was looked up in a plain object and written
   through, which on Node changed every object in the process shared by all users. Ids and names
   are now only ever found as an object's own entries, and such segments are refused outright.
2. Request bodies were read whole before any limit applied. They are now counted as they arrive
   and cut off at a limit, with a backstop on the Node server.
3. The agent's record of its paired computers was reachable through the generic proxy. It is now
   among the routes only the gateway may call.
4. An approval rule on one tool did not cover another tool that could do the same thing. Rules are
   now about what happens: commands answer to the rule on changing files, and the memory files
   answer to the rule on changing memory.
5. Fetched skill files and recordings were length-checked only after being read. Same fix as 2.

The review found these sound: the address guard and its redirect handling, where connector
credentials live, how library files are served, shell quoting, blob key encoding, ownership
checks, the sign-in callback, sign-up gating, and the daemon's read-only mode. It could not rule
out one thing from the code alone and judged it impractical: guessing a pairing code (40 bits,
ten minutes) to bind someone else's daemon. A rate limit on confirming codes would close it.

### Not built

- Mobile: managing connectors, permissions and paired computers, and deleting an agent. Those are
  on the web only.
- Archiving stale agent-written skills.
- Usage limits. Usage is recorded and shown; nothing stops spending.

### Checked against the real thing

Run on 2026-10-02 with real keys, on the Node build and inside the Workers runtime:

- **OpenRouter.** Chat with Claude Sonnet 5.5, tool use, onboarding (the agent named itself and
  picked an avatar), memory, web search, a schedule firing on its own and reporting back, history
  search across chats, state surviving a restart, and usage with real costs. Transcription of a
  spoken sentence, as WAV and as the WebM a browser records.
- **Daytona.** The sandbox conformance suite against a real machine; stopping it and coming back
  with its files; the real model writing and running a script on it; file tools and the identity
  files; deleting an agent deleting its machine. `packages/sandbox/test/daytona.live.test.ts`
  repeats the first part for anyone with a key.

Running for real found five bugs the tests had missed, all fixed with tests:

1. A one-off reminder given as a duration ("1m") re-armed itself and repeated.
2. In the built Node server the Daytona SDK could not load what it needs to move files, so every
   file read and write failed while commands worked. The SDKs are now loaded unbundled on Node.
3. That failure was hidden, because a failed write of the identity files was swallowed. It is
   now reported.
4. Tools started in one step could run before the identity files were written.
5. An identity file waiting to be rewritten was read as an edit by the agent, and undid a rename
   made in the same step.

### Still not checked against the real thing

- **Modal.** No Modal credentials were available. It passes the conformance suite against a
  stand-in and was run with the real SDK as far as an invalid token allows.
- **Cloudflare Containers.** Needs a deployed Worker on a paid plan; nothing has been deployed.
  The sandbox object runs in workerd as far as the missing container.
- **A deployed Worker.** The Cloudflare target runs in workerd locally, with real model and
  Daytona calls, but has never been deployed.
- **Native mobile.** The app's screens are tested through its web build. Secure storage, push
  registration, the microphone and the share sheet have not run on a device.
- **Sign-in with Google and GitHub**, which need OAuth apps registered for a public address.
- **A real MCP service.** Connectors are tested against a stand-in with its own sign-in page.

---

## 1. Decisions made with the owner

| Area                    | Decision                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Agent model             | Many agents per user; each agent has its own VM, identity and memory                                  |
| Tenancy                 | Multi-user from day one; a self-hosted install is a deployment with few users                         |
| Relation to do-computer | New codebase; port the proven parts (section 7)                                                       |
| Milestone 1 scope       | Web chat, durable agent, sandbox, schedules, skills, pairing own computers, Expo app                  |
| Channels                | Web and mobile only; define a channel interface, ship no messaging apps                               |
| Approvals               | Full trust by default; approval rules are opt-in                                                      |
| Model keys              | One deployment OpenRouter key; usage recorded, no limits, no user keys                                |
| Connectors              | MCP servers plus agent-written skills                                                                 |
| Memory and identity     | Canonical in the harness store, mirrored into the workspace as files                                  |
| Onboarding              | Conversation only: the agent works out its name, look and personality in chat                         |
| Avatar                  | Bundled preset characters with customization                                                          |
| Computer shape          | Headless Linux with a headless browser; live take-over designed for, built later                      |
| Proactivity             | Schedules only: no heartbeat, no ideas feed, no nightly memory job                                    |
| Skill sources           | Bundled, agent-written, and git or URL installs; no public hub                                        |
| Mobile scope            | Streaming chat, push notifications, voice dictation, files and library, manage automations and skills |
| Sandbox providers       | Daytona, Cloudflare Containers, Modal, plus just-bash as the test and no-VM tier                      |
| Runtime order           | Cloudflare and Node in lockstep, with a shared conformance suite                                      |
| Chats                   | Many chats per agent, sharing memory, skills and computer                                             |
| Node storage            | SQLite only                                                                                           |
| Computer durability     | Workspace directory persists; the system image is disposable                                          |
| Pairable devices        | macOS and Linux daemon                                                                                |
| Sign-in                 | Email and password, Google, GitHub                                                                    |
| Dictation               | Server-side transcription model                                                                       |

## 2. Defaults chosen without asking (veto any of these)

- **One actor per agent**, not per chat. A pi-durable harness runs many conversations, so an agent's
  chats, scheduled runs and subagents share one store and one scheduler.
- **One deployable per target:** a single Worker (TanStack Start plus Durable Objects) or a single
  Node process. do-computer's split into an API Worker and a web Worker is not carried over.
- **Client transport is resumable SSE plus POST.** TanStack Start has no first-class WebSockets and
  SSE works on both targets and in Expo. WebSockets are used only for paired-computer daemons and
  are terminated outside Start.
- **TanStack DB through Query Collections plus our own change feed.** No offline persistence in
  milestone 1 (the persistence adapters are at 0.2.x).
- **Sign-up is gated** by invite or allowlist by default, because a single deployment key with open
  sign-up is unbounded spend.
- **Skills are canonical outside the VM**, like memory, and mirrored to `.agents/skills/`.
- **Scheduled runs follow the same trust setting** as interactive ones.
- **Pairing tokens expire and are revocable.** do-computer's never-expiring token and its single
  static bearer for all accounts are not carried over.
- **Tooling:** pnpm workspaces, TypeScript, vitest, Drizzle for the app database.

## 3. Out of milestone 1

Messaging channels (Telegram and others), Local Docker and E2B providers, Windows daemon, Chrome
extension as a browser, phone as a device, live browser or desktop take-over, heartbeat and ideas
feed, nightly memory review, public skill hubs, usage limits and billing, user-supplied model keys,
teams and organizations, agent-to-agent chat, offline mobile.

---

## 4. Architecture

### 4.1 Runtime interface

No mature library offers one actor, alarm and storage API across Durable Objects and Node, so we
define a narrow one and implement it twice. Sketch:

```ts
// packages/runtime: one implementation for Durable Objects, one for Node
interface AgentHost {
  sql: SqliteDatabase // pi-durable's facade: exec, run, get, all, transaction
  setAlarm(at: number | null): Promise<void> // one next-wake: DO alarm, or a Node timer
  blobs: BlobStore // R2, or a local directory
  connections: ConnectionHub // SSE subscribers and daemon sockets
  now(): number
}
```

| Concern                                   | Cloudflare                          | Node                                         |
| ----------------------------------------- | ----------------------------------- | -------------------------------------------- |
| Agent actor                               | Durable Object per agent            | In-process actor per agent, loaded on demand |
| Agent store                               | Durable Object SQLite               | One SQLite file per agent                    |
| App database (users, agents, auth)        | D1                                  | One SQLite file                              |
| Wake-ups                                  | Durable Object alarm                | Timer, re-armed from the store on boot       |
| Blobs (library, uploads, workspace saves) | R2                                  | Local directory                              |
| Daemon sockets                            | Hibernatable WebSocket in the actor | `ws` on the HTTP server                      |

Every piece that touches this interface lands with both implementations and a conformance test.
Anything importing `cloudflare:workers` sits behind an adapter module so the Node build never sees it.

### 4.2 Agent actor

- Opens a pi-durable `Harness` on its store and calls `resume()` on every wake. Crash recovery is
  pi-durable's: unfinished tasks continue from their last checkpoint; a non-replay-safe tool call
  is reported to the model as interrupted and is not re-run.
- Conversations: user chats, one fresh conversation per scheduled run, and owned child
  conversations for subagents.
- Inbound messages use pi-durable's submit semantics: follow-up by default, steer while busy.
- pi-durable has only `sleep(until)` and no scheduler. The actor computes the earliest of all
  pending sleeps and schedule fire times and sets a single alarm for it.
- pi-durable sits behind a thin adapter. It reached 1.0.0 on 2026-10-01 and is still described as
  experimental; OpenClaw, which started on pi, later moved its loop in-house.

### 4.3 Models

`pi-ai` with OpenRouter as the default and only configured provider. Per-agent model choice from a
curated catalog. Usage (tokens and cost) is recorded per user, agent and conversation from day one
so limits can be added later without a migration. Prompt-cache discipline is carried over from
do-computer: frozen memory snapshot per conversation, byte-stable tool schemas.

### 4.4 The agent's computer

```ts
interface SandboxProvider {
  id: "daytona" | "cloudflare" | "modal" | "just-bash"
  capabilities: { realBinaries: boolean; browser: boolean; nativeDisk: boolean }
  ensure(agent: AgentRef): Promise<SandboxHandle> // create only on a proven not-found
}
interface SandboxHandle {
  exec(
    command: string,
    opts?: { cwd?: string; timeoutMs?: number; stdin?: string },
  ): Promise<ExecResult>
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: Uint8Array): Promise<void>
  saveWorkspace(): Promise<void>
  restoreWorkspace(): Promise<void>
}
```

| Provider              | Cloudflare deployment                    | Node deployment | Workspace persistence                                                           |
| --------------------- | ---------------------------------------- | --------------- | ------------------------------------------------------------------------------- |
| Daytona               | Yes                                      | Yes             | Native disk across stop and start                                               |
| Cloudflare Containers | Yes                                      | No              | As built: snapshots of the whole disk (see section 0)                           |
| Modal                 | No (SDK is gRPC, cannot run in a Worker) | Yes             | As built: a volume mounted as the workspace (see section 0)                     |
| just-bash             | Yes                                      | Yes             | In-memory filesystem persisted to the agent store; no real binaries, no browser |

- The provider is a deployment setting with a per-agent override. Each runtime has one native
  provider plus Daytona as the shared one.
- Only the workspace directory is durable. The agent maintains a setup script in the workspace that
  reinstalls system packages after a fresh start.
- Workspace saves have a single writer, the agent actor. do-computer's backup work took 12
  revisions because separate claim and grant systems did not interact; this design avoids having two.
- The same `exec`/`readFile`/`writeFile` shape serves paired computers (section 4.9).
- Browser: a bundled headless-browser skill (dev-browser, as chosen in do-computer). Not available
  on just-bash.

### 4.5 Tools

- Model tools stay few: bash, read, write, edit, grep, glob, read image, send file. Each takes an
  optional `target` naming a paired computer.
- Everything else is a CLI on the box's PATH (the do-computer `dc` pattern): schedules, memory,
  skills, history, computers, web search. The CLI calls back to the server with a scoped,
  expiring token, so provider keys never enter the box.

### 4.6 Identity and memory

- pi-durable documents hold `soul`, `identity` (name, avatar, tagline), `user` and `memory`. They
  commit atomically with the transcript and are mirrored into the workspace as `SOUL.md`,
  `IDENTITY.md`, `USER.md` and `MEMORY.md`. Edits from the agent, the file mirror or the UI all
  write the document.
- `memory` and `user` are hard-capped; a write over the cap fails so the agent must consolidate
  (the Hermes pattern). They are injected as a frozen snapshot per conversation.
- A pre-compaction turn reminds the agent to save notes. There is no scheduled memory job.
- Past chats are searchable through SQLite full-text search in the agent store.
- Onboarding: a new agent starts with a bootstrap instruction and no name. In its first chat it
  settles its name and personality with the user and picks from the preset avatars with a tool.

### 4.7 Schedules

- Stored in the agent store. Kinds: once, interval, cron expression with time zone.
- Firing is at-most-once: the next run time is re-armed with a compare-and-swap before dispatch,
  and a run lease fences late writers (ported from do-computer).
- Each run is a fresh conversation that shares memory, skills and computer. A reply of exactly
  `[SILENT]` suppresses delivery. Scheduled runs cannot create schedules.
- Results are delivered to the chat the schedule was created in, plus a push notification.

### 4.8 Skills and connectors

- Skills use the AgentSkills `SKILL.md` layout. The index (name and description) is in the prompt
  under a size budget; bodies load on demand.
- The agent creates and edits skills directly. Installs from a git repository or URL are supported.
  Agent-written skills are archived when stale, never deleted.
- Connectors are remote MCP servers configured per user and enabled per agent. OAuth tokens are
  held server-side and never shown to the model.

### 4.9 The user's own computers

- A single-file daemon for macOS and Linux, installed as a user service, dials out over one
  WebSocket. Protocol ported from do-computer's `dc-protocol`: exec, chunked file read and write,
  revoke.
- Pairing uses Better Auth's device authorization flow: the daemon shows a code, the signed-in
  user confirms on the web. The resulting token expires, rotates, and is revoked by deleting a row.
- The daemon writes a local audit log of every command.
- Trust: full by default, per the owner's decision. Each computer can be switched to "ask" or
  "read only", and those rules are also enforced on the daemon, not just the server.

### 4.10 Approvals

Full trust is the default. The mechanism still ships: a `beforeTool` hook checks opt-in rules
(allow, ask, deny per tool, connector or computer); an "ask" pauses the task and renders an approval
card in chat and as a push notification. With full trust, a prompt injection can act on connected
MCP accounts and paired machines; the controls that remain are the per-agent VM, server-side
secrets, untrusted-content markers on fetched material, revocation, and the audit log.

### 4.11 Clients

**Shared (`packages/client`):** typed API client, SSE reader with offset resume, TanStack DB
collections, message and event types. Used by web and Expo.

**Data flow:** TanStack Query fetches snapshots; TanStack DB Query Collections hold chats, messages,
schedules, skills, computers and files; an SSE change feed applies server deltas through direct
writes; jotai holds UI-local state (composer draft, selected chat, panel state).

**Web (TanStack Start):**

- shadcn chat components (`MessageScroller`, `Message`, `Bubble`, `Attachment`, `Marker`) for the
  conversation layer. They own no data or transport, which suits a non-AI-SDK backend.
- Hand-built: composer, tool-call rows, connector cards, approval cards. shadcn ships none of these.
- Navigation: Chats, Search, Library, Automations, Skills, Computers, Memory, agent switcher.
- Pin TanStack Start to 1.168.60 or later (critical XSS fixed on 2026-09-30).

**Expo:** native chat UI (none of the shadcn components carry over), Expo push, dictation, library
browser, automation and skill management. Streaming uses `expo/fetch`. Push requires a development
build, not Expo Go.

**Dictation:** audio is uploaded and transcribed by a model on the server.

### 4.12 Auth

Better Auth mounted in TanStack Start: email and password, Google, GitHub, the Expo plugin, and
device authorization for daemons. Database is D1 on Cloudflare and SQLite on Node, with migrations
run programmatically on Workers. One identity module is the only place that mints agent and
conversation keys, and every request derives the account from the session, never from the client.

---

## 5. Repository layout

```
apps/
  web/        TanStack Start app; server entry exports the Durable Objects
  mobile/     Expo app
  daemon/     paired-computer daemon (single-file bundle)
packages/
  runtime/    AgentHost interface, Durable Object and Node implementations, conformance tests
  agent/      pi-durable adapter, tools, memory, schedules, skills, MCP, approvals
  sandbox/    SandboxProvider interface and the four providers
  protocol/   client wire types and daemon frames
  client/     shared API client, SSE reader, TanStack DB collections
  db/         Drizzle schema and migrations for the app database
  cli/        the in-box CLI
```

## 6. Phases

Each phase ends with both runtimes passing the same tests.

| Phase                            | Builds                                                                                                                                                                        | Done when                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0. Spikes                        | The unknowns in section 8                                                                                                                                                     | Each has a written go or no-go                                                                                                                   |
| 1. Skeleton                      | Monorepo, runtime interface and conformance suite, app database, auth, agent create and delete, one chat streaming to the web with just-bash                                  | A signed-in user chats with an agent on a Worker and on Node; killing the process mid-turn resumes it; an end-to-end test runs with a fake model |
| 2. Agent core                    | Conversational onboarding, identity and memory documents with file mirror, many chats, compaction, history search, steer and follow-up, library, usage recording, full web UI | An agent names itself, remembers across chats, and survives a restart with memory intact                                                         |
| 3. Computers                     | Provider interface, Daytona, Cloudflare Containers, Modal, workspace save and restore, in-box CLI, browser skill                                                              | The same task runs on all three providers; a stopped box comes back with its workspace                                                           |
| 4. Schedules, skills, connectors | Schedule store and alarms, isolated runs and delivery, skill store and authoring, git and URL install, MCP                                                                    | A schedule created in chat fires after a process restart and reports back; the agent writes a skill and uses it in a later chat                  |
| 5. Own computers                 | Daemon, pairing, `target`, opt-in rules, audit log                                                                                                                            | The agent runs a command on a paired laptop; revoking stops it immediately                                                                       |
| 6. Mobile                        | Expo auth, chat, push, dictation, library, automation and skill management                                                                                                    | A scheduled result arrives as a push and opens the right chat                                                                                    |
| 7. Release                       | Security review, sign-up gating, deploy guides for Wrangler and Node, docs                                                                                                    | A new user can self-host from the README on either target                                                                                        |

## 7. Ported from do-computer

Source: `/home/sawyer/projects/do-browser/apps/do-computer`.

| Piece                          | Source                                                           | Change on the way in                             |
| ------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------ |
| Identity key module            | `src/identity.ts`                                                | Add a real agent id; drop the shared dev account |
| In-box CLI and callback token  | `src/tools/registry.ts`, `src/tools/dc-token.ts`                 | Tokens expire and are scoped per agent           |
| Schedule grammar and store     | `src/cron/schedule.ts`, `src/cron/jobs.ts`, `src/cron/runner.ts` | Per-agent alarm in place of a global minute tick |
| Daemon and protocol            | `src/computer-daemon/`, `packages/dc-protocol`                   | Pairing through Better Auth device authorization |
| Target seam                    | `src/computers/remote-env.ts`, `src/sandboxes/tools.ts`          | Unified with the sandbox handle                  |
| Daytona adapter                | `src/sandboxes/daytona.ts`, `src/sandboxes/index.ts`             | Keep create-only-on-proven-404                   |
| Skill store                    | `src/skills/`                                                    | Canonical store moves outside the VM             |
| Memory caps and history search | `src/memory/`                                                    | Stored as pi-durable documents                   |

Not ported: Flue and everything that reads its private tables, the Telegram delivery object, the
restic backup system, the dobrowser.io auth hand-off.

## 8. Risks and spikes

These are unverified and are what phase 0 is for.

1. **pi-durable in a Durable Object.** Its README says the portable SQLite core runs there, but
   there is no example. Verify: the storage facade over Durable Object SQLite, the cost of
   `Harness.open()` on every wake, and mapping `sleep(until)` onto alarms.
2. **pi's own server, client, protocol and MCP packages.** One research pass listed these in the
   pi monorepo; the repo README I read lists only seven packages. Evaluate before writing our own
   wire protocol and MCP client.
3. **TanStack Start on two targets.** No official dual-target recipe exists; the Node target runs on
   a Nitro v3 beta; Start is still labelled a release candidate. Verify one app, two builds, SSE on
   both, and Durable Objects exported from the server entry.
4. **Cloudflare Containers.** The SDK was rewritten as 1.0.0 on 2026-09-30 and depends on
   public-beta scheduling and snapshots. do-computer previously abandoned Containers. Verify
   start, exec and workspace save and restore; note that code running inside the instance does
   not count as activity.
5. **Modal on Node.** Verify the 24-hour lifetime and snapshot-based workspace restore.
6. **Transcription path.** Not verified that OpenRouter offers a suitable audio transcription
   route. If not, dictation needs a second provider key, which conflicts with "one key".
7. **Web search.** do-computer uses Exa with its own key. Decide between an OpenRouter-side search
   option and an optional second key.
8. **Better Auth on D1.** D1 has no transactions; the 1.7 upgrade was heavy. Verify the chosen
   plugins there.
9. **TanStack DB churn.** Beta, five minor releases in seven weeks. Keep collections behind
   `packages/client` so changes stay in one place.
10. **Version drift.** Better Auth's Expo guide targets SDK 55; current Expo is SDK 57.

## 9. Research sources

- pi-durable: https://earendil.com/posts/pi-durable/ and https://github.com/earendil-works/pi
- shadcn chat components: https://ui.shadcn.com/docs/changelog/2026-06-chat-components
- TanStack DB: https://tanstack.com/db/latest
- just-bash: https://github.com/vercel-labs/just-bash
- Meta Muse security design: https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse
- OpenClaw docs: https://docs.openclaw.ai ; Hermes Agent docs: https://hermes-agent.nousresearch.com/docs
- do-computer plan docs: `/home/sawyer/projects/do-browser/do-computer-plans`

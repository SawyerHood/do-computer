# durable-computer: build plan

**Status:** draft 1, 2026-10-01. Not yet reviewed. Nothing is built.
**Working name:** durable-computer. **License:** MIT.

An open-source, self-hostable, always-on personal agent in the style of Meta Muse. Each agent has a
name, an avatar, a personality, memory and its own computer. It keeps working when the client is
closed, runs schedules, learns skills, and can reach the user's own machines. One codebase deploys
to Cloudflare Workers and to plain Node. Models are called through OpenRouter.

Foundation: [`@earendil-works/pi-durable`](https://earendil.com/posts/pi-durable/) for the durable
agent loop and `@earendil-works/pi-ai` for the model layer.

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
| Cloudflare Containers | Yes                                      | No              | Save and restore the workspace directory to R2 (disk is lost on stop)           |
| Modal                 | No (SDK is gRPC, cannot run in a Worker) | Yes             | Filesystem snapshot of the workspace (24-hour maximum lifetime)                 |
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

# Shared computers: plan

**Status:** built on 2026-10-07. HANDOFF.md section 5 item 19 says how, and where the build
departed from this plan. Section 7 lists the choices in here that the owner has not made
himself.

Today every agent has a cloud machine of its own, made for it and deleted with it. This plan makes
computers belong to the workspace. An agent has no computer of its own: it uses the workspace's
computers when a task needs one. The library becomes one per workspace as well.

## 1. What was decided

The owner's decisions, from the conversation this plan came out of:

- A workspace has computers, possibly several, and it is possible to choose which agents can use
  which.
- An agent has no home computer. It runs without one and uses the ones it can reach.
- Each agent has its own starting folder on a computer.
- The library is shared by the agents of a workspace.
- Memory is no longer mirrored as files on a computer (`SOUL.md`, `IDENTITY.md`, `USER.md`,
  `MEMORY.md`). The agent changes it with the memory tools only.

## 2. How it works

### Computers

A computer is a row in `dc_computers`, whether someone paired it or the app made it at a provider.
Paired computers already work this way (HANDOFF.md section 5 item 16). Cloud machines join them.

| Column        | Meaning                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`        | `paired`, `daytona`, `modal`, `cloudflare` or `just-bash`.                                                                                                            |
| `machine_key` | What the provider's machine is named after. The computer's own id for a new one. The agent's id for a machine that existed before, so that the same machine is found. |
| `access`      | `open`: every agent of the workspace can use it. `chosen`: only agents with a row in `dc_computer_grants`. A paired computer is always `chosen`.                      |

A new table, `dc_computer_folders (computer_id, agent_id, path)`, records each agent's folder on
each computer it has used.

### Who can use what

- A cloud computer is `open` by default. Anyone in the workspace can switch it to `chosen` and
  pick the agents.
- A paired computer keeps today's rules: it is connected agent by agent, and an agent that wants
  one asks its owner.
- `mayUse` in `computer-access.ts` stays the one rule, asked before every use: the computer must
  fit the agent's workspace, and be open or granted.
- An agent can ask for a `chosen` cloud computer with its `computers` tool, as it asks for a
  paired one.

### Which computer a tool call runs on

The file and shell tools already take a `computer` argument. The change is what leaving it out
means:

- If the agent can use exactly one cloud computer, that one is meant.
- If it can use several, it must name one, and the error says which there are.
- A person's paired machine is never meant by default. It is always named.

### Folders

On a cloud computer the agent starts in its own folder, `~/<name>`, made on first use from the
agent's name at that moment and never renamed. `~` is still the computer's home. An agent that had
its own machine before this change keeps the home directory as its folder, since its files are
there.

```
/home/daytona/        the computer's home
  library/            the workspace's library, one working copy per computer
  scout/              one agent's folder
  mira/               another's
```

Nothing stops an agent from leaving its folder. Its prompt names the other agents on the machine
and their folders, and asks it to work in its own unless a task is about a shared path.

### The library

There is one library per workspace, held by an actor of its own (`library:<workspace id>`) with
the file index, the bytes, the versions and the deleted files. Every agent's Library tab shows it.

- Each cloud computer has one `~/library` folder, a working copy, kept in step the way it is now:
  before a tool that reads files and after one that can write them, on that computer.
- The pass still runs in the agent that used the computer. The library actor allows one pass per
  computer at a time and keeps what each computer's folder held when the two last agreed.
- On a paired computer there is no folder. The `library` and `send_file` tools move files, as now.
- A file records which agent or person made it, where it now records only "agent" or "user".
- An HTML document is served at `/d/<workspace>/<key>/<path>`.

### Skills

Skills stay stored with the agent. Loading one copies its files into the agent's folder on the
computer the call is for, where today they go to the agent's own computer.

### A new workspace, a new agent

Creating an agent stays one click. If the workspace has no cloud computer the agent could use, one
is added, of the kind in the person's "Default computer" setting, open to the workspace. The
machine itself is still only created when something first runs on it. Setting the default to "No
computer" means none is added.

### Deleting and moving

- **Deleting an agent** removes its grants and folder records. Computers stay. Where the agent is
  the only one that can use a computer, the dialog offers to delete that computer too, ticked.
- **Deleting a computer** destroys the machine at the provider and removes its rows. Whoever added
  it, or an admin of its team, can do this.
- **Moving an agent to another workspace** ends its use of the old workspace's computers and gives
  it the new workspace's open ones. A `chosen` computer that only this agent can use moves with it.
  Library files stay with the workspace they are in.
- **Deleting a team** destroys its cloud computers and its library.

## 3. What changes for agents that exist today

- Each agent's machine becomes a computer of its workspace, `chosen`, with that agent alone on it.
  The agent goes on using it, in the same directory, with the same files.
- A machine an agent left behind when its kind was changed becomes a computer with no agents, so
  it can be seen and deleted. Today it is invisible until the agent is deleted.
- The four memory files are read one last time for edits, then removed from the machine.
- Each agent's library is moved into its workspace's library. Paths are kept. Where two agents
  have a file at the same path, the later one's goes under a folder named for that agent. File
  ids are kept, so file cards in old chats still open.

## 4. The built-in shell

The built-in shell keeps its files in the agent's own database, so it cannot be shared as it is.
In this plan it stays one per agent: a `just-bash` computer, `chosen`, with one agent, deleted
with that agent. On a deployment whose default is the built-in shell, each new agent gets its own.
Making it shareable means giving its files an actor of their own, answering the same requests a
paired computer's link does. That is left for later.

## 5. Build order

Each step can be shipped on its own.

### Step 1: cloud computers join the list

No change in what an agent does.

- Migration: `kind`, `machine_key`, `access` on `dc_computers`; `dc_computer_folders`.
- `ComputerChoices.create` takes a machine key where it takes the agent's host
  (`apps/web/src/server/sandbox.ts`, `packages/agent/src/actor.ts`). The built-in shell still needs
  the agent's database.
- Adoption: when an agent next loads, its host records the machines it has
  (`IdentityDoc.computers`) through the computer directory, which is how the actor reaches the app
  database.
- `mayUse` is asked before every use of a cloud computer too.
- The Computers page lists cloud computers and can delete one.

### Step 2: no home computer

- `packages/agent/src/paired.ts` becomes the one place an agent's computers are kept: paired and
  cloud, with kind, machine key and folder. It builds the sandbox for a call, picks the computer
  when none is named, and starts the call in the agent's folder.
- `packages/agent/src/computer.ts` and `mirror.ts` go, with the mirror hooks. The prompt section
  is rewritten: which computers there are, the agent's folder on each, who else works there, where
  the library is. `IdentityDoc.computer`, `computers` and `computerChangedAt` are retired once
  adopted.
- The gateway tells each agent of a workspace when an open computer is added, removed or changes
  access, as it tells an agent today when a paired one is connected.
- Approval rules (`approvals.ts`) match on the computer a call resolves to, not only on a
  `computer` argument that was written out.
- Skills copy to the computer in use. The browsing skill is given to every agent where the
  deployment offers a kind with real programs.
- Agent creation adds the workspace's first computer when there is none. The delete and move
  rules of section 2.
- Web: the Computers page gains "Add a computer", the access switch and each agent's folder. The
  agent's "Model and computer" settings lose the kind picker and list what the agent can use. The
  "Default computer" setting is reworded.

### Step 3: the workspace library

The largest step.

- A library actor per workspace. Most of `packages/agent/src/library.ts` moves into it; what stays
  with the agent is the two tools, the prompt section and the hooks that start a pass.
- The gateway's `/api/agents/<id>/library` routes forward to the library of the agent's workspace,
  so the web and mobile clients change little at first.
- One pass per computer at a time, handed out by the library actor.
- Open tabs learn of a change from a socket on the library actor, as they learn of presence, and
  read the listing again. Today the listing arrives in the agent's own state.
- Moving each agent's library across, as in section 3.

### Step 4: mobile and the record

- The mobile app's library and settings screens.
- HANDOFF.md, README.md and PLAN.md section 0.

A click-through mock-up of the Computers page in `prototypes/shared-computers` would come before
step 2, as was done for teams.

## 6. Risks

- **No wall between agents on one machine.** An agent can read and change another's folder, stop
  its processes, fill the disk or take a port. Memory is safe from this once it is no longer a
  file. A Unix user per agent would be the wall, and it depends on the provider.
- **A restricted agent beside a free one.** An agent whose permissions are limited can read what
  a less limited agent left on the same disk. The remedy is a `chosen` computer for that agent.
- **The wrong computer.** With several cloud computers the agent must name one each time and will
  sometimes name the wrong one.
- **Library copies.** Every cloud computer holds a full copy of the library, and a merged library
  is larger than any one agent's was. The limit of 2,000 files now applies to a workspace.
- **Sharing a machine is untested on Modal and Cloudflare.** Daytona finds a machine by name and
  already handles two callers creating it at once. The other two need the same check.
- **The library move is one way.** There are no production users, so this is accepted.

## 7. Choices the owner has not made

These are the plan's own. Each can be changed without changing the rest.

1. A new cloud computer is open to every agent of its workspace.
2. Agents that exist today keep their own machine, restricted to them, and are not gathered onto
   one shared machine.
3. A paired machine is never the default for a tool call.
4. An agent's folder is named after it at first use and never renamed.
5. Library files stay with the workspace when an agent moves. A file card in an old chat then
   points at the other workspace's library and opens only for someone who is in it.
6. The built-in shell stays one per agent.

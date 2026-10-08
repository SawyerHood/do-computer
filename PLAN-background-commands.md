# Background commands: plan

**Status:** proposed on 2026-10-08. Nothing is built. Section 8 lists the choices in here that
the owner has not made himself, and section 9 what has not been checked.

An agent that runs a slow command today can do nothing else until it ends, and neither can the
person talking to it. This plan lets a command run in the background: the agent starts it, gets
its turn back at once, and is told when it finishes. A command that turns out to be slow moves
to the background by itself.

## 1. What happens today

- `bash` is pi-durable's tool (`createBashTool`), wrapped in `packages/agent/src/computers.ts` to
  add the `computer` parameter. It takes `command` and `timeout`, and returns when the command
  ends.
- A command is killed after 5 minutes unless the agent asks for longer, and 10 minutes is the
  most it can ask for (`DEFAULT_EXEC_TIMEOUT_MS`, `MAX_EXEC_TIMEOUT_MS` in
  `packages/sandbox/src/remote.ts`). So a long build or install cannot finish at all, and a dev
  server cannot be left running.
- The agent's turn is held for the whole command. A message the user sends in the meantime waits
  for the command to end, whether the agent is set to steer or to queue.
- On Daytona, which is what do.computer uses, nothing a command prints is shown until it ends,
  and Stop does nothing until it ends ("Daytona has no way to stop a command", in
  `packages/sandbox/src/daytona/index.ts`). A paired computer is the same on both counts.
  Cloudflare and Modal machines stream output and can be stopped.
- A machine is stopped when nothing has been asked of it for a while: 15 minutes on Daytona, 10
  on Cloudflare. A process left running on it does not count as use.

## 2. What the agent gets

### `bash` gains `run_in_background`

```
bash({ command: "pnpm build", computer: "devbox", run_in_background: true })
→ Started in the background as b3 on "devbox". You will get a message when it finishes.
  Its output is being written to /home/daytona/.do-computer/jobs/<agent>/b3/output.log.
```

The call returns as soon as the command has started. A command that cannot start (no such
program, bad directory) still fails there and then.

### A slow command moves to the background by itself

A command started the ordinary way that is still running after 60 seconds is not killed. The
call returns what it has printed so far, and says:

```
Still running after 60s, so it was moved to the background as b3. You will get a message when
it finishes. Do not run it again.
```

Passing `timeout` keeps today's meaning: wait that long in the foreground, up to 10 minutes, and
kill the command at the end of it. So an agent that wants to sit and wait still can.

### A `background` tool

One tool with an `action`, the way `schedule` and `skill` are built:

| Action   | What it does                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list`   | The agent's background commands: id, computer, command, state, how long it has run.                                                                          |
| `output` | What a command has printed since the agent last looked, within the same limits as `bash`. With `wait_seconds` (60 at most) it waits that long for it to end. |
| `stop`   | Stops the command and everything it started: asked first, killed 5 seconds later.                                                                            |

The log is an ordinary file on the machine, so the agent can also `read` or `grep` it.

### Being told when it finishes

The same way a sub-agent's report arrives (`#deliver` in `packages/agent/src/subagents.ts`): an
entry is written into the chat that started the command, and the agent is given a turn there.

```
[Your background command b3 on "devbox" finished with exit code 0 after 4m 12s.
 Command: pnpm build
 The last of what it printed is below. All of it: /home/daytona/.do-computer/jobs/<agent>/b3/output.log]
```

A turn is given when the command finishes, fails, hits its time limit or is lost with its
machine. When the agent stopped it, nothing is sent. When the user stopped it, the entry is
written and no turn is given, as with a sub-agent.

### What the agent is told

A paragraph in the computers section of its prompt: use the background for servers, watchers,
and builds, installs or test runs likely to take more than a minute; do not `sleep` or poll, the
message will come; carry on with other work or end the turn; stop what is no longer needed.

## 3. How it works on the machine

Every command becomes a job, foreground or not. The difference is only how long the call waits.

A job has a folder on the machine, `~/.do-computer/jobs/<agent id>/<job id>/`, holding
`command`, `output.log`, `pid` and, once it has ended, `exit`. The command is started in its own
session with its output going to the log, by one shell command that then follows the log until
the job ends or the foreground wait runs out. A fast command therefore still costs one round
trip to the provider, as now. When the wait runs out the follower is what stops; the job is in
another session and carries on.

Reading output, checking for `exit` and stopping are each one short shell command. Nothing in
the `Sandbox` interface changes for Daytona, Cloudflare or Modal: this is all `exec`.

**Paired computers** get it in the daemon instead (`packages/computers/src/node-io.ts`), because
macOS has neither `setsid` nor `timeout`. New frames in `packages/protocol/src/daemon.ts`:
`job_start`, `job_read`, `job_stop`, and `job_exit` sent by the daemon when a job ends. The same
folder is kept on disk so a restarted daemon finds its jobs. A daemon too old to know the frames
(`hello.version`) keeps working as today, and the agent is told that computer cannot run things
in the background.

**The lightweight shell** (just-bash) has no processes. `run_in_background` fails there with a
sentence saying so, and nothing moves to the background.

## 4. How the agent learns a job has ended

A `JobsDoc` in the agent's store holds each job: id, chat, computer, command, state, start and
end times, exit code, deadline, and how much of the log the agent has seen.

The agent's actor already wakes every 20 seconds while it has live work (`#rearm` in
`packages/agent/src/actor.ts`). Running jobs count as live work, and each wake-up asks every
machine with running jobs, in one command per machine, which of them have ended. After ten
minutes a job is looked at once a minute instead.

That look is also what keeps the machine from being stopped under the job. So a job needs a
limit of its own, or a forgotten dev server keeps a paid machine running for good:

- A background command is stopped after **1 hour** unless `timeout` says otherwise, up to
  **24 hours**. The agent is told when that happens.
- At most **8** running at once per agent.
- A job whose log passes **100 MB** is stopped.
- Job folders are removed **7 days** after the job ended.

If the machine stopped or restarted anyway, the job is marked lost and the agent is told, with
the path of whatever was printed before.

## 5. What the user sees

A mock-up in `prototypes/` comes before any of this is built.

- **In the chat.** The row for the call reads "Running in the background on devbox: pnpm build"
  with a live dot and a running clock, and settles to "Finished in 4m 12s" or "Failed (exit 1)
  after 38s". Opening it shows the end of the output, live while it runs. The wording goes in
  `packages/protocol/src/activity.ts`.
- **Above the composer.** A small "2 running" chip while the agent has background commands. It
  opens a list: command, computer, how long, the last line printed, and a Stop button for each.
- **The agent in the sidebar.** An agent with commands running and no turn in progress shows as
  waiting on something, not as thinking and not as idle.
- **Stop.** The Stop button on a turn stops a command the turn is waiting on, and now does so
  at once on Daytona and paired computers too. It leaves background commands alone; those are
  stopped from the list.
- **Phone.** The chat rows only, to begin with.

Routes: `GET /api/agents/:id/jobs`, `GET .../jobs/:jobId/output`, `POST .../jobs/:jobId/stop`.
Jobs travel with the chat state the app already streams.

## 6. What else it touches

- **Permissions.** Starting a command in the background asks for the same approval as running
  it. `background` needs none of its own: it only reaches the agent's own jobs, and fails if
  the agent can no longer use the computer.
- **Keep-going** (`packages/agent/src/keep-going.ts`). An agent that says "waiting for the build"
  and stops has not stopped by accident. A chat with a running job is not nudged.
- **Sub-agents.** A sub-agent can start jobs. The message goes to its own conversation, and it
  reports to its parent again afterwards.
- **Automations.** A scheduled run can start a job and end its turn; the message wakes it. The
  check command an automation runs before starting the agent is unchanged.
- **Deleting.** Deleting a chat or an agent stops its jobs. Removing a computer does too.
- **Shared machines.** Jobs are filed under the agent's id, so agents on one machine see only
  their own.

## 7. Order of building

1. Check section 9 on each provider.
2. Jobs on Linux machines: the runner, `run_in_background`, the `background` tool, `JobsDoc`,
   the look on each wake-up, the message. Tests on Node and in the Workers runtime.
3. Moving a slow command to the background.
4. The mock-up, then the chat rows, the list and Stop.
5. Paired computers.
6. Output shown as it arrives on Daytona and paired computers, by reading the log during the
   foreground wait. Not needed for the rest.

## 8. Choices the owner has not made

- **60 seconds** before a command moves to the background. Shorter frees the agent sooner;
  each move costs an extra model call, so a command that takes 40 seconds is slower if moved at 30.
- **1 hour** as the default life of a background command, and **24 hours** as the most. This is
  what a forgotten job can cost in machine time.
- Whether a dev server should be able to outlive that, as something the user keeps running on
  purpose. This plan says no.
- 8 at once, 100 MB of log, 7 days kept.
- One `background` tool with actions, where Claude Code has separate tools.
- An explicit `timeout` waits in the foreground and kills, as today, and is never moved.
- Old paired daemons keep working without the feature and are not forced to update.

## 9. Not checked

Nothing here has been run. Before building:

- That a process started in its own session outlives the call that started it, on Daytona
  (`executeCommand`), Cloudflare (`container.exec`) and Modal. If Daytona kills it, Daytona's
  session commands (`runAsync`) are the other way to do it there.
- That a second call can reach a machine while a first is still waiting, on Daytona, so that
  Stop works during the foreground wait.
- That asking a machine about its jobs counts as use and holds off the 15 and 10 minute stops.
- That following the log adds no delay a person would notice to a command that takes a
  fraction of a second.

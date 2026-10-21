# Executor lifecycle checks

These small TLA+ models describe the lifecycle obligations behind the executor regression tests. They are finite, hand-written abstractions, not extracted models or a refinement proof of the JavaScript, operating system, Cloudflare, or transport.

## Run

With Java and a local `tla2tools.jar`, from this directory:

```sh
java -cp /path/to/tla2tools.jar tlc2.TLC -workers 2 -config exec-boot-hardened.cfg ExecLifecycle
java -cp /path/to/tla2tools.jar tlc2.TLC -workers 2 -config exec-spawn-hardened.cfg ExecLifecycle
java -cp /path/to/tla2tools.jar tlc2.TLC -workers 2 -config exec-stream-hardened.cfg ExecLifecycle
java -cp /path/to/tla2tools.jar tlc2.TLC -workers 2 -config reply-hardened.cfg ReplySettlement
java -cp /path/to/tla2tools.jar tlc2.TLC -workers 2 -config jobs-hardened.cfg JobOwnership
```

The constants also permit comparison with the former patterns: disable the four bounding/cancellation flags for `ExecLifecycle`, set `Strict = FALSE` for `ReplySettlement`, or `Hardened = FALSE` for `JobOwnership`. Those configurations intentionally have counterexamples. Terminal stuttering is allowed; temporal properties, rather than TLC's terminal-state deadlock heuristic, check progress.

## Scope and assumptions

- `ExecLifecycle`: two requests, a shared startup, process allocation, abort, caller settlement, busy accounting, process exit independent of EOF, and two abstract deadline ticks. Weak fairness applies to local timers and local continuation/finalization, **not** cloud RPC completion, startup, EOF or natural exit. An independent server deadline must release accounting without losing responsibility for a process allocated after it expires. Actual kill effects are abstracted as effective exit; kernel failures and escaped descendants are outside this model.
- `ReplySettlement`: two waiters and all seven expected/reply kinds. A mismatched kind with a matching id is an explicit faulty-peer/protocol-regression assumption. It must either be rejected or ignored without removing the original request's deadline. Timeout delivery is weakly fair.
- `JobOwnership`: one delayed start, an overtaking stop, foreground-to-background handoff, caller-context loss, daemon restart and a two-tick lease. Durable ownership is recorded before remote effects, stop prevents a _later_ start, and a process-side deadline survives the daemon. Stop/kill effects are abstracted atomically: the real API requests termination and allows a bounded grace, not instantaneous physical exit. Reconciliation, independent filesystem failure, pid reuse, arbitrary external side effects, and duplicate payload conflicts are not exhaustively modeled.

No model guarantees progress if the runtime's own event loop or OS cannot schedule timers. Their graphs are exhaustively enumerable only within these finite bounds. The source-level tests in `packages/computers/test/executor-lifecycle.test.ts`, `packages/sandbox/test/executor-lifecycle.test.ts`, `packages/sandbox/test/cloudflare-startup.test.ts` and `packages/agent/test/job-ownership.test.ts` connect particular obligations to actual implementations.

## Implementation details and limits

Cloudflare execution has independent client and server deadlines. Shared startup is bounded at three minutes; preparation and login RPC/output waits at thirty seconds. (The `boot` phase in `ExecLifecycle` is this shared startup and preparation.) Command allocation/output is bounded by the command lifetime plus ten seconds; cancellation is registered before setup and remembered for early arrival. Late allocations are killed best-effort. Interrupted preparation is durably marked so a resumed Durable Object retries it; shared startup is not mistaken for an idle machine by the snapshot alarm. One startup waiter aborting does not cancel shared setup for other callers. Early execution-cancel tombstones are bounded to 1,024 entries and one maximal request budget; they are not permanent replay protection against arbitrarily delayed transport delivery. Those cache-eviction and long-partition cases are outside the two-request model.

Paired daemon tracked work has its own budget, releases busy accounting on expiry, and suppresses late success replies. Uncancellable platform IO can still complete after timeout; callers must treat failed writes as an uncertain side effect, not proof nothing was written. Independent operation deadlines do not turn screen-consent policy into an OS sandbox.

Job ids are claimed before execution. Claim/stop metadata is separate from removable output folders, so an output purge does not allow replay. Claims are retained for seven days, matching the existing output-retention window; id reuse after that is outside the idempotency guarantee. An ambiguous/incomplete claimed start fails closed rather than rerunning a potentially side-effecting command. A durable agent intent remains until foreground completion, atomic background handoff, or confirmed reconciliation. Reconciliation retries uncertain cleanup and does not block an aborted foreground caller. Intents are reconciled concurrently, each on its own deadline, after running jobs are checked. An intent whose computer is gone (removed or unpaired) is dropped, as a running job there is marked lost; one still unreachable well past its lifetime plus the overdue allowance is given up on. Unreachable computers are not reported as errors.

On POSIX, a detached private Node supervisor enforces each job's deadline/output cap independently of the daemon. It owns a separate command process group and enforces a wall-clock deadline across daemon exit, the clock the agent's own lifetime-plus-overdue judgement uses, so a laptop that slept does not keep running a job the agent has already called lost (timers are monotonic, so the clock is also checked every 100 ms). On a stop, the deadline or the output cap, it terminates the whole group and escalates after four seconds, including children remaining after the leader exits. A command that exits by itself leaves its background children running (`server &`), matching the Linux sandbox's jobs. While a job is supervised the daemon does not run its own limit timer or output measurement, so that a timeout is recorded as one by a single enforcer. Daemon-side forced cleanup also targets the recorded command group; it must not kill only the supervisor and strand its child. Commands/paths are argv, not interpolated program text. Command-specific Node flags are not applied to the supervisor; trusted runtime-only flags support Electron's Node mode without leaking them into the command environment. Windows retains its existing console/launcher behavior; this change does not claim a new Windows detached-supervisor guarantee. Neither path is an isolation boundary against an unrestricted same-user command that deliberately escapes supervision.

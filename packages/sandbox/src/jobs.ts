import { JOB_LOG_CAP_BYTES } from "@do-computer/protocol"
import type { ExecOptions, ExecOutcome } from "./index.ts"
import { quote } from "./shell-fs.ts"

/** How a job stands: still going, ended, or gone with nothing to say how it ended. */
export type JobState =
  | { readonly state: "running" }
  | {
      readonly state: "exited"
      readonly exitCode: number
      /** Its time limit stopped it. */
      readonly timedOut: boolean
      /** How long it ran, as the computer it ran on measured it, where it said. */
      readonly ranMs?: number
    }
  /** Neither running nor ended: the machine stopped under it, or its folder was removed. */
  | { readonly state: "lost" }

/** What following a job for a while came to. */
export type JobFollowed = JobState & {
  /** What it printed while it was followed. */
  readonly output: string
  /** How many bytes of its log have been read so far: where the next look starts. */
  readonly next: number
  /** Whether its folder is still there. A short job that ended while followed leaves none. */
  readonly kept: boolean
}

export type JobFollowOptions = {
  /** How long to wait for it to end. Zero looks once. */
  readonly waitMs: number
  readonly signal?: AbortSignal
  /** Receives what it prints as it arrives, where the machine can say so before the wait ends. */
  readonly onOutput?: (text: string) => void
  /**
   * Remove the job's folder if it ended while followed and printed no more than this. For a
   * command somebody waited for, whose output they then have.
   */
  readonly removeUnder?: { readonly bytes: number; readonly lines: number }
}

export type JobStart = {
  /** Names its folder. Letters, digits, `-` and `_`. */
  readonly id: string
  readonly command: string
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  /** How long it may run before it is stopped. */
  readonly lifeMs: number
}

/** The computer cannot keep a command going by itself, where one of its kind usually can. */
export class JobsUnsupported extends Error {}

/**
 * Commands that outlive the call that started them. A job runs in a session of its own with
 * what it prints going to a log in its folder, so it can be left, looked in on, and stopped.
 */
export interface SandboxJobs {
  /** Start a job and follow it. It carries on when the wait ends first. */
  start(job: JobStart, follow: JobFollowOptions): Promise<JobFollowed>
  /** Follow a job from `from` bytes into its log. */
  follow(id: string, options: JobFollowOptions & { readonly from: number }): Promise<JobFollowed>
  /** Ask a job and everything it started to stop; they are killed a few seconds later. */
  stop(id: string): Promise<void>
  /** How each job stands and how much it has printed, in one look. */
  check(ids: readonly string[]): Promise<Record<string, JobState & { readonly size: number }>>
  /** Remove the folders of jobs that are over. */
  remove(ids: readonly string[]): Promise<void>
  /** The file a job's output is written to. */
  log(id: string): string
}

/** A folder left behind is removed this long after its job ended. */
const KEEP_DAYS = 7
/** Past this much unread output, only the end of it is sent. */
const MAX_STEP_BYTES = 1024 * 1024
const STEP_TAIL_BYTES = 256 * 1024
/** How long past the wait the call itself is given, for the machine to answer. */
const ANSWER_GRACE_MS = 20_000

/**
 * Starts the command in its own session. `timeout` puts it in a process group and stops the
 * whole group at the limit, or when it is itself asked to stop; the shell around it is outside
 * that group, and lives to write how it ended, and how long it took by bash's own clock: a
 * \`date\` that is not GNU's cannot be trusted with milliseconds. `dd` passes on what is printed as it comes and
 * stops at the cap, which ends a job that prints without end.
 */
const START = `d=$1
claim="\${d%/*}/.claims/\${d##*/}"
mkdir -p "$claim" || exit 1
chmod 700 "$claim"
[ -e "$claim/stopped" ] && exit 0
if ! mkdir "$claim/started" 2>/dev/null; then
  [ "$(cat "$claim/identity" 2>/dev/null)" = "$5" ] || exit 1
  exit 0
fi
printf '%s' "$5" > "$claim/identity"
[ -e "$claim/stopped" ] && exit 0
[ -e "$d/command" ] && exit 0
mkdir -p "$d" || exit 1
printf '%s\\n' "$2" > "$d/command"
: > "$d/output.log"
setsid bash -c '
now() { if [ -n "\${EPOCHREALTIME:-}" ]; then t=\${EPOCHREALTIME/[.,]/}; echo $(( t / 1000 )); else echo $(( $(date +%s) * 1000 )); fi; }
t0=$(now)
claim="\${2%/*}/.claims/\${2##*/}"
if [ -e "$claim/stopped" ]; then echo "143 0 0" > "$2/exit"; exit 0; fi
{ timeout --kill-after=5 "$3" bash -c "$1" 2>&1 & p=$!; echo "$p" > "$2/tpid"; [ ! -e "$claim/stopped" ] || kill -TERM "$p" 2>/dev/null; wait "$p"; echo $? > "$2/code"; } | dd bs=65536 iflag=count_bytes count="$4" status=none >> "$2/output.log"
code=$(cat "$2/code" 2>/dev/null || echo 1)
ran=$(( $(now) - t0 ))
late=0
if [ "$code" = 124 ] || { [ "$code" = 137 ] && [ "$ran" -ge "$(( $3 * 1000 ))" ]; }; then late=1; fi
echo "$code $late $ran" > "$2/exit.tmp" && mv "$2/exit.tmp" "$2/exit"
' job "$2" "$d" "$3" "$4" > /dev/null 2>&1 < /dev/null &
echo $! > "$d/pid"
`

/** Prints `running`, `exited <code> <late> <milliseconds it ran>` or `lost` for the job in "$1". */
const STATE = `state() {
  if [ -e "$1/exit" ]; then echo "exited $(cat "$1/exit")"
  elif pid=$(cat "$1/pid" 2>/dev/null); [ "$pid" -gt 0 ] 2>/dev/null && kill -0 "$pid" 2>/dev/null; then
    case "$(cat "/proc/$pid/stat" 2>/dev/null)" in
      *") Z "*|*") X "*) echo lost;;
      *) echo running;;
    esac
  elif [ -e "$1/exit" ]; then echo "exited $(cat "$1/exit")"
  else echo lost; fi
}`

/**
 * Prints what the job in "$1" wrote from byte "$2" on, as it arrives, for up to "$3"
 * milliseconds, and ends with a line that says how far it read and how the job stands. It looks
 * often at first, so that a quick command is answered quickly, and less often after.
 */
const FOLLOW = `${STATE}
d=$1; pos=$2; left=$3; slept=0; nap=10; st=running; kept=1
while :; do
  fin=0; [ -e "$d/exit" ] && fin=1
  size=$(stat -c %s "$d/output.log" 2>/dev/null) || { st=lost; break; }
  if [ "$size" -gt "$pos" ]; then
    if [ "$((size - pos))" -gt ${MAX_STEP_BYTES} ]; then
      printf '\\n[%s bytes of output are not shown here]\\n' "$((size - pos - ${STEP_TAIL_BYTES}))"
      pos=$((size - ${STEP_TAIL_BYTES}))
    fi
    tail -c "+$((pos + 1))" "$d/output.log" | head -c "$((size - pos))"
    pos=$size
  fi
  [ "$fin" = 1 ] && { st=$(state "$d"); break; }
  st=$(state "$d")
  [ "$st" = running ] || { [ -e "$d/exit" ] && continue; break; }
  [ "$slept" -ge "$left" ] && break
  case $nap in 10) sleep 0.01;; 20) sleep 0.02;; 50) sleep 0.05;; 100) sleep 0.1;; *) sleep 0.2;; esac
  slept=$((slept + nap))
  case $nap in 10) nap=20;; 20) nap=50;; 50) nap=100;; 100) nap=200;; esac
done
case $st in exited*)
  if [ "$5" -gt 0 ] && [ "$pos" -le "$5" ] && [ "$(wc -l < "$d/output.log")" -le "$6" ]; then rm -rf "$d"; kept=0; fi;;
esac
printf '\\n%s %s %s %s\\n' "$4" "$pos" "$kept" "$st"
`

const STOP = `d=$1
claim="\${d%/*}/.claims/\${d##*/}"
mkdir -p "$claim" || exit 1
chmod 700 "$claim"
: > "$claim/stopped"
[ -d "$d" ] || exit 0
[ -e "$d/exit" ] && exit 0
i=0
while [ ! -s "$d/tpid" ] && [ $i -lt 20 ]; do sleep 0.05; i=$((i + 1)); done
kill -TERM "$(cat "$d/tpid" 2>/dev/null)" 2>/dev/null
exit 0
`

const script = (body: string, args: readonly (string | number)[]) =>
  `sh -c ${quote(body)} sh ${args.map((arg) => quote(String(arg))).join(" ")}`

function parseState(words: readonly string[]): JobState {
  if (words[0] === "running") return { state: "running" }
  if (words[0] === "exited") {
    const exitCode = Number(words[1])
    const ranMs = Number(words[3])
    return {
      state: "exited",
      exitCode: Number.isInteger(exitCode) ? exitCode : 1,
      timedOut: words[2] === "1",
      ...(words[3] !== undefined && Number.isFinite(ranMs) && ranMs >= 0 ? { ranMs } : {}),
    }
  }
  return { state: "lost" }
}

/**
 * Passes on what a follow prints, less its last line, which is for this side. The line can
 * arrive in pieces, so the end of what has come is held back while it could be its beginning.
 */
function withoutTrailer(marker: string, onOutput: ((text: string) => void) | undefined) {
  const start = `\n${marker} `
  let held = ""
  return (text: string) => {
    if (onOutput === undefined) return
    held += text
    const at = held.indexOf(start)
    if (at !== -1) {
      if (at > 0) onOutput(held.slice(0, at))
      held = held.slice(at)
      return
    }
    // The longest ending that the trailer could begin with.
    let keep = Math.min(held.length, start.length - 1)
    while (keep > 0 && !start.startsWith(held.slice(held.length - keep))) keep--
    if (held.length > keep) onOutput(held.slice(0, held.length - keep))
    held = held.slice(held.length - keep)
  }
}

type Exec = (command: string, options?: ExecOptions) => Promise<ExecOutcome>

/**
 * Jobs on a Linux machine that offers a shell, which is every machine the app makes. Each lives
 * in a folder under `~/.do-computer/jobs/<scope>`, so whoever shares the machine sees only their
 * own. Uses `setsid`, GNU `timeout` and coreutils.
 */
export function shellJobs(sandbox: { exec: Exec; home: string }, scope: string): SandboxJobs {
  const base = `${sandbox.home}/.do-computer/jobs/${scope.replace(/[^A-Za-z0-9_-]/g, "_")}`
  const dir = (id: string) => {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`"${id}" cannot name a job`)
    return `${base}/${id}`
  }

  const follow = async (
    id: string,
    prelude: string,
    options: JobFollowOptions & {
      from: number
      cwd?: string
      env?: Readonly<Record<string, string>>
    },
  ): Promise<JobFollowed> => {
    const marker = `<<job:${crypto.randomUUID()}>>`
    const waitMs = Math.max(0, Math.round(options.waitMs))
    const onOutput = withoutTrailer(marker, options.onOutput)
    // Stopping the call that follows a job does not stop the job, which is the caller's to do.
    const outcome = await sandbox.exec(
      prelude +
        script(FOLLOW, [
          dir(id),
          options.from,
          waitMs,
          marker,
          options.removeUnder?.bytes ?? 0,
          options.removeUnder?.lines ?? 0,
        ]),
      {
        cwd: options.cwd,
        env: options.env,
        timeoutMs: waitMs + ANSWER_GRACE_MS,
        signal: options.signal,
        onOutput,
      },
    )
    const at = outcome.output.lastIndexOf(`\n${marker} `)
    if (at === -1) {
      // The follower was cut short, or the job could not be started at all.
      const stands = (await check([id]))[id] ?? { state: "lost" as const, size: options.from }
      return { ...stands, output: outcome.output, next: stands.size, kept: true }
    }
    const [next, kept, ...state] = outcome.output
      .slice(at + marker.length + 2)
      .trim()
      .split(" ")
    return {
      ...parseState(state),
      output: outcome.output.slice(0, at),
      next: Number(next) || options.from,
      kept: kept !== "0",
    }
  }

  const check: SandboxJobs["check"] = async (ids) => {
    if (ids.length === 0) return {}
    const outcome = await sandbox.exec(
      `${script(
        `${STATE}
for d in "$@"; do
  echo "$(basename "$d") $(stat -c %s "$d/output.log" 2>/dev/null || echo 0) $(state "$d")"
done`,
        ids.map(dir),
      )}
find ${quote(base)} -mindepth 1 -maxdepth 1 -type d ! -name .claims -mtime +${KEEP_DAYS} -exec rm -rf {} + 2>/dev/null
find ${quote(`${base}/.claims`)} -mindepth 1 -maxdepth 1 -type d -mtime +${KEEP_DAYS} -exec rm -rf {} + 2>/dev/null`,
      { timeoutMs: 60_000 },
    )
    const found: Record<string, JobState & { size: number }> = {}
    for (const line of outcome.output.split("\n")) {
      const [id, size, ...state] = line.trim().split(" ")
      if (id === undefined || !ids.includes(id)) continue
      found[id] = { ...parseState(state), size: Number(size) || 0 }
    }
    return found
  }

  return {
    start: async (job, options) => {
      if (!Number.isFinite(job.lifeMs) || job.lifeMs <= 0 || job.lifeMs > 24 * 60 * 60_000)
        throw new Error("Invalid job lifetime")
      const identity = JSON.stringify({
        command: job.command,
        cwd: job.cwd,
        env: job.env === undefined ? undefined : Object.fromEntries(Object.entries(job.env).sort()),
        lifeMs: job.lifeMs,
      })
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity))
      const fingerprint = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("")
      return follow(
        job.id,
        `${script(START, [dir(job.id), job.command, Math.max(1, Math.ceil(job.lifeMs / 1000)), JOB_LOG_CAP_BYTES, fingerprint])} || exit 1\n`,
        { ...options, from: 0, cwd: job.cwd, env: job.env },
      )
    },
    follow: (id, options) => follow(id, "", options),
    stop: async (id) => {
      await sandbox.exec(script(STOP, [dir(id)]), { timeoutMs: 30_000 })
    },
    check,
    remove: async (ids) => {
      if (ids.length === 0) return
      await sandbox.exec(`rm -rf -- ${ids.map((id) => quote(dir(id))).join(" ")}`, {
        timeoutMs: 60_000,
      })
    },
    log: (id) => `${dir(id)}/output.log`,
  }
}

/**
 * The wire protocol between a paired computer's daemon and the server.
 *
 * JSON text frames over one WebSocket the daemon dials out. Every request carries an `id`. The
 * daemon buffers results it could not send while the socket was down and flushes them on
 * reconnect; the host resolves the id if something is still waiting for it and drops the frame
 * otherwise. File bytes travel base64-encoded in chunks sized under the 1 MiB message limit of a
 * Durable Object WebSocket.
 */

import type { ScreenAction, UsingAgent } from "./screen.ts"
import type { Person } from "./workspace.ts"

/** Cap on each of stdout and stderr, so a result always fits in a frame. */
export const EXEC_STDIO_CAP = 256 * 1024
/** Raw bytes per file chunk: about 342 KiB once base64-encoded. */
export const FILE_CHUNK_BYTES = 256 * 1024
/** Largest file that can be read from or written to a paired computer. */
export const REMOTE_FILE_CAP = 25 * 1024 * 1024
export const DEFAULT_EXEC_TIMEOUT_MS = 300_000
export const MAX_EXEC_TIMEOUT_MS = 600_000

/** Close code sent when the computer was removed; the daemon then forgets its credentials. */
export const REVOKED_CLOSE_CODE = 4001
/** Close code when a newer connection from the same computer replaces this one. */
export const SUPERSEDED_CLOSE_CODE = 4002

/** Keep-alive pair, answered by the runtime without waking the computer's actor. */
export const PING_FRAME = '{"t":"ping"}'
export const PONG_FRAME = '{"t":"pong"}'

// Host to daemon.

export type ExecFrame = {
  t: "exec"
  id: string
  command: string
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
}
export type ReadFrame = { t: "read"; id: string; path: string; maxBytes?: number }
export type WriteBeginFrame = { t: "write_begin"; id: string; path: string; size: number }
export type WriteChunkFrame = { t: "write_chunk"; id: string; seq: number; data: string }
export type WriteEndFrame = { t: "write_end"; id: string }
/**
 * A file-system operation the daemon performs itself, without a shell. `stat`, `list` and
 * `realpath` only look; `mkdir`, `remove` and `rename` change things.
 */
export type FsFrame = {
  t: "fs"
  id: string
  op: "stat" | "list" | "realpath" | "mkdir" | "remove" | "rename"
  path: string
  /** Destination of a rename. */
  to?: string
  recursive?: boolean
  force?: boolean
}
/**
 * Something to do with a job: a command the daemon keeps going by itself, in a folder named
 * `job` under `scope`, with what it prints going to a log there. `start` starts one and follows
 * it; `follow` reads what one printed from `from` bytes on, waiting up to `waitMs` for it to
 * end; `stop` stops one; `check` says how each of `jobs` stands; `remove` removes their folders.
 */
export type JobFrame = {
  t: "job"
  id: string
  op: "start" | "follow" | "stop" | "check" | "remove"
  scope: string
  job?: string
  jobs?: string[]
  command?: string
  cwd?: string
  env?: Record<string, string>
  /** How long the command may run before it is stopped. */
  lifeMs?: number
  from?: number
  waitMs?: number
  /** Remove the folder of a job that ended while followed and printed no more than this. */
  removeUnder?: { bytes: number; lines: number }
}
/**
 * Something to do with the computer's screen. `act` does one thing to it for `agent` and
 * answers with how it looks afterwards; `view` answers with how it looks now, for someone
 * watching, waiting up to `waitMs` for a picture newer than `after`; `hold` pauses whoever is
 * using it, or lets them carry on.
 */
export type ScreenFrame = {
  t: "screen"
  id: string
  op: "act" | "view" | "hold"
  agent?: UsingAgent
  action?: ScreenAction
  /** What the agent is doing, in a few words, for whoever watches. */
  say?: string
  after?: number
  waitMs?: number
  held?: boolean
}
/**
 * Something to do with a browser on the computer. `run` runs a script in it for `agent` and
 * answers with what it printed and the pictures it took; `view`, and `hold` are as for the
 * screen; `close` closes the browser kept for agents, and lets go of the owner's own.
 */
export type BrowserFrame = {
  t: "browser"
  id: string
  op: "run" | "view" | "hold" | "close"
  agent?: UsingAgent
  script?: string
  timeoutMs?: number
  say?: string
  after?: number
  waitMs?: number
  held?: boolean
}
/**
 * Sent when the server has reason to think the daemon is behind: it said so when it connected,
 * or something was asked of it that it cannot do. A daemon that keeps itself up to date then
 * asks for the newest one at once, without waiting for its next look. One that does not, or
 * that is from before this frame, lets it pass.
 */
export type UpdateFrame = { t: "update" }
/** Sent, best effort, before a revocation close so the daemon can say why. */
export type RevokedFrame = { t: "revoked" }

export type HostFrame =
  | ExecFrame
  | ReadFrame
  | WriteBeginFrame
  | WriteChunkFrame
  | WriteEndFrame
  | FsFrame
  | JobFrame
  | ScreenFrame
  | BrowserFrame
  | UpdateFrame
  | RevokedFrame

// Daemon to host.

/** Sent once after connecting: what this computer is, and what its owner allows. */
export type HelloFrame = {
  t: "hello"
  platform: string
  hostname: string
  home: string
  /** True when the daemon was started read-only: it refuses commands and writes. */
  readOnly: boolean
  version: string
  /** True when the daemon understands `job` frames. Absent on one from before there were jobs. */
  jobs?: boolean
  /**
   * True when the daemon keeps itself up to date. False when its owner switched that off, and
   * absent on one from before daemons could: either way it is replaced only by hand.
   */
  updates?: boolean
  /**
   * Whether agents may use the screen here: true where the computer has one they can use and
   * its owner switched that on. Absent on a daemon from before there was such a thing.
   */
  screen?: boolean
  /** Whether agents may use a browser here. Absent on a daemon from before there was one. */
  browser?: boolean
}
export type ExecResultFrame = {
  t: "exec_result"
  id: string
  stdout: string
  stderr: string
  exitCode: number
}
export type FileChunkFrame = {
  t: "file_chunk"
  id: string
  seq: number
  data: string
  last: boolean
}
export type OkFrame = { t: "ok"; id: string }
export type RemoteFileStat = {
  kind: "file" | "directory" | "symlink"
  size: number
  mtimeMs: number
}
/** The answer to an `fs` frame: a stat (null when absent), a listing, a path, or nothing. */
export type FsResultFrame = {
  t: "fs_result"
  id: string
  value: RemoteFileStat | null | (RemoteFileStat & { name: string })[] | string | true
}
/** The answer to a `job` frame: how the job stands and what it printed, or nothing. */
export type JobResultFrame = { t: "job_result"; id: string; value: unknown }
/** The answer to a `screen` or a `browser` frame: what its `op` answers with, or nothing. */
export type UseResultFrame = { t: "use_result"; id: string; value: unknown }
export type DaemonErrorCode =
  | "not_found"
  | "not_directory"
  | "is_directory"
  | "permission_denied"
  | "invalid"
  | "too_large"
  | "io"
  | "bad_request"
  | "read_only"
  /** The computer's owner has this switched off, or stopped the agent doing it. */
  | "refused"
export type ErrFrame = { t: "err"; id: string; code: DaemonErrorCode; message: string }

export type DaemonFrame =
  | HelloFrame
  | ExecResultFrame
  | FileChunkFrame
  | OkFrame
  | FsResultFrame
  | JobResultFrame
  | UseResultFrame
  | ErrFrame

export function parseFrame<T extends { t: string }>(raw: unknown): T | null {
  if (typeof raw !== "string") return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && typeof (parsed as { t?: unknown }).t === "string") {
      return parsed as T
    }
  } catch {
    // Not a frame.
  }
  return null
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const step = 0x8000
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Split bytes into base64 chunk payloads of `FILE_CHUNK_BYTES` each; an empty file is one empty chunk. */
export function chunkBytes(bytes: Uint8Array): string[] {
  if (bytes.length === 0) return [""]
  const chunks: string[] = []
  for (let index = 0; index < bytes.length; index += FILE_CHUNK_BYTES) {
    chunks.push(bytesToBase64(bytes.subarray(index, index + FILE_CHUNK_BYTES)))
  }
  return chunks
}

/** The kind of a computer somebody paired, as opposed to a machine the app made at a provider. */
export const PAIRED_COMPUTER = "paired"

/**
 * A computer as the app lists it to someone who can see it: one somebody paired, or a machine
 * of a workspace, which the app made and which the workspace's agents work on.
 */
export type ComputerSummary = {
  id: string
  /** The name agents refer to it by. */
  name: string
  /** `paired`, or the kind of machine it is: the `id` of one of the deployment's `ComputerKind`s. */
  kind: string
  platform: string
  hostname: string
  /** Whose it is: the own workspace of whoever paired or added it, or a team's. */
  workspaceId: string
  /** Who paired or added it. A paired computer's daemon runs as them on that machine. */
  pairedBy: Person
  /**
   * Who can use it. `open`: every agent of its workspace, as long as it is one. `chosen`: the
   * agents it was connected to, one by one. A paired computer is always `chosen`.
   */
  access: "open" | "chosen"
  /** Whether it can serve more than one agent. A kind that keeps its files with one agent cannot. */
  shareable: boolean
  /** The agents that can work on it, whichever way they came to. */
  agentIds: string[]
  /** The folder each agent has to itself on a machine, once it has worked there. */
  folders: { agentId: string; path: string }[]
  /** Whether the signed-in user may remove it: whoever paired or added it, or an admin of its team. */
  canManage: boolean
  createdAt: number
  online: boolean
  readOnly: boolean
  lastSeenAt: number | null
  /** For a paired computer: whether its owner lets agents use its screen, as its daemon last said. */
  screen?: boolean
  /** For a paired computer: whether agents may use a browser there, as its daemon last said. */
  browser?: boolean
  /**
   * For a paired computer whose daemon has said what it is: `current` when it is the daemon
   * this deployment serves, `updating` when it is not and keeps itself up to date, `outdated`
   * when it is not and will not: someone has to run the install command there again.
   */
  daemon?: "current" | "updating" | "outdated"
}

/** An agent asking to work on a computer it is not connected to, until someone answers. */
export type ComputerRequest = {
  id: string
  computer: { id: string; name: string; workspaceId: string; pairedBy: Person; readOnly: boolean }
  agentId: string
  /** The chat it asked from, where the answer is sent. */
  chatId: string | null
  /** What the agent said it wants the computer for. */
  reason: string
  /** Whether the signed-in user is one of the people the computer belongs to, who can answer. */
  canAnswer: boolean
  createdAt: number
}

/** What adding a machine to a workspace says about it. */
export type AddComputerRequest = {
  /** The workspace it is for: the user's own unless a team of theirs is named. */
  workspaceId?: string
  /** The kind of machine: one the deployment offers, that can be shared. */
  kind: string
  /** What agents call it. One is made up when this is left out. */
  name?: string
}

/** What confirming a pairing code says about the computer behind it. */
export type ConfirmPairingRequest = {
  code: string
  /** Whose it is to be: the user's own workspace unless a team of theirs is named. */
  workspaceId?: string
  /** The agents to connect it to straight away. More can be connected later. */
  agentIds?: string[]
}

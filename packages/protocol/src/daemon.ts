/**
 * The wire protocol between a paired computer's daemon and the server.
 *
 * JSON text frames over one WebSocket the daemon dials out. Every request carries an `id`. The
 * daemon buffers results it could not send while the socket was down and flushes them on
 * reconnect; the host resolves the id if something is still waiting for it and drops the frame
 * otherwise. File bytes travel base64-encoded in chunks sized under the 1 MiB message limit of a
 * Durable Object WebSocket.
 */

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
/** Sent, best effort, before a revocation close so the daemon can say why. */
export type RevokedFrame = { t: "revoked" }

export type HostFrame =
  ExecFrame | ReadFrame | WriteBeginFrame | WriteChunkFrame | WriteEndFrame | FsFrame | RevokedFrame

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
export type ErrFrame = { t: "err"; id: string; code: DaemonErrorCode; message: string }

export type DaemonFrame =
  HelloFrame | ExecResultFrame | FileChunkFrame | OkFrame | FsResultFrame | ErrFrame

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

/** A paired computer as the app lists it to someone who can see it. */
export type ComputerSummary = {
  id: string
  /** The name agents refer to it by. */
  name: string
  platform: string
  hostname: string
  /** Whose it is: the own workspace of whoever paired it, or a team's. */
  workspaceId: string
  /** Who paired it. Its daemon runs as them on that machine. */
  pairedBy: Person
  /** The agents that can work on it. */
  agentIds: string[]
  /** Whether the signed-in user may remove it: whoever paired it, or an admin of its team. */
  canManage: boolean
  createdAt: number
  online: boolean
  readOnly: boolean
  lastSeenAt: number | null
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

/** What confirming a pairing code says about the computer behind it. */
export type ConfirmPairingRequest = {
  code: string
  /** Whose it is to be: the user's own workspace unless a team of theirs is named. */
  workspaceId?: string
  /** The agents to connect it to straight away. More can be connected later. */
  agentIds?: string[]
}

import type { Context } from "@earendil-works/chord"
import type { DocumentReader, JsonObject, SessionDocToken, Tx } from "@earendil-works/pi-durable"
import { ApprovalsDoc } from "./approvals.ts"
import { ComputersDoc } from "./computers.ts"
import { ConnectorsDoc } from "./connectors.ts"
import { ChatsDoc, IdentityDoc, SchedulesDoc } from "./docs.ts"
import { JournalDoc } from "./journal.ts"
import type { IdentityChange, IdentityChanged, MemoryEdit, MemoryEdited } from "./persona.ts"
import { SkillsDoc } from "./skills.ts"

/**
 * The conversation that asks, and the tool call it asks in. Across objects, a change is written
 * under these, so that a call sent twice changes one thing (PLAN-main-bus.md, 8.5).
 */
export type AskedFrom = { readonly chatId: string; readonly callId: string }

/** Something sent to the people of a main chat, or posted to a thread in Slack, with `send`. */
export type Sent = { readonly chatId: string; readonly text: string; readonly files: number }

/** A thread in Slack tells the main chat something, with `tell_main`. */
export type ToldMain = { readonly chatId: string; readonly callId: string; readonly text: string }

/**
 * What a conversation asks of the Dood it works for, where the answer is the Dood's: changes to
 * its own documents, and word to its main chat and its people.
 *
 * Today every conversation is kept in the Dood's own object, and the only implementation is the
 * agent's (`AgentActor`), which does what it did before this existed. It is the seam a
 * conversation kept in an object of its own (`ChatObject`, PLAN-main-bus.md 8.5) calls through
 * instead, so everything here is plain data in and out, and every change carries what keys it.
 *
 * What a conversation only reads of the Dood (who it is, its memory, skills, computers,
 * connectors, approval rules, its other chats) is not asked for call by call: it is read from
 * the mirror (`readMirror`), the same documents under the same names.
 */
export interface AgentLink {
  /** The documents a conversation reads, where they differ from the versions it has. */
  mirror(known: MirrorVersions | undefined, context: Context): Promise<AgentMirror>
  /** `set_identity`: change who the agent is. */
  changeIdentity(
    from: AskedFrom,
    change: IdentityChange,
    context: Context,
  ): Promise<IdentityChanged>
  /** `memory`: edit what the agent remembers. */
  editMemory(from: AskedFrom, edit: MemoryEdit, context: Context): Promise<MemoryEdited>
  /** `send` said something to people. Never fails: what it tells of was done already. */
  sent(sent: Sent): Promise<void>
  /** `tell_main`: undefined where the main chat was told, or why it was not. */
  tellMain(told: ToldMain, context: Context): Promise<string | undefined>
}

/**
 * The agent's documents a conversation reads while it builds a request or checks a call, by
 * the name of each document (its `kind`):
 *
 * - `dc.identity`: the persona's sections, the computers, peers and schedules tools;
 * - `dc.skills`: the skills section (a skill's files are read when it is loaded, not here);
 * - `dc.connectors`: which connector tools there are (their tokens are kept elsewhere);
 * - `dc.computers`: the computers section and tools;
 * - `dc.approvals`: the rules the approvals hook checks a call against;
 * - `dc.journal`, `dc.schedules`, `dc.chats`: the `recent` section, and the record of the
 *   conversation itself, which several tools read.
 */
const MIRRORED = {
  "dc.identity": IdentityDoc,
  "dc.skills": SkillsDoc,
  "dc.connectors": ConnectorsDoc,
  "dc.computers": ComputersDoc,
  "dc.approvals": ApprovalsDoc,
  "dc.journal": JournalDoc,
  "dc.schedules": SchedulesDoc,
  "dc.chats": ChatsDoc,
} as const

export type MirroredKind = keyof typeof MIRRORED

export const MIRRORED_KINDS = Object.keys(MIRRORED) as readonly MirroredKind[]

/** Each mirrored document with its token. */
export const mirrored = () =>
  MIRRORED_KINDS.map((kind) => [kind, MIRRORED[kind] as SessionDocToken<JsonObject>] as const)

/** The version of each mirrored document, as a fingerprint of its content. */
export type MirrorVersions = Readonly<Partial<Record<MirroredKind, string>>>

/**
 * The agent's documents a conversation reads, as of one moment. `docs` holds those that differ
 * from what the asker said it had, `null` for one the agent does not have; `versions` is every
 * one's version, for the next time.
 */
export type AgentMirror = {
  readonly versions: Readonly<Record<MirroredKind, string>>
  readonly docs: Readonly<Partial<Record<MirroredKind, JsonObject | null>>>
}

/** The fingerprint of a document that is not there. */
const ABSENT = "-"

/**
 * A fingerprint of some JSON: 53 bits of cyrb53 over its text, as hex. Not a secure hash: two
 * versions are only compared for being the same, and a document written with its keys in
 * another order is merely sent again.
 */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value)
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ char, 2654435761)
    h2 = Math.imul(h2 ^ char, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/** Read the mirror from the agent's store, sending only what differs from `known`. */
export async function readMirror(
  reader: DocumentReader,
  known: MirrorVersions | undefined,
  context: Context,
): Promise<AgentMirror> {
  const versions = {} as Record<MirroredKind, string>
  const docs: Partial<Record<MirroredKind, JsonObject | null>> = {}
  for (const [kind, token] of mirrored()) {
    const doc = ((await reader.snapshot(token, context)) ?? null) as JsonObject | null
    const version = doc === null ? ABSENT : fingerprint(doc)
    versions[kind] = version
    if (known?.[kind] !== version) docs[kind] = doc
  }
  return { versions, docs }
}

/**
 * Write a mirror into another store, under the same names, so that what reads them there reads
 * what the agent has. A document the agent does not have is left as it is: nothing there is
 * taken away. Returns the versions the store now has.
 */
export async function writeMirror(
  tx: Tx,
  mirror: AgentMirror,
  had: MirrorVersions | undefined,
): Promise<MirrorVersions> {
  const versions: Partial<Record<MirroredKind, string>> = { ...had }
  for (const [kind, token] of mirrored()) {
    if (!(kind in mirror.docs)) continue
    const doc = mirror.docs[kind]
    if (doc !== null && doc !== undefined) {
      const draft = (await tx.doc(token)) as Record<string, unknown>
      for (const key of Object.keys(draft)) delete draft[key]
      Object.assign(draft, structuredClone(doc))
    }
    versions[kind] = mirror.versions[kind]
  }
  return versions
}

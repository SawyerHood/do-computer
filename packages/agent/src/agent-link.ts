import type { Context, JsonValue } from "@earendil-works/chord"
import type {
  DocumentReader,
  Harness,
  JsonObject,
  SessionDocToken,
  ToolExecutionApi,
  Tx,
} from "@earendil-works/pi-durable"
import { ApprovalsDoc } from "./approvals.ts"
import { ComputersDoc } from "./computers.ts"
import { ConnectorsDoc } from "./connectors.ts"
import { ChatsDoc, IdentityDoc, SchedulesDoc } from "./docs.ts"
import { JournalDoc } from "./journal.ts"
import {
  changeIdentity,
  editMemory,
  type IdentityChange,
  type IdentityChanged,
  type MemoryEdit,
  type MemoryEdited,
} from "./persona.ts"
import { SkillsDoc } from "./skills.ts"

/**
 * The conversation that asks, and the tool call it asks in. Not read yet: the agent's own link
 * makes each change as the call makes it. Across objects, a change will be recorded under these
 * (with the call's sequence of link calls), so that a call sent twice changes one thing and gets
 * the same answer back (PLAN-main-bus.md, 8.5).
 */
export type AskedFrom = { readonly chatId: string; readonly callId: string }

/** Something sent to the people of a main chat, or posted to a thread in Slack, with `send`. */
export type Sent = { readonly chatId: string; readonly text: string; readonly files: number }

/** A thread in Slack tells the main chat something, with `tell_main`. */
export type ToldMain = { readonly chatId: string; readonly callId: string; readonly text: string }

/** A tool call's own commit, which refuses once the call has ended or been stopped. */
export type CallCommit = ToolExecutionApi["commit"]

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
  /**
   * `set_identity`: change who the agent is. `commit` is the asking tool call's own, which
   * refuses once the call has been stopped: the agent's link makes the change with it, so that a
   * stopped call changes nothing, as before. Across objects there is none to pass, and the link
   * will carry the call's abort instead (PLAN-main-bus.md, 8.5).
   */
  changeIdentity(
    from: AskedFrom,
    change: IdentityChange,
    context: Context,
    commit?: CallCommit,
  ): Promise<IdentityChanged>
  /** `memory`: edit what the agent remembers. `commit` as for `changeIdentity`. */
  editMemory(
    from: AskedFrom,
    edit: MemoryEdit,
    context: Context,
    commit?: CallCommit,
  ): Promise<MemoryEdited>
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
 *   conversation itself, which several tools read. `dc.chats` is every chat's record and
 *   changes with nearly every message: before a chat object reads it, it is split into the
 *   conversation's own record and what `recent` needs (PLAN-main-bus.md, 8.5).
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
 * one's version, for the next time; `schemas` is the version of each document's definition in
 * the build that read it, so that a store on another build (during a deploy) refuses it rather
 * than keep a document it would read wrongly.
 */
export type AgentMirror = {
  readonly versions: Readonly<Record<MirroredKind, string>>
  readonly schemas: Readonly<Record<MirroredKind, number>>
  readonly docs: Readonly<Partial<Record<MirroredKind, JsonObject | null>>>
}

/** A mirror from a build whose documents are not this build's. */
export class MirrorSkewError extends Error {}

/** The fingerprint of a document that is not there. */
const ABSENT = "-"

/**
 * A fingerprint of some JSON: 53 bits of cyrb53 over its text, as hex. Not a secure hash: two
 * versions are only compared for being the same, and a document written with its keys in
 * another order is merely sent again.
 */
export function fingerprint(value: JsonValue): string {
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

/**
 * Read the mirror from the agent's store, sending only what differs from `known`. The documents
 * are read one after another, not in one transaction, so a commit can land between two of them:
 * each is whole, and the next read sends whatever moved meanwhile.
 */
export async function readMirror(
  reader: DocumentReader,
  known: MirrorVersions | undefined,
  context: Context,
): Promise<AgentMirror> {
  const versions = {} as Record<MirroredKind, string>
  const schemas = {} as Record<MirroredKind, number>
  const docs: Partial<Record<MirroredKind, JsonObject | null>> = {}
  for (const [kind, token] of mirrored()) {
    const doc = ((await reader.snapshot(token, context)) ?? null) as JsonObject | null
    const version = doc === null ? ABSENT : fingerprint(doc)
    versions[kind] = version
    schemas[kind] = token.definition.version
    if (known?.[kind] !== version) docs[kind] = doc
  }
  return { versions, schemas, docs }
}

/**
 * Write a mirror into another store, under the same names, so that what reads them there reads
 * what the agent has: a document is replaced whole, and one the agent does not have is retired.
 * `had` is the versions the store had before, as it asked for the mirror with them; returned is
 * what it has now, which is `had` for the documents the mirror did not send. Refuses the whole
 * mirror, writing nothing, where a document's definition is not this build's.
 */
export async function writeMirror(
  tx: Tx,
  mirror: AgentMirror,
  had: MirrorVersions | undefined,
): Promise<MirrorVersions> {
  for (const [kind, token] of mirrored()) {
    if (kind in mirror.docs && mirror.schemas[kind] !== token.definition.version) {
      throw new MirrorSkewError(
        `The agent's ${kind} is version ${mirror.schemas[kind]}, and this build reads version ${token.definition.version}.`,
      )
    }
  }
  const versions: Partial<Record<MirroredKind, string>> = { ...had }
  for (const [kind, token] of mirrored()) {
    if (!(kind in mirror.docs)) continue
    const doc = mirror.docs[kind]
    if (doc === null || doc === undefined) await tx.retireDoc(token)
    else {
      const draft = (await tx.doc(token)) as Record<string, unknown>
      for (const key of Object.keys(draft)) delete draft[key]
      Object.assign(draft, structuredClone(doc))
    }
    versions[kind] = mirror.versions[kind]
  }
  return versions
}

/**
 * The agent's own link for the persona's changes, over its store: each change is made with the
 * asking call's commit where there is one, and with the store's own otherwise.
 */
export function identityWrites(
  store: () => Promise<Pick<Harness, "commit">>,
): Pick<AgentLink, "changeIdentity" | "editMemory"> {
  const commit = async (given: CallCommit | undefined): Promise<CallCommit> => {
    if (given !== undefined) return given
    const harness = await store()
    return (change, context) => harness.commit(change, context)
  }
  return {
    changeIdentity: async (_from, change, context, given) =>
      (await commit(given))(
        async (tx) => changeIdentity(await tx.doc(IdentityDoc), change),
        context,
      ),
    editMemory: async (_from, edit, context, given) =>
      (await commit(given))(async (tx) => editMemory(await tx.doc(IdentityDoc), edit), context),
  }
}

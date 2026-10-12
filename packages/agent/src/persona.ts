import { AVATAR_COLORS, parseAvatar } from "@do-computer/protocol"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  defineExtension,
  defineTool,
  type DocumentReader,
  section,
} from "@earendil-works/pi-durable"
import { IdentityDoc, type IdentityState } from "./docs.ts"

/**
 * Hard caps on the always-injected notes. A write over the cap fails, so the agent must
 * consolidate. Large enough for a team's worth of people and conventions, and still a small part
 * of every request.
 */
export const MEMORY_LIMIT = 6000
export const USER_LIMIT = 4000

const STORES = {
  memory: { field: "memory", limit: MEMORY_LIMIT, label: "your notes" },
  user: { field: "user", limit: USER_LIMIT, label: "the user profile" },
} as const

const ALONE = `You are a persistent personal agent. You belong to one person, you keep working for them across many conversations, and you remember what matters between them.`

/** For an agent a team shares. What it knows is the team's: there is no person it belongs to. */
const shared = (
  team: string,
) => `You are a persistent agent shared by a team, ${team}. Everyone in the team can talk to you, in their own conversations or together in one, and you keep working for all of them and remember what matters between conversations.

Working for a team:
- Each message says who sent it, in the "from" of the note that follows it. Answer the person who is speaking, by name where that helps, and do not mistake one of them for another.
- Any conversation here can be read by anyone in the team, and what you remember is the team's. In "the person" below, read the team and its people: when you save something about one of them, say who it is about.
- When two people ask for things that conflict, say so and ask, instead of quietly doing what the last one said.`

const HOW = `
How to work:
- Be direct and useful. Do the thing rather than describing how it could be done.
- You have long-term memory. Each of your chats sees only its own messages, but the "user" and "memory" sections below are in all of them, and so is a short account of what has been going on in your other chats. When you learn something durable about the person or how they like things done, save it with the memory tool right away. Do not save things that only matter to the current conversation.
- If you do not know something, say so. Never invent the result of an action you did not take.
- Your turn ends the moment you reply without calling a tool. So do not reply with only a promise or a progress update ("on it", "next I'll check"): the work would stop there. To keep the person posted while there is more to do, call the progress tool: it shows them your message and lets you carry on. Reply on its own when the work is done or you need something from them.
- The person sees a short list of what you have done in a chat. When you finish something substantial, add it with the log tool. Leave small things out: a list of everything is no use to them.`

/** What is added to the first conversation where a team will be sharing the agent. */
const BOOTSTRAP_SHARED = `You are being shared by a team, so "they" below is whoever is talking to you first: settle your name and personality with them, and save what you learn about the team and what it wants help with.`

const BOOTSTRAP = `You have just hatched. The person you will be working with sees you as a small creature, with a shape and a face that are your own and were not chosen. You do not have a name or a personality yet, and this is your first conversation with them.

Work these out together, naturally, a question or two at a time:
- what they would like to call you (offer a few suggestions if they want),
- what kind of personality they want from you,
- what color you are: one of the colors below,
- who they are and what they want help with.

As soon as something is settled, save it: call set_identity for your name, tagline, personality and color, and the memory tool (target "user") for what you learn about them. You can call set_identity again whenever something changes. Do not drag this out; once you have a name and a sense of the person, get on with being useful.`

/** The first conversation of an agent whose owner named it as it hatched, as the first run has them do. */
const bootstrapNamed = (
  name: string,
) => `You have just hatched. The person you will be working with watched it happen, and sees you as a small creature, with a shape and a face that are your own and were not chosen. They have already named you ${name} and picked your color. You do not have a personality yet, and this is your first conversation with them.

Work these out together, naturally, a question or two at a time:
- what kind of personality they want from you,
- who they are and what they want help with.

As soon as something is settled, save it: call set_identity for your tagline and personality (and for your name or color, should they want another), and the memory tool (target "user") for what you learn about them. Do not drag this out. If they come with something to do, do it, and get to know them along the way.`

const colorCatalog = () => `Colors: ${AVATAR_COLORS.map((color) => color.id).join(", ")}.`

const readIdentity = (read: DocumentReader, context: Context) => read.snapshot(IdentityDoc, context)

function entries(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "")
}

/** What is shown of a store: how full it is, so the agent tidies before it is turned away, then its entries. */
function shown(text: string | undefined, limit: number): string {
  if (!text) return "(Nothing saved yet.)"
  return `(${text.length} of ${limit} characters used)\n${text}`
}

/** The longest an entry added on the agent's behalf may be. */
const MAX_ADDED_CHARS = 240

const folded = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim()

/**
 * Adds entries to a store on the agent's behalf, where it did not think to. Only ever adds: one
 * that is already there in other words' clothing, or that there is no room for, is left out, and
 * nothing is removed to make room. Returns what was added.
 */
export function addNotes(
  doc: Pick<IdentityState, "user" | "memory">,
  target: keyof typeof STORES,
  candidates: readonly string[],
): string[] {
  const store = STORES[target]
  const lines = entries(doc[store.field])
  const added: string[] = []
  for (const candidate of candidates) {
    const entry = candidate.replace(/\s+/g, " ").trim()
    if (entry === "" || entry.length > MAX_ADDED_CHARS) continue
    const said = folded(entry)
    const same = (line: string) => {
      const kept = folded(line)
      // A short entry is part of many sentences without saying what they say.
      return kept.includes(said) || (kept.length >= 12 && said.includes(kept))
    }
    if (lines.some(same)) continue
    if ([...lines, entry].join("\n").length > store.limit) continue
    lines.push(entry)
    added.push(entry)
  }
  if (added.length > 0) doc[store.field] = lines.join("\n")
  return added
}

const setIdentity = defineTool({
  name: "set_identity",
  description:
    "Set or change who you are: your name, a short tagline, your personality in your own words, and your color. Pass only what you are changing.",
  parameters: Type.Object({
    name: Type.Optional(Type.String({ description: "Your name", maxLength: 40 })),
    tagline: Type.Optional(
      Type.String({ description: "One short line describing you", maxLength: 120 }),
    ),
    personality: Type.Optional(
      Type.String({
        description:
          'Your personality, tone and boundaries, written in the second person ("You are..."). Replaces the previous one.',
        maxLength: 4000,
      }),
    ),
    color: Type.Optional(
      Type.String({ description: `The color of the creature you appear as. ${colorCatalog()}` }),
    ),
  }),
  execute: async (args, api, context) => {
    if (args.color !== undefined) {
      const parsed = parseAvatar({ color: args.color })
      if ("error" in parsed) {
        return {
          isError: true,
          content: [{ type: "text", text: `${parsed.error}. ${colorCatalog()}` }],
        }
      }
    }
    const name = args.name?.trim()
    if (name === "") {
      return { isError: true, content: [{ type: "text", text: "A name cannot be empty." }] }
    }
    const saved = await api.commit(async (tx) => {
      const doc = await tx.doc(IdentityDoc)
      if (name !== undefined) doc.name = name
      if (args.tagline !== undefined) doc.tagline = args.tagline.trim() || null
      if (args.personality !== undefined) doc.soul = args.personality.trim()
      // Its features grow from its seed, which a change of color leaves alone.
      if (args.color !== undefined) {
        const seed = doc.avatar?.seed
        doc.avatar = seed === undefined ? { color: args.color } : { color: args.color, seed }
      }
      // Copy out of the draft: it cannot be read once the commit settles.
      return { name: doc.name, tagline: doc.tagline, color: doc.avatar?.color ?? null }
    }, context)
    return {
      content: [{ type: "text", text: `Saved. You are now: ${JSON.stringify(saved)}` }],
      details: saved,
    }
  },
})

const memory = defineTool({
  name: "memory",
  description: `Edit your long-term memory, which is shown to you in every conversation. Target "user" is what you know about the person (limit ${USER_LIMIT} characters); target "memory" is your own notes (limit ${MEMORY_LIMIT} characters). Each entry is one line. "replace" and "remove" pick the entry containing "match", which must match exactly one entry. When a store is full, replace or remove entries to make room.`,
  parameters: Type.Object({
    action: Type.Union([Type.Literal("add"), Type.Literal("replace"), Type.Literal("remove")]),
    target: Type.Union([Type.Literal("user"), Type.Literal("memory")]),
    content: Type.Optional(Type.String({ description: "The entry text, for add and replace" })),
    match: Type.Optional(
      Type.String({ description: "Text that identifies the entry, for replace and remove" }),
    ),
  }),
  execute: async (args, api, context) => {
    const store = STORES[args.target]
    const content = args.content?.replace(/\s*\n\s*/g, " ").trim()
    const fail = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] })
    if (args.action !== "remove" && (content === undefined || content === "")) {
      return fail(`"${args.action}" needs content.`)
    }
    if (args.action !== "add" && (args.match === undefined || args.match === "")) {
      return fail(`"${args.action}" needs match.`)
    }
    const outcome = await api.commit(async (tx): Promise<{ error: string } | { used: number }> => {
      const doc = await tx.doc(IdentityDoc)
      const lines = entries(doc[store.field])
      if (args.action === "add") {
        if (lines.includes(content!)) return { error: "That entry is already saved." }
        lines.push(content!)
      } else {
        const matches = lines.flatMap((line, index) => (line.includes(args.match!) ? [index] : []))
        if (matches.length === 0) return { error: `No entry contains "${args.match}".` }
        if (matches.length > 1) {
          return { error: `${matches.length} entries contain "${args.match}"; be more specific.` }
        }
        if (args.action === "replace") lines[matches[0]!] = content!
        else lines.splice(matches[0]!, 1)
      }
      const next = lines.join("\n")
      if (next.length > store.limit) {
        return {
          error: `That would make ${store.label} ${next.length} characters; the limit is ${store.limit}. Shorten, merge or remove entries first.`,
        }
      }
      doc[store.field] = next
      return { used: next.length }
    }, context)
    if ("error" in outcome) return fail(outcome.error)
    return {
      content: [
        { type: "text", text: `Saved. ${store.label}: ${outcome.used}/${store.limit} characters.` },
      ],
    }
  },
})

/** The agent's sense of self: who it is, who its user is, what it remembers, and the tools to change them. */
export const Persona = defineExtension({
  name: "dc.persona",
  sections: [
    section(
      "preamble",
      async (input, context) => {
        const team = (await readIdentity(input.read, context))?.team
        return `${team ? shared(team) : ALONE}\n${HOW}`
      },
      { tag: false },
    ),
    section("identity", async (input, context) => {
      const doc = await readIdentity(input.read, context)
      if (doc === undefined || doc.name === null) {
        return `${BOOTSTRAP}\n\n${doc?.team ? `${BOOTSTRAP_SHARED}\n\n` : ""}${colorCatalog()}`
      }
      if (doc.namedByOwner && !doc.soul) {
        return `${bootstrapNamed(doc.name)}\n\n${doc.team ? `${BOOTSTRAP_SHARED}\n\n` : ""}${colorCatalog()}`
      }
      const lines = [`Your name is ${doc.name}.`]
      if (doc.tagline) lines.push(doc.tagline)
      if (doc.soul) lines.push("", doc.soul)
      return lines.join("\n")
    }),
    section("user", async (input, context) => {
      const doc = await readIdentity(input.read, context)
      return shown(doc?.user, USER_LIMIT)
    }),
    section("memory", async (input, context) => {
      const doc = await readIdentity(input.read, context)
      return shown(doc?.memory, MEMORY_LIMIT)
    }),
  ],
  tools: [setIdentity, memory],
})

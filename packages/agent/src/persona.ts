import {
  AVATAR_ACCESSORIES,
  AVATAR_CHARACTERS,
  AVATAR_COLORS,
  parseAvatar,
} from "@durable-computer/protocol"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  defineExtension,
  defineTool,
  type DocumentReader,
  section,
} from "@earendil-works/pi-durable"
import { IdentityDoc, type IdentityState } from "./docs.ts"

/** Hard caps on the always-injected notes. A write over the cap fails, so the agent must consolidate. */
export const MEMORY_LIMIT = 2200
export const USER_LIMIT = 1375

const STORES = {
  memory: { field: "memory", limit: MEMORY_LIMIT, label: "your notes" },
  user: { field: "user", limit: USER_LIMIT, label: "the user profile" },
} as const

const PREAMBLE = `You are a persistent personal agent. You belong to one person, you keep working for them across many conversations, and you remember what matters between them.

How to work:
- Be direct and useful. Do the thing rather than describing how it could be done.
- You have long-term memory. Conversations start fresh, but the "user" and "memory" sections below carry over. When you learn something durable about the person or how they like things done, save it with the memory tool right away. Do not save things that only matter to the current conversation.
- If you do not know something, say so. Never invent the result of an action you did not take.`

const BOOTSTRAP = `You have just come into being. You do not have a name, a look or a personality yet, and this is your first conversation with the person you will be working with.

Work these out together, naturally, a question or two at a time:
- what they would like to call you (offer a few suggestions if they want),
- what kind of personality they want from you,
- what you look like: one of the bundled avatars below,
- who they are and what they want help with.

As soon as something is settled, save it: call set_identity for your name, tagline, personality and avatar, and the memory tool (target "user") for what you learn about them. You can call set_identity again whenever something changes. Do not drag this out; once you have a name and a sense of the person, get on with being useful.`

function avatarCatalog(): string {
  const characters = AVATAR_CHARACTERS.map((c) => `${c.id} (${c.description})`).join(", ")
  const colors = AVATAR_COLORS.map((c) => c.id).join(", ")
  const accessories = AVATAR_ACCESSORIES.map((a) => a.id).join(", ")
  return `Avatar characters: ${characters}.\nColors: ${colors}.\nOptional accessories: ${accessories}.`
}

const readIdentity = (read: DocumentReader, context: Context) => read.snapshot(IdentityDoc, context)

function entries(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "")
}

const setIdentity = defineTool({
  name: "set_identity",
  description:
    "Set or change who you are: your name, a short tagline, your personality in your own words, and your avatar. Pass only what you are changing.",
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
    avatar: Type.Optional(
      Type.Object({
        character: Type.String(),
        color: Type.String(),
        accessory: Type.Optional(Type.String()),
      }),
    ),
  }),
  execute: async (args, api, context) => {
    let avatar: IdentityState["avatar"] | undefined
    if (args.avatar !== undefined) {
      const parsed = parseAvatar(args.avatar)
      if ("error" in parsed) {
        return {
          isError: true,
          content: [{ type: "text", text: `${parsed.error}. ${avatarCatalog()}` }],
        }
      }
      avatar = parsed.avatar
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
      if (avatar !== undefined) doc.avatar = avatar
      // Copy out of the draft: it cannot be read once the commit settles.
      return { name: doc.name, tagline: doc.tagline, avatar: doc.avatar && { ...doc.avatar } }
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
    section("preamble", () => PREAMBLE, { tag: false }),
    section("identity", async (input, context) => {
      const doc = await readIdentity(input.read, context)
      if (doc === undefined || doc.name === null) return `${BOOTSTRAP}\n\n${avatarCatalog()}`
      const lines = [`Your name is ${doc.name}.`]
      if (doc.tagline) lines.push(doc.tagline)
      if (doc.soul) lines.push("", doc.soul)
      return lines.join("\n")
    }),
    section("user", async (input, context) => {
      const doc = await readIdentity(input.read, context)
      return doc?.user ? doc.user : "(Nothing saved yet.)"
    }),
    section("memory", async (input, context) => {
      const doc = await readIdentity(input.read, context)
      return doc?.memory ? doc.memory : "(Nothing saved yet.)"
    }),
  ],
  tools: [setIdentity, memory],
})

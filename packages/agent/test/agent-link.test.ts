import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai/models"
import { createRegistry, Harness } from "@earendil-works/pi-durable"
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory"
import { afterEach, describe, expect, it } from "vitest"
import {
  type AgentLink,
  type AgentMirror,
  type CallCommit,
  fingerprint,
  identityWrites,
  MirrorSkewError,
  mirrored,
  MIRRORED_KINDS,
  readMirror,
  writeMirror,
} from "../src/agent-link.ts"
import { ChatsDoc, IdentityDoc } from "../src/docs.ts"
import { JournalDoc } from "../src/journal.ts"
import { changeIdentity, editMemory, persona } from "../src/persona.ts"
import { SkillsDoc } from "../src/skills.ts"

const context = BACKGROUND_CONTEXT
const opened: Harness[] = []

async function store(): Promise<Harness> {
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: createModels(), registry: createRegistry(), now: () => 1_000 },
    context,
  )
  opened.push(harness)
  return harness
}

afterEach(async () => {
  for (const harness of opened.splice(0)) await harness.close(context)
})

/** An agent's store with something in its identity, its skills and its chats. */
async function agentStore(): Promise<Harness> {
  const harness = await store()
  await harness.commit(async (tx) => {
    const identity = await tx.doc(IdentityDoc)
    identity.name = "Juniper"
    identity.memory = "likes tea"
    const skills = await tx.doc(SkillsDoc)
    skills.skills.notes = {
      description: "Take notes",
      source: "agent",
      origin: null,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      files: ["SKILL.md"],
    }
    const chats = await tx.doc(ChatsDoc)
    chats.main = "2"
  }, context)
  return harness
}

describe("the mirror of an agent's documents", () => {
  it("names each document by its own kind", () => {
    for (const [kind, token] of mirrored()) {
      expect((token as unknown as { definition: { kind: string } }).definition.kind).toBe(kind)
    }
    expect(new Set(MIRRORED_KINDS).size).toBe(MIRRORED_KINDS.length)
  })

  it("sends every document the first time, and only what changed after", async () => {
    const agent = await agentStore()
    const first = await readMirror(agent, undefined, context)
    expect(Object.keys(first.docs).sort()).toEqual([...MIRRORED_KINDS].sort())
    expect(first.docs["dc.identity"]).toMatchObject({ name: "Juniper", memory: "likes tea" })
    // What the agent does not have is said to be absent, and is not sent again either.
    expect(first.docs["dc.journal"]).toBeNull()
    expect(first.versions["dc.journal"]).toBe("-")

    const again = await readMirror(agent, first.versions, context)
    expect(again.docs).toEqual({})
    expect(again.versions).toEqual(first.versions)

    await agent.commit(async (tx) => {
      editMemory(await tx.doc(IdentityDoc), { action: "add", target: "memory", content: "a cat" })
    }, context)
    const changed = await readMirror(agent, first.versions, context)
    expect(Object.keys(changed.docs)).toEqual(["dc.identity"])
    expect(changed.docs["dc.identity"]).toMatchObject({ memory: "likes tea\na cat" })
    expect(changed.versions["dc.identity"]).not.toBe(first.versions["dc.identity"])
  })

  it("is read in another store as the agent has it, under the same names", async () => {
    const agent = await agentStore()
    const chat = await store()
    const mirror = await readMirror(agent, undefined, context)
    const had = await chat.commit((tx) => writeMirror(tx, mirror, undefined), context)
    expect(had).toEqual(mirror.versions)
    expect(await chat.snapshot(IdentityDoc, context)).toEqual(
      await agent.snapshot(IdentityDoc, context),
    )
    expect(await chat.snapshot(SkillsDoc, context)).toEqual(
      await agent.snapshot(SkillsDoc, context),
    )
    // The copy reads back with the agent's versions: there is nothing more to send it.
    expect((await readMirror(chat, had, context)).docs).toEqual({})

    // A change is written over what the copy had, with nothing of the old left.
    await agent.commit(async (tx) => {
      changeIdentity(await tx.doc(IdentityDoc), { name: "Fern", tagline: "  " })
    }, context)
    const update: AgentMirror = await readMirror(agent, had, context)
    const now = await chat.commit((tx) => writeMirror(tx, update, had), context)
    expect(await chat.snapshot(IdentityDoc, context)).toMatchObject({
      name: "Fern",
      tagline: null,
      memory: "likes tea",
    })
    expect((await readMirror(chat, now, context)).docs).toEqual({})
  })
})

describe("a mirror written over a copy", () => {
  it("takes away a document the agent does not have, so the two agree", async () => {
    const agent = await agentStore()
    const chat = await store()
    await chat.commit(async (tx) => {
      ;(await tx.doc(JournalDoc)).done.push({ chatId: "9", title: "Old", outcome: "Kept", at: 1 })
    }, context)
    const had = await chat.commit(
      async (tx) => writeMirror(tx, await readMirror(agent, undefined, context), undefined),
      context,
    )
    expect(had["dc.journal"]).toBe("-")
    expect(await chat.snapshot(JournalDoc, context)).toBeUndefined()
    expect((await readMirror(chat, had, context)).docs).toEqual({})
  })

  it("is refused whole from a build whose documents are not this one's", async () => {
    const agent = await agentStore()
    const chat = await store()
    const mirror = await readMirror(agent, undefined, context)
    const skewed: AgentMirror = {
      ...mirror,
      schemas: { ...mirror.schemas, "dc.skills": mirror.schemas["dc.skills"] + 1 },
    }
    await expect(
      chat.commit((tx) => writeMirror(tx, skewed, undefined), context),
    ).rejects.toBeInstanceOf(MirrorSkewError)
    expect(await chat.snapshot(IdentityDoc, context)).toBeUndefined()
  })
})

describe("the agent's link for the persona", () => {
  it("makes a change with the asking call's commit, and nothing once that refuses", async () => {
    const agent = await agentStore()
    const writes = identityWrites(async () => agent)
    const from = { chatId: "2", callId: "call-1" }
    // As pi-durable's commit for a tool call refuses once the call has been stopped.
    const stopped: CallCommit = async () => {
      throw new Error("The tool call has ended")
    }
    await expect(
      writes.editMemory(from, { action: "add", target: "memory", content: "no" }, context, stopped),
    ).rejects.toThrow("ended")
    await expect(writes.changeIdentity(from, { name: "No" }, context, stopped)).rejects.toThrow()
    expect(await agent.snapshot(IdentityDoc, context)).toMatchObject({
      name: "Juniper",
      memory: "likes tea",
    })

    let used = 0
    const running: CallCommit = (change, c) => {
      used++
      return agent.commit(change, c)
    }
    expect(
      await writes.editMemory(
        from,
        { action: "add", target: "memory", content: "yes" },
        context,
        running,
      ),
    ).toEqual({ used: 13 })
    expect(used).toBe(1)
    // Without a call's commit, the store's own.
    expect(await writes.changeIdentity(from, { name: "Fern" }, context)).toMatchObject({
      name: "Fern",
    })
    expect(await agent.snapshot(IdentityDoc, context)).toMatchObject({
      name: "Fern",
      memory: "likes tea\nyes",
    })
  })

  it("is what the persona's tools ask, with the call and the edit as the tool makes it", async () => {
    const asked: unknown[] = []
    const commit: CallCommit = async () => {
      throw new Error("not this")
    }
    const link: Pick<AgentLink, "changeIdentity" | "editMemory"> = {
      editMemory: async (from, edit, _c, given) => {
        asked.push({ from, edit, commit: given !== undefined })
        return { used: 4 }
      },
      changeIdentity: async (from, change, _c, given) => {
        asked.push({ from, change, commit: given !== undefined })
        return { name: "Fern", tagline: null, color: null }
      },
    }
    const tools = persona(link).tools!
    const api = { conversationId: 12, callId: "call-7", commit } as never
    const memory = tools.find((tool) => tool.name === "memory")!
    const identity = tools.find((tool) => tool.name === "set_identity")!
    expect(
      await memory.execute(
        { action: "add", target: "user", content: "  likes\n  tea " },
        api,
        context,
      ),
    ).toMatchObject({ output: [{ text: "Saved. the user profile: 4/4000 characters." }] })
    await identity.execute({ name: " Fern ", tagline: "Hi" }, api, context)
    expect(asked).toEqual([
      {
        from: { chatId: "12", callId: "call-7" },
        edit: { action: "add", target: "user", content: "likes tea" },
        commit: true,
      },
      {
        from: { chatId: "12", callId: "call-7" },
        change: { name: "Fern", tagline: "Hi" },
        commit: true,
      },
    ])
  })
})

describe("the persona's changes", () => {
  it("edits memory as the tool always has", async () => {
    const doc = (await (
      await store()
    ).commit(async (tx) => {
      const identity = await tx.doc(IdentityDoc)
      const outcomes = [
        editMemory(identity, { action: "add", target: "user", content: "Name is Sam" }),
        editMemory(identity, { action: "add", target: "user", content: "Name is Sam" }),
        editMemory(identity, { action: "replace", target: "user", match: "Sam", content: "Sal" }),
        editMemory(identity, { action: "remove", target: "user", match: "nobody" }),
        editMemory(identity, { action: "add", target: "memory", content: "x".repeat(6001) }),
      ]
      return { outcomes, user: identity.user, memory: identity.memory }
    }, context))!
    expect(doc.outcomes).toEqual([
      { used: 11 },
      { error: "That entry is already saved." },
      { used: 3 },
      { error: 'No entry contains "nobody".' },
      {
        error:
          "That would make your notes 6001 characters; the limit is 6000. Shorten, merge or remove entries first.",
      },
    ])
    expect(doc.user).toBe("Sal")
    expect(doc.memory).toBe("")
  })

  it("keeps the creature's seed through a change of color", async () => {
    const changed = await (
      await store()
    ).commit(async (tx) => {
      const identity = await tx.doc(IdentityDoc)
      identity.avatar = { color: "honey", seed: "s7" }
      return {
        said: changeIdentity(identity, { color: "moss", personality: " Calm. " }),
        avatar: { ...identity.avatar },
        soul: identity.soul,
      }
    }, context)
    expect(changed).toEqual({
      said: { name: null, tagline: null, color: "moss" },
      avatar: { color: "moss", seed: "s7" },
      soul: "Calm.",
    })
  })
})

describe("fingerprint", () => {
  it("is the same for the same JSON and differs for other JSON", () => {
    expect(fingerprint({ a: 1, b: [2] })).toBe(fingerprint({ a: 1, b: [2] }))
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }))
    expect(fingerprint("")).toMatch(/^[0-9a-f]+$/)
  })
})

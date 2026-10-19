import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Context as ModelContext } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { BUS_UNDONE_NOTE } from "../src/bus.ts"
import { ChatsDoc, type ScheduleRecord, SchedulesDoc } from "../src/docs.ts"
import { createAgentActor } from "../src/index.ts"
import { chatRecord, entriesOf, inStore, seedChat } from "./seed.ts"

// A Dood as the bus for everyone (phase 4 of PLAN-main-bus.md) left it, opened on the code that
// rolls that back: a main chat set up for the bus, a side chat it archived and one a person had,
// a sub-agent it gave to the main chat that is still at work and one that had ended, and an
// automation whose home is the main chat.

const AGENT = "agent-1"
const namespaces: NodeActorNamespace[] = []

afterEach(async () => {
  for (const namespace of namespaces.splice(0)) await namespace.close().catch(() => {})
})

/** The agent, on a model that answers a run and a sub-agent by what they were asked. */
function open(directory: string): NodeActorNamespace {
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  faux.setResponses(
    Array.from({ length: 40 }, () => (context: ModelContext) => {
      const seen = JSON.stringify(context.messages)
      if (seen.includes("You are working as a sub-agent")) {
        return fauxAssistantMessage("The venue is booked.")
      }
      if (seen.includes("You are running the scheduled task")) {
        return fauxAssistantMessage("Sunny all day.")
      }
      return fauxAssistantMessage("Noted.")
    }),
  )
  const models = createModels()
  models.setProvider(faux.provider)
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
      }),
  })
  namespace.start()
  namespaces.push(namespace)
  return namespace
}

async function call<T>(
  namespace: NodeActorNamespace,
  path: string,
  method = "GET",
  payload?: unknown,
): Promise<T> {
  const response = await namespace.get(AGENT).fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
    }),
  )
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${body.error}`)
  return body
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15_000
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error(`Timed out; last value: ${JSON.stringify(value)}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** What is stored: the chats, and of the main chat its marks, notes and delivered reports. */
async function stored(directory: string, main: string) {
  return inStore(directory, AGENT, async (harness) => {
    const doc = (await harness.snapshot(ChatsDoc, BACKGROUND_CONTEXT))!
    const entries = await entriesOf(harness, main)
    const noteText = (entry: (typeof entries)[number]) => {
      const content = entry.model?.[0]?.content
      return typeof content === "string" ? content : ""
    }
    return {
      doc,
      marks: entries
        .filter((entry) => entry.kind === "dc.bus")
        .map((entry) => (entry.data as { on: boolean }).on),
      notes: entries.filter((entry) => entry.kind === "dc.bus-note").map(noteText),
      reports: entries.filter((entry) => entry.kind === "dc.scheduled").length,
    }
  })
}

describe("rolling back the bus for everyone", () => {
  it("brings back what it archived and moved, tells the main chat once, and delivers there", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dc-undo-bus-"))
    let agent = open(directory)
    await call(agent, "/init", "POST", { ownerId: "user-1" })
    await agent.close()

    const ids = await inStore(directory, AGENT, async (harness) => {
      const main = await seedChat(
        harness,
        chatRecord("chat", "Plans", { bus: true }),
        [
          { kind: "dc.legacy", said: "We talked before." },
          { kind: "dc.bus", data: { on: true } },
          { kind: "dc.legacy", said: "And on the bus." },
        ],
        true,
      )
      const marks = (await entriesOf(harness, main)).filter((entry) => entry.kind === "dc.bus")
      const side = await seedChat(
        harness,
        chatRecord("chat", "An aside", { archived: true, archivedBy: "bus" }),
        [{ kind: "dc.legacy", said: "An aside." }],
      )
      const put = await seedChat(harness, chatRecord("chat", "Put away", { archived: true }), [
        { kind: "dc.legacy", said: "Put away by a person." },
      ])
      const sub = (status: "working" | "done") => ({
        subagent: {
          parentId: main,
          parentBefore: side,
          task: "Book the venue.",
          status,
          reported: null,
          reports: 0,
        },
      })
      const working = await seedChat(harness, chatRecord("subagent", "Venue", sub("working")))
      const ended = await seedChat(harness, chatRecord("subagent", "Caterer", sub("done")))
      await harness.commit(async (tx) => {
        const doc = await tx.doc(ChatsDoc)
        doc.chats[main]!.busMarks = [{ at: Number(marks[0]!.id), on: true }]
        ;(await tx.doc(SchedulesDoc)).schedules.ab12 = {
          title: "Weather check",
          prompt: "Check the weather.",
          schedule: "every 6h",
          timezone: null,
          enabled: true,
          nextRunAt: Date.now() + 1_500,
          createdAt: Date.now(),
          originChatId: main,
          pending: null,
          lastRun: null,
          runCount: 0,
        } satisfies ScheduleRecord
      }, BACKGROUND_CONTEXT)
      return { main, side, put, working, ended }
    })

    // Opened, it is undone at once, and the automation's next result is delivered to the main
    // chat, as it was before every main chat was a bus.
    agent = open(directory)
    await call(agent, "/")
    await until(
      async () =>
        (await call<{ schedules: { lastRun: { outcome: string } | null }[] }>(agent, "/schedules"))
          .schedules[0]!.lastRun?.outcome,
      (outcome) => outcome !== undefined,
    )
    await agent.close()
    const after = await stored(directory, ids.main)
    expect(after.reports).toBe(1)
    const chats = after.doc.chats
    expect(chats[ids.side]).toMatchObject({ archived: false })
    expect(chats[ids.side]!.archivedBy).toBeUndefined()
    expect(chats[ids.put]).toMatchObject({ archived: true })
    expect(chats[ids.working]!.subagent).toMatchObject({ parentId: ids.side })
    expect(chats[ids.working]!.subagent!.parentBefore).toBeUndefined()
    // One that had ended reported to the main chat, and stays where its report is.
    expect(chats[ids.ended]!.subagent).toMatchObject({ parentId: ids.main })
    expect(chats[ids.ended]!.subagent!.parentBefore).toBeUndefined()
    // The main chat is told side chats are back, and the bus is taken off it, as when the switch
    // was turned off: one mark, one note for each.
    expect(after.marks).toEqual([true, false])
    expect(after.notes).toHaveLength(2)
    expect(after.notes[0]).toBe(BUS_UNDONE_NOTE)
    expect(after.notes[1]).toContain("an ordinary one again")
    expect(chats[ids.main]).toMatchObject({ bus: false })

    // Opened again, it changes nothing.
    agent = open(directory)
    await call(agent, "/")
    await call(agent, "/chats/main", "POST")
    await agent.close()
    const again = await stored(directory, ids.main)
    expect(again.marks).toEqual(after.marks)
    expect(again.notes).toEqual(after.notes)
    expect(again.doc.chats).toEqual(chats)
  })
})

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChatState, ChatSummary, NoticePart, ScheduleSummary } from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Context as ModelContext } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { ChatsDoc, type ScheduleRecord, SchedulesDoc } from "../src/docs.ts"
import { createAgentActor } from "../src/index.ts"
import { quietOnReminder } from "./quiet.ts"
import { chatRecord, entriesOf, inStore, seedChat, wakeSoon } from "./seed.ts"

// A Dood from before phase 4 of PLAN-main-bus.md: a main chat that is not a bus, a side chat, a
// sub-agent that side chat started, a run of an automation in flight that was told it could say
// [SILENT], and a thread in Slack. It is set up in its store as it was left, and then opened.

const AGENT = "agent-1"
const namespaces: NodeActorNamespace[] = []

afterEach(async () => {
  for (const namespace of namespaces.splice(0)) await namespace.close().catch(() => {})
})

/** The agent, on a model that answers a run and a sub-agent by what they were asked. */
function open(directory: string): NodeActorNamespace {
  const faux = quietOnReminder(
    fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 }),
  )
  faux.setResponses(
    Array.from({ length: 20 }, () => (context: ModelContext) => {
      const seen = JSON.stringify(context.messages)
      if (seen.includes("You are working as a sub-agent")) {
        return fauxAssistantMessage("The venue is booked.")
      }
      if (seen.includes("You are running the scheduled task")) {
        return fauxAssistantMessage("[SILENT]")
      }
      return fauxAssistantMessage("")
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
  const deadline = Date.now() + 10_000
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error(`Timed out; last value: ${JSON.stringify(value)}`)
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}

/** The marks and notes of the bus in a chat, as stored. */
async function busEntries(directory: string, chatId: string) {
  return inStore(directory, AGENT, async (harness) => {
    const entries = await entriesOf(harness, chatId)
    const doc = await harness.snapshot(ChatsDoc, BACKGROUND_CONTEXT)
    return {
      marks: entries
        .filter((entry) => entry.kind === "dc.bus")
        .map((entry) => (entry.data as { on: boolean }).on),
      notes: entries.filter((entry) => entry.kind === "dc.bus-note").length,
      record: doc!.chats[chatId]!,
    }
  })
}

const notices = (state: ChatState, kind: string) =>
  state.messages.flatMap((message) =>
    message.parts.filter(
      (part): part is NoticePart => part.type === "notice" && part.kind === kind,
    ),
  )

describe("a Dood from before every main chat was a bus", () => {
  it("is set up once as it opens: its main chat marked, its side chats archived, their work moved", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dc-migration-"))
    let agent = open(directory)
    await call(agent, "/init", "POST", { ownerId: "user-1" })
    await agent.close()

    const ids = await inStore(directory, AGENT, async (harness) => {
      const main = await seedChat(
        harness,
        chatRecord("chat", "Plans"),
        [{ kind: "dc.legacy", said: "We talked before there was a bus." }],
        true,
      )
      const side = await seedChat(harness, chatRecord("chat", "An aside"), [
        { kind: "dc.legacy", said: "An aside, from before." },
      ])
      const subagent = await seedChat(
        harness,
        chatRecord("subagent", "Venue", {
          subagent: {
            parentId: side,
            task: "Book the venue.",
            status: "working",
            reported: null,
            reports: 0,
          },
        }),
      )
      const slack = await seedChat(
        harness,
        chatRecord("slack", "Launch question", {
          slack: {
            channel: "C1",
            channelName: "launch",
            direct: false,
            thread: "1.0",
            url: null,
            status: "done",
            replied: null,
            replies: 1,
          },
        }),
        [{ kind: "dc.legacy", said: "A thread from before." }],
      )
      // A run that started before, and was told it could answer [SILENT].
      const run = await seedChat(harness, chatRecord("schedule", "Weather check"))
      await harness.commit(async (tx) => {
        const doc = await tx.doc(SchedulesDoc)
        doc.schedules.ab12 = {
          title: "Weather check",
          prompt: "Check the weather.",
          schedule: "every 6h",
          timezone: null,
          enabled: true,
          nextRunAt: Date.now() + 6 * 3_600_000,
          createdAt: Date.now(),
          originChatId: side,
          pending: { chatId: run, firedAt: Date.now() },
          lastRun: null,
          runCount: 1,
        } satisfies ScheduleRecord
      }, BACKGROUND_CONTEXT)
      return { main, side, subagent, slack, run }
    })

    wakeSoon(directory, AGENT)
    agent = open(directory)
    // The run and the sub-agent report to the main chat.
    const state = await until(
      () => call<ChatState>(agent, `/chats/${ids.main}`),
      (value) =>
        !value.busy &&
        notices(value, "automation").length === 1 &&
        notices(value, "subagent").length === 1,
    )
    expect(notices(state, "automation")[0]).toMatchObject({ text: "Weather check" })
    expect(notices(state, "subagent")[0]).toMatchObject({
      chatId: ids.subagent,
      detail: "The venue is booked.",
    })
    const [schedule] = (await call<{ schedules: ScheduleSummary[] }>(agent, "/schedules")).schedules
    expect(schedule!.lastRun).toMatchObject({ outcome: "reported" })

    // The side chat is archived and read, and its sub-agent is the main chat's.
    const { chats } = await call<{ chats: ChatSummary[] }>(agent, "/")
    expect(chats.find((one) => one.id === ids.side)).toMatchObject({ archived: true })
    expect(chats.find((one) => one.id === ids.subagent)).toMatchObject({ parentId: ids.main })
    await expect(
      call(agent, `/chats/${ids.side}/messages`, "POST", { text: "hi", requestId: "r" }),
    ).rejects.toThrow("409")
    await agent.close()

    // One mark and one note in the main chat, and nothing yet in the thread in Slack, which is
    // set up when it is next given a message.
    const main = await busEntries(directory, ids.main)
    expect(main).toMatchObject({ marks: [true], notes: 1, record: { bus: true } })
    expect(main.record.busMarks).toHaveLength(1)
    expect(await busEntries(directory, ids.slack)).toMatchObject({ marks: [], notes: 0 })

    // Opened again, it adds nothing.
    agent = open(directory)
    await call(agent, "/")
    await call(agent, "/chats/main", "POST")
    await agent.close()
    const again = await busEntries(directory, ids.main)
    expect(again).toMatchObject({ marks: [true], notes: 1 })
    expect(again.record.busMarks).toHaveLength(1)
  })

  it("marks a main chat that had the bus switched on and off once more, with the next key", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dc-migration-"))
    let agent = open(directory)
    await call(agent, "/init", "POST", { ownerId: "user-1" })
    await agent.close()

    const main = await inStore(directory, AGENT, async (harness) => {
      const id = await seedChat(
        harness,
        chatRecord("chat", "Plans", { bus: false }),
        [
          { kind: "dc.legacy", said: "Before the switch." },
          { kind: "dc.bus", data: { on: true } },
          { kind: "dc.legacy", said: "On the bus." },
          { kind: "dc.bus", data: { on: false } },
          { kind: "dc.legacy", said: "Off again." },
        ],
        true,
      )
      const entries = await entriesOf(harness, id)
      const marks = entries.filter((entry) => entry.kind === "dc.bus")
      await harness.commit(async (tx) => {
        const doc = await tx.doc(ChatsDoc)
        doc.chats[id]!.busMarks = [
          { at: Number(marks[0]!.id), on: true },
          { at: Number(marks[1]!.id), on: false },
        ]
      }, BACKGROUND_CONTEXT)
      return id
    })

    for (let open_ = 0; open_ < 2; open_++) {
      agent = open(directory)
      await call(agent, "/")
      await agent.close()
    }
    const after = await busEntries(directory, main)
    expect(after).toMatchObject({ marks: [true, false, true], notes: 1, record: { bus: true } })
    expect(after.record.busMarks!.map((mark) => mark.on)).toEqual([true, false, true])
  })
})

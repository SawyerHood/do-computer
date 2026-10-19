import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChatState, ChatSummary } from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { afterAll, describe, expect, it } from "vitest"
import { createAgentActor } from "../src/index.ts"
import { quietOnReminder } from "./quiet.ts"

const apiKey = process.env.OPENROUTER_API_KEY ?? ""
const model = process.env.DC_REVIEW_MODEL ?? "anthropic/claude-haiku-4.5"

/**
 * The note of a chat as a real small model writes it. Run with `OPENROUTER_API_KEY` set; the
 * agent's own answers are scripted, so only the notes are paid for.
 */
describe.skipIf(apiKey === "")("a chat's note, written for real", () => {
  const reports: unknown[] = []
  /** What the small model answered, each time it was asked. */
  const answers: string[] = []
  const faux = quietOnReminder(
    fauxProvider({
      provider: "test",
      models: [{ id: "model" }],
      tokensPerSecond: 50_000,
    }),
  )
  const models = createModels()
  models.setProvider(faux.provider)
  const directory = mkdtempSync(join(tmpdir(), "dc-journal-live-"))
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
        review: {
          apiKey,
          model,
          fetch: async (url, init) => {
            const response = await fetch(url, init)
            const body = (await response.clone().json()) as {
              choices?: { message?: { content?: string } }[]
            }
            answers.push(body.choices?.[0]?.message?.content ?? JSON.stringify(body))
            return response
          },
        },
        onReport: (error) => reports.push(error),
      }),
    onError: (error) => reports.push(error),
  })
  namespace.start()
  afterAll(() => namespace.close())

  async function call<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
    const response = await namespace.get("agent-1").fetch(
      new Request(`http://actor${path}`, {
        method,
        body: payload === undefined ? undefined : JSON.stringify(payload),
        headers: payload === undefined ? undefined : { "content-type": "application/json" },
      }),
    )
    return (await response.json()) as T
  }

  async function say(chatId: string, text: string): Promise<void> {
    await call(`/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
    for (let attempt = 0; attempt < 400; attempt++) {
      const state = await call<ChatState>(`/chats/${chatId}`)
      if (!state.busy && state.messages.at(-1)?.role === "assistant") return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error("The chat did not settle")
  }

  it("says what the chat came to, and saves a standing preference but not the task", async () => {
    await call("/init", "POST", { ownerId: "user-1" })
    const main = await call<ChatSummary>("/chats/main", "POST")
    faux.setResponses([
      fauxAssistantMessage(
        "I found two options for Lisbon on the 14th: TAP TP1352 at 09:40 for 212 euros, and Ryanair FR1885 at 06:10 for 148 euros.",
      ),
      fauxAssistantMessage(
        "Booked TP1352 on the 14th, seat 14C on the aisle. I have not booked a hotel yet: Alfama or Baixa?",
      ),
    ])
    await say(main.id, "Find me a flight to Lisbon on the 14th.")
    await say(
      main.id,
      "Take the TAP one. And for every flight from now on: always an aisle seat, I never check a bag.",
    )

    // Shown to a side chat, which is where the note is read.
    const seen: string[] = []
    // Two notes were asked for, one after each answer.
    for (let attempt = 0; attempt < 60 && answers.length < 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
    const { user, memory } = await call<{ user: string; memory: string }>("/")
    const side = await call<ChatSummary>("/chats/main", "POST", { title: "Other" })
    faux.setResponses([
      (context: unknown) => {
        seen.push(JSON.stringify(context))
        return fauxAssistantMessage("Hello.")
      },
    ])
    await say(side.id, "hi")
    const shown = /Where your other chats stand[^"]*/.exec(seen[0]!)?.[0] ?? ""
    console.log(
      `model: ${model}\nanswers:\n${answers.join("\n")}\nuser: ${user}\nmemory: ${memory}\nshown to the side chat: ${shown}`,
    )
    expect(reports).toEqual([])
    expect(shown).toContain("TP1352")
    // The standing preference is kept, in the store for what the person wants, and the task is not.
    expect(user.toLowerCase()).toContain("aisle")
    expect(`${user}\n${memory}`).not.toContain("TP1352")
  }, 60_000)
})

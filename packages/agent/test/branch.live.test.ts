import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChatState, ChatSummary } from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActor, createAgentModels } from "../src/index.ts"

const apiKey = process.env.OPENROUTER_API_KEY ?? ""
const MODELS = (
  process.env.DC_BRANCH_MODELS ??
  "anthropic/claude-haiku-5.5,openai/gpt-6-luna,meta/muse-spark-1.3-contributor"
).split(",")

/**
 * A side chat's first answer, on real models: what it carries of the main chat is read from the
 * provider's cache and not paid for again. Run with `OPENROUTER_API_KEY` set. Each model is sent
 * about 60,000 tokens in all, most of them read from its cache.
 */
describe.skipIf(apiKey === "")("a side chat, on a real model", () => {
  const namespaces: NodeActorNamespace[] = []
  afterEach(async () => {
    for (const namespace of namespaces.splice(0)) await namespace.close().catch(() => {})
  })

  for (const model of MODELS) {
    it(`reads the main chat from the cache of ${model}`, async () => {
      const models = createAgentModels({ openrouterApiKey: apiKey, defaultModel: model })
      const reports: unknown[] = []
      const directory = mkdtempSync(join(tmpdir(), "dc-branch-live-"))
      const namespace = new NodeActorNamespace({
        directory: join(directory, "actors"),
        blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
        factory: (host) =>
          createAgentActor(host, {
            models: models.models,
            defaultModel: models.defaultModel,
            modelOptions: models.options,
            keepAliveMs: 100,
            onReport: (error) => reports.push(error),
          }),
        onError: (error) => reports.push(error),
      })
      namespace.start()
      namespaces.push(namespace)

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
      async function say(chatId: string, text: string): Promise<ChatState> {
        await call(`/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
        for (let attempt = 0; attempt < 6_000; attempt++) {
          const state = await call<ChatState>(`/chats/${chatId}`)
          if (!state.busy && state.messages.at(-1)?.role === "assistant") return state
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        throw new Error("The chat did not settle")
      }

      await call("/init", "POST", { ownerId: "user-1" })
      const main = await call<ChatSummary>("/chats/main", "POST")
      // Notes no earlier run has sent, so nothing is in a cache before this one.
      const run = crypto.randomUUID()
      const notes = Array.from(
        { length: 400 },
        (_, index) =>
          `Note ${index} of run ${run}: box ${index % 17} was moved to shelf ${(index * 37) % 91}.`,
      ).join("\n")
      await say(main.id, `${notes}\n\nThese are my shelf notes. Reply with the one word: ready.`)
      const before = await say(main.id, "Reply with the one word: again.")

      const side = await call<ChatSummary>("/chats", "POST", {})
      const state = await say(side.id, "Reply with the one word: side.")
      expect(state.messages[0]?.parts[0]).toMatchObject({
        type: "notice",
        kind: "branch",
        text: "Continues from the main chat",
      })
      expect(reports).toEqual([])

      const option = models.options.find((entry) => entry.id === models.defaultModel)!
      // What the side chat's prompt would have cost had none of it been in the cache.
      const uncached = (state.usage.inputTokens * option.inputCost) / 1_000_000
      console.info(
        `${model}: main chat ${before.usage.inputTokens} tokens in for $${before.usage.cost.toFixed(5)}; ` +
          `side chat's first answer ${state.usage.inputTokens} tokens in for $${state.usage.cost.toFixed(5)}, ` +
          `against $${uncached.toFixed(5)} uncached`,
      )
      // It carried the main chat, and paid well under what sending it afresh costs.
      expect(state.usage.inputTokens).toBeGreaterThan(8_000)
      expect(state.usage.cost).toBeLessThan(0.6 * uncached)
    }, 180_000)
  }
})

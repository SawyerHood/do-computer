import { env } from "cloudflare:test"
import {
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  EMPTY_CHAT,
  readSse,
  reduceChat,
} from "@durable-computer/protocol"
import { durableObjectNamespace } from "@durable-computer/runtime/cloudflare"
import { describe, expect, it } from "vitest"
import type { Env } from "./worker.ts"

const namespace = durableObjectNamespace((env as unknown as Env).AGENT)

async function call<T>(agent: string, path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await namespace.get(agent).fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
    }),
  )
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
  return (await response.json()) as T
}

describe("agent actor in a Durable Object", () => {
  it("answers a message and streams it through the stub", async () => {
    const agent = "agent-workers-1"
    await call(agent, "/init", "POST", { ownerId: "user-1" })
    const chat = await call<ChatSummary>(agent, "/chats", "POST", {})

    const response = await namespace
      .get(agent)
      .fetch(new Request(`http://actor/chats/${chat.id}/events`))
    await call(agent, `/chats/${chat.id}/messages`, "POST", {
      text: "ping from workerd",
      requestId: "request-1",
    })

    let state: ChatState = EMPTY_CHAT
    const types = new Set<string>()
    for await (const event of readSse<ChatEvent>(response.body!)) {
      types.add(event.type)
      state = reduceChat(state, event)
      if (
        !state.busy &&
        state.messages.some((m) => m.role === "assistant" && m.status === "done")
      ) {
        break
      }
    }

    expect(state.messages.map((m) => m.role)).toEqual(["user", "assistant"])
    const answer = state.messages[1]!.parts[0]
    expect(answer?.type === "text" && answer.text.startsWith("You said: ping from workerd")).toBe(
      true,
    )
    expect(types.has("delta")).toBe(true)

    // A second object instance of the same agent sees what the first one stored.
    const again = await call<{ agent: { id: string }; chats: ChatSummary[] }>(agent, "/")
    expect(again.agent.id).toBe(agent)
    expect(again.chats[0]!.title).toBe("ping from workerd")
  })
})

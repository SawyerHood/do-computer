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
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { describe, expect, it } from "vitest"
import { type Env, scripted } from "./worker.ts"

const bindings = env as unknown as Env
const namespace = durableObjectNamespace(bindings.AGENT)
const scriptedNamespace = durableObjectNamespace(bindings.SCRIPTED)

async function call<T>(
  agent: string,
  path: string,
  method = "GET",
  payload?: unknown,
  target = namespace,
): Promise<T> {
  const response = await target.get(agent).fetch(
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

describe("agent computer in a Durable Object", () => {
  it("runs the shell and keeps files in Durable Object storage", async () => {
    const agent = "agent-workers-computer"
    const scriptedCall = <T>(path: string, method = "GET", payload?: unknown) =>
      call<T>(agent, path, method, payload, scriptedNamespace)
    await scriptedCall("/init", "POST", { ownerId: "user-1" })
    const chat = await scriptedCall<ChatSummary>("/chats", "POST", {})

    const run = async (command: string) => {
      scripted.setResponses([
        fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" }),
        fauxAssistantMessage("done"),
      ])
      const response = await scriptedNamespace
        .get(agent)
        .fetch(new Request(`http://actor/chats/${chat.id}/events`))
      await scriptedCall(`/chats/${chat.id}/messages`, "POST", {
        text: command,
        requestId: crypto.randomUUID(),
      })
      let state: ChatState = EMPTY_CHAT
      let started = false
      for await (const event of readSse<ChatEvent>(response.body!)) {
        state = reduceChat(state, event)
        started ||= state.busy
        if (started && !state.busy) break
      }
      const tool = state.messages.flatMap((m) => m.parts).findLast((part) => part.type === "tool")
      return tool?.type === "tool" ? tool : undefined
    }

    // 1.5 MB crosses the per-row limit of Durable Object SQLite, so it is stored in pieces.
    const written = await run(
      "mkdir -p data && printf '%1500000s' x > data/big.txt && echo hello > data/note.txt && wc -c < data/big.txt",
    )
    expect(written?.status).toBe("done")
    expect(written?.output?.trim()).toBe("1500000")

    const read = await run("cat data/note.txt && wc -c < data/big.txt && cat IDENTITY.md")
    expect(read?.output).toContain("hello\n1500000")
    expect(read?.output).toContain("name:")
  })
})

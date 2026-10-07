import { env } from "cloudflare:test"
import {
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  type ConnectorResult,
  EMPTY_CHAT,
  readSse,
  reduceChat,
} from "@durable-computer/protocol"
import { durableObjectNamespace } from "@durable-computer/runtime/cloudflare"
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { describe, expect, it } from "vitest"
import { CONNECTOR_REDIRECT_HEADER } from "../../src/index.ts"
import { GOOD_CODE } from "../fake-mcp.ts"
import { type Env, mcp, scripted } from "./worker.ts"

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

describe("sub-agents in a Durable Object", () => {
  it("has a sub-agent work in its own chat and report back to the one that started it", async () => {
    const agent = "agent-workers-subagent"
    await call(agent, "/init", "POST", { ownerId: "user-1" })
    const chat = await call<ChatSummary>(agent, "/chats", "POST", {})
    await call(agent, `/chats/${chat.id}/messages`, "POST", {
      text: '/tool subagent {"action":"start","title":"Flights","task":"Find flights to Lisbon"}',
      requestId: "request-1",
    })

    // The report arrives by itself, and the agent is given a turn over it.
    const said = (state: ChatState) =>
      state.messages
        .flatMap((message) => message.parts)
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
    let state: ChatState = EMPTY_CHAT
    for (let attempt = 0; attempt < 150; attempt++) {
      state = await call<ChatState>(agent, `/chats/${chat.id}`)
      if (!state.busy && said(state).some((text) => text.includes("has reported back"))) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const { chats } = await call<{ chats: ChatSummary[] }>(agent, "/")
    const subagent = chats.find((entry) => entry.kind === "subagent")
    expect(subagent).toMatchObject({ title: "Flights", parentId: chat.id, status: "done" })
    const word = state.messages
      .flatMap((message) => message.parts)
      .find((part) => part.type === "notice" && part.kind === "subagent")
    expect(word).toMatchObject({ text: "Flights", chatId: subagent!.id, outcome: "reported" })
    expect(said(state).at(-1)).toContain('[Your sub-agent "Flights"')
    // Its chat is the agent's to write in.
    await expect(
      call(agent, `/chats/${subagent!.id}/messages`, "POST", { text: "hi", requestId: "direct" }),
    ).rejects.toThrow("409")
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

describe("connectors in a Durable Object", () => {
  it("signs in to a service, keeps the grant in the object's storage, and calls its tools", async () => {
    const agent = "agent-workers-connectors"
    const scriptedCall = <T>(path: string, method = "GET", payload?: unknown) =>
      call<T>(agent, path, method, payload, scriptedNamespace)
    await scriptedCall("/init", "POST", { ownerId: "user-1" })

    const added = await scriptedNamespace.get(agent).fetch(
      new Request("http://actor/connectors", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONNECTOR_REDIRECT_HEADER]: "https://app.example/api/connectors/callback",
        },
        body: JSON.stringify({ name: "Sums", url: mcp.url }),
      }),
    )
    expect(added.status).toBe(200)
    const pending = (await added.json()) as ConnectorResult & { state?: string }
    expect(pending.connector.status).toBe("needs_auth")
    expect(pending.state).toBeTruthy()
    // PKCE, which needs Web Crypto, was set up inside the Workers runtime.
    expect(new URL(pending.authorizationUrl!).searchParams.get("code_challenge_method")).toBe(
      "S256",
    )

    const authorized = await scriptedCall<ConnectorResult>(
      `/connectors/${pending.connector.id}/authorize`,
      "POST",
      { code: GOOD_CODE },
    )
    expect(authorized.connector.status).toBe("connected")
    expect(authorized.connector.tools.map((tool) => tool.name)).toContain("add")

    const chat = await scriptedCall<ChatSummary>("/chats", "POST", {})
    scripted.setResponses([
      fauxAssistantMessage([fauxToolCall("sums__add", { a: 20, b: 22 })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ])
    const response = await scriptedNamespace
      .get(agent)
      .fetch(new Request(`http://actor/chats/${chat.id}/events`))
    await scriptedCall(`/chats/${chat.id}/messages`, "POST", {
      text: "add them",
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
    expect(tool?.type === "tool" && tool.status).toBe("done")
    expect(tool?.type === "tool" && tool.output).toBe("42")
    // The service saw the granted token, which the model never did.
    expect(mcp.calls.at(-1)?.authorization).toMatch(/^Bearer /)
  })
})

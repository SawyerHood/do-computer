import { env } from "cloudflare:test"
import {
  type AgentSocketMessage,
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  type ConnectorResult,
  digest,
  EMPTY_CHAT,
  readSse,
  reduceChat,
} from "@durable-computer/protocol"
import { durableObjectNamespace } from "@durable-computer/runtime/cloudflare"
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { describe, expect, it } from "vitest"
import { CONNECTOR_REDIRECT_HEADER } from "../../src/index.ts"
import { GOOD_CODE } from "../fake-mcp.ts"
import { type Env, mcp, PEERS, scripted } from "./worker.ts"

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

describe("an agent's chats in a Durable Object", () => {
  it("branches a side chat off the main one, and finds what was said in the object's own table", async () => {
    const agent = "agent-workers-chats"
    await call(agent, "/init", "POST", { ownerId: "user-1" })
    const main = await call<ChatSummary>(agent, "/chats/main", "POST")
    await call(agent, `/chats/${main.id}/messages`, "POST", {
      text: "the ferry leaves at noon",
      requestId: "request-1",
    })
    let state = EMPTY_CHAT
    for (let attempt = 0; attempt < 400; attempt++) {
      state = await call<ChatState>(agent, `/chats/${main.id}`)
      if (!state.busy && state.messages.at(-1)?.role === "assistant") break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(state.messages.map((m) => m.role)).toEqual(["user", "assistant"])

    // The side chat carries those messages, and shows only where its own begin.
    const side = await call<ChatSummary>(agent, "/chats", "POST", { title: "Aside" })
    const opened = await call<ChatState>(agent, `/chats/${side.id}`)
    expect(opened.messages.map((m) => m.parts[0])).toMatchObject([
      { type: "notice", kind: "branch" },
    ])

    const found = await call<{ hits: { chatId: string }[]; complete: boolean }>(
      agent,
      "/search?q=ferry%20noon",
    )
    expect(found.complete).toBe(true)
    expect(found.hits.map((hit) => hit.chatId)).toEqual([main.id, main.id])
    // Asked again, with the table already filled.
    const again = await call<{ hits: unknown[] }>(agent, "/search?q=FERRY")
    expect(again.hits).toHaveLength(2)
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

describe("messages between agents in Durable Objects", () => {
  it("reach another agent's object, whose answer comes back to the one that asked", async () => {
    const [ada, bo] = PEERS as [string, string]
    for (const agent of PEERS) await call(agent, "/init", "POST", { ownerId: "user-1" })
    const chat = await call<ChatSummary>(ada, "/chats", "POST", {})
    await call(ada, `/chats/${chat.id}/messages`, "POST", {
      text: `/tool agents {"action":"message","to":"${bo}","message":"When is the launch?"}`,
      requestId: "request-1",
    })

    // The reply arrives by itself, and the agent that asked is given a turn over it.
    const said = (state: ChatState) =>
      state.messages
        .flatMap((message) => message.parts)
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
    let state: ChatState = EMPTY_CHAT
    for (let attempt = 0; attempt < 150; attempt++) {
      state = await call<ChatState>(ada, `/chats/${chat.id}`)
      if (!state.busy && said(state).some((text) => text.includes("has replied"))) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const { chats } = await call<{ chats: ChatSummary[] }>(bo, "/")
    const thread = chats.find((entry) => entry.kind === "agent")
    expect(thread).toMatchObject({
      title: "When is the launch?",
      status: "done",
      peer: { agentId: ada, chatId: chat.id },
    })
    const word = state.messages
      .flatMap((message) => message.parts)
      .find((part) => part.type === "notice" && part.kind === "agent")
    expect(word).toMatchObject({ agentId: bo, chatId: thread!.id, outcome: "reported" })
    expect(word).toMatchObject({ detail: expect.stringContaining("When is the launch?") })
    expect(said(state).at(-1)).toContain("the agent you sent a message to")
    // The conversation is the two agents' to write in.
    await expect(
      call(bo, `/chats/${thread!.id}/messages`, "POST", { text: "hi", requestId: "direct" }),
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

    const read = await run("cat data/note.txt && wc -c < data/big.txt && pwd")
    expect(read?.output).toContain("hello\n1500000")
    expect(read?.output).toContain("/workspace")
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

describe("an agent followed over a socket, in a Durable Object", () => {
  /** A socket to the agent, as the gateway hands one on, and everything heard on it. */
  async function connect(agent: string) {
    const response = await bindings.AGENT.get(bindings.AGENT.idFromName(agent)).fetch(
      new Request("http://actor/socket", {
        headers: { upgrade: "websocket", "x-dc-actor-name": agent },
      }),
    )
    const socket = response.webSocket
    if (response.status !== 101 || socket === null) throw new Error("The agent did not upgrade")
    const heard: AgentSocketMessage[] = []
    let waiting: (() => void)[] = []
    socket.addEventListener("message", (event) => {
      heard.push(JSON.parse(String(event.data)) as AgentSocketMessage)
      for (const look of waiting.splice(0)) look()
    })
    socket.accept()
    const until = (done: () => boolean) =>
      new Promise<void>((resolve) => {
        const look = () => (done() ? resolve() : void waiting.push(look))
        look()
      })
    const chat = (chatId: string) =>
      heard.reduce(
        (state, message) =>
          message.type === "chat" && message.chat === chatId
            ? reduceChat(state, message.event)
            : state,
        EMPTY_CHAT,
      )
    return { socket, heard, until, chat }
  }

  const answers = (state: ChatState) =>
    state.busy
      ? -1
      : state.messages.filter((m) => m.role === "assistant" && m.status === "done").length

  it(
    "is put away with the socket still connected, and comes back to it where it left off",
    { timeout: 60_000 },
    async () => {
      const agent = "agent-workers-socket"
      await call(agent, "/init", "POST", { ownerId: "user-1" })
      const chat = await call<ChatSummary>(agent, "/chats", "POST", {})
      const { socket, heard, until, chat: held } = await connect(agent)
      socket.send(JSON.stringify({ type: "follow", chat: chat.id }))
      await call(agent, `/chats/${chat.id}/messages`, "POST", { text: "first", requestId: "1" })
      await until(() => answers(held(chat.id)) === 1)
      expect(heard[0]).toMatchObject({ type: "agent", event: { type: "ready" } })
      expect(heard.some((message) => message.type === "resumed")).toBe(false)

      // Left alone, with nothing to do and its socket open, the object is unloaded. A stream
      // in the socket's place would have kept it in memory for as long as it was open.
      // What follows an answer is told first.
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      const before = heard.length
      const stood = digest(held(chat.id))
      await new Promise((resolve) => setTimeout(resolve, 14_000))
      expect(heard).toHaveLength(before)

      await call(agent, `/chats/${chat.id}/messages`, "POST", { text: "second", requestId: "2" })
      await until(() => answers(held(chat.id)) === 2)
      const since = heard.slice(before)
      // It came back with nothing in memory, and said where things stand: where they stood.
      expect(since[0]).toMatchObject({ type: "resumed", chats: { [chat.id]: stood } })
      // So the chat was not sent again, and the answer arrived as changes to what was held.
      const kinds = since.flatMap((message) =>
        message.type === "chat" ? [message.event.type] : [],
      )
      expect(kinds).not.toContain("snapshot")
      expect(held(chat.id).messages.map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant",
      ])
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      expect(JSON.parse(JSON.stringify(held(chat.id)))).toEqual(
        await call<ChatState>(agent, `/chats/${chat.id}`),
      )
      expect(digest(held(chat.id))).toBe(digest(await call<ChatState>(agent, `/chats/${chat.id}`)))
      socket.close(1000)
    },
  )
})

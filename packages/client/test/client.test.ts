import {
  type ChatEvent,
  type ChatState,
  EMPTY_CHAT,
  encodeSse,
  SSE_HEARTBEAT,
  SSE_HEARTBEAT_MS,
} from "@durable-computer/protocol"
import { describe, expect, it, vi } from "vitest"
import { ApiError, createClient } from "../src/index.ts"

function sse(events: ChatEvent[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(encodeSse(event))
        controller.close()
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  )
}

describe("client", () => {
  it("turns an error response into an ApiError with its code", async () => {
    const client = createClient({
      baseUrl: "http://app",
      fetch: async () =>
        Response.json({ error: "Sign in first", code: "unauthenticated" }, { status: 401 }),
    })
    const error = await client.me().catch((caught) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 401, code: "unauthenticated", message: "Sign in first" })
  })

  it("sends JSON with credentials and any extra headers", async () => {
    let seen: Request | undefined
    const client = createClient({
      baseUrl: "http://app",
      headers: () => ({ cookie: "session=abc" }),
      fetch: async (input, init) => {
        seen = new Request(input, init)
        return Response.json({ submissionId: "7" })
      },
    })
    await client.agent("a 1").send("3", { text: "hi", requestId: "r" })
    expect(seen?.url).toBe("http://app/api/agents/a%201/chats/3/messages")
    expect(seen?.headers.get("content-type")).toBe("application/json")
    expect(seen?.headers.get("cookie")).toBe("session=abc")
    expect(await seen?.json()).toEqual({ text: "hi", requestId: "r" })
  })

  it("reconnects a dropped chat stream and resumes from the new snapshot", async () => {
    const first: ChatState = {
      ...EMPTY_CHAT,
      busy: true,
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }], status: "done" }],
    }
    const second: ChatState = {
      ...first,
      busy: false,
      messages: [
        ...first.messages,
        { id: "2", role: "assistant", parts: [{ type: "text", text: "hello" }], status: "done" },
      ],
    }
    let connections = 0
    const client = createClient({
      baseUrl: "",
      fetch: async () => {
        connections++
        // The first connection drops after its snapshot; the second carries the rest.
        return connections === 1
          ? sse([{ type: "snapshot", state: first }])
          : sse([
              { type: "snapshot", state: first },
              { type: "message", message: second.messages[1]! },
              { type: "busy", busy: false },
            ])
      },
    })
    const states: ChatState[] = []
    const statuses: string[] = []
    const done = Promise.withResolvers<void>()
    const subscription = client.agent("a").watchChat(
      "1",
      (state) => {
        states.push(state)
        if (!state.busy) done.resolve()
      },
      (status) => statuses.push(status),
    )
    await done.promise
    subscription.close()
    expect(states.at(-1)).toEqual(second)
    expect(connections).toBe(2)
    expect(statuses.slice(0, 4)).toEqual(["connecting", "open", "reconnecting", "open"])
  })

  it("asks again for a stream that has gone quiet without ending", async () => {
    vi.useFakeTimers()
    try {
      const state: ChatState = { ...EMPTY_CHAT, busy: true }
      const given: AbortSignal[] = []
      const beats: ReadableStreamDefaultController<Uint8Array>[] = []
      const client = createClient({
        baseUrl: "",
        fetch: async (_input, init) => {
          given.push(init!.signal!)
          // Neither connection ever ends. The second is told the chat is no longer busy.
          const later = given.length > 1
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                beats.push(controller)
                controller.enqueue(
                  encodeSse({ type: "snapshot", state: { ...state, busy: !later } }),
                )
                init!.signal!.addEventListener("abort", () => controller.error(new Error("gone")))
              },
            }),
          )
        },
      })
      const states: ChatState[] = []
      const subscription = client.agent("a").watchChat("1", (next) => states.push(next))
      await vi.advanceTimersByTimeAsync(0)
      expect(states.at(-1)?.busy).toBe(true)

      // One that still sends its heartbeat is kept, however long it has nothing to say.
      for (let beat = 0; beat < 6; beat++) {
        await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_MS)
        beats[0]!.enqueue(SSE_HEARTBEAT)
      }
      await vi.advanceTimersByTimeAsync(0)
      expect(given).toHaveLength(1)

      // Then nothing at all: it is given up, and the chat is read again from the start.
      await vi.advanceTimersByTimeAsync(3 * SSE_HEARTBEAT_MS + 1_000)
      expect(given[0]!.aborted).toBe(true)
      expect(given).toHaveLength(2)
      expect(states.at(-1)?.busy).toBe(false)
      subscription.close()
      expect(given[1]!.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("asks again for a stream the server never answered", async () => {
    vi.useFakeTimers()
    try {
      const given: AbortSignal[] = []
      const client = createClient({
        baseUrl: "",
        fetch: (_input, init) => {
          given.push(init!.signal!)
          // The first is never answered, as by a server that is stuck. The second is.
          if (given.length === 1) {
            return new Promise<Response>((_resolve, reject) => {
              init!.signal!.addEventListener("abort", () => reject(new Error("gone")))
            })
          }
          return Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(encodeSse({ type: "snapshot", state: EMPTY_CHAT }))
                },
              }),
            ),
          )
        },
      })
      const states: ChatState[] = []
      const subscription = client.agent("a").watchChat("1", (next) => states.push(next))
      await vi.advanceTimersByTimeAsync(3 * SSE_HEARTBEAT_MS - 1_000)
      expect(given).toHaveLength(1)
      expect(given[0]!.aborted).toBe(false)

      await vi.advanceTimersByTimeAsync(2_000)
      expect(given[0]!.aborted).toBe(true)
      expect(given).toHaveLength(2)
      expect(states).toHaveLength(1)
      subscription.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("stops instead of retrying a stream the server refuses", async () => {
    let connections = 0
    const client = createClient({
      baseUrl: "",
      fetch: async () => {
        connections++
        return Response.json({ error: "Chat not found" }, { status: 404 })
      },
    })
    const closed = Promise.withResolvers<void>()
    client.agent("a").watchChat(
      "nope",
      () => {},
      (status) => status === "closed" && closed.resolve(),
    )
    await closed.promise
    expect(connections).toBe(1)
  })
})

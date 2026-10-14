import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  CALL_VOICES,
  type CallsState,
  callVoice,
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  EMPTY_CHAT,
  readSse,
  reduceChat,
  type StartCallResponse,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import type { Context as FauxContext } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import type { CallAllowance, CallDirectory } from "../src/calls.ts"
import { callMeta, callOf, parseSummary, readLines, voiceContext } from "../src/calls.ts"
import { CALLER_HEADER, encodeCaller } from "../src/caller.ts"
import { createAgentActor } from "../src/index.ts"

const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
const ANSWER = "v=0\r\no=- 3 4 IN IP4 0.0.0.0\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

type World = {
  agents: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
  /** What the voice's provider was asked, and what it answers. */
  provider: Sent[]
  answer: () => Response
  /** What the small model was asked, and what it answers. */
  summaries: string[]
  summary: string
  allowance: CallAllowance
  spent: { caller: string | null; seconds: number }[]
  /** How far ahead of the real clock the agents' clock is. */
  ahead: number
}
const worlds: World[] = []

function open(): World {
  const root = mkdtempSync(join(tmpdir(), "dc-calls-"))
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const world: World = {
    agents: undefined as unknown as NodeActorNamespace,
    faux,
    reports: [],
    provider: [],
    answer: () => new Response(ANSWER, { status: 201 }),
    summaries: [],
    summary: JSON.stringify({ lines: ["You decided to wait until Friday."] }),
    allowance: {
      pass: {
        dialect: "codex",
        accessToken: "token-1",
        accountId: "account-1",
        paidBy: "workspace",
      },
      maxSeconds: 1_800,
      quietSeconds: 120,
    },
    spent: [],
    ahead: 0,
  }
  const directory: CallDirectory = {
    allow: async () => world.allowance,
    spent: async (caller, seconds) => {
      world.spent.push({ caller, seconds })
    },
  }
  world.agents = new NodeActorNamespace({
    directory: join(root, "agents"),
    blobs: (name) => fileBlobs(join(root, "blobs", encodeURIComponent(name))),
    now: () => Date.now() + world.ahead,
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
        computers: { kinds: [], default: "", create: () => undefined },
        calls: directory,
        callFetch: async (url, init) => {
          world.provider.push({
            url,
            headers: init.headers as Record<string, string>,
            body: JSON.parse(String(init.body)) as Record<string, unknown>,
          })
          return world.answer()
        },
        review: {
          apiKey: "small-key",
          model: "small/model",
          fetch: async (_url, init) => {
            world.summaries.push(String(init.body))
            return Response.json({ choices: [{ message: { content: world.summary } }] })
          },
        },
        onReport: (error) => world.reports.push(error),
      }),
    onError: (error) => world.reports.push(error),
  })
  world.agents.start()
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.agents.close().catch(() => {})
})

const SAWYER = { id: "user-1", name: "Sawyer" }
const JON = { id: "user-2", name: "Jon" }

async function ask(
  world: World,
  path: string,
  method = "GET",
  payload?: unknown,
  caller = SAWYER,
): Promise<Response> {
  return world.agents.get("agent-1").fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: {
        [CALLER_HEADER]: encodeCaller(caller),
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
      },
    }),
  )
}

async function call<T>(
  world: World,
  path: string,
  method = "GET",
  payload?: unknown,
  caller = SAWYER,
): Promise<T> {
  const response = await ask(world, path, method, payload, caller)
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error ?? ""}`)
  return result
}

async function setup(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  await call(world, "/", "PATCH", {
    name: "Juniper",
    soul: "Dry, quick, kind.",
    user: "Sawyer likes teal.",
  })
  return call<ChatSummary>(world, "/chats", "POST", {})
}

async function converse(
  world: World,
  chatId: string,
  message: Record<string, unknown>,
): Promise<ChatState> {
  const response = await ask(world, `/chats/${chatId}/events`)
  await call(world, `/chats/${chatId}/messages`, "POST", {
    requestId: crypto.randomUUID(),
    ...message,
  })
  let state = EMPTY_CHAT
  let started = false
  for await (const event of readSse<ChatEvent>(response.body!)) {
    state = reduceChat(state, event)
    started ||= state.busy
    if (started && !state.busy) break
  }
  return state
}

const chatOf = (world: World, chatId: string) => call<ChatState>(world, `/chats/${chatId}`)

/** What the model was last sent, as the text of each block of its last user message. */
function lastSeen(context: FauxContext): string[] {
  const user = context.messages.findLast((message) => message.role === "user")
  if (user === undefined || typeof user.content === "string") return []
  return user.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
}

describe("whether an agent can be called", () => {
  it("says it can, of what kind, and in which voice", async () => {
    const world = open()
    await setup(world)
    const state = await call<CallsState>(world, "/calls")
    expect(state).toEqual({
      available: true,
      dialect: "codex",
      paidBy: "workspace",
      voices: [...CALL_VOICES.codex],
      voice: callVoice("codex", "agent-1"),
    })
    expect(CALL_VOICES.codex).toContain(state.voice)
  })

  it("says why it cannot", async () => {
    const world = open()
    const chat = await setup(world)
    world.allowance = { refused: "admins" }
    expect(await call<CallsState>(world, "/calls")).toEqual({
      available: false,
      reason: "admins",
      voices: [],
      voice: null,
    })
    const refused = await ask(world, "/calls", "POST", { chatId: chat.id, sdp: OFFER })
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ code: "admins" })
  })

  it("keeps a voice that was chosen, where the call can speak in it", async () => {
    const world = open()
    await setup(world)
    await call(world, "/", "PATCH", { voice: "Ember" })
    expect((await call<CallsState>(world, "/calls")).voice).toBe("ember")
    // A voice of another kind of call is passed over, not refused: the kind can change.
    await call(world, "/", "PATCH", { voice: "marin" })
    expect((await call<CallsState>(world, "/calls")).voice).toBe(callVoice("codex", "agent-1"))
    await call(world, "/", "PATCH", { voice: null })
    expect((await ask(world, "/", "PATCH", { voice: "not a voice!" })).status).toBe(400)
  })
})

describe("starting a call", () => {
  it("asks a ChatGPT sign-in for one, with who the voice is and what was said before", async () => {
    const world = open()
    const chat = await setup(world)
    world.faux.setResponses([fauxAssistantMessage("Ticked it off, and the test starts today.")])
    await converse(world, chat.id, { text: "The one-row layout shipped this morning." })

    const { call: started } = await call<StartCallResponse>(world, "/calls", "POST", {
      chatId: chat.id,
      sdp: OFFER,
    })
    expect(started).toMatchObject({
      dialect: "codex",
      sdp: ANSWER,
      voice: callVoice("codex", "agent-1"),
      maxSeconds: 1_800,
      quietSeconds: 120,
    })
    const [sent] = world.provider
    expect(sent!.url).toBe(
      "https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas",
    )
    expect(sent!.headers).toMatchObject({
      authorization: "Bearer token-1",
      "chatgpt-account-id": "account-1",
      "openai-alpha": "quicksilver=v2",
      originator: "do-computer",
    })
    const session = sent!.body.session as Record<string, unknown>
    expect(sent!.body.sdp).toBe(OFFER)
    expect(session).toMatchObject({
      model: "gpt-live-1-codex",
      audio: { output: { voice: started.voice } },
      delegation: { type: "client" },
      initial_items: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "The one-row layout shipped this morning." }],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Ticked it off, and the test starts today." }],
        },
      ],
    })
    expect(session.instructions).toContain("You are Juniper")
    expect(session.instructions).toContain("Dry, quick, kind.")
    expect(session.instructions).toContain("Sawyer likes teal.")
    // The sign-in is the server's to hold: it is not in what the device is handed.
    expect(JSON.stringify(started)).not.toContain("token-1")
  })

  it("asks an OpenAI key for one on the public route, where that is what there is", async () => {
    const world = open()
    const chat = await setup(world)
    world.allowance = {
      pass: { dialect: "openai", apiKey: "sk-test", paidBy: "server" },
      maxSeconds: 600,
      quietSeconds: 120,
    }
    world.answer = () =>
      Response.json(
        { session: { id: "live_1" }, transport: { type: "webrtc", sdp: ANSWER } },
        { status: 201 },
      )
    const { call: started } = await call<StartCallResponse>(world, "/calls", "POST", {
      chatId: chat.id,
      sdp: OFFER,
    })
    expect(started).toMatchObject({ dialect: "openai", sdp: ANSWER, maxSeconds: 600 })
    expect(CALL_VOICES.openai).toContain(started.voice)
    const [sent] = world.provider
    expect(sent!.url).toBe("https://api.openai.com/v1/live/sessions")
    expect(sent!.headers.authorization).toBe("Bearer sk-test")
    expect(sent!.body).toMatchObject({
      session: {
        model: "gpt-live-1",
        delegation: { type: "client" },
        audio: { output: { voice: started.voice } },
        input: [],
      },
      transport: { type: "webrtc", sdp: OFFER },
    })
  })

  it("says what the provider said when it will not", async () => {
    const world = open()
    const chat = await setup(world)
    world.answer = () =>
      Response.json({ error: { message: "Voice session access denied." } }, { status: 403 })
    const refused = await ask(world, "/calls", "POST", { chatId: chat.id, sdp: OFFER })
    expect(refused.status).toBe(502)
    expect(((await refused.json()) as { error: string }).error).toContain(
      "Voice session access denied.",
    )
    // Nothing is left behind of a call that never was.
    world.answer = () => new Response(ANSWER, { status: 201 })
    await call(world, "/calls", "POST", { chatId: chat.id, sdp: OFFER })
  })

  it("wants an offer, and a chat a person talks in", async () => {
    const world = open()
    const chat = await setup(world)
    expect((await ask(world, "/calls", "POST", { chatId: chat.id, sdp: "hello" })).status).toBe(400)
    expect((await ask(world, "/calls", "POST", { chatId: "999", sdp: OFFER })).status).toBe(409)
    expect(world.provider).toHaveLength(0)
  })
})

describe("what is said on a call", () => {
  it("reaches the agent with what it hands on, and is answered for the ear", async () => {
    const world = open()
    const chat = await setup(world)
    const { call: started } = await call<StartCallResponse>(world, "/calls", "POST", {
      chatId: chat.id,
      sdp: OFFER,
    })
    await call(world, `/calls/${started.id}/lines`, "POST", {
      lines: [
        { who: "you", text: "Hey Juniper, how did the pricing test do overnight?" },
        { who: "dood", text: "Morning! One second, I'll pull the numbers." },
        { who: "nobody", text: "not a line" },
        { who: "you", text: "   " },
      ],
    })
    let seen: string[] = []
    world.faux.setResponses([
      (context) => {
        seen = lastSeen(context)
        return fauxAssistantMessage("Sign-ups are at 3.9 percent, up from 3.4.")
      },
    ])
    const state = await converse(world, chat.id, {
      text: "How did the pricing test do overnight?",
      call: started.id,
    })
    // The agent reads the request, and beside it that it was spoken and what else was said.
    expect(seen[0]).toBe("How did the pricing test do overnight?")
    const note = seen.find((text) => callOf(text) !== undefined)!
    expect(callOf(note)).toBe(started.id)
    expect(note).toContain("said out loud")
    expect(note).toContain("They: Hey Juniper, how did the pricing test do overnight?")
    expect(note).toContain("Juniper: Morning! One second, I'll pull the numbers.")
    expect(note).not.toContain("not a line")
    // A person sees what they said, marked as spoken, and none of the note.
    const said = state.messages.find((message) => message.role === "user")!
    expect(said.spoken).toBe(true)
    expect(said.parts).toEqual([{ type: "text", text: "How did the pricing test do overnight?" }])

    // What it has been shown once it is not shown again.
    await call(world, `/calls/${started.id}/lines`, "POST", {
      lines: [{ who: "you", text: "Give it till Friday." }],
    })
    world.faux.setResponses([
      (context) => {
        seen = lastSeen(context)
        return fauxAssistantMessage("Friday it is.")
      },
    ])
    await converse(world, chat.id, { text: "Give it till Friday.", call: started.id })
    const second = seen.find((text) => callOf(text) !== undefined)!
    expect(second).toContain("They: Give it till Friday.")
    expect(second).not.toContain("pricing test")
  })

  it("is not taken from someone the call is not theirs", async () => {
    const world = open()
    const chat = await setup(world)
    const { call: started } = await call<StartCallResponse>(world, "/calls", "POST", {
      chatId: chat.id,
      sdp: OFFER,
    })
    const lines = { lines: [{ who: "you", text: "Hello" }] }
    expect((await ask(world, `/calls/${started.id}/lines`, "POST", lines, JON)).status).toBe(403)
    expect((await ask(world, `/calls/${started.id}/end`, "POST", {}, JON)).status).toBe(403)
    // Nor can they start one while it lasts.
    const busy = await ask(world, "/calls", "POST", { chatId: chat.id, sdp: OFFER }, JON)
    expect(busy.status).toBe(409)
    expect(await busy.json()).toMatchObject({ code: "busy" })
  })
})

describe("the end of a call", () => {
  it("leaves one record in the chat: how long, what came of it, what was said", async () => {
    const world = open()
    const chat = await setup(world)
    world.allowance = {
      pass: { dialect: "codex", accessToken: "token-1", accountId: "account-1", paidBy: "server" },
      maxSeconds: 1_800,
      quietSeconds: 120,
    }
    const { call: started } = await call<StartCallResponse>(world, "/calls", "POST", {
      chatId: chat.id,
      sdp: OFFER,
    })
    await call(world, `/calls/${started.id}/lines`, "POST", {
      lines: [{ who: "you", text: "How did the test do?" }],
    })
    world.ahead += 61_000
    await call(world, `/calls/${started.id}/end`, "POST", {
      lines: [
        { who: "dood", text: "Sign-ups are at 3.9 percent." },
        { who: "you", text: "Give it till Friday." },
      ],
    })
    const state = await chatOf(world, chat.id)
    const record = state.messages.at(-1)!
    expect(record.role).toBe("notice")
    expect(record.parts).toEqual([
      {
        type: "notice",
        kind: "call",
        text: "1 min",
        call: {
          id: started.id,
          seconds: 61,
          summary: ["You decided to wait until Friday."],
          lines: [
            { who: "you", text: "How did the test do?" },
            { who: "dood", text: "Sign-ups are at 3.9 percent." },
            { who: "you", text: "Give it till Friday." },
          ],
        },
      },
    ])
    // The small model was shown what was said, by name.
    expect(world.summaries).toHaveLength(1)
    expect(world.summaries[0]).toContain("Juniper: Sign-ups are at 3.9 percent.")
    // The server's own sign-in paid, so the minute is the caller's to have used.
    expect(world.spent).toEqual([{ caller: "user-1", seconds: 61 }])

    // The agent remembers it: what it was not shown is in what it next reads.
    let seen: string[] = []
    world.faux.setResponses([
      (context) => {
        seen = context.messages.flatMap((message) =>
          message.role !== "user"
            ? []
            : typeof message.content === "string"
              ? [message.content]
              : message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])),
        )
        return fauxAssistantMessage("Friday.")
      },
    ])
    await converse(world, chat.id, { text: "When does the test end?" })
    const note = seen.find((text) => text.startsWith('<meta kind="call-ended">'))!
    expect(note).toContain("The voice call ended after 1 min.")
    expect(note).toContain("They: Give it till Friday.")

    // Ending it again changes nothing, and it is gone for whoever asks after it.
    await call(world, `/calls/${started.id}/end`, "POST", {})
    expect((await chatOf(world, chat.id)).messages.filter((m) => m.role === "notice")).toHaveLength(
      1,
    )
    expect((await ask(world, `/calls/${started.id}/lines`, "POST", { lines: [] })).status).toBe(404)
    expect(world.reports).toEqual([])
  })

  it("is written up at its time where nobody ended it", async () => {
    const world = open()
    const chat = await setup(world)
    world.allowance = { ...world.allowance, maxSeconds: 60 } as CallAllowance
    world.summary = "not json"
    const { call: started } = await call<StartCallResponse>(world, "/calls", "POST", {
      chatId: chat.id,
      sdp: OFFER,
    })
    await call(world, `/calls/${started.id}/lines`, "POST", {
      lines: [{ who: "you", text: "Hello?" }],
    })
    // The device went away. Past the call's time, the next anyone asks of the agent finds it over.
    world.ahead += 5 * 60_000
    await call<CallsState>(world, "/calls", "POST", { chatId: chat.id, sdp: OFFER })
    const notices = (await chatOf(world, chat.id)).messages.filter((m) => m.role === "notice")
    expect(notices).toHaveLength(1)
    const part = notices[0]!.parts[0]!
    // It lasted as long as it was allowed, and what could not be read as a summary is left out.
    expect(part).toMatchObject({ kind: "call", text: "1 min", call: { seconds: 60, summary: [] } })
    // A workspace's own sign-in paid: nobody's minutes are counted.
    expect(world.spent).toEqual([])
  })

  it("makes way for a new call by the same person", async () => {
    const world = open()
    const chat = await setup(world)
    const first = await call<StartCallResponse>(world, "/calls", "POST", {
      chatId: chat.id,
      sdp: OFFER,
    })
    const second = await call<StartCallResponse>(world, "/calls", "POST", {
      chatId: chat.id,
      sdp: OFFER,
    })
    expect(second.call.id).not.toBe(first.call.id)
    // The first is over and written up, with nothing said on it.
    const notices = (await chatOf(world, chat.id)).messages.filter((m) => m.role === "notice")
    expect(notices).toHaveLength(1)
    expect((await ask(world, `/calls/${first.call.id}/lines`, "POST", { lines: [] })).status).toBe(
      404,
    )
  })

  it("plays a script where there is no voice at all", async () => {
    const world = open()
    const chat = await setup(world)
    world.allowance = {
      pass: { dialect: "scripted", script: [{ hear: "Hello" }, { say: "Hi" }], paidBy: "server" },
      maxSeconds: 60,
      quietSeconds: 30,
    }
    const { call: started } = await call<StartCallResponse>(world, "/calls", "POST", {
      chatId: chat.id,
      sdp: "",
    })
    expect(started).toMatchObject({
      dialect: "scripted",
      sdp: null,
      voice: "plain",
      script: [{ hear: "Hello" }, { say: "Hi" }],
    })
    expect(world.provider).toHaveLength(0)
  })
})

describe("the pieces", () => {
  it("reads lines leniently and never more than text", () => {
    expect(
      readLines([
        { who: "you", text: " Hello\n there " },
        { who: "dood", text: "x".repeat(5_000) },
        { who: "you", text: 4 },
        "nope",
        null,
      ]),
    ).toEqual([
      { who: "you", text: "Hello there" },
      { who: "dood", text: `${"x".repeat(1_999)}…` },
    ])
    expect(readLines("nope")).toEqual([])
  })

  it("writes a note that cannot be ended from inside", () => {
    const note = callMeta('a"b', [{ who: "you", text: "Hi" }], "Juniper")
    expect(note.startsWith('<meta kind="call" call="a&quot;b">')).toBe(true)
    expect(callOf(note)).toBe("a&quot;b")
    expect(callOf('<meta sent_at="now"/>')).toBeUndefined()
  })

  it("gives the voice the end of the chat, without its steps", () => {
    const text = (role: "user" | "assistant", said: string) => ({
      id: said,
      role,
      parts: [{ type: "text" as const, text: said }],
      status: "done" as const,
    })
    expect(
      voiceContext([
        text("user", "One"),
        {
          id: "tool",
          role: "assistant",
          parts: [{ type: "tool", toolCallId: "1", name: "bash", args: {}, status: "done" }],
          status: "done",
        },
        {
          id: "note",
          role: "notice",
          parts: [{ type: "notice", kind: "reset", text: "" }],
          status: "done",
        },
        text("assistant", "Two"),
        { ...text("assistant", "Three"), status: "streaming" },
      ]),
    ).toEqual([
      { who: "you", text: "One" },
      { who: "dood", text: "Two" },
    ])
    // A long chat gives its newest messages.
    const long = Array.from({ length: 100 }, (_, i) => text("user", `Message ${i}`))
    const given = voiceContext(long)
    expect(given).toHaveLength(40)
    expect(given.at(-1)).toEqual({ who: "you", text: "Message 99" })
  })

  it("reads a small model's summary leniently", () => {
    expect(parseSummary('Here: {"lines": ["One.", " Two. ", 3, ""]} done')).toEqual([
      "One.",
      "Two.",
    ])
    expect(parseSummary('{"lines": ["a","b","c","d"]}')).toHaveLength(3)
    expect(parseSummary("no")).toEqual([])
    expect(parseSummary('{"lines": "x"}')).toEqual([])
  })
})

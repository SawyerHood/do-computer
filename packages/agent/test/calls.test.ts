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
  type CallWorkResponse,
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
  /** What the small model was asked of a call, and what it answers. */
  summaries: string[]
  summary: string
  /** What it was asked for a chat's note, and what it answers. */
  notes: string[]
  note: string
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
    notes: [],
    note: JSON.stringify({ note: "", memory: [], user: [] }),
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
            // The one small model says what came of a call and keeps the chats' notes.
            const noting = String(init.body).includes("You keep the notes of an AI agent")
            ;(noting ? world.notes : world.summaries).push(String(init.body))
            return Response.json({
              choices: [{ message: { content: noting ? world.note : world.summary } }],
            })
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

async function until(check: () => Promise<boolean>): Promise<void> {
  for (let tries = 0; tries < 200; tries++) {
    if (await check()) return
    await new Promise((done) => setTimeout(done, 25))
  }
  throw new Error("It never happened.")
}

/**
 * The voice hands something on, and the agent answers it. Gives the chat it went to, as it
 * stands once it is answered.
 */
async function handOn(
  world: World,
  callId: string,
  text: string,
): Promise<{ chatId: string; request: string; state: ChatState }> {
  const request = crypto.randomUUID()
  const sent = await call<CallWorkResponse>(world, `/calls/${callId}/work`, "POST", {
    text,
    requestId: request,
  })
  let state = EMPTY_CHAT
  await until(async () => {
    state = await chatOf(world, sent.chatId)
    const at = state.messages.findIndex((message) => message.spoken?.request === request)
    return (
      at !== -1 &&
      !state.busy &&
      state.messages.slice(at + 1).some((message) => message.role === "assistant")
    )
  })
  return { chatId: sent.chatId, request, state }
}

/** Every text the model was sent as said by the user, oldest first. */
const everySeen = (context: FauxContext): string[] =>
  context.messages.flatMap((message) =>
    message.role !== "user"
      ? []
      : typeof message.content === "string"
        ? [message.content]
        : message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])),
  )

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
    const first = await handOn(world, started.id, "How did the pricing test do overnight?")
    // The call is held in a side chat, and that is where its work is done.
    expect(first.chatId).toBe(chat.id)
    const { state } = first
    // The agent reads the request, and beside it that it was spoken and what else was said.
    expect(seen[0]).toBe("How did the pricing test do overnight?")
    const note = seen.find((text) => callOf(text) !== undefined)!
    expect(callOf(note)).toEqual({ call: started.id, request: first.request })
    expect(note).toContain("said out loud")
    expect(note).toContain("They: Hey Juniper, how did the pricing test do overnight?")
    expect(note).toContain("Juniper: Morning! One second, I'll pull the numbers.")
    expect(note).not.toContain("not a line")
    // A person sees what they said, marked as spoken, and none of the note.
    const said = state.messages.find((message) => message.role === "user")!
    expect(said.spoken).toEqual({ call: started.id, request: first.request })
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
    expect((await handOn(world, started.id, "Give it till Friday.")).chatId).toBe(chat.id)
    const second = seen.find((text) => callOf(text) !== undefined)!
    expect(second).toContain("They: Give it till Friday.")
    expect(second).not.toContain("pricing test")

    // A message cannot be marked as said on a call by whoever sends it: only the call's own
    // way in does that.
    world.faux.setResponses([fauxAssistantMessage("Typed.")])
    const typed = await converse(world, chat.id, { text: "Typed, not said.", call: started.id })
    expect(typed.messages.findLast((message) => message.role === "user")!.spoken).toBeUndefined()
    // Nor is anything handed on to a call that is not whoever asks's.
    const theirs = await ask(
      world,
      `/calls/${started.id}/work`,
      "POST",
      { text: "Hello", requestId: "r-1" },
      JON,
    )
    expect(theirs.status).toBe(403)
  })

  it("is done in a side chat of the call's own, where the call is held in the main chat", async () => {
    const world = open()
    await setup(world)
    const main = await call<ChatSummary>(world, "/chats/main", "POST")
    world.faux.setResponses([fauxAssistantMessage("The launch is on Friday, noted.")])
    await converse(world, main.id, { text: "The launch is on Friday." })
    const { call: started } = await call<StartCallResponse>(world, "/calls", "POST", {
      chatId: main.id,
      sdp: OFFER,
    })
    await call(world, `/calls/${started.id}/lines`, "POST", {
      lines: [
        { who: "you", text: "Can you check which files are in my library?" },
        { who: "dood", text: "On it." },
      ],
    })
    let seen: string[] = []
    world.faux.setResponses([
      (context) => {
        seen = everySeen(context)
        return fauxAssistantMessage("There are three files in your library.")
      },
    ])
    const first = await handOn(world, started.id, "Check which files are in my library.")
    // A chat beside the main one, named for the call and what was asked.
    expect(first.chatId).not.toBe(main.id)
    const chats = (await call<{ chats: ChatSummary[] }>(world, "/")).chats
    expect(chats.find((chat) => chat.id === first.chatId)).toMatchObject({
      kind: "chat",
      title: "Call: Check which files are in my library.",
      archived: false,
    })
    expect(chats.find((chat) => chat.id === first.chatId)!.main).not.toBe(true)
    // It branched off the main chat, so the agent knows there what was said before the call,
    // that it is in a side chat, and what was said on the call.
    expect(seen).toContain("The launch is on Friday.")
    expect(seen.some((text) => text.startsWith('<meta kind="side-chat">'))).toBe(true)
    const note = seen.find((text) => callOf(text) !== undefined)!
    expect(note).toContain("They: Can you check which files are in my library?")
    // The main chat is as it was: nothing was added to it, and it is not held up.
    const before = await chatOf(world, main.id)
    expect(before.messages.map((message) => message.role)).toEqual(["user", "assistant"])
    expect(before.busy).toBe(false)

    // What is handed on next goes to the same chat.
    await call(world, `/calls/${started.id}/lines`, "POST", {
      lines: [
        { who: "dood", text: "There are three files in your library." },
        { who: "you", text: "Remember that I like the short one best." },
      ],
    })
    world.faux.setResponses([fauxAssistantMessage("Noted.")])
    const second = await handOn(world, started.id, "Remember that I like the short one best.")
    expect(second.chatId).toBe(first.chatId)
    expect(
      (await call<{ chats: ChatSummary[] }>(world, "/")).chats.filter((chat) =>
        chat.title.startsWith("Call:"),
      ),
    ).toHaveLength(1)

    world.ahead += 61_000
    await call(world, `/calls/${started.id}/end`, "POST", {
      lines: [
        { who: "dood", text: "Noted." },
        { who: "you", text: "Thanks, bye." },
      ],
    })
    // The main chat has the call's one record, which says where its work was done and who called.
    const record = (await chatOf(world, main.id)).messages.at(-1)!
    expect(record.parts[0]).toMatchObject({
      kind: "call",
      call: { id: started.id, chatId: first.chatId, by: "Sawyer" },
    })
    // The side chat shows nothing more for the call being over.
    const worked = await chatOf(world, first.chatId)
    expect(worked.messages.filter((message) => message.role === "notice")).toHaveLength(1)

    // The agent in the main chat was shown none of the call, and is now told all of it and
    // where it did the work.
    world.faux.setResponses([
      (context) => {
        seen = everySeen(context)
        return fauxAssistantMessage("Three.")
      },
    ])
    await converse(world, main.id, { text: "How many files was it?" })
    const ended = seen.find((text) => text.startsWith('<meta kind="call-ended">'))!
    expect(ended).toContain("A voice call was held here, and ended after 1 min.")
    expect(ended).toContain(`side chat ${first.chatId}`)
    expect(ended).toContain("They: Can you check which files are in my library?")
    expect(ended).toContain("Juniper: There are three files in your library.")
    expect(ended).toContain("They: Thanks, bye.")
    // In the side chat it is told the call is over, and what it had not been shown of it.
    world.faux.setResponses([
      (context) => {
        seen = everySeen(context)
        return fauxAssistantMessage("The short one.")
      },
    ])
    await converse(world, first.chatId, { text: "Which one did I like?" })
    const over = seen.find((text) => text.startsWith('<meta kind="call-ended">'))!
    expect(over).toContain("The voice call this side chat worked for ended after 1 min.")
    expect(over).toContain("They: Thanks, bye.")
    expect(over).not.toContain("Can you check which files")
    expect(world.reports).toEqual([])
  })

  it("is given a side chat all the same where the main chat has nothing to carry", async () => {
    const world = open()
    await setup(world)
    const main = await call<ChatSummary>(world, "/chats/main", "POST")
    const { call: started } = await call<StartCallResponse>(world, "/calls", "POST", {
      chatId: main.id,
      sdp: OFFER,
    })
    world.faux.setResponses([fauxAssistantMessage("Hello to you.")])
    const first = await handOn(world, started.id, "Say hello.")
    expect(first.chatId).not.toBe(main.id)
    expect((await chatOf(world, main.id)).messages).toEqual([])
    expect(world.reports).toEqual([])
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
          by: "Sawyer",
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
        seen = everySeen(context)
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

  it("has what was said out loud taken into the chat's note and into what the agent remembers", async () => {
    const world = open()
    const chat = await setup(world)
    world.note = JSON.stringify({
      note: "On a call, Sawyer said the move to Portland is done.",
      memory: ["The office printer is called Gutenberg."],
      user: [
        "Sawyer lives in Portland.",
        "Sawyer has a dog called Biscuit.",
        "Sawyer drinks oat milk.",
        "Sawyer is left-handed.",
      ],
    })
    const { call: started } = await call<StartCallResponse>(world, "/calls", "POST", {
      chatId: chat.id,
      sdp: OFFER,
    })
    // Nothing is handed on: it was only said to the voice.
    await call(world, `/calls/${started.id}/end`, "POST", {
      lines: [
        { who: "you", text: "By the way, I moved to Portland last month, with Biscuit." },
        { who: "dood", text: "Portland! How is Biscuit taking it?" },
      ],
    })
    await until(async () => (await call<{ memory: string }>(world, "/")).memory !== "")
    // The small model was shown the call as what was said in the chat, by who said it.
    expect(world.notes).toHaveLength(1)
    expect(world.notes[0]).toContain(
      "Sawyer (out loud, on a call): By the way, I moved to Portland last month, with Biscuit.",
    )
    expect(world.notes[0]).toContain("the agent's voice: Portland! How is Biscuit taking it?")
    expect(world.notes[0]).toContain("At most 3 entries in each.")
    // What it found worth keeping is remembered, up to three things of a kind from one call.
    const remembered = await call<{ user: string; memory: string }>(world, "/")
    expect(remembered.memory).toBe("The office printer is called Gutenberg.")
    expect(remembered.user).toBe(
      [
        "Sawyer likes teal.",
        "Sawyer lives in Portland.",
        "Sawyer has a dog called Biscuit.",
        "Sawyer drinks oat milk.",
      ].join("\n"),
    )
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
    const note = callMeta('a"b', "r<1>&", [{ who: "you", text: "Hi" }], "Juniper")
    expect(note.startsWith('<meta kind="call" call="a&quot;b" request="r&lt;1&gt;&amp;">')).toBe(
      true,
    )
    expect(callOf(note)).toEqual({ call: 'a"b', request: "r<1>&" })
    // One written before a request was named in it.
    expect(callOf('<meta kind="call" call="c-1">Said out loud.</meta>')).toEqual({
      call: "c-1",
      request: "",
    })
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
        // A send that failed was said to nobody, and its own words are not text.
        { ...text("assistant", "Not sent."), notSent: "could not find it" },
        {
          id: "own",
          role: "assistant",
          parts: [{ type: "thinking", text: "Private.", written: true }],
          status: "done",
        },
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

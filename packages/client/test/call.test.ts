import {
  type CallLine,
  type CallWorkRequest,
  type ChatMessage,
  type ChatState,
  EMPTY_CHAT,
  type StartedCall,
} from "@do-computer/protocol"
import { describe, expect, it, vi } from "vitest"
import { type CallApi, type CallerOptions, createCaller, type VoiceLine } from "../src/call.ts"

/**
 * A call as a device holds it, against a server and a voice that are stood in for: the server
 * records what it is told, and the voice is a line whose events the test sends.
 */
function setUp(
  dialect: "codex" | "openai" | "scripted" = "codex",
  more: Partial<CallerOptions> = {},
) {
  const told: CallLine[] = []
  const work: CallWorkRequest[] = []
  const ended: { id: string; lines: CallLine[] }[] = []
  const sent: string[] = []
  const muted: boolean[] = []
  let closed = false
  let toVoice: ((data: string) => void) | undefined
  let lost: (() => void) | undefined
  let watcher: ((state: ChatState) => void) | undefined
  const started: StartedCall = {
    id: "call-1",
    dialect,
    sdp: dialect === "scripted" ? null : "answer-sdp",
    voice: "juniper",
    maxSeconds: 1800,
    quietSeconds: 120,
    ...(dialect === "scripted"
      ? { script: [{ hear: "What is on today?" }, { handOn: true }, { say: "Bye." }] }
      : {}),
  }
  const api: CallApi = {
    calls: async () => ({ available: true, dialect, voices: [], voice: null }),
    startCall: vi.fn(async () => started),
    callSaid: async (_id, lines) => {
      told.push(...lines)
      return { ok: true }
    },
    callWork: async (_id, input) => {
      work.push(input)
      return { chatId: "side-1", submissionId: "s1" }
    },
    endCall: async (id, lines = []) => {
      ended.push({ id, lines })
      return { ok: true }
    },
  }
  const line: VoiceLine = {
    send: (events) => sent.push(...events),
    setMuted: (value) => muted.push(value),
    levels: () => ({ you: 0, dood: 0 }),
    close: () => {
      closed = true
    },
  }
  const caller = createCaller({
    agent: () => api,
    openLine: async (place, onEvent, onLost) => {
      toVoice = onEvent
      lost = onLost
      return { line, call: await place("offer-sdp") }
    },
    microphoneProblem: () => "No microphone.",
    follow: (_agent, _chat, onState) => {
      watcher = onState
      onState(EMPTY_CHAT)
      return () => {
        watcher = undefined
      }
    },
    origin: () => ({ app: "mobile", device: "iPhone" }),
    ...more,
  })
  return {
    caller,
    api,
    told,
    work,
    ended,
    sent,
    muted,
    get closed() {
      return closed
    },
    voice: (event: unknown) => toVoice?.(JSON.stringify(event)),
    lose: () => lost?.(),
    chat: (state: ChatState) => watcher?.(state),
    get following() {
      return watcher !== undefined
    },
  }
}

const say = (role: ChatMessage["role"], text: string, more: Partial<ChatMessage> = {}) =>
  ({
    id: `${role}-${text}`,
    role,
    status: "done",
    parts: [{ type: "text", text }],
    ...more,
  }) as ChatMessage

const agent = { id: "a1", name: "Juniper" }

describe("a call", () => {
  it("is connecting until the voice is ready, then listens, and keeps what each side said once", async () => {
    const call = setUp("codex")
    const starting = call.caller.start(agent, "main")
    // It shows at once, before anything is known.
    expect(call.caller.getState().call).toMatchObject({ agentName: "Juniper", phase: "starting" })
    await starting
    expect(call.api.startCall).toHaveBeenCalledWith({ chatId: "main", sdp: "offer-sdp" })
    expect(call.caller.getState().call?.phase).toBe("connecting")
    call.voice({ type: "session.started" })
    expect(call.caller.getState().call).toMatchObject({ phase: "listening" })
    expect(call.caller.getState().call?.startedAt).toBeTypeOf("number")

    call.voice({ type: "input_transcript.added", item: { text: " Hello" } })
    call.voice({ type: "input_transcript.added", item: { text: " there" } })
    expect(call.caller.getState().call?.you).toBe(" Hello there")
    call.voice({ type: "turn.done", turn: { role: "user", transcript: "Hello there" } })
    call.voice({ type: "output_transcript.added", item: { text: " Hi!" } })
    call.voice({ type: "turn.done", turn: { role: "assistant", transcript: "Hi!" } })
    expect(call.caller.getState().call?.lines).toEqual([
      { who: "you", text: "Hello there" },
      { who: "dood", text: "Hi!" },
    ])

    await call.caller.end()
    expect(call.caller.getState().call).toBeUndefined()
    // The server is told everything, once, and the chat waits for the record of this call.
    expect([...call.told, ...call.ended[0]!.lines]).toEqual([
      { who: "you", text: "Hello there" },
      { who: "dood", text: "Hi!" },
    ])
    expect(call.caller.getState().wrapUp).toEqual({
      agentId: "a1",
      chatId: "main",
      callId: "call-1",
    })
    expect(call.sent.at(-1)).toBe(JSON.stringify({ type: "session.close" }))
  })

  it("hands on what was asked, follows the chat it is worked in, and gives the Dood's answer to the voice", async () => {
    const call = setUp("codex")
    await call.caller.start(agent, "main")
    call.voice({ type: "session.started" })
    call.voice({
      type: "delegation.created",
      item: {
        id: "d1",
        target: "client",
        content: [{ type: "input_text", text: "What is in my calendar?" }],
      },
    })
    await vi.waitFor(() => expect(call.work).toHaveLength(1))
    expect(call.work[0]).toMatchObject({
      text: "What is in my calendar?",
      from: { app: "mobile", device: "iPhone" },
    })
    await vi.waitFor(() => expect(call.following).toBe(true))
    expect(call.caller.getState().call).toMatchObject({
      workChatId: "side-1",
      works: [{ id: "d1", ask: "What is in my calendar?", done: false }],
    })

    // The Dood is at work on it: the step it is on is shown.
    const asked = say("user", "What is in my calendar?", {
      spoken: { request: call.work[0]!.requestId },
    } as Partial<ChatMessage>)
    call.chat({
      ...EMPTY_CHAT,
      busy: true,
      messages: [
        asked,
        {
          id: "working",
          role: "assistant",
          status: "streaming",
          parts: [
            {
              type: "tool",
              toolCallId: "t1",
              name: "bash",
              args: { command: "cal" },
              status: "running",
            },
          ],
        } as unknown as ChatMessage,
      ],
    })
    expect(call.caller.getState().call?.works[0]?.step).toBeTruthy()

    // It answered: the voice is given the answer to say, and the work is done.
    call.chat({ ...EMPTY_CHAT, messages: [asked, say("assistant", "Lunch with Sam at one.")] })
    const answer = call.sent
      .map((event) => JSON.parse(event) as { type: string; channel?: string; content?: unknown })
      .find((event) => event.type === "delegation.context.append" && event.channel === "speakable")
    expect(answer?.content).toEqual([{ type: "input_text", text: "Lunch with Sam at one." }])
    expect(call.caller.getState().call?.works[0]?.done).toBe(true)
    await call.caller.end()
    expect(call.following).toBe(false)
  })

  it("never gives the voice a send that failed as the Dood's answer", async () => {
    const call = setUp("codex")
    await call.caller.start(agent, "main")
    call.voice({ type: "session.started" })
    call.voice({
      type: "delegation.created",
      item: { id: "d1", target: "client", content: [{ type: "input_text", text: "The report?" }] },
    })
    await vi.waitFor(() => expect(call.work).toHaveLength(1))
    await vi.waitFor(() => expect(call.following).toBe(true))
    const asked = say("user", "The report?", {
      spoken: { request: call.work[0]!.requestId },
    } as Partial<ChatMessage>)
    // Where it speaks only through `send`: one that failed, then the one that went.
    call.chat({
      ...EMPTY_CHAT,
      messages: [
        asked,
        say("assistant", "Here it is.", { id: "send:ok" }),
        say("assistant", "Here it is again.", { id: "send:x", notSent: "could not find it" }),
      ],
    })
    const spoken = call.sent
      .map((event) => JSON.parse(event) as { type: string; channel?: string; content?: unknown })
      .filter(
        (event) => event.type === "delegation.context.append" && event.channel === "speakable",
      )
    expect(spoken.map((event) => event.content)).toEqual([
      [{ type: "input_text", text: "Here it is." }],
    ])
    await call.caller.end()
  })

  it("mutes the microphone and says so, and hears again when unmuted", async () => {
    const call = setUp("openai")
    await call.caller.start(agent, "main")
    call.voice({ type: "session.started" })
    call.caller.setMuted(true)
    expect(call.muted).toEqual([true])
    expect(call.caller.getState().call?.muted).toBe(true)
    call.caller.setMuted(false)
    expect(call.muted).toEqual([true, false])
    await call.caller.end()
  })

  it("says why it could not start where the microphone was refused, and places no call", async () => {
    const call = setUp("codex", {
      openLine: async () => {
        throw Object.assign(new Error("denied"), { name: "NotAllowedError" })
      },
      microphoneProblem: (error) =>
        (error as Error).name === "NotAllowedError" ? "Allow the microphone." : "Something else.",
    })
    await call.caller.start(agent, "main")
    expect(call.caller.getState()).toMatchObject({
      call: undefined,
      problem: { agentId: "a1", text: "Allow the microphone." },
      wrapUp: undefined,
    })
    expect(call.api.startCall).not.toHaveBeenCalled()
    call.caller.clearProblem()
    expect(call.caller.getState().problem).toBeUndefined()
  })

  it("ends by itself when its line is lost, and says so", async () => {
    const call = setUp("codex")
    await call.caller.start(agent, "main")
    call.lose()
    await vi.waitFor(() => expect(call.ended).toHaveLength(1))
    expect(call.caller.getState().problem?.text).toBe("The call was cut off.")
  })

  it("is one at a time: a second call while one is on does nothing", async () => {
    const call = setUp("codex")
    await call.caller.start(agent, "main")
    await call.caller.start({ id: "a2", name: "Basil" }, "other")
    expect(call.caller.getState().call?.agentId).toBe("a1")
    expect(call.api.startCall).toHaveBeenCalledTimes(1)
    await call.caller.end()
  })

  it("plays a script where the server hands one over, with no line of sound at all", async () => {
    const call = setUp("scripted", {
      openLine: async () => {
        throw new Error("a scripted call opens no line")
      },
    })
    await call.caller.start(agent, "main")
    await vi.waitFor(() => expect(call.work).toHaveLength(1))
    expect(call.work[0]?.text).toBe("What is on today?")
    await vi.waitFor(() => expect(call.following).toBe(true))
    const asked = say("user", "What is on today?", {
      spoken: { request: call.work[0]!.requestId },
    } as Partial<ChatMessage>)
    call.chat({ ...EMPTY_CHAT, messages: [asked, say("assistant", "Nothing much.")] })
    await vi.waitFor(() =>
      expect(call.caller.getState().call?.lines.map((line) => line.text)).toEqual([
        "What is on today?",
        "Nothing much.",
        "Bye.",
      ]),
    )
    await call.caller.end()
  })

  it("gives back what the server was not told when the device goes away in the middle of it", async () => {
    const call = setUp("openai")
    expect(call.caller.leaving()).toBeUndefined()
    await call.caller.start(agent, "main")
    call.voice({ type: "session.started" })
    call.voice({ type: "session.input_transcript.delta", delta: "Half a sentence" })
    expect(call.caller.leaving()).toEqual({
      agentId: "a1",
      callId: "call-1",
      lines: [{ who: "you", text: "Half a sentence" }],
    })
    await call.caller.end()
  })
})

import {
  type CallDialect,
  type CallLine,
  type CallWorkRequest,
  type CallWorkResponse,
  type CallsState,
  type ChatMessage,
  type ChatState,
  EMPTY_CHAT,
  type MessageOrigin,
  randomId,
  type StartCallRequest,
  type StartedCall,
  toolActivity,
} from "@do-computer/protocol"
import { type Heard, readVoiceEvent, voiceClose, voiceReply } from "./call-events.ts"
import { playCallScript } from "./call-script.ts"
import { addWords, NOTHING_SAID, type Said, takePause, takePauses, turnDone } from "./call-said.ts"

/**
 * A voice call with a Dood, as one device holds it. The sound goes straight between the device
 * and the provider of the voice; the server starts the call and keeps what was said. The voice
 * is not the Dood and can only talk: what it hands on is sent to the call's side chat as a
 * message, where the Dood does it with everything it can do, and the Dood's answer there is
 * handed back for the voice to say.
 *
 * Everything here is the same in a browser and on a phone. What differs is handed in: how the
 * sound is carried (`openLine`), how a chat is followed, and where a message is from. There is
 * one call at a time.
 */

/**
 * `starting`: the microphone is being asked for. `connecting`: the call is being placed.
 * `listening`: nobody is talking. `hearing`: the person is. `speaking`: the Dood's voice is.
 * `working`: the Dood has been handed something and has not answered yet.
 */
export type CallPhase = "starting" | "connecting" | "listening" | "hearing" | "speaking" | "working"

/** Something the voice handed on to the Dood, and what the Dood is doing about it right now. */
export type CallWork = { id: string; ask: string; done: boolean; step?: string }

export type CallView = {
  agentId: string
  agentName: string
  /** The chat the call is held in, which is given its record. */
  chatId: string
  /**
   * The chat the Dood does the call's work in, once something was handed on: a side chat of the
   * call's own where the call is held in the main chat, else the chat it is held in.
   */
  workChatId?: string
  phase: CallPhase
  /** When the voice was ready to talk. Until then nothing is counted. */
  startedAt: number | undefined
  muted: boolean
  /** What has been said, each thing once it was finished. */
  lines: CallLine[]
  /** What each of the two is in the middle of saying. */
  you: string
  dood: string
  works: CallWork[]
}

/** Why a call could not be started, or ended by itself, for the Dood it was with. */
export type CallProblem = { agentId: string; text: string }

/**
 * A call that has just ended, until its record turns up in its chat: what was said is written
 * up by the server, which takes a moment.
 */
export type CallWrapUp = { agentId: string; chatId: string; callId: string }

/** All a device shows of calls: the one that is on, why one ended, and one being written up. */
export type CallerState = {
  call: CallView | undefined
  problem: CallProblem | undefined
  wrapUp: CallWrapUp | undefined
}

/** What carries a call: the real thing, or a script played in its place. */
export type VoiceLine = {
  send(events: string[]): void
  setMuted(muted: boolean): void
  /** How loud the person and the voice are right now, 0 to 1. Zero where it cannot be told. */
  levels(): { you: number; dood: number }
  close(): void
}

/**
 * Open a real call: the microphone up, the voice down, and events beside them. `place` is given
 * the device's offer and places the call with it; `onEvent` is each event from the voice as it
 * came; `onLost` is the line dropping by itself. It rejects with the microphone's own error
 * where that is what failed.
 */
export type OpenVoiceLine = (
  place: (offer: string) => Promise<StartedCall>,
  onEvent: (data: string) => void,
  onLost: () => void,
) => Promise<{ line: VoiceLine; call: StartedCall }>

/** What the caller asks of the server, which is the agent's part of the client. */
export type CallApi = {
  calls(): Promise<CallsState>
  startCall(input: StartCallRequest): Promise<StartedCall>
  callSaid(callId: string, lines: CallLine[]): Promise<unknown>
  callWork(callId: string, input: CallWorkRequest): Promise<CallWorkResponse>
  endCall(callId: string, lines?: CallLine[]): Promise<unknown>
}

export type CallerOptions = {
  agent(agentId: string): CallApi
  openLine: OpenVoiceLine
  /** What went wrong asking for the microphone, in words this device's person can act on. */
  microphoneProblem(error: unknown): string
  /**
   * Follow a chat for as long as the call needs it: `onState` with each new state of it,
   * starting from its current one. Gives back how to stop.
   */
  follow(agentId: string, chatId: string, onState: (state: ChatState) => void): () => void
  /** Where what is handed on is said from, as with a message that was typed. */
  origin?(): MessageOrigin | undefined | Promise<MessageOrigin | undefined>
  /** The Dood's voice made a sound, `amount` how loud where that is known: its mouth moves. */
  onVoice?(agentId: string, amount?: number): void
}

/**
 * How long one side may be quiet in the middle of a sentence before what it said counts as
 * said, on a call that never says when somebody has finished.
 */
const SENTENCE_MS = 1_600
/**
 * The same, on a call that does say: it says so a couple of seconds after the last word, so
 * this is only for a turn whose end never comes.
 */
const TURN_MS = 8_000
/** How long a sound keeps a face moving after it stops. */
const SOUND_MS = 350
/** How loud counts as talking, of the 0 to 1 a level is given as. */
const TALKING = 0.035
/** How often the Dood's steps are passed on to its voice while it works, and how many. */
const PROGRESS_MS = 4_000
const MAX_PROGRESS = 5
/** How long the Dood is waited for before the voice is told to say the answer will be in the chat. */
const ANSWER_MS = 4 * 60_000
/** How long a call's record is waited for once it has ended. */
const WRAP_UP_MS = 25_000

type Handoff = {
  id: string
  ask: string
  /** The id it was sent under, by which its message in the chat is known. */
  request: string
  sentAt: number
  /** The steps that have been passed on, and when the last was. */
  told: Set<string>
  toldAt: number
}

type Session = {
  agentId: string
  chatId: string
  /** The chat its work is done in, once the server has said which. */
  workChatId: string | undefined
  /** That chat as it last stood. */
  workChat: ChatState
  dialect: CallDialect | undefined
  id: string | undefined
  line: VoiceLine | undefined
  /** Lines the server has not been told. */
  unsent: CallLine[]
  handoffs: Handoff[]
  /** When each side last made a sound or was heard to say a word. */
  youAt: number
  doodAt: number
  /** What has been said, as the words arrived. What is shown of it is a copy. */
  said: Said
  /** When anything was last said by anyone. */
  activeAt: number
  quietSeconds: number
  timers: ReturnType<typeof setInterval>[]
  cleanups: (() => void)[]
}

/** How long a call has lasted, as a clock shows it: 0:41, 12:05. */
export function callClock(startedAt: number | undefined, now: number): string {
  const seconds = startedAt === undefined ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** What is going on in a call, in a word or two. */
export function callPhaseWords(call: Pick<CallView, "phase" | "muted">): string {
  if (call.phase === "starting") return "Waiting for your microphone"
  if (call.phase === "connecting") return "Connecting…"
  if (call.phase === "speaking") return "Talking"
  if (call.phase === "working") return "Working on it"
  return call.muted ? "You’re muted" : "Listening"
}

const wordsOf = (message: ChatMessage) =>
  message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim()

export type Caller = ReturnType<typeof createCaller>

/** The calls of one device. */
export function createCaller(options: CallerOptions) {
  let state: CallerState = { call: undefined, problem: undefined, wrapUp: undefined }
  const listeners = new Set<() => void>()
  let session: Session | undefined

  const set = (change: Partial<CallerState>) => {
    state = { ...state, ...change }
    for (const listener of listeners) listener()
  }
  const view = () => state.call
  const patch = (change: Partial<CallView>) => {
    const current = view()
    if (current !== undefined) set({ call: { ...current, ...change } })
  }
  function setPhase(phase: CallPhase): void {
    const current = view()
    if (current === undefined || current.phase === phase) return
    set({ call: { ...current, phase } })
  }

  // --- What was said.

  /** Whether a call says when somebody has finished speaking. One on an OpenAI key does not. */
  const saysTurns = (mine: Session) => mine.dialect !== "openai"

  /** What was said has changed: it is shown, and the server is owed the new lines. */
  function keep(mine: Session, said: Said, lines: readonly (CallLine | undefined)[] = []): void {
    mine.said = said
    for (const line of lines) if (line !== undefined) mine.unsent.push(line)
    patch({ lines: said.lines, you: said.you, dood: said.dood })
  }

  /** Whatever either of the two was in the middle of saying is taken as said: the call is ending. */
  function takeAll(mine: Session): void {
    for (const who of ["you", "dood"] as const) {
      const taken = takePause(mine.said, who, false)
      keep(mine, taken.said, [taken.line])
    }
  }

  /** Tell the server what was said since it was last told. What does not get there goes the next time. */
  async function tell(): Promise<void> {
    const mine = session
    if (mine === undefined || mine.id === undefined || mine.unsent.length === 0) return
    const lines = mine.unsent.splice(0)
    try {
      await options.agent(mine.agentId).callSaid(mine.id, lines)
    } catch (error) {
      if (session !== mine) return
      mine.unsent.unshift(...lines)
      // The server has it as over: the same person called from somewhere else, or its time is up.
      if ((error as { status?: number }).status === 404) {
        void end("The call was ended from somewhere else.")
      }
    }
  }

  // --- What the voice says to the device.

  function heard(event: Heard): void {
    const mine = session
    const current = view()
    if (mine === undefined || current === undefined) return
    const now = Date.now()
    switch (event.type) {
      case "started":
        mine.activeAt = now
        set({ call: { ...current, startedAt: current.startedAt ?? now } })
        setPhase("listening")
        return
      case "words": {
        mine.activeAt = now
        if (event.who === "you") mine.youAt = now
        else mine.doodAt = now
        keep(mine, addWords(mine.said, event.who, event.text, now))
        // Its mouth moves with its words where the sound itself cannot be measured.
        if (event.who === "dood" && mine.line?.levels().dood === 0) options.onVoice?.(mine.agentId)
        return
      }
      case "line": {
        mine.activeAt = now
        const done = turnDone(mine.said, event.who, event.text)
        keep(mine, done.said, [done.line])
        return
      }
      case "handOn":
        void handOn(event.id, event.ask)
        return
      case "closed":
        void end()
        return
      case "error":
        void end(event.message)
        return
    }
  }

  /** The voice handed something on: it goes to the Dood's chat, as said out loud. */
  async function handOn(id: string, given: string | undefined): Promise<void> {
    const mine = session
    if (mine === undefined || mine.id === undefined) return
    // On a call that never says when somebody has finished, what the person was saying is the
    // request, and is said by now. One that does say gives the request in words, and says that
    // the person has finished a moment later: it is not taken twice.
    if (!saysTurns(mine)) {
      const taken = takePause(mine.said, "you", false)
      keep(mine, taken.said, [taken.line])
    }
    const current = view()
    if (current === undefined) return
    const ask =
      given?.trim() ||
      mine.said.you.replace(/\s+/g, " ").trim() ||
      current.lines.findLast((line) => line.who === "you")?.text ||
      "(Something was asked out loud that was not caught in words.)"
    set({ call: { ...current, works: [...current.works, { id, ask, done: false }] } })
    const handoff: Handoff = {
      id,
      ask,
      request: randomId(),
      sentAt: Date.now(),
      told: new Set(),
      toldAt: Date.now(),
    }
    mine.handoffs.push(handoff)
    // The Dood is shown what was said before this, so the server is told first.
    await tell()
    if (session !== mine) return
    try {
      const from = await options.origin?.()
      const sent = await options.agent(mine.agentId).callWork(mine.id, {
        text: ask,
        requestId: handoff.request,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(from === undefined ? {} : { from }),
      })
      if (session === mine) follow(mine, sent.chatId)
    } catch (error) {
      answer(
        handoff,
        `That did not reach me: ${error instanceof Error ? error.message : "something went wrong"}.`,
      )
    }
  }

  /**
   * The chat the call's work is done in is followed for as long as the call lasts, wherever the
   * person goes: what the Dood answers there is what its voice says.
   */
  function follow(mine: Session, chatId: string): void {
    if (mine.workChatId === chatId) return
    mine.workChatId = chatId
    mine.workChat = EMPTY_CHAT
    patch({ workChatId: chatId })
    mine.cleanups.push(
      options.follow(mine.agentId, chatId, (chat) => {
        if (session !== mine || mine.workChatId !== chatId) return
        mine.workChat = chat
        chatChanged(chat)
      }),
    )
  }

  function answer(handoff: Handoff, said: string): void {
    const mine = session
    if (mine === undefined || mine.dialect === undefined) return
    mine.handoffs = mine.handoffs.filter((one) => one !== handoff)
    mine.line?.send(voiceReply(mine.dialect, handoff.id, said, "answer"))
    const current = view()
    if (current === undefined) return
    set({
      call: {
        ...current,
        works: current.works.map((work) =>
          work.id === handoff.id ? { ...work, done: true } : work,
        ),
      },
    })
  }

  /** What the Dood is doing about something handed on is shown where the call is. */
  function showStep(id: string, step: string | undefined): void {
    const current = view()
    const work = current?.works.find((one) => one.id === id)
    if (current === undefined || work === undefined || work.step === step) return
    set({
      call: {
        ...current,
        works: current.works.map((one) => {
          if (one.id !== id) return one
          const { step: _was, ...rest } = one
          return step === undefined ? rest : { ...rest, step }
        }),
      },
    })
  }

  /**
   * The chat the call works in changed: what the Dood answers there to something handed on goes
   * back to its voice.
   */
  function chatChanged(chat: ChatState): void {
    const mine = session
    if (mine === undefined || mine.dialect === undefined) return
    const now = Date.now()
    for (const handoff of [...mine.handoffs]) {
      // Its own message in the chat, known by the id it was sent under.
      const at = chat.messages.findIndex(
        (message) => message.role === "user" && message.spoken?.request === handoff.request,
      )
      if (at === -1) {
        if (now - handoff.sentAt > ANSWER_MS)
          answer(handoff, "I could not get to that. Ask me again.")
        continue
      }
      const after = chat.messages.slice(at + 1)
      if (!chat.busy) {
        // What it said. Where it speaks only through `send`, its own words are not text.
        const last = after.findLast(
          (message) => message.role === "assistant" && wordsOf(message) !== "",
        )
        const failed = after.findLast((message) => message.role === "assistant")
        if (last !== undefined) answer(handoff, wordsOf(last))
        else if (failed?.status === "error") {
          answer(handoff, "Something went wrong on my side. What happened is in the chat.")
        } else if (now - handoff.sentAt > 6_000) {
          answer(handoff, "I have nothing to say on that yet. Have a look at the chat.")
        }
        continue
      }
      if (now - handoff.sentAt > ANSWER_MS) {
        answer(handoff, "This is taking me a while. I will have it in the chat when it is done.")
        continue
      }
      const steps = after.flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "tool" && (part.status === "running" || part.status === "pending")
            ? [part]
            : [],
        ),
      )
      const doing = steps.at(-1)
      showStep(handoff.id, doing === undefined ? undefined : toolActivity(doing))
      // While it works, its voice hears what it is doing, a step now and then.
      if (handoff.told.size >= MAX_PROGRESS || now - handoff.toldAt < PROGRESS_MS) continue
      const step = steps.findLast((part) => !handoff.told.has(part.toolCallId))
      if (step === undefined) continue
      handoff.told.add(step.toolCallId)
      handoff.toldAt = now
      mine.line?.send(voiceReply(mine.dialect, handoff.id, toolActivity(step), "progress"))
    }
  }

  // --- Starting and ending.

  /** Call a Dood, in a chat of its own that the person talks in. Does nothing while a call is on. */
  async function start(agent: { id: string; name: string | null }, chatId: string): Promise<void> {
    if (session !== undefined) return
    const mine: Session = {
      agentId: agent.id,
      chatId,
      workChatId: undefined,
      workChat: EMPTY_CHAT,
      dialect: undefined,
      id: undefined,
      line: undefined,
      unsent: [],
      handoffs: [],
      youAt: 0,
      doodAt: 0,
      said: NOTHING_SAID,
      activeAt: Date.now(),
      quietSeconds: 120,
      timers: [],
      cleanups: [],
    }
    session = mine
    set({
      problem: undefined,
      wrapUp: undefined,
      call: {
        agentId: agent.id,
        agentName: agent.name ?? "Your Dood",
        chatId,
        phase: "starting",
        startedAt: undefined,
        muted: false,
        lines: [],
        you: "",
        dood: "",
        works: [],
      },
    })
    const api = options.agent(agent.id)
    const fail = (text: string) => {
      if (session !== mine) return
      void end(text)
    }
    try {
      const { dialect } = await api.calls()
      if (session !== mine) return
      // Known before the call is placed: the voice starts talking the moment it is.
      mine.dialect = dialect
      let started: StartedCall
      if (dialect === "scripted") {
        started = await api.startCall({ chatId, sdp: "" })
        if (session !== mine) return void api.endCall(started.id).catch(() => {})
        mine.line = playCallScript(started.script ?? [], heard)
      } else {
        const opened = await options
          .openLine(
            (offer) => {
              setPhase("connecting")
              return api.startCall({ chatId, sdp: offer })
            },
            (data) => {
              if (session !== mine || mine.dialect === undefined) return
              const event = readVoiceEvent(mine.dialect, data)
              if (event !== null) heard(event)
            },
            () => fail("The call was cut off."),
          )
          .catch((error: unknown) => {
            // Before the call was placed, what failed was the microphone.
            throw mine.id === undefined && view()?.phase === "starting"
              ? new Error(options.microphoneProblem(error))
              : error
          })
        started = opened.call
        if (session !== mine) {
          opened.line.close()
          return void api.endCall(started.id).catch(() => {})
        }
        mine.line = opened.line
      }
      mine.id = started.id
      mine.dialect = started.dialect
      mine.quietSeconds = started.quietSeconds
      setPhase(view()?.startedAt === undefined ? "connecting" : "listening")

      const deadline = Date.now() + started.maxSeconds * 1000
      mine.timers.push(
        // Who is talking, by the sound of it, and the creature's mouth with its voice.
        setInterval(() => {
          const current = view()
          if (session !== mine || current === undefined || current.startedAt === undefined) return
          const now = Date.now()
          const { you, dood } = mine.line?.levels() ?? { you: 0, dood: 0 }
          if (dood > TALKING) {
            mine.doodAt = now
            options.onVoice?.(mine.agentId, Math.min(1, dood * 1.6))
          }
          if (you > TALKING && !current.muted) mine.youAt = now
          const speaking = now - mine.doodAt < SOUND_MS
          const hearing = !current.muted && now - mine.youAt < SOUND_MS
          setPhase(
            speaking
              ? "speaking"
              : mine.handoffs.length > 0
                ? "working"
                : hearing
                  ? "hearing"
                  : "listening",
          )
        }, 70),
        setInterval(() => {
          const current = view()
          if (session !== mine || current === undefined) return
          const now = Date.now()
          // A sentence that was left hanging is taken as said.
          const turns = saysTurns(mine)
          const paused = takePauses(mine.said, now, turns ? TURN_MS : SENTENCE_MS, turns)
          if (paused.lines.length > 0) keep(mine, paused.said, paused.lines)
          if (mine.unsent.length > 0) void tell()
          // What the Dood was handed is looked at again, for one that never answers.
          chatChanged(mine.workChat)
          if (now >= deadline) return void end("The call reached its longest length.")
          const busy = mine.handoffs.length > 0 || now - Math.max(mine.youAt, mine.doodAt) < 5_000
          if (!busy && now - mine.activeAt > mine.quietSeconds * 1000) {
            void end("The call ended after nobody had said anything for a while.")
          }
        }, 800),
      )
    } catch (error) {
      fail(error instanceof Error ? error.message : "The call could not be started.")
    }
  }

  /** Hang up. `problem` is why, where the call ended by itself. */
  async function end(problem?: string): Promise<void> {
    const mine = session
    if (mine === undefined) return
    takeAll(mine)
    session = undefined
    for (const timer of mine.timers) clearInterval(timer)
    for (const cleanup of mine.cleanups) cleanup()
    mine.line?.send([voiceClose()])
    // The voice is given a moment to hear that, and then the line is let go of.
    const line = mine.line
    setTimeout(() => line?.close(), 300)
    const wrapUp =
      mine.id === undefined
        ? undefined
        : { agentId: mine.agentId, chatId: mine.chatId, callId: mine.id }
    set({
      call: undefined,
      ...(problem === undefined ? {} : { problem: { agentId: mine.agentId, text: problem } }),
      ...(wrapUp === undefined ? {} : { wrapUp }),
    })
    if (mine.id === undefined) return
    setTimeout(() => {
      if (state.wrapUp === wrapUp) set({ wrapUp: undefined })
    }, WRAP_UP_MS)
    try {
      await options.agent(mine.agentId).endCall(mine.id, mine.unsent)
    } catch {
      // The server ends it by itself at its time, with what it was told.
    }
  }

  return {
    start,
    end,
    /** Stop the person being heard, or let them be heard again. The Dood's voice goes on. */
    setMuted(muted: boolean): void {
      if (session === undefined) return
      session.line?.setMuted(muted)
      patch({ muted })
    },
    /**
     * The device is going away with the call on it (a page that is closed or loaded again):
     * everything said is taken as said, and what the server has not been told is given back,
     * for one last word to it on the way out. Undefined where no call was placed.
     */
    leaving(): { agentId: string; callId: string; lines: CallLine[] } | undefined {
      const mine = session
      if (mine === undefined || mine.id === undefined) return undefined
      takeAll(mine)
      return { agentId: mine.agentId, callId: mine.id, lines: mine.unsent }
    },
    /** The problem was read and put away. */
    clearProblem(): void {
      if (state.problem !== undefined) set({ problem: undefined })
    },
    /** The call's record is in its chat: nothing need stand in for it. */
    clearWrapUp(): void {
      if (state.wrapUp !== undefined) set({ wrapUp: undefined })
    },
    getState: (): CallerState => state,
    /** Called whenever anything about calls changes. Gives back how to stop. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

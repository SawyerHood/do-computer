import {
  type CallDialect,
  type CallLine,
  type CallScriptStep,
  type ChatMessage,
  type ChatState,
  randomId,
  type StartedCall,
  toolActivity,
} from "@do-computer/protocol"
import { atom, getDefaultStore } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { chatKey, liveChatAtom } from "./atoms.ts"
import { type Heard, readVoiceEvent, voiceClose, voiceReply } from "./call-events.ts"
import { addWords, NOTHING_SAID, type Said, takePause, takePauses, turnDone } from "./call-said.ts"
import { client } from "./client.ts"
import { messageOrigin } from "./desktop.ts"
import { callMoodAtom, feedMascot, type MascotMood } from "./mascot.ts"
import { holdChat } from "./use-live-chat.ts"

/**
 * A voice call with a Dood, as this tab holds it. The sound goes straight between the browser
 * and the provider of the voice; the server starts the call and keeps what was said. The voice
 * is not the Dood: what it hands on is sent to the Dood's chat as a message, and the Dood's
 * answer there is handed back for the voice to say.
 *
 * The call belongs to the tab and not to a page, so that it goes on while other pages are
 * opened. There is one at a time.
 */

/**
 * `starting`: the microphone is being asked for. `connecting`: the call is being placed.
 * `listening`: nobody is talking. `hearing`: the person is. `speaking`: the Dood's voice is.
 * `working`: the Dood has been handed something and has not answered yet.
 */
export type CallPhase = "starting" | "connecting" | "listening" | "hearing" | "speaking" | "working"

/** Something the voice handed on to the Dood. */
export type CallWork = { id: string; ask: string; done: boolean }

export type CallView = {
  agentId: string
  agentName: string
  chatId: string
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

/** The call this tab is on, if it is on one. */
export const callAtom = atom<CallView | undefined>(undefined)

/** Why a call could not be started, or ended by itself, for the Dood it was with. */
export const callProblemAtom = atom<{ agentId: string; text: string } | undefined>(undefined)

/**
 * A call that has just ended, until its record turns up in its chat: what was said is written
 * up by the server, which takes a moment.
 */
export const callWrapUpAtom = atom<{ agentId: string; chatId: string; callId: string } | undefined>(
  undefined,
)

/** Whether what is said is shown as it is said. Kept from one call to the next. */
export const callWordsAtom = atomWithStorage("dc.call.words", true)

/** Whether the call is being shown where its Dood is, so that nothing else need show it. */
export const callShownAtom = atom(false)

const store = getDefaultStore()

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

/** What carries a call: the real thing, or a script played in its place. */
type Line = {
  send(events: string[]): void
  setMuted(muted: boolean): void
  /** How loud the person and the voice are right now, 0 to 1. Zero where it cannot be told. */
  levels(): { you: number; dood: number }
  close(): void
}

type Handoff = {
  id: string
  ask: string
  /** The chat's messages there were when it was sent: the answer is after one that is not among them. */
  known: Set<string>
  sentAt: number
  /** The steps that have been passed on, and when the last was. */
  told: Set<string>
  toldAt: number
}

type Session = {
  agentId: string
  chatId: string
  dialect: CallDialect | undefined
  id: string | undefined
  line: Line | undefined
  /** Lines the server has not been told. */
  unsent: CallLine[]
  handoffs: Handoff[]
  /** When each side last made a sound or was heard to say a word. */
  youAt: number
  doodAt: number
  /** When each side last added to what it is in the middle of saying. */
  /** What has been said, as the words arrived. What the page shows of it is a copy. */
  said: Said
  /** When anything was last said by anyone. */
  activeAt: number
  quietSeconds: number
  timers: ReturnType<typeof setInterval>[]
  cleanups: (() => void)[]
}

let session: Session | undefined

const view = () => store.get(callAtom)
const patch = (change: Partial<CallView>) => {
  const current = view()
  if (current !== undefined) store.set(callAtom, { ...current, ...change })
}

/** What the Dood's creature does at each moment of a call. */
function moodOf(phase: CallPhase): MascotMood {
  if (phase === "speaking") return { state: "speaking" }
  if (phase === "hearing") return { state: "listening" }
  if (phase === "working") return { state: "working", variant: "search" }
  if (phase === "starting" || phase === "connecting") return { state: "thinking" }
  return { state: "idle" }
}

function setPhase(phase: CallPhase): void {
  const current = view()
  if (current === undefined || current.phase === phase) return
  store.set(callAtom, { ...current, phase })
  store.set(callMoodAtom(current.agentId), moodOf(phase))
}

// --- What was said.

/** Whether a call says when somebody has finished speaking. One on an OpenAI key does not. */
const saysTurns = (mine: Session) => mine.dialect !== "openai"

/** What was said has changed: the page shows it, and the server is owed the new lines. */
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
    await client.agent(mine.agentId).callSaid(mine.id, lines)
  } catch (error) {
    if (session !== mine) return
    mine.unsent.unshift(...lines)
    // The server has it as over: the same person called from somewhere else, or its time is up.
    if ((error as { status?: number }).status === 404) {
      void endCall("The call was ended from somewhere else.")
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
      store.set(callAtom, { ...current, startedAt: current.startedAt ?? now })
      setPhase("listening")
      return
    case "words": {
      mine.activeAt = now
      if (event.who === "you") mine.youAt = now
      else mine.doodAt = now
      keep(mine, addWords(mine.said, event.who, event.text, now))
      // Its mouth moves with its words where the sound itself cannot be measured.
      if (event.who === "dood" && mine.line?.levels().dood === 0) feedMascot(mine.agentId, "token")
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
      void endCall()
      return
    case "error":
      void endCall(event.message)
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
  store.set(callAtom, { ...current, works: [...current.works, { id, ask, done: false }] })
  const chat = store.get(liveChatAtom(chatKey(mine.agentId, mine.chatId))).state
  const handoff: Handoff = {
    id,
    ask,
    known: new Set(chat.messages.map((message) => message.id)),
    sentAt: Date.now(),
    told: new Set(),
    toldAt: Date.now(),
  }
  mine.handoffs.push(handoff)
  // The Dood is shown what was said before this, so the server is told first.
  await tell()
  if (session !== mine) return
  try {
    await client.agent(mine.agentId).send(mine.chatId, {
      text: ask,
      requestId: randomId(),
      call: mine.id,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      from: await messageOrigin(),
    })
  } catch (error) {
    answer(
      handoff,
      `That did not reach me: ${error instanceof Error ? error.message : "something went wrong"}.`,
    )
  }
}

function answer(handoff: Handoff, said: string): void {
  const mine = session
  if (mine === undefined || mine.dialect === undefined) return
  mine.handoffs = mine.handoffs.filter((one) => one !== handoff)
  mine.line?.send(voiceReply(mine.dialect, handoff.id, said, "answer"))
  const current = view()
  if (current === undefined) return
  store.set(callAtom, {
    ...current,
    works: current.works.map((work) => (work.id === handoff.id ? { ...work, done: true } : work)),
  })
}

const wordsOf = (message: ChatMessage) =>
  message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim()

/** The Dood's chat changed: what it answers to something handed on goes back to its voice. */
function chatChanged(chat: ChatState): void {
  const mine = session
  if (mine === undefined || mine.dialect === undefined) return
  const now = Date.now()
  for (const handoff of [...mine.handoffs]) {
    // Its own message in the chat: the first spoken one that was not there before.
    const at = chat.messages.findIndex(
      (message) =>
        message.role === "user" && message.spoken === true && !handoff.known.has(message.id),
    )
    if (at === -1) {
      if (now - handoff.sentAt > ANSWER_MS)
        answer(handoff, "I could not get to that. Ask me again.")
      continue
    }
    const after = chat.messages.slice(at + 1)
    if (!chat.busy) {
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
    // While it works, its voice hears what it is doing, a step now and then.
    if (handoff.told.size >= MAX_PROGRESS || now - handoff.toldAt < PROGRESS_MS) continue
    const step = after
      .flatMap((message) => message.parts)
      .findLast(
        (part) =>
          part.type === "tool" &&
          (part.status === "running" || part.status === "pending") &&
          !handoff.told.has(part.toolCallId),
      )
    if (step?.type !== "tool") continue
    handoff.told.add(step.toolCallId)
    handoff.toldAt = now
    mine.line?.send(voiceReply(mine.dialect, handoff.id, toolActivity(step), "progress"))
  }
}

// --- What carries the call.

/** A real call: the microphone up, the voice down, and events on a data channel beside them. */
async function openLine(
  place: (offer: string) => Promise<StartedCall>,
  onEvent: (data: string) => void,
  onLost: () => void,
): Promise<{ line: Line; call: StartedCall }> {
  const microphone = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const peer = new RTCPeerConnection()
  const player = new Audio()
  player.autoplay = true
  let context: AudioContext | undefined
  let closed = false
  const meters: { you?: AnalyserNode; dood?: AnalyserNode } = {}
  const meter = (stream: MediaStream): AnalyserNode | undefined => {
    try {
      context ??= new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      context.createMediaStreamSource(stream).connect(analyser)
      return analyser
    } catch {
      return undefined
    }
  }
  const samples = new Uint8Array(512)
  const level = (analyser: AnalyserNode | undefined) => {
    if (analyser === undefined) return 0
    analyser.getByteTimeDomainData(samples)
    let sum = 0
    for (const sample of samples) sum += ((sample - 128) / 128) ** 2
    return Math.min(1, Math.sqrt(sum / samples.length) * 3)
  }
  const close = () => {
    if (closed) return
    closed = true
    for (const track of microphone.getTracks()) track.stop()
    player.srcObject = null
    peer.close()
    void context?.close().catch(() => {})
  }
  try {
    for (const track of microphone.getTracks()) peer.addTrack(track, microphone)
    meters.you = meter(microphone)
    peer.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track])
      player.srcObject = stream
      void player.play().catch(() => {})
      meters.dood = meter(stream)
    }
    // The call does not connect without this channel, and the voice's events come over it.
    const channel = peer.createDataChannel("oai-events")
    const waiting: string[] = []
    channel.onopen = () => {
      for (const event of waiting.splice(0)) channel.send(event)
    }
    channel.onmessage = (event) => {
      if (typeof event.data === "string") onEvent(event.data)
    }
    peer.onconnectionstatechange = () => {
      if (!closed && (peer.connectionState === "failed" || peer.connectionState === "closed")) {
        onLost()
      }
    }
    await peer.setLocalDescription(await peer.createOffer())
    // The offer is sent whole, with every way of reaching this browser in it.
    await new Promise<void>((done) => {
      if (peer.iceGatheringState === "complete") return done()
      const timer = setTimeout(done, 2_500)
      peer.onicegatheringstatechange = () => {
        if (peer.iceGatheringState !== "complete") return
        clearTimeout(timer)
        done()
      }
    })
    const call = await place(peer.localDescription?.sdp ?? "")
    if (call.sdp === null) throw new Error("The call was not answered.")
    await peer.setRemoteDescription({ type: "answer", sdp: call.sdp })
    return {
      call,
      line: {
        send(events) {
          for (const event of events) {
            if (channel.readyState === "open") channel.send(event)
            else waiting.push(event)
          }
        },
        setMuted(muted) {
          for (const track of microphone.getAudioTracks()) track.enabled = !muted
        },
        levels: () => ({ you: level(meters.you), dood: level(meters.dood) }),
        close,
      },
    }
  } catch (error) {
    close()
    throw error
  }
}

/**
 * A call with no voice: the script the server handed over is played as if a voice were saying
 * it. Only a test asks for one. It goes at reading speed, so that what a call shows can be seen.
 */
function playScript(script: readonly CallScriptStep[], onEvent: (event: Heard) => void): Line {
  let closed = false
  let answered: ((said: string) => void) | undefined
  const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))
  const words = async (who: "you" | "dood", said: string) => {
    for (const word of said.split(" ")) {
      if (closed) return
      onEvent({ type: "words", who, text: ` ${word}` })
      await wait(40)
    }
  }
  // As a real call does, it says that somebody has finished a moment after their last word.
  const finished = async (who: "you" | "dood", said: string) => {
    await wait(150)
    if (!closed) onEvent({ type: "line", who, text: said })
  }
  void (async () => {
    await wait(50)
    if (closed) return
    onEvent({ type: "started" })
    let n = 0
    const handOn = (ask?: string) =>
      new Promise<string>((done) => {
        answered = done
        onEvent({ type: "handOn", id: `scripted-${++n}`, ...(ask === undefined ? {} : { ask }) })
      })
    for (let i = 0; i < script.length; i++) {
      const step = script[i]!
      if (closed) return
      await wait(120)
      if ("say" in step) {
        await words("dood", step.say)
        await finished("dood", step.say)
        continue
      }
      const next = script[i + 1]
      let answer: Promise<string>
      if ("hear" in step) {
        await words("you", step.hear)
        if (next === undefined || !("handOn" in next)) {
          await finished("you", step.hear)
          continue
        }
        // What was heard is handed on before the person is said to have finished, with the
        // request in words.
        answer = handOn(step.hear)
        await finished("you", step.hear)
        i++
      } else answer = handOn()
      const said = await answer
      answered = undefined
      await words("dood", said)
      await finished("dood", said)
    }
  })()
  return {
    send(events) {
      for (const event of events) {
        const sent = JSON.parse(event) as {
          type?: string
          channel?: string
          content?: { text?: string }[]
        }
        if (sent.type === "delegation.context.append" && sent.channel === "speakable") {
          answered?.(sent.content?.[0]?.text ?? "")
        }
      }
    },
    setMuted() {},
    levels: () => ({ you: 0, dood: 0 }),
    close() {
      closed = true
    },
  }
}

// --- Starting and ending.

/** What went wrong asking for the microphone, in words. */
function microphoneProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ""
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The microphone is not allowed here. Check the permission for this site, then call again."
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found."
  }
  return error instanceof Error ? error.message : "The call could not be started."
}

/** Call a Dood, in a chat of its own that the person talks in. Does nothing while a call is on. */
export async function startCall(
  agent: { id: string; name: string | null },
  chatId: string,
): Promise<void> {
  if (session !== undefined) return
  const mine: Session = {
    agentId: agent.id,
    chatId,
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
  store.set(callProblemAtom, undefined)
  store.set(callWrapUpAtom, undefined)
  store.set(callAtom, {
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
  })
  store.set(callMoodAtom(agent.id), moodOf("starting"))
  const api = client.agent(agent.id)
  const fail = (text: string) => {
    if (session !== mine) return
    void endCall(text)
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
      mine.line = playScript(started.script ?? [], heard)
    } else {
      const opened = await openLine(
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
      ).catch((error: unknown) => {
        // Before the call was placed, what failed was the microphone.
        throw mine.id === undefined && view()?.phase === "starting"
          ? new Error(microphoneProblem(error))
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

    // The Dood's chat is followed for as long as the call lasts, wherever the person goes.
    const release = holdChat(agent.id, chatId)
    const live = liveChatAtom(chatKey(agent.id, chatId))
    const unsubscribe = store.sub(live, () => chatChanged(store.get(live).state))
    mine.cleanups.push(release, unsubscribe)

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
          feedMascot(mine.agentId, "token", Math.min(1, dood * 1.6))
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
        chatChanged(store.get(live).state)
        if (now >= deadline) return void endCall("The call reached its longest length.")
        const busy = mine.handoffs.length > 0 || now - Math.max(mine.youAt, mine.doodAt) < 5_000
        if (!busy && now - mine.activeAt > mine.quietSeconds * 1000) {
          void endCall("The call ended after nobody had said anything for a while.")
        }
      }, 800),
    )
    // A page that is left takes the call with it: the server is told on the way out.
    const leaving = () => {
      if (session !== mine || mine.id === undefined) return
      takeAll(mine)
      void fetch(
        `/api/agents/${encodeURIComponent(mine.agentId)}/calls/${encodeURIComponent(mine.id)}/end`,
        {
          method: "POST",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lines: mine.unsent }),
        },
      ).catch(() => {})
    }
    window.addEventListener("pagehide", leaving)
    mine.cleanups.push(() => window.removeEventListener("pagehide", leaving))
  } catch (error) {
    fail(error instanceof Error ? error.message : "The call could not be started.")
  }
}

/** Hang up. `problem` is why, where the call ended by itself. */
export async function endCall(problem?: string): Promise<void> {
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
  store.set(callAtom, undefined)
  store.set(callMoodAtom(mine.agentId), undefined)
  if (problem !== undefined) store.set(callProblemAtom, { agentId: mine.agentId, text: problem })
  if (mine.id === undefined) return
  const wrapUp = { agentId: mine.agentId, chatId: mine.chatId, callId: mine.id }
  store.set(callWrapUpAtom, wrapUp)
  setTimeout(() => {
    if (store.get(callWrapUpAtom) === wrapUp) store.set(callWrapUpAtom, undefined)
  }, WRAP_UP_MS)
  try {
    await client.agent(mine.agentId).endCall(mine.id, mine.unsent)
  } catch {
    // The server ends it by itself at its time, with what it was told.
  }
}

/** Stop the person being heard, or let them be heard again. The Dood's voice goes on. */
export function setCallMuted(muted: boolean): void {
  if (session === undefined) return
  session.line?.setMuted(muted)
  patch({ muted })
}

/** How long a call has lasted, as a clock shows it: 0:41, 12:05. */
export function callClock(startedAt: number | undefined, now: number): string {
  const seconds = startedAt === undefined ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

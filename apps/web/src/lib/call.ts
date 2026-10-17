import {
  type CallerState,
  type CallPhase,
  type CallProblem,
  type CallView,
  type CallWrapUp,
  createCaller,
  type OpenVoiceLine,
} from "@do-computer/client"
import { atom, getDefaultStore } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { chatKey, liveChatAtom } from "./atoms.ts"
import { client } from "./client.ts"
import { messageOrigin } from "./desktop.ts"
import { callMoodAtom, feedMascot, type MascotMood } from "./mascot.ts"
import { holdChat } from "./use-live-chat.ts"

/**
 * A voice call with a Dood, as this tab holds it. What a call does is the same on a phone and
 * is in `@do-computer/client` (`createCaller`); this is the browser's part of it: the
 * microphone and the voice through the browser's own WebRTC, the chats this tab already
 * follows, and what the page shows of a call kept where the page reads it.
 *
 * The call belongs to the tab and not to a page, so that it goes on while other pages are
 * opened. There is one at a time.
 */

export { callClock, type CallPhase, type CallView, type CallWork } from "@do-computer/client"

/** The call this tab is on, if it is on one. */
export const callAtom = atom<CallView | undefined>(undefined)

/** Why a call could not be started, or ended by itself, for the Dood it was with. */
export const callProblemAtom = atom<CallProblem | undefined>(undefined)

/**
 * A call that has just ended, until its record turns up in its chat: what was said is written
 * up by the server, which takes a moment.
 */
export const callWrapUpAtom = atom<CallWrapUp | undefined>(undefined)

/** Whether what is said is shown as it is said. Kept from one call to the next. */
export const callWordsAtom = atomWithStorage("dc.call.words", true)

/** Whether the call is being shown where its Dood is, so that nothing else need show it. */
export const callShownAtom = atom(false)

const store = getDefaultStore()

/** What the Dood's creature does at each moment of a call. */
function moodOf(phase: CallPhase): MascotMood {
  if (phase === "speaking") return { state: "speaking" }
  if (phase === "hearing") return { state: "listening" }
  if (phase === "working") return { state: "working", variant: "search" }
  if (phase === "starting" || phase === "connecting") return { state: "thinking" }
  return { state: "idle" }
}

/** A real call: the microphone up, the voice down, and events on a data channel beside them. */
const openLine: OpenVoiceLine = async (place, onEvent, onLost) => {
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

const caller = createCaller({
  agent: (agentId) => client.agent(agentId),
  openLine,
  microphoneProblem,
  // The chat is followed as the page follows it, so the call and the page share one stream.
  follow(agentId, chatId, onState) {
    const live = liveChatAtom(chatKey(agentId, chatId))
    const release = holdChat(agentId, chatId)
    const unsubscribe = store.sub(live, () => onState(store.get(live).state))
    onState(store.get(live).state)
    return () => {
      unsubscribe()
      release()
    }
  },
  origin: messageOrigin,
  onVoice: (agentId, amount) => feedMascot(agentId, "token", amount),
})

// What the caller holds is kept where the page reads it. A part the page put away itself (a
// problem that was read, a record that turned up) is only replaced when the caller has a new one.
let seen: CallerState = caller.getState()
caller.subscribe(() => {
  const next = caller.getState()
  const was = seen
  seen = next
  if (next.call !== was.call) {
    store.set(callAtom, next.call)
    if (next.call === undefined) {
      if (was.call !== undefined) store.set(callMoodAtom(was.call.agentId), undefined)
    } else if (next.call.phase !== was.call?.phase || next.call.agentId !== was.call.agentId) {
      store.set(callMoodAtom(next.call.agentId), moodOf(next.call.phase))
    }
  }
  if (next.problem !== was.problem) store.set(callProblemAtom, next.problem)
  if (next.wrapUp !== was.wrapUp) {
    // The page may have put it away already, once the record arrived.
    if (next.wrapUp !== undefined || store.get(callWrapUpAtom) === was.wrapUp) {
      store.set(callWrapUpAtom, next.wrapUp)
    }
  }
})

// A page that is left takes the call with it: the server is told on the way out.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    const left = caller.leaving()
    if (left === undefined) return
    void fetch(
      `/api/agents/${encodeURIComponent(left.agentId)}/calls/${encodeURIComponent(left.callId)}/end`,
      {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines: left.lines }),
      },
    ).catch(() => {})
  })
}

/** Call a Dood, in a chat of its own that the person talks in. Does nothing while a call is on. */
export const startCall = (agent: { id: string; name: string | null }, chatId: string) =>
  caller.start(agent, chatId)

/** Hang up. `problem` is why, where the call ended by itself. */
export const endCall = (problem?: string) => caller.end(problem)

/** Stop the person being heard, or let them be heard again. The Dood's voice goes on. */
export const setCallMuted = (muted: boolean) => caller.setMuted(muted)

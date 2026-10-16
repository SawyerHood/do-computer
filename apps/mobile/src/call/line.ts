import type { OpenVoiceLine, VoiceLine } from "@do-computer/client"
import type { StartedCall } from "@do-computer/protocol"
import { requestRecordingPermissionsAsync } from "expo-audio"
import { Platform } from "react-native"

/**
 * The sound of a call on this device. React Native has no WebRTC of its own, so the sound is
 * carried by `LINE_PAGE` (line-page.ts) in a web view no one sees: the system's web view has
 * WebRTC and the microphone, and the app already has a web view in it. That needs nothing new
 * built into the app. Here is the app's side of talking to that page; `line-host.tsx` is where
 * it is drawn, and `line-host.web.tsx` is the same in the browser build.
 */

/** What the app tells the page. */
export type ToPage =
  | { type: "open" }
  | { type: "answer"; sdp: string }
  | { type: "send"; events: string[] }
  | { type: "mute"; muted: boolean }
  | { type: "close" }

/** What the page tells the app. */
export type FromPage =
  | { type: "ready" }
  | { type: "offer"; sdp: string }
  | { type: "answered" }
  | { type: "event"; data: string }
  | { type: "levels"; you: number; dood: number }
  | { type: "lost" }
  | { type: "failed"; name: string; message: string }

/** Where the page is drawn: it is put there with what it says going to `onMessage`. */
export type LineHost = {
  open(onMessage: (message: FromPage) => void): { post(message: ToPage): void; release(): void }
}

let host: LineHost | undefined

/** The host is mounted, or gone. There is one, under the signed-in app. */
export function setLineHost(next: LineHost | undefined): void {
  host = next
}

/** Read what a page said, which arrives as a string. Null for anything else. */
export function readFromPage(data: unknown): FromPage | null {
  if (typeof data !== "string") return null
  try {
    const message = JSON.parse(data) as { type?: unknown }
    return typeof message?.type === "string" ? (message as FromPage) : null
  } catch {
    return null
  }
}

/** An error the way a browser gives one: a name to tell what it was by, and words. */
const named = (name: string, message: string) => Object.assign(new Error(message), { name })

/**
 * The microphone is asked for by the app before the page asks for it: on a phone the app is
 * what is allowed it or not, and a "no" said to the app is not one the page can ask past.
 */
async function allowMicrophone(): Promise<void> {
  if (Platform.OS === "web") return
  const { granted } = await requestRecordingPermissionsAsync()
  if (!granted) throw named("NotAllowedError", "The microphone is not allowed.")
}

/** What went wrong asking for the microphone, in words this person can act on. */
export function microphoneProblem(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name
  if (name === "NotAllowedError" || name === "SecurityError") {
    return Platform.OS === "web"
      ? "The microphone is not allowed here. Check the permission for this site, then call again."
      : "Do Computer is not allowed the microphone. Allow it in Settings, then call again."
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found."
  }
  return error instanceof Error ? error.message : "The call could not be started."
}

/** A real call, carried by the page: it makes the offer, the app places the call with it. */
export const openLine: OpenVoiceLine = async (place, onEvent, onLost) => {
  await allowMicrophone()
  const where = host
  if (where === undefined) throw new Error("The call could not be started here.")
  let levels = { you: 0, dood: 0 }
  let settled = false
  let closed = false
  return new Promise<{ line: VoiceLine; call: StartedCall }>((resolve, reject) => {
    let call: StartedCall | undefined
    const page = where.open((message) => {
      if (closed) return
      switch (message.type) {
        case "ready":
          page.post({ type: "open" })
          return
        case "offer":
          place(message.sdp).then((placed) => {
            if (placed.sdp === null) throw new Error("The call was not answered.")
            call = placed
            page.post({ type: "answer", sdp: placed.sdp })
          }, fail)
          return
        case "answered":
          if (call === undefined || settled) return
          settled = true
          resolve({ call, line })
          return
        case "event":
          onEvent(message.data)
          return
        case "levels":
          levels = { you: message.you, dood: message.dood }
          return
        case "lost":
          if (settled) onLost()
          else fail(new Error("The call was cut off."))
          return
        case "failed":
          fail(named(message.name, message.message))
          return
      }
    })
    const line: VoiceLine = {
      send: (events) => page.post({ type: "send", events }),
      setMuted: (muted) => page.post({ type: "mute", muted }),
      levels: () => levels,
      close() {
        if (closed) return
        closed = true
        page.post({ type: "close" })
        // The page lets the microphone go when it is told; then it is taken down.
        setTimeout(() => page.release(), 200)
      },
    }
    function fail(error: unknown) {
      if (settled) {
        // Placed, and then lost: the call is over.
        if (!closed) onLost()
        return
      }
      settled = true
      line.close()
      reject(error)
    }
  })
}

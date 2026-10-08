import { useCallback, useEffect, useRef, useState } from "react"
import { client } from "./client.ts"

export type DictationState = "idle" | "recording" | "transcribing"

/** What becomes of what was said: it joins the draft to be read over, or goes as a message. */
export type DictationEnd = "draft" | "send"

/**
 * Record from the microphone and turn it into text on the server. `start` begins a recording and
 * `stop` ends it, saying what the text is for; `onText` receives the result. `cancel` drops the
 * recording, or the text that is on its way. `stream` is the microphone while it is recording,
 * for drawing what it hears.
 */
export function useDictation(onText: (text: string, end: DictationEnd) => void) {
  const [state, setState] = useState<DictationState>("idle")
  const [error, setError] = useState<string>()
  const [stream, setStream] = useState<MediaStream>()
  const recorder = useRef<MediaRecorder | undefined>(undefined)
  const starting = useRef(false)
  const end = useRef<DictationEnd>("draft")
  // Each recording has a number. Cancelling moves on to the next, so that whatever the cancelled
  // one still has to say is not listened to.
  const take = useRef(0)
  const deliver = useRef(onText)
  deliver.current = onText

  const supported =
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getUserMedia !== undefined &&
    typeof MediaRecorder !== "undefined"

  // Leaving the page mid-recording must release the microphone.
  useEffect(
    () => () => {
      take.current++
      recorder.current?.stream.getTracks().forEach((track) => track.stop())
    },
    [],
  )

  const start = useCallback(async () => {
    if (starting.current || recorder.current?.state === "recording") return
    setError(undefined)
    starting.current = true
    const mine = ++take.current
    let microphone: MediaStream
    try {
      microphone = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      if (take.current === mine) {
        setError("The microphone is not available. Check the browser's permission for this site.")
      }
      return
    } finally {
      starting.current = false
    }
    // Cancelled, or left, while the browser was asking for the microphone.
    if (take.current !== mine) return microphone.getTracks().forEach((track) => track.stop())
    const chunks: Blob[] = []
    const active = new MediaRecorder(microphone)
    recorder.current = active
    end.current = "draft"
    active.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    active.onstop = async () => {
      microphone.getTracks().forEach((track) => track.stop())
      if (recorder.current === active) recorder.current = undefined
      setStream((current) => (current === microphone ? undefined : current))
      if (take.current !== mine) return
      const audio = new Blob(chunks, { type: active.mimeType })
      if (audio.size === 0) return setState("idle")
      setState("transcribing")
      try {
        const text = await client.transcribe({ type: audio.type, body: audio })
        if (take.current === mine && text !== "") deliver.current(text, end.current)
      } catch (caught) {
        if (take.current === mine) {
          setError(caught instanceof Error ? caught.message : "Dictation failed.")
        }
      } finally {
        if (take.current === mine) setState("idle")
      }
    }
    active.start()
    setStream(microphone)
    setState("recording")
  }, [])

  const stop = useCallback((then: DictationEnd = "draft") => {
    if (recorder.current?.state !== "recording") return
    end.current = then
    recorder.current.stop()
  }, [])

  const cancel = useCallback(() => {
    take.current++
    if (recorder.current?.state === "recording") recorder.current.stop()
    setState("idle")
  }, [])

  return { state, error, supported, stream, start, stop, cancel }
}

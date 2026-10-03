import { useCallback, useEffect, useRef, useState } from "react"
import { client } from "./client.ts"

export type DictationState = "idle" | "recording" | "transcribing"

/**
 * Record from the microphone and turn it into text on the server. `toggle` starts a recording,
 * and stops it when one is running; `onText` receives the result.
 */
export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle")
  const [error, setError] = useState<string>()
  const recorder = useRef<MediaRecorder | undefined>(undefined)
  const deliver = useRef(onText)
  deliver.current = onText

  const supported =
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getUserMedia !== undefined &&
    typeof MediaRecorder !== "undefined"

  // Leaving the page mid-recording must release the microphone.
  useEffect(
    () => () => {
      recorder.current?.stream.getTracks().forEach((track) => track.stop())
    },
    [],
  )

  const toggle = useCallback(async () => {
    if (recorder.current?.state === "recording") {
      recorder.current.stop()
      return
    }
    setError(undefined)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError("The microphone is not available. Check the browser's permission for this site.")
      return
    }
    const chunks: Blob[] = []
    const active = new MediaRecorder(stream)
    recorder.current = active
    active.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    active.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop())
      recorder.current = undefined
      const audio = new Blob(chunks, { type: active.mimeType })
      if (audio.size === 0) return setState("idle")
      setState("transcribing")
      try {
        const text = await client.transcribe({ type: audio.type, body: audio })
        if (text !== "") deliver.current(text)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Dictation failed.")
      } finally {
        setState("idle")
      }
    }
    active.start()
    setState("recording")
  }, [])

  return { state, error, supported, toggle }
}

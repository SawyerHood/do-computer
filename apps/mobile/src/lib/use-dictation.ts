import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio"
import { useCallback, useState } from "react"
import { Platform } from "react-native"
import { useSession } from "./use-session.ts"

export type DictationState = "idle" | "recording" | "transcribing"

/** Record a message with the microphone and get it back as text from the server. */
export function useDictation(onText: (text: string) => void) {
  const { client } = useSession()
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const [state, setState] = useState<DictationState>("idle")
  const [error, setError] = useState<string>()

  const toggle = useCallback(async () => {
    if (state === "transcribing") return
    setError(undefined)
    try {
      if (state === "idle") {
        const { granted } = await requestRecordingPermissionsAsync()
        if (!granted) return setError("Allow microphone access to dictate.")
        if (Platform.OS !== "web")
          await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
        await recorder.prepareToRecordAsync()
        recorder.record()
        return setState("recording")
      }
      await recorder.stop()
      const uri = recorder.uri
      if (!uri) return setState("idle")
      setState("transcribing")
      // The recording is a local file on a device and a blob in a browser; both can be fetched.
      const audio = await (await fetch(uri)).blob()
      const type = audio.type || (Platform.OS === "web" ? "audio/webm" : "audio/mp4")
      const text = await client.transcribe({ type, body: audio })
      if (text !== "") onText(text)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Dictation failed.")
    } finally {
      setState((current) => (current === "transcribing" ? "idle" : current))
    }
  }, [client, onText, recorder, state])

  return { state, error, toggle }
}

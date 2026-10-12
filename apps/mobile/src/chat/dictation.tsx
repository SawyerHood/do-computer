import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio"
import { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, Platform, Pressable, View } from "react-native"
import { type Accent, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { haptic, Icon, Text } from "@/ui"

export type DictationState = "idle" | "recording" | "transcribing"
/** What becomes of what was said: put in the box to be read over, or sent as it is. */
export type DictationEnd = "draft" | "send"

const REFUSED =
  Platform.OS === "web"
    ? "The microphone is not available. Check the browser's permission for this site."
    : "The microphone is not available. Allow it for Do Computer in Settings."

/**
 * Dictating a message: record with the microphone, hear how loud it is for the waveform, and
 * get the words back from the server. As `useDictation` in src/lib, with a way to throw the
 * recording away and to say what the words are for when it is stopped.
 */
export function useChatDictation(onText: (text: string, end: DictationEnd) => void) {
  const { client } = useSession()
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true })
  const [state, setState] = useState<DictationState>("idle")
  const [error, setError] = useState<string>()
  // Which recording is going. One that was cancelled is not this one any more when it answers.
  const run = useRef(0)
  const told = useRef(onText)
  told.current = onText

  const start = useCallback(async () => {
    if (state !== "idle") return
    setError(undefined)
    const mine = ++run.current
    try {
      const { granted } = await requestRecordingPermissionsAsync()
      if (!granted) return setError(REFUSED)
      if (Platform.OS !== "web") {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      }
      await recorder.prepareToRecordAsync()
      if (mine !== run.current) return
      recorder.record()
      setState("recording")
    } catch (caught) {
      setError(caught instanceof Error && caught.message !== "" ? caught.message : REFUSED)
    }
  }, [recorder, state])

  const stop = useCallback(
    async (end: DictationEnd) => {
      if (state !== "recording") return
      const mine = run.current
      setState("transcribing")
      try {
        await recorder.stop()
        const uri = recorder.uri
        if (!uri) return
        // The recording is a local file on a device and a blob in a browser; both can be fetched.
        const audio = await (await fetch(uri)).blob()
        const type = audio.type || (Platform.OS === "web" ? "audio/webm" : "audio/mp4")
        const text = await client.transcribe({ type, body: audio })
        if (mine === run.current && text !== "") told.current(text, end)
      } catch (caught) {
        if (mine === run.current) {
          setError(caught instanceof Error ? caught.message : "Dictation failed.")
        }
      } finally {
        if (mine === run.current) setState("idle")
      }
    },
    [client, recorder, state],
  )

  const cancel = useCallback(() => {
    run.current += 1
    setState((current) => {
      if (current === "recording") void recorder.stop().catch(() => {})
      return "idle"
    })
  }, [recorder])

  return { state, error, recorder, start, stop, cancel }
}

const BARS = 36

type Recorder = ReturnType<typeof useAudioRecorder>

/**
 * What the microphone hears, as bars moving across where the words would be. The recorder is
 * asked how loud it is only here, while the bars are on screen, and not by the whole message box.
 */
function Waveform({
  recorder,
  active,
  color,
}: {
  recorder: Recorder
  active: boolean
  color: string
}) {
  const [bars, setBars] = useState<number[]>(() => new Array<number>(BARS).fill(0))
  const heard = useAudioRecorderState(recorder, 80)
  // How loud it is from 0 to 1. The meter is in decibels below full, where there is one.
  const latest = useRef<number | undefined>(undefined)
  latest.current =
    heard.metering === undefined ? undefined : Math.min(1, Math.max(0, (heard.metering + 55) / 55))
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      // Where the loudness is not told (a browser), the bars still move, to show it is listening.
      const next = latest.current ?? 0.25 + Math.random() * 0.4
      setBars((current) => [...current.slice(1), next])
    }, 80)
    return () => clearInterval(timer)
  }, [active])
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        flex: 1,
        height: 28,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        opacity: active ? 1 : 0.4,
      }}
    >
      {bars.map((bar, at) => (
        <View
          key={at}
          style={{
            flex: 1,
            maxWidth: 3,
            height: 3 + Math.round(bar * 24),
            borderRadius: 2,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  )
}

/**
 * The message box while it is listening: the waveform, what it is doing, and its buttons.
 * Stopping puts what was said in the box to be read over; sending sends it as it is; the cross
 * throws it away.
 */
export function Dictating({
  state,
  recorder,
  accent,
  onCancel,
  onStop,
}: {
  state: DictationState
  recorder: Recorder
  accent: Accent
  onCancel: () => void
  onStop: (end: DictationEnd) => void
}) {
  const theme = useTheme()
  const [end, setEnd] = useState<DictationEnd>("draft")
  const transcribing = state === "transcribing"
  const stop = (chosen: DictationEnd) => {
    haptic.light()
    setEnd(chosen)
    onStop(chosen)
  }
  return (
    <View style={{ flex: 1, paddingLeft: 14, paddingRight: 5, paddingVertical: 5, gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Waveform recorder={recorder} active={!transcribing} color={accent.a} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel dictating"
          onPress={onCancel}
          hitSlop={6}
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="close" size={16} color={theme.ink2} weight="semibold" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop dictating"
          accessibilityHint="Stop, and put it in the message"
          disabled={transcribing}
          onPress={() => stop("draft")}
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.fill,
          }}
        >
          {transcribing && end === "draft" ? (
            <ActivityIndicator size="small" color={theme.ink2} />
          ) : (
            <Icon name="stop" size={15} color={transcribing ? theme.ink3 : theme.ink} />
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send what you said"
          disabled={transcribing}
          onPress={() => stop("send")}
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: accent.a,
            opacity: transcribing && end !== "send" ? 0.5 : 1,
          }}
        >
          {transcribing && end === "send" ? (
            <ActivityIndicator size="small" color={accent.onA} />
          ) : (
            <Icon name="arrowUp" size={16} color={accent.onA} weight="bold" />
          )}
        </Pressable>
      </View>
      <Text variant="caption" tone="ink2" accessibilityRole="text" accessibilityLiveRegion="polite">
        {transcribing ? "Turning what you said into text" : "Listening"}
      </Text>
    </View>
  )
}

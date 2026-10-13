import { useEventListener } from "expo"
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio"
import { useState } from "react"
import { Platform, View } from "react-native"
import { useTheme } from "@/lib/theme"
import { Text } from "@/ui"
import { lengthOf } from "./logic"
import { Unplayed, usePlayed, type Way } from "./played"
import { Card, RoundButton } from "./shared"

/**
 * A sound, played where it is: a button that plays and stops it, how far into it it is and how
 * long it is, and between them a bar that fills as it plays and is pressed to move to another
 * place in it. It keeps the address it was first given, since a new one would start it again;
 * whoever draws it gives it a key that changes when the sound itself does.
 */
export function Sound({
  src,
  name,
  onStale,
  way,
}: {
  src: string
  name: string
  onStale?: () => Promise<string | undefined>
  way?: Way
}) {
  const theme = useTheme()
  const played = usePlayed(src, onStale)
  const player = useAudioPlayer(played.address, { updateInterval: 250 })
  const status = useAudioPlayerStatus(player)
  // What the player itself says, and not what was last heard from the one before it: a fresh
  // address has a player of its own.
  useEventListener(player, "playbackStatusUpdate", (now) => {
    if (now.error !== null) return played.stopped(now.currentTime)
    if (now.playing) played.playing()
    if (!now.isLoaded) return
    const at = played.place()
    if (at > 0) void player.seekTo(at)
  })
  // How wide the bar is drawn, which is what a press on it is measured against.
  const [wide, setWide] = useState(0)
  // Until the sound has said how long it is, it is not known, and nothing can be moved to.
  const total = Number.isFinite(status.duration) && status.duration > 0 ? status.duration : 0
  const at = Math.min(Math.max(0, status.currentTime), total)
  const toggle = async () => {
    if (status.playing) return player.pause()
    // On an iPhone a sound is heard with the ringer off, as in any app that plays one. This is
    // said when it is played and not before, since saying it ends a recording: dictation says
    // what it needs each time it starts, so it is not kept from recording afterwards.
    if (Platform.OS === "ios") await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {})
    // One that was played to its end starts again from its beginning.
    if (total > 0 && total - at < 0.1) await player.seekTo(0)
    player.play()
  }
  if (played.failed) return <Unplayed name={name} way={way} />
  return (
    <Card
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 10,
        width: 320,
        maxWidth: "100%",
      }}
    >
      <RoundButton
        icon={status.playing ? "pause" : "play"}
        label={status.playing ? `Pause ${name}` : `Play ${name}`}
        onPress={() => void toggle()}
      />
      <Text variant="footnote" tone="ink2" style={{ fontVariant: ["tabular-nums"] }}>
        {lengthOf(at)}
      </Text>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={`Where ${name} is played from`}
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(at)}
        hitSlop={8}
        onLayout={(event) => setWide(event.nativeEvent.layout.width)}
        // A press, and not a button's: where along the bar it was is what matters, which a
        // button's press does not say in a browser.
        onStartShouldSetResponder={() => total > 0}
        onResponderRelease={(event) => {
          const part = event.nativeEvent.locationX / wide
          if (Number.isFinite(part)) void player.seekTo(Math.min(1, Math.max(0, part)) * total)
        }}
        style={{ flex: 1, height: 28, justifyContent: "center" }}
      >
        {/* Nothing in the bar takes the press itself, so that it is measured from the bar's start. */}
        <View
          pointerEvents="none"
          style={{ height: 4, borderRadius: 2, backgroundColor: theme.fill }}
        >
          <View
            style={{
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.tint,
              width: `${total === 0 ? 0 : (at / total) * 100}%`,
            }}
          />
        </View>
      </View>
      <Text variant="footnote" tone="ink2" style={{ fontVariant: ["tabular-nums"] }}>
        {lengthOf(total)}
      </Text>
    </Card>
  )
}
